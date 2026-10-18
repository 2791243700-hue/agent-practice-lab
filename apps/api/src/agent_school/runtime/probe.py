"""Offline SDK feasibility probes. No external model or API key is used."""

import asyncio
import json
from dataclasses import dataclass

from agentscope.credential import OpenAICredential
from agentscope.message import TextBlock, ToolCallBlock
from agentscope.model import ChatModelBase, ChatResponse
from pydantic import SecretStr

from agent_school.contracts import ChatMessage, RuntimeRequest, ToolResult, ToolSpec
from agent_school.runtime.agentscope_runtime import AgentScopeRuntime


class ScriptedModel(ChatModelBase):
    def __init__(self, scenario):
        super().__init__(
            OpenAICredential(api_key=SecretStr("test-secret-runtime")),
            "scripted-model",
            self.Parameters(),
            stream=False,
            max_retries=0,
        )
        self.scenario = scenario
        self.step = 0
        self.started = asyncio.Event()

    async def _call_api(self, model, messages, tools=None, **kwargs):
        self.started.set()
        if self.scenario == "cancel":
            await asyncio.Event().wait()
        self.step += 1
        if self.step == 1:
            name = "read_material" if self.scenario in ("read", "malformed") else "save_todos"
            arguments = '{"broken":' if self.scenario == "malformed" else json.dumps({"file_id": "notice"})
            return ChatResponse(
                content=[ToolCallBlock(id="probe-call", name=name, input=arguments)], is_last=True
            )
        return ChatResponse(content=[TextBlock(text="处理完成。")], is_last=True)


@dataclass
class ProbeResult:
    tool_calls: list
    writes: int
    terminal_state: str
    events: list


async def probe_runtime(scenario):
    model = ScriptedModel(scenario)
    runtime = AgentScopeRuntime(lambda request: model)
    result = ProbeResult([], 0, "completed", [])

    async def invoke(call):
        result.tool_calls.append(call)
        status = "denied" if scenario == "deny" else "ok"
        if scenario == "approve":
            result.writes += 1
        return ToolResult(call_id=call.id, name=call.name, status=status, data={"message": "已处理"})

    spec = ToolSpec(
        name="read_material" if scenario in ("read", "malformed", "cancel") else "save_todos",
        description="探针工具",
        input_schema={
            "type": "object",
            "properties": {"file_id": {"type": "string"}},
            "required": ["file_id"],
            "additionalProperties": False,
        },
    )
    request = RuntimeRequest(
        run_id="probe-run",
        attempt_id="probe-attempt",
        messages=[ChatMessage(role="user", content="执行探针。")],
        settings={"system_instruction": "使用指定工具。", "temperature": 0.3},
        allowed_tools=[spec],
    )

    async def consume():
        try:
            async for event in runtime.stream(request, invoke):
                result.events.append(event.model_dump())
        except asyncio.CancelledError:
            result.terminal_state = "cancelled"
        except Exception:
            result.terminal_state = "failed"

    task = asyncio.create_task(consume())
    if scenario == "cancel":
        await model.started.wait()
        await runtime.cancel(request.run_id)
    await task
    return result
