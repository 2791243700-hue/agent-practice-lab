import pytest

@pytest.mark.parametrize("scenario,tool_calls,writes,state", [
    ("read", 1, 0, "completed"),
    ("deny", 1, 0, "completed"),
    ("cancel", 0, 0, "cancelled"),
    ("malformed", 0, 0, "failed"),
])
async def test_sdk_probe_enforces_tool_boundary(scenario, tool_calls, writes, state):
    from agent_school.runtime.probe import probe_runtime
    result = await probe_runtime(scenario)
    assert len(result.tool_calls) == tool_calls
    assert result.writes == writes
    assert result.terminal_state == state
    assert "test-secret-runtime" not in repr(result.events)

async def test_sdk_probe_approval_executes_once():
    from agent_school.runtime.probe import probe_runtime
    result = await probe_runtime("approve")
    assert result.writes == 1
    assert result.terminal_state == "completed"
