import asyncio

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


@pytest.mark.parametrize("outcome", ["completed", "failed", "cancelled"])
def test_split_key_in_message_deltas_cannot_be_replayed_from_event_store(client, outcome):
    from pydantic import SecretStr

    from agent_school.contracts import RuntimeEvent
    from conftest import create_attempt
    from test_runs import start, wait_run

    school = client.app.state.school
    school.credentials.set("local-owner", "profile-unused", SecretStr("stream-secret-key"))

    class LeakyStream:
        usage_by_run = {}

        async def stream(self, request, invoke):
            yield RuntimeEvent(
                kind="message.delta", payload={"message_id": "secret-message", "delta": "stream-"}
            )
            yield RuntimeEvent(
                kind="message.delta", payload={"message_id": "secret-message", "delta": "secret-key"}
            )
            if outcome == "failed":
                raise RuntimeError("provider failed")
            if outcome == "cancelled":
                raise asyncio.CancelledError
            yield RuntimeEvent(
                kind="message.completed",
                payload={"message_id": "secret-message", "role": "assistant", "content": "stream-secret-key"},
            )

    school.runs.demo = LeakyStream()
    a = create_attempt(client)
    run = start(client, a)
    assert wait_run(client, run["id"])["status"] == outcome
    events = school.store.event_list(run["id"])
    text = "".join(e["payload"]["delta"] for e in events if e["kind"] == "message.delta")
    assert "stream-secret-key" not in text
    assert "stream-secret-key" not in str(school.store.get("history", a["id"], missing_ok=True))


def test_tool_argument_key_is_redacted_in_approval_and_pending_run(client):
    from pydantic import SecretStr

    from agent_school.contracts import ToolCall
    from conftest import create_attempt
    from test_runs import start, wait_run

    school = client.app.state.school
    school.credentials.set("local-owner", "profile-unused", SecretStr("approval-secret-key"))

    class LeakyTool:
        usage_by_run = {}

        async def stream(self, request, invoke):
            await invoke(
                ToolCall(
                    id="secret-save-call",
                    name="save_todos",
                    arguments={
                        "items": [
                            {
                                "task_id": "submit-summary",
                                "title": "approval-secret-key",
                                "due_date": "2026-11-04",
                                "source_id": "notice-week",
                            }
                        ]
                    },
                )
            )
            if False:
                yield

    school.runs.demo = LeakyTool()
    a = create_attempt(client, "04-permission")
    run = start(client, a)
    pending = wait_run(client, run["id"], lambda r: r["status"] == "awaiting_approval")
    approval = school.store.get("approval", pending["pending_approval"]["id"])
    assert "approval-secret-key" not in str(approval)
    assert "approval-secret-key" not in str(school.store.get("run", run["id"]))
