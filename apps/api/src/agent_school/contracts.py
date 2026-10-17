from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, SecretStr


class Value(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Actor(Value):
    id: str = "local-owner"
    auth_mode: Literal["local"] = "local"


class ToolCall(Value):
    id: str
    name: str
    arguments: dict


class ToolSpec(Value):
    name: str
    description: str
    input_schema: dict
    approval_required: bool = False


class ToolResult(Value):
    call_id: str
    name: str
    status: Literal["ok", "denied", "error"]
    data: dict


class ChatMessage(Value):
    role: Literal["system", "user", "assistant", "tool"]
    content: str
    tool_call_id: str | None = None
    tool_calls: list[ToolCall] = Field(default_factory=list)


class ModelAccess(Value):
    provider: str = "openai-compatible"
    base_url: str
    model: str
    api_key: SecretStr


class RuntimeRequest(Value):
    run_id: str
    attempt_id: str
    messages: list[ChatMessage]
    settings: dict
    allowed_tools: list[ToolSpec]
    model: ModelAccess | None = None
    mode: Literal["live", "demo"] = "live"


class RuntimeEvent(Value):
    kind: str
    payload: dict


InvokeTool = Callable[[ToolCall], Awaitable[ToolResult]]


class AgentRuntime(Protocol):
    def stream(self, request: RuntimeRequest, invoke_tool: InvokeTool) -> AsyncIterator[RuntimeEvent]: ...
    async def cancel(self, run_id: str) -> None: ...


class IdentityProvider(Protocol):
    def current_actor(self) -> Actor: ...


class LocalIdentityProvider:
    def current_actor(self) -> Actor:
        return Actor()


class CredentialStore(Protocol):
    def set(self, owner_id: str, profile_id: str, key: SecretStr) -> None: ...
    def get(self, owner_id: str, profile_id: str) -> SecretStr: ...
    def delete(self, owner_id: str, profile_id: str) -> None: ...
