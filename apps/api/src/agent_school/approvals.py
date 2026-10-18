import asyncio
from datetime import datetime, timedelta, timezone

from agent_school.errors import AppError, new_id
from agent_school.service import now


class ApprovalBroker:
    def __init__(self, school):
        self.school = school
        self.store = school.store
        self.waiters = {}

    def finish(self, approval, status, decision=None):
        approval = {**approval, "status": status, "decision": decision, "decided_at": now()}
        self.store.put("approval", approval["id"], approval)
        run = self.store.get("run", approval["run_id"])
        run["pending_approval"] = None
        self.store.put("run", run["id"], run)
        self.school.events.append(run["id"], "approval.decided", {"approval": approval})
        return approval

    def decide(self, approval_id, decision):
        with self.store.atomic():
            approval = self.store.get("approval", approval_id)
            if approval["status"] == "pending":
                run = self.store.get("run", approval["run_id"])
                if run["status"] not in ("running", "awaiting_approval"):
                    approval = self.finish(approval, "cancelled")
                elif datetime.fromisoformat(approval["expires_at"].replace("Z", "+00:00")) <= datetime.now(
                    timezone.utc
                ):
                    approval = self.finish(approval, "expired")
                else:
                    approval = self.finish(
                        approval, "approved" if decision == "approve" else "denied", decision
                    )
            future = self.waiters.get(approval_id)
            if approval["status"] == "expired":
                code = "APPROVAL_EXPIRED"
            elif approval["status"] == "cancelled":
                code = "APPROVAL_INVALIDATED"
            elif approval["decision"] != decision:
                code = "APPROVAL_ALREADY_DECIDED"
            else:
                code = None
            if future and not future.done():
                if code:
                    future.set_result(code)
                else:
                    future.set_result(decision)
        # Persist invalidation before returning the error; it is a real lifecycle transition.
        if code:
            raise AppError(code, "该授权已失效或已作出其他决定。", 409)
        return approval

    async def request(self, context, call):
        approval = {
            "id": new_id("approval"),
            "run_id": context.run_id,
            "call_id": call.id,
            "tool_name": "save_todos",
            "arguments": call.arguments,
            "status": "pending",
            "decision": None,
            "created_at": now(),
            "expires_at": (
                datetime.now(timezone.utc) + timedelta(seconds=self.school.config.approval_timeout)
            )
            .isoformat()
            .replace("+00:00", "Z"),
            "decided_at": None,
        }
        future = asyncio.get_running_loop().create_future()
        self.waiters[approval["id"]] = future
        with self.store.atomic():
            self.store.put("approval", approval["id"], approval)
            run = self.store.get("run", context.run_id)
            run.update(status="awaiting_approval", pending_approval=approval)
            self.store.put("run", run["id"], run)
            self.school.events.append(run["id"], "approval.requested", {"approval": approval})
        context.pause()
        try:
            decision = await asyncio.wait_for(future, self.school.config.approval_timeout)
            if decision not in ("approve", "deny"):
                raise AppError(decision, "授权已失效。", 409)
            return decision == "approve"
        except TimeoutError:
            with self.store.atomic():
                current = self.store.get("approval", approval["id"])
                if current["status"] == "pending":
                    self.finish(current, "expired")
            raise AppError("APPROVAL_EXPIRED", "授权等待超时。", 409) from None
        finally:
            self.waiters.pop(approval["id"], None)
            context.resume()
            with self.store.atomic():
                run = self.store.get("run", context.run_id)
                if run["status"] == "awaiting_approval":
                    run.update(status="running", pending_approval=None)
                    self.store.put("run", run["id"], run)

    def invalidate(self, run_id):
        for value in self.store.list("approval"):
            if value["run_id"] == run_id and value["status"] == "pending":
                self.finish(value, "cancelled")
