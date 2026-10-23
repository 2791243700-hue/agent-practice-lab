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
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def fingerprint(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()


class School:
    def __init__(self, config, contracts: Contracts | None = None):
        self.config = config
        self.contracts = contracts if contracts is not None else Contracts(config.root)
        from agent_school.instance import InstanceLock

        self.instance_lock = InstanceLock(config.data_dir)
        self.store = Store(config.data_dir)
        self.catalog = LessonCatalog(self.store, self.contracts, config.root / "content/lessons")
        from agent_school.credentials import InMemoryCredentialStore
        from agent_school.model_profiles import ModelProfiles

        self.credentials = InMemoryCredentialStore()
        self.slot = None
        self.busy_profile = None
        self.profiles = ModelProfiles(self)
        from agent_school.approvals import ApprovalBroker
        from agent_school.events import EventStore
        from agent_school.runs import RunService
        from agent_school.tools import ToolGateway
        from agent_school.workspaces import WorkspaceStore

        self.workspace = WorkspaceStore(self)
        self.events = EventStore(self)
        self.approvals = ApprovalBroker(self)
        self.gateway = ToolGateway(self)
        self.runs = RunService(self)
        from agent_school.exports import ExportService
        from agent_school.submissions import SubmissionService

        self.submissions = SubmissionService(self)
        self.exports = ExportService(self)
        from agent_school.tips import TipsService

        self.tips = TipsService(self)

    def completed(self, lesson_id, version):
        attempts = {
            a["id"]
            for a in self.store.list("attempt")
            if a["lesson_id"] == lesson_id and a["lesson_version"] == version
        }
        return any(
            s["attempt_id"] in attempts and s["passed"] and s["mode"] == "live"
            for s in self.store.list("submission")
        )

    def attempt(self, key, active=False):
        value = self.store.get("attempt", key)
        if active and value["status"] != "active":
            raise AppError("ATTEMPT_SUPERSEDED", "请继续新创建的实验。", 409)
        return value

    def idle(self, attempt):
        if attempt["active_run_id"]:
            raise AppError("ATTEMPT_BUSY", "请等待当前运行结束或先停止。", 409, True)

    def page(self, values, params, scope="attempts"):
        filters = {k: v for k, v in params.items() if k not in ("cursor", "limit")}
        values = [v for v in values if all(v.get(k) == value for k, value in filters.items())]
        values.sort(key=lambda v: (v["created_at"], v["id"]), reverse=True)
        token = params.get("cursor")
        if token:
            try:
                cursor = json.loads(base64.urlsafe_b64decode(token + "=" * (-len(token) % 4)))
                if cursor["filter"] != fingerprint([scope, filters]):
                    raise ValueError()
                boundary = tuple(cursor["after"])
                values = [v for v in values if (v["created_at"], v["id"]) < boundary]
            except Exception:
                raise AppError("CURSOR_INVALID", "分页位置无效，请重新读取列表。", 400) from None
        limit = params.get("limit", 20)
        items = values[:limit]
        next_cursor = None
        if len(values) > limit:
            next_cursor = (
                base64.urlsafe_b64encode(
                    json.dumps(
                        {
                            "filter": fingerprint([scope, filters]),
                            "after": [items[-1]["created_at"], items[-1]["id"]],
                        }
                    ).encode()
                )
                .decode()
                .rstrip("=")
            )
        return {"items": items, "next_cursor": next_cursor}

    def create_attempt(self, body):
        if body["mode"] == "demo" and not self.config.demo_enabled:
            raise AppError("DEMO_DISABLED", "此服务未启用演示模式。", 403)
        lesson = self.catalog.get(body["lesson_id"], body["lesson_version"])
        value = {
            "id": new_id("attempt"),
            "owner_id": "local-owner",
            **body,
            "revision": 1,
            "status": "active",
            "settings": copy.deepcopy(lesson["manifest"]["settings_policy"]["defaults"]),
            "selected_file_ids": [],
            "progress": "not_started",
            "active_run_id": None,
            "latest_submission_id": None,
            "reset_to_attempt_id": None,
            "created_at": now(),
            "updated_at": now(),
        }
        self.store.put("attempt", value["id"], value)
        self.workspace.create(value["id"], lesson)
        return value

    def update_attempt(self, key, body):
        value = self.attempt(key, True)
        revision(value, body["expected_revision"])
        lesson = self.catalog.get(value["lesson_id"], value["lesson_version"])
        policy = lesson["manifest"]["settings_policy"]
        for field, setting in body["settings"].items():
            if field not in policy["editable_fields"] and setting != value["settings"][field]:
                raise AppError()
        if not set(body["selected_file_ids"]) <= {v["id"] for v in lesson["materials"]}:
            raise AppError(message="只能选择本关提供的材料。")
        value.update(
            settings=body["settings"],
            selected_file_ids=body["selected_file_ids"],
            revision=value["revision"] + 1,
            updated_at=now(),
        )
        return self.store.put("attempt", key, value)

    def reset_idle(self, key, body):
        old = self.attempt(key, True)
        revision(old, body["expected_revision"])
        self.idle(old)
        value = self.create_attempt({k: old[k] for k in ("lesson_id", "lesson_version", "mode")})
        old.update(
            status="superseded",
            revision=old["revision"] + 1,
            reset_to_attempt_id=value["id"],
            updated_at=now(),
        )
        self.store.put("attempt", key, old)
        return value

    async def prepare(self, operation, path, params, body):
        if operation == "generateRunTips":
            return await self.tips.generate(path["run_id"], body)
        if operation == "connectProfile":
            return await self.profiles.prepare_connect(body)
        if operation == "listProfileModels":
            return await self.profiles.models(path["profile_id"])
        if operation == "checkConnection":
            return await self.profiles.check(path["profile_id"], body)
        if operation == "resetAttempt":
            await self.runs.prepare_reset(path["attempt_id"], body)

    async def dispatch(self, operation, path, params, body, prepared=None):
        if operation == "generateRunTips":
            return prepared
        if operation == "getRunTips":
            return self.tips.get(path["run_id"])
        if operation == "connectProfile":
            return self.profiles.connect(prepared)
        if operation == "listProfileModels":
            return prepared
        if operation == "getHealth":
            return {"status": "ok", "contract_version": "0.1.0"}
        if operation == "getMe":
            return {
                "id": "local-owner",
                "auth_mode": "local",
                "capabilities": {"demo_enabled": self.config.demo_enabled, "max_active_runs": 1},
            }
        if operation == "getLesson":
            lesson = self.catalog.get(path["lesson_id"], params.get("version"))
            return self.catalog.public(
                lesson, self.completed(lesson["manifest"]["id"], lesson["manifest"]["version"])
            )
        if operation == "listLessons":
            ids = {v["manifest"]["id"] for v in self.store.list("lesson", owner="system")}
            details = []
            for key in ids:
                lesson = self.catalog.get(key)
                details.append(
                    self.catalog.public(lesson, self.completed(key, lesson["manifest"]["version"]))
                )
            return {
                "items": [
                    {k: v[k] for k in ("id", "version", "title", "description", "order", "completed")}
                    for v in sorted(details, key=lambda v: v["order"])
                ]
            }
        if operation == "createAttempt":
            return self.create_attempt(body)
        if operation == "getAttempt":
            return self.attempt(path["attempt_id"])
        if operation == "listAttempts":
            return self.page(self.store.list("attempt"), params)
        if operation == "updateAttempt":
            return self.update_attempt(path["attempt_id"], body)
        if operation == "resetAttempt":
            try:
                return self.reset_idle(path["attempt_id"], body)
            finally:
                self.runs.resetting.discard(path["attempt_id"])
        if operation == "listProfiles":
            return {"items": self.store.list("profile")}
        if operation == "getProfile":
            return self.store.get("profile", path["profile_id"])
        if operation == "createProfile":
            return self.profiles.create(body)
        if operation in ("updateProfile", "setCredential", "clearCredential", "deleteProfile"):
            return self.profiles.mutate(operation, path["profile_id"], body, params)
        if operation == "checkConnection":
            return self.store.put("profile", path["profile_id"], prepared)
        if operation == "listFiles":
            return {"items": self.workspace.list(path["attempt_id"])}
        if operation == "previewFile":
            return self.workspace.preview(path["attempt_id"], path["file_id"])
        if operation == "downloadFile":
            from fastapi.responses import Response

            info, data = self.workspace.read(path["attempt_id"], path["file_id"])
            from urllib.parse import quote

            return Response(
                data,
                media_type="application/octet-stream",
                headers={
                    "Content-Disposition": "attachment; filename*=UTF-8''"
                    + quote(info["display_path"].split("/")[-1])
                },
            )
        if operation == "createRun":
            return self.runs.create(body)
        if operation == "getRun":
            return self.store.get("run", path["run_id"])
        if operation == "listRuns":
            self.attempt(path["attempt_id"])
            return self.page(
                [r for r in self.store.list("run") if r["attempt_id"] == path["attempt_id"]],
                params,
                scope="runs:" + path["attempt_id"],
            )
        if operation == "cancelRun":
            return self.runs.cancel(path["run_id"])
        if operation == "getEventHistory":
            return self.events.history(path["run_id"], params.get("after_seq", 0), params.get("limit", 100))
        if operation == "streamEvents":
            return self.events.subscribe(
                path["run_id"], int(params.get("Last-Event-ID", params.get("after_seq", 0)))
            )
        if operation == "getApproval":
            return self.store.get("approval", path["approval_id"])
        if operation == "decideApproval":
            return self.approvals.decide(path["approval_id"], body["decision"])
        if operation == "createSubmission":
            return self.submissions.submit(body)
        if operation == "getSubmission":
            return self.store.get("submission", path["submission_id"])
        if operation == "listSubmissions":
            self.attempt(path["attempt_id"])
            values = [s for s in self.store.list("submission") if s["attempt_id"] == path["attempt_id"]]
            values = [
                {
                    k: s[k]
                    for k in (
                        "id",
                        "attempt_id",
                        "lesson_version",
                        "mode",
                        "passed",
                        "evaluation_passed",
                        "created_at",
                    )
                }
                for s in values
            ]
            return self.page(values, params, scope="submissions:" + path["attempt_id"])
        if operation == "downloadSubmissionFile":
            return self.submissions.download(path["submission_id"], path["file_id"])
        if operation == "createExport":
            return self.exports.create(path["attempt_id"], body)
        if operation == "getExport":
            return self.store.get("export", path["export_id"])
        if operation == "downloadExport":
            return self.exports.download(path["export_id"])
        raise AppError("NOT_FOUND", "尚未实现的接口。", 404)

    async def close(self):
        await self.runs.close()
        self.credentials.clear()
        self.store.close()
        self.instance_lock.close()
