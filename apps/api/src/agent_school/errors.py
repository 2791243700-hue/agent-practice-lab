from uuid import uuid4


def new_id(prefix="id"):
    return prefix + "-" + uuid4().hex


def error_body(code, message, retryable=False, fields=None):
    return {
        "error": {
            "code": code,
            "message": message,
            "request_id": new_id("request"),
            "retryable": retryable,
            "fields": fields or [],
        }
    }


class AppError(Exception):
    def __init__(
        self,
        code="VALIDATION_ERROR",
        message="请求内容不符合要求。",
        status=422,
        retryable=False,
        fields=None,
    ):
        self.status = status
        self.code = code
        self.body = error_body(code, message, retryable, fields)
        super().__init__(code)


def not_found():
    raise AppError("NOT_FOUND", "没有找到该资源。", 404)


def revision(record, expected):
    if record["revision"] != expected:
        raise AppError("REVISION_CONFLICT", "设置已变化，请刷新后重试。", 409)
