import httpx
from pydantic import SecretStr

from agent_school.contracts import ModelAccess


async def test_connection_check_requires_successful_tool_roundtrip_and_hides_provider_errors():
    from agent_school.runtime.model_connector import ModelConnector

    def handle(request):
        import json

        body = json.loads(request.content)
        if body.get("tools"):
            return httpx.Response(
                200, json={"choices": [{"message": {"role": "assistant", "content": "不支持工具"}}]}
            )
        return httpx.Response(200, json={"choices": [{"message": {"role": "assistant", "content": "ok"}}]})

    access = ModelAccess(
        base_url="https://model.example/v1", model="test", api_key=SecretStr("private-key-123")
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        result = await ModelConnector(client).check(access)
    assert result["text_ok"] and not result["tools_ok"]
    assert result["error_code"] == "MODEL_INCOMPATIBLE"

    def unauthorized(request):
        return httpx.Response(401, json={"error": {"message": "private-key-123"}})

    async with httpx.AsyncClient(transport=httpx.MockTransport(unauthorized)) as client:
        result = await ModelConnector(client).check(access)
    assert result["error_code"] == "MODEL_AUTH_FAILED"
    assert "private-key-123" not in str(result)


async def test_connection_check_accepts_only_valid_noop_call():
    from agent_school.runtime.model_connector import ModelConnector

    def handle(request):
        import json

        body = json.loads(request.content)
        message = {"role": "assistant", "content": "ok"}
        if body.get("tools"):
            message["tool_calls"] = [
                {
                    "id": "check-call",
                    "type": "function",
                    "function": {"name": "connection_probe", "arguments": '{"value":"ok"}'},
                }
            ]
        return httpx.Response(200, json={"choices": [{"message": message}]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        result = await ModelConnector(client).check(
            ModelAccess(base_url="https://model.example/v1", model="test", api_key=SecretStr("private-key"))
        )
    assert result["tools_ok"]
    assert result["status"] == "passed"
