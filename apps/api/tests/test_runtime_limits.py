import pytest
from agentscope.message import ToolCallBlock
from agentscope.model import ChatResponse

from agent_school.contracts import ChatMessage, RuntimeRequest, ToolResult, ToolSpec
from agent_school.runtime.agentscope_runtime import AgentScopeRuntime, RuntimeFailure
from runtime_probe import ScriptedModel


async def test_sdk_cannot_make_an_eleventh_model_call():
    class LoopModel(ScriptedModel):
        async def _call_api(self, model, messages, tools=None, **kwargs):
            self.step += 1
            return ChatResponse(
                content=[
                    ToolCallBlock(id=f"call-{self.step}", name="read_material", input='{"file_id":"notice"}')
                ],
                is_last=True,
            )

    model = LoopModel("loop")
    runtime = AgentScopeRuntime(lambda request: model)
    request = RuntimeRequest(
        run_id="limited-run",
        attempt_id="a",
        messages=[ChatMessage(role="user", content="读取")],
        settings={},
        allowed_tools=[
            ToolSpec(
                name="read_material",
                description="读取资料",
                input_schema={
                    "type": "object",
                    "properties": {"file_id": {"type": "string"}},
                    "required": ["file_id"],
                },
            )
        ],
    )

    async def invoke(call):
        return ToolResult(call_id=call.id, name=call.name, status="ok", data={"content": "资料"})

    with pytest.raises(RuntimeFailure):
        async for event in runtime.stream(request, invoke):
            pass
    assert model.step == 10
