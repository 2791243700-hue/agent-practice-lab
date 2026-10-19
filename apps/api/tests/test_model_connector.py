import httpx
import pytest
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


@pytest.mark.parametrize("base_url", ["https://api.deepseek.com", "https://api.deepseek.com/v1"])
async def test_deepseek_check_disables_default_thinking_for_standard_tool_calls(base_url):
    import json

    from agent_school.runtime.model_connector import ModelConnector

    requests = []

    def handle(request):
        body = json.loads(request.content)
        requests.append(body)
        if body.get("thinking") != {"type": "disabled"}:
            return httpx.Response(
                400, json={"error": {"message": "Thinking mode does not support this tool_choice"}}
            )
        message = {"role": "assistant", "content": "ok"}
        if body.get("tools"):
            message["tool_calls"] = [
                {
                    "id": "deepseek-probe",
                    "type": "function",
                    "function": {"name": "connection_probe", "arguments": '{"value":"ok"}'},
                }
            ]
        return httpx.Response(200, json={"choices": [{"message": message}]})

    access = ModelAccess(base_url=base_url, model="deepseek-flash", api_key=SecretStr("test-only"))
    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        result = await ModelConnector(client).check(access)
    assert result["status"] == "passed"
    assert len(requests) == 3
    assert requests[2]["messages"][-1]["role"] == "tool"


@pytest.mark.parametrize(
    "base_url,expected",
    [
        ("https://api.deepseek.com", {"thinking": {"type": "disabled"}}),
        ("https://api.deepseek.com/v1", {"thinking": {"type": "disabled"}}),
        ("https://model.example/v1", None),
        ("https://api.deepseek.com.example/v1", None),
    ],
)
async def test_runtime_uses_same_provider_mode_as_connection_check(base_url, expected):
    from agent_school.contracts import RuntimeRequest
    from agent_school.runtime.agentscope_runtime import make_model

    request = RuntimeRequest(
        run_id="test-run",
        attempt_id="test-attempt",
        messages=[],
        allowed_tools=[],
        settings={"temperature": 0.3},
        model=ModelAccess(base_url=base_url, model="deepseek-flash", api_key=SecretStr("test-only")),
    )
    model = make_model(request)
    try:
        assert model.extra_body == expected
    finally:
        await model.client.close()
