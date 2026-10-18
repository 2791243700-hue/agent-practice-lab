import asyncio
import json
import logging
from collections.abc import AsyncIterator, Callable

from agentscope.agent import Agent, ContextConfig, InjectionConfig, ModelConfig, ReActConfig
from agentscope.credential import OpenAICredential
from agentscope.event import (
    ExceedMaxItersEvent,
    ExternalExecutionResultEvent,
    ReplyEndEvent,
    RequireExternalExecutionEvent,
    TextBlockDeltaEvent,
    TextBlockEndEvent,
)
from agentscope.formatter import OpenAIChatFormatter
from agentscope.message import (
    AssistantMsg,
    TextBlock,
    ToolCallBlock,
    ToolResultBlock,
    ToolResultState,
    UserMsg,
)
from agentscope.model import ChatModelBase, OpenAIChatModel
from agentscope.permission import PermissionBehavior, PermissionDecision
from agentscope.tool import ToolBase, Toolkit
from jsonschema import Draft202012Validator

from agent_school.contracts import InvokeTool, RuntimeEvent, RuntimeRequest, ToolCall, ToolSpec


class RuntimeFailure(Exception):
    def __init__(self, code: str = "EXECUTION_FAILED"):
        self.code = code
        super().__init__(code)


class ExternalTool(ToolBase):
    """The SDK plans calls; our gateway owns all execution and approval."""

    is_external_tool = True
    is_concurrency_safe = False

    def __init__(self, spec: ToolSpec):
        super().__init__()
        self.name = spec.name
        self.description = spec.description
        self.input_schema = spec.input_schema
        self.is_read_only = not spec.approval_required

    async def check_permissions(self, tool_input, context):
        return PermissionDecision(behavior=PermissionBehavior.ALLOW)


class MeteredModel(ChatModelBase):
    def __init__(self, wrapped: ChatModelBase, specs=None, redactor=lambda value: value):
        super().__init__(
            wrapped.credential,
            wrapped.model,
            wrapped.parameters,
            stream=wrapped.stream,
            max_retries=0,
            context_size=wrapped.context_size,
        )
        self.wrapped = wrapped
        self.formatter = getattr(wrapped, "formatter", None) or OpenAIChatFormatter()
        self.specs = specs or {}
        self.redactor = redactor
        self.calls = 0
        self.input_tokens: int | None = None
        self.output_tokens: int | None = None
        self.unknown_usage = False

    def record(self, response):
        for block in response.content:
            if isinstance(block, TextBlock):
                block.text = self.redactor(block.text)
            if isinstance(block, ToolCallBlock):
                try:
                    spec = self.specs[block.name]
                    arguments = json.loads(block.input)
                    Draft202012Validator(spec.input_schema).validate(arguments)
                    block.input = json.dumps(self.redactor(arguments), ensure_ascii=False)
                except Exception:
                    raise RuntimeFailure("MODEL_INCOMPATIBLE") from None
        if response.usage is None:
            self.unknown_usage = True
        elif not self.unknown_usage:
            self.input_tokens = (self.input_tokens or 0) + response.usage.input_tokens
            self.output_tokens = (self.output_tokens or 0) + response.usage.output_tokens
        if self.unknown_usage:
            self.input_tokens = self.output_tokens = None

    async def __call__(self, *args, **kwargs):
        if self.calls >= 10:
            raise RuntimeFailure("LIMIT_EXCEEDED")
        self.calls += 1
        response = await self.wrapped(*args, **kwargs)
        if hasattr(response, "__aiter__"):

            async def stream():
                async for chunk in response:
                    if chunk.is_last:
                        self.record(chunk)
                    yield chunk

            return stream()
        self.record(response)
        return response

    def usage(self):
        return {
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "model_calls": self.calls,
        }


def make_model(request: RuntimeRequest) -> OpenAIChatModel:
    access = request.model
    if access is None:
        raise RuntimeFailure("CREDENTIAL_MISSING")
    return OpenAIChatModel(
        OpenAICredential(api_key=access.api_key, base_url=access.base_url),
        model=access.model,
        parameters=OpenAIChatModel.Parameters(temperature=request.settings["temperature"]),
        stream=True,
        max_retries=0,
        client_kwargs={"timeout": 30.0, "max_retries": 0},
    )


