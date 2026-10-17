import asyncio
import json
from fastapi.responses import Response, StreamingResponse
from agent_school.errors import AppError
from agent_school.service import now

TERMINAL={"completed","failed","cancelled","interrupted"}

class EventStore:
    def __init__(self, school):
        self.school=school
        self.store=school.store
        self.signals={}

    def append(self, run_id, kind, payload):
        with self.store.atomic():
            run=self.store.get("run",run_id)
            value={"schema_version":"0.1.0","run_id":run_id,"attempt_id":run["attempt_id"],
                "seq":run["last_seq"]+1,"mode":run["mode"],"kind":kind,"created_at":now(),
                "payload":self.school.credentials.redact(payload)}
            self.school.contracts.validate("StoredEvent",value,response=True)
            value=self.store.append_event(run_id,value)
        signal=self.signals.get(run_id)
        if signal: signal.set()
        return value

    def history(self, run_id, after=0, limit=100):
        run=self.store.get("run",run_id)
        if after>run["last_seq"]:
            raise AppError("CURSOR_INVALID","事件位置超过最新记录。",400)
        values=[v for v in self.store.event_list(run_id) if v["seq"]>after][:limit]
        next_seq=values[-1]["seq"] if values else after
        return {"items":values,"next_after_seq":next_seq,
            "has_more":next_seq<run["last_seq"],"last_seq":run["last_seq"]}

    def subscribe(self, run_id, after=0):
        run=self.store.get("run",run_id)
        if after>run["last_seq"]:
            raise AppError("CURSOR_INVALID","事件位置超过最新记录。",400)
        if run["status"] in TERMINAL and after==run["last_seq"]:
            return Response(status_code=204)
        async def frames():
            nonlocal after
            # The subscriber owns its notification, so it cannot clear another subscriber's wakeup.
            while True:
                page=self.history(run_id,after,500)
                for value in page["items"]:
                    yield f"id: {value['seq']}\nevent: {value['kind']}\ndata: "+json.dumps(value,ensure_ascii=False)+"\n\n"
                    after=value["seq"]
                run=self.store.get("run",run_id)
                if run["status"] in TERMINAL and after>=run["last_seq"]:
                    break
                if page["has_more"]:
                    continue
                await asyncio.sleep(0.05)
                # Polling the durable event sequence avoids history/notification races.
                if not self.history(run_id,after,1)["items"]:
                    frames.idle = getattr(frames,"idle",0)+1
                    if frames.idle>=300:
                        frames.idle=0
                        yield ": heartbeat\n\n"
        return StreamingResponse(frames(),media_type="text/event-stream",
            headers={"Cache-Control":"no-store","X-Accel-Buffering":"no"})

