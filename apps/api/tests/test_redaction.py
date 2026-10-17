import pytest
from agent_school.contracts import ChatMessage, RuntimeRequest
from agent_school.runtime.agentscope_runtime import AgentScopeRuntime, RuntimeFailure
from agent_school.runtime.probe import ScriptedModel


async def test_sdk_provider_exception_cannot_log_credential(capfd):
    class Failing(ScriptedModel):
        async def _call_api(self, *args, **kwargs):
            raise ValueError("test-secret-runtime appears in raw provider error")

    runtime = AgentScopeRuntime(lambda request: Failing("error"))
    request = RuntimeRequest(
        run_id="sensitive-run",
        attempt_id="a",
        messages=[ChatMessage(role="user", content="test")],
        settings={},
        allowed_tools=[],
    )

    async def invoke(call):
        raise AssertionError("No tools expected")

    with pytest.raises(RuntimeFailure):
        async for event in runtime.stream(request, invoke):
            pass
    captured = capfd.readouterr()
    assert "test-secret-runtime" not in captured.out + captured.err
