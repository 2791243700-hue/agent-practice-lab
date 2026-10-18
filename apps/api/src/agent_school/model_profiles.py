from urllib.parse import urlsplit

from pydantic import SecretStr

from agent_school.contracts import ModelAccess
from agent_school.errors import AppError, new_id, revision
from agent_school.runtime.model_connector import ModelConnector


def unchecked():
    return {
        "status": "unchecked",
        "text_ok": False,
        "tools_ok": False,
        "error_code": None,
        "message": "请检查文本与工具调用兼容性。",
        "checked_at": None,
    }


class ModelProfiles:
    def __init__(self, school):
        self.school = school
        self.store = school.store
        self.credentials = school.credentials
        self.connector = ModelConnector()
        for value in self.store.list("profile"):
            value.update(credential_status="missing", connection_check=unchecked())
            self.store.put("profile", value["id"], value)

    def available(self, key):
        self.store.get("profile", key)
        if self.school.busy_profile == key:
            raise AppError("PROFILE_BUSY", "请等待该模型的运行结束或先停止。", 409, True)

    def validate_url(self, url):
        try:
            value = urlsplit(url)
            loopback = value.hostname in ("127.0.0.1", "localhost", "::1")
            if (
                value.username
                or value.password
                or value.query
                or value.fragment
                or not value.hostname
                or value.scheme not in ("http", "https")
                or (value.scheme == "http" and not loopback)
            ):
                raise ValueError()
            value.port
        except Exception:
            raise AppError(
                message="接口地址必须是无凭据、查询参数和片段的 HTTPS 根地址；本机服务可使用 HTTP。"
            ) from None

    def create(self, body):
        from agent_school.service import now

        self.validate_url(body["base_url"])
        value = {
            "id": new_id("profile"),
            "revision": 1,
            **body,
            "credential_status": "missing",
            "connection_check": unchecked(),
            "created_at": now(),
            "updated_at": now(),
        }
        return self.store.put("profile", value["id"], value)

    def resolve(self, key):
        value = self.store.get("profile", key)
        if value["connection_check"]["status"] != "passed" or not value["connection_check"]["tools_ok"]:
            raise AppError("MODEL_NOT_READY", "请先完成模型连接检查。")
        secret = self.credentials.get("local-owner", key)
        return ModelAccess(
            provider=value["provider"], base_url=value["base_url"], model=value["model"], api_key=secret
        )

    def mutate(self, operation, key, body, params):
        from agent_school.service import now

        self.available(key)
        value = self.store.get("profile", key)
        revision(value, (body or params)["expected_revision"])
        if operation == "updateProfile":
            self.validate_url(body["base_url"])
            value.update({k: v for k, v in body.items() if k != "expected_revision"})
        elif operation == "setCredential":
            self.credentials.set("local-owner", key, SecretStr(body["api_key"]))
        elif operation in ("clearCredential", "deleteProfile"):
            self.credentials.delete("local-owner", key)
        if operation == "deleteProfile":
            self.store.remove("profile", key)
            return None
        value.update(
            revision=value["revision"] + 1,
            credential_status="configured" if self.credentials.configured(key) else "missing",
            connection_check=unchecked(),
            updated_at=now(),
        )
        return self.store.put("profile", key, value)

    async def check(self, key, body):
        value = self.store.get("profile", key)
        revision(value, body["expected_revision"])
        if self.school.slot is not None:
            raise AppError("RUN_BUSY", "已有运行或连接检查正在进行。", 409, True)
        secret = self.credentials.get("local-owner", key)
        self.school.slot = "check"
        self.school.busy_profile = key
        try:
            access = ModelAccess(
                provider=value["provider"], base_url=value["base_url"], model=value["model"], api_key=secret
            )
            checked = await self.connector.check(access)
            return {**value, "connection_check": checked}
        finally:
            self.school.slot = None
            self.school.busy_profile = None
