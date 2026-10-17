import base64
import copy
import hashlib
import json
from datetime import datetime, timezone
from agent_school.db import Store
from agent_school.errors import AppError, new_id, revision
from agent_school.lessons import LessonCatalog
from agent_school.schema import Contracts

def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00","Z")

def fingerprint(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()).hexdigest()

class School:
    def __init__(self, config):
        self.config = config
        self.contracts = Contracts(config.root)
        self.store = Store(config.data_dir)
        self.catalog = LessonCatalog(self.store,self.contracts,config.root / "content/lessons")
        from agent_school.credentials import InMemoryCredentialStore
        from agent_school.model_profiles import ModelProfiles
        self.credentials = InMemoryCredentialStore()
        self.slot = None
        self.busy_profile = None
        self.profiles = ModelProfiles(self)

    def attempt(self, key, active=False):
        value = self.store.get("attempt",key)
        if active and value["status"] != "active":
            raise AppError("ATTEMPT_SUPERSEDED","请继续新创建的实验。",409)
        return value

    def idle(self, attempt):
        if attempt["active_run_id"]:
            raise AppError("ATTEMPT_BUSY","请等待当前运行结束或先停止。",409,True)

    def page(self, values, params):
        filters = {k:v for k,v in params.items() if k not in ("cursor","limit")}
        values = [v for v in values if all(v.get(k)==value for k,value in filters.items())]
        values.sort(key=lambda v:(v["created_at"],v["id"]),reverse=True)
        token = params.get("cursor")
        if token:
            try:
                cursor = json.loads(base64.urlsafe_b64decode(token + "=" * (-len(token)%4)))
                if cursor["filter"] != fingerprint(filters):
                    raise ValueError()
                boundary = tuple(cursor["after"])
                values = [v for v in values if (v["created_at"],v["id"]) < boundary]
            except Exception:
                raise AppError("CURSOR_INVALID","分页位置无效，请重新读取列表。",400) from None
        limit = params.get("limit",20)
        items = values[:limit]
        next_cursor = None
        if len(values)>limit:
            next_cursor = base64.urlsafe_b64encode(json.dumps({"filter":fingerprint(filters),
                "after":[items[-1]["created_at"],items[-1]["id"]]}).encode()).decode().rstrip("=")
        return {"items":items,"next_cursor":next_cursor}

    def create_attempt(self, body):
        if body["mode"]=="demo" and not self.config.demo_enabled:
            raise AppError("DEMO_DISABLED","此服务未启用演示模式。",403)
        lesson = self.catalog.get(body["lesson_id"],body["lesson_version"])
        value = {"id":new_id("attempt"),"owner_id":"local-owner",**body,"revision":1,"status":"active",
            "settings":copy.deepcopy(lesson["manifest"]["settings_policy"]["defaults"]),
            "selected_file_ids":[],"progress":"not_started","active_run_id":None,
            "latest_submission_id":None,"reset_to_attempt_id":None,"created_at":now(),"updated_at":now()}
        self.store.put("attempt",value["id"],value)
        return value

    def update_attempt(self, key, body):
        value = self.attempt(key,True)
        revision(value,body["expected_revision"])
        lesson = self.catalog.get(value["lesson_id"],value["lesson_version"])
        policy = lesson["manifest"]["settings_policy"]
        for field,setting in body["settings"].items():
            if field not in policy["editable_fields"] and setting!=value["settings"][field]:
                raise AppError()
        if not set(body["selected_file_ids"]) <= {v["id"] for v in lesson["materials"]}:
            raise AppError(message="只能选择本关提供的材料。")
        value.update(settings=body["settings"],selected_file_ids=body["selected_file_ids"],
                     revision=value["revision"]+1,updated_at=now())
        return self.store.put("attempt",key,value)

    def reset_idle(self, key, body):
        old = self.attempt(key,True)
        revision(old,body["expected_revision"])
        self.idle(old)
        value = self.create_attempt({k:old[k] for k in ("lesson_id","lesson_version","mode")})
        old.update(status="superseded",revision=old["revision"]+1,reset_to_attempt_id=value["id"],updated_at=now())
        self.store.put("attempt",key,old)
        return value

    async def prepare(self, operation, path, params, body):
        if operation=="checkConnection":
            return await self.profiles.check(path["profile_id"],body)

    async def dispatch(self, operation, path, params, body, prepared=None):
        if operation=="getHealth": return {"status":"ok","contract_version":"0.1.0"}
        if operation=="getMe": return {"id":"local-owner","auth_mode":"local",
            "capabilities":{"demo_enabled":self.config.demo_enabled,"max_active_runs":1}}
        if operation=="getLesson":
            return self.catalog.public(self.catalog.get(path["lesson_id"],params.get("version")))
        if operation=="listLessons":
            ids = {v["manifest"]["id"] for v in self.store.list("lesson",owner="system")}
            details = [self.catalog.public(self.catalog.get(key)) for key in ids]
            return {"items":[{k:v[k] for k in ("id","version","title","description","order","completed")}
                for v in sorted(details,key=lambda v:v["order"])]}
        if operation=="createAttempt": return self.create_attempt(body)
        if operation=="getAttempt": return self.attempt(path["attempt_id"])
        if operation=="listAttempts": return self.page(self.store.list("attempt"),params)
        if operation=="updateAttempt": return self.update_attempt(path["attempt_id"],body)
        if operation=="resetAttempt": return self.reset_idle(path["attempt_id"],body)
        if operation=="listProfiles": return {"items":self.store.list("profile")}
        if operation=="getProfile": return self.store.get("profile",path["profile_id"])
        if operation=="createProfile": return self.profiles.create(body)
        if operation in ("updateProfile","setCredential","clearCredential","deleteProfile"):
            return self.profiles.mutate(operation,path["profile_id"],body,params)
        if operation=="checkConnection":
            return self.store.put("profile",path["profile_id"],prepared)
        raise AppError("NOT_FOUND","尚未实现的接口。",404)

    async def close(self):
        self.credentials.clear()
        self.store.close()