class AgentScopeRuntime:
    def __init__(self, model_factory: Callable = make_model, redactor=lambda value: value):
        self.model_factory = model_factory
        self.redactor = redactor
        self.tasks: dict[str, asyncio.Task] = {}
        self.usage_by_run: dict[str, dict] = {}

    async def cancel(self, run_id: str):
        task = self.tasks.get(run_id)
        if task and task is not asyncio.current_task():
            task.cancel()

    async def stream(self, request: RuntimeRequest, invoke_tool: InvokeTool) -> AsyncIterator[RuntimeEvent]:
        # The SDK may log provider exception bodies; the app publishes sanitized errors instead.
        logging.getLogger("as").setLevel(logging.CRITICAL + 1)
        allowed = {spec.name: spec for spec in request.allowed_tools}
        model = MeteredModel(self.model_factory(request), allowed, self.redactor)
        self.tasks[request.run_id] = asyncio.current_task()
        agent = Agent(
            "课程资料助手",
            request.settings.get("system_instruction", ""),
            model=model,
            toolkit=Toolkit(tools=[ExternalTool(spec) for spec in allowed.values()]),
            react_config=ReActConfig(max_iters=10, interruption_raise_cancelled_error=True),
            model_config=ModelConfig(max_retries=0),
            context_config=ContextConfig(compression_tool_enabled=False),
            injection_config=InjectionConfig(inject_runtime_state=False),
        )
        inputs = []
        for message in request.messages:
            if message.role == "user":
                inputs.append(UserMsg("学生", message.content))
            elif message.role == "assistant":
                inputs.append(AssistantMsg("课程资料助手", message.content))
        next_input = inputs
        seen_calls: set[str] = set()
        text_by_block: dict[str, str] = {}
        try:
            while True:
                continuation = None
                async for event in agent.reply_stream(next_input):
                    if asyncio.current_task().cancelling():
                        raise asyncio.CancelledError
                    if isinstance(event, TextBlockDeltaEvent):
                        text_by_block[event.block_id] = text_by_block.get(event.block_id, "") + event.delta
                        yield RuntimeEvent(
                            kind="message.delta", payload={"message_id": event.block_id, "delta": event.delta}
                        )
                    elif isinstance(event, TextBlockEndEvent):
                        accumulated = text_by_block.pop(event.block_id, "")
                        final_text = event.text if event.text is not None else accumulated
                        yield RuntimeEvent(
                            kind="message.completed",
                            payload={
                                "message_id": event.block_id,
                                "role": "assistant",
                                "content": self.redactor(final_text),
                            },
                        )
                    elif isinstance(event, RequireExternalExecutionEvent):
                        results = []
                        for block in event.tool_calls:
                            if block.id in seen_calls or block.name not in allowed:
                                raise RuntimeFailure("TOOL_ERROR")
                            seen_calls.add(block.id)
                            try:
                                arguments = json.loads(block.input)
                                Draft202012Validator(allowed[block.name].input_schema).validate(arguments)
                            except Exception:
                                raise RuntimeFailure("MODEL_INCOMPATIBLE") from None
                            result = await invoke_tool(
                                ToolCall(id=block.id, name=block.name, arguments=arguments)
                            )
                            state = {
                                "ok": ToolResultState.SUCCESS,
                                "denied": ToolResultState.DENIED,
                                "error": ToolResultState.ERROR,
                            }[result.status]
                            results.append(
                                ToolResultBlock(
                                    id=block.id,
                                    name=block.name,
                                    output=json.dumps(result.data, ensure_ascii=False),
                                    state=state,
                                )
                            )
                        continuation = ExternalExecutionResultEvent(
                            reply_id=event.reply_id, execution_results=results
                        )
                    elif isinstance(event, ExceedMaxItersEvent):
                        raise RuntimeFailure("LIMIT_EXCEEDED")
                    elif isinstance(event, ReplyEndEvent):
                        if event.error or str(event.finished_reason) not in (
                            "completed",
                            "require_external_execution",
                        ):
                            if continuation is None:
                                raise RuntimeFailure()
                if continuation is None:
                    break
                next_input = continuation
        except asyncio.CancelledError:
            raise
        except RuntimeFailure:
            raise
        except Exception:
            raise RuntimeFailure("MODEL_UNAVAILABLE") from None
        finally:
            self.usage_by_run[request.run_id] = model.usage()
            self.tasks.pop(request.run_id, None)
            client = getattr(model.wrapped, "client", None)
            if client is not None:
                await client.close()
