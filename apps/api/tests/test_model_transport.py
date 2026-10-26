import asyncio

import httpx
import openai
import pytest
from pydantic import SecretStr

from agent_school.contracts import ChatMessage, ModelAccess, RuntimeRequest
from agent_school.runtime.agentscope_runtime import AgentScopeRuntime, RuntimeFailure, make_model


@pytest.mark.parametrize(
    "failure,expected_calls,code",
    [
        (httpx.ConnectError, 2, None),
        (httpx.ConnectTimeout, 2, None),
        ("persistent-connect", 2, "MODEL_UNAVAILABLE"),
        ("broken-stream", 1, "MODEL_UNAVAILABLE"),
        (httpx.ReadTimeout, 1, "MODEL_TIMEOUT"),
        (httpx.ReadError, 1, "MODEL_UNAVAILABLE"),
        (httpx.WriteError, 1, "MODEL_UNAVAILABLE"),
        (401, 1, "MODEL_AUTH_FAILED"),
        (429, 1, "MODEL_UNAVAILABLE"),
        (500, 1, "MODEL_UNAVAILABLE"),
    ],
)
async def test_only_pre_send_connection_failures_can_reconnect(monkeypatch, failure, expected_calls, code):
    calls = []

    class BrokenStream(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b'data: {"id":"partial","choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":null}]}\n\n'
            raise httpx.ReadError("response interrupted")

    async def handle(request):
        calls.append(request)
        if failure == "persistent-connect":
            raise httpx.ConnectError("connection still unavailable", request=request)
        if failure == "broken-stream":
            return httpx.Response(200, headers={"Content-Type": "text/event-stream"}, stream=BrokenStream())
        if len(calls) == 1:
            if isinstance(failure, int):
                return httpx.Response(failure, json={"error": {"message": "provider unavailable"}})
            raise failure("test connection failure", request=request)
        return httpx.Response(
            200,
            headers={"Content-Type": "text/event-stream"},
            content=(
                'data: {"id":"plan","choices":[{"index":0,"delta":{"content":"两小时计划表"},'
                '"finish_reason":null}]}\n\n'
                'data: {"id":"plan","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],'
                '"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n'
                "data: [DONE]\n\n"
            ).encode(),
        )

    original_client = openai.AsyncClient

    def client(**kwargs):
        kwargs["http_client"] = httpx.AsyncClient(transport=httpx.MockTransport(handle))
        return original_client(**kwargs)

    monkeypatch.setattr(openai, "AsyncClient", client)
    request = RuntimeRequest(
        run_id="connection-plan",
        attempt_id="a",
        messages=[ChatMessage(role="user", content="我有两小时时间，请为我做一份计划表")],
        settings={"temperature": 0.3},
        allowed_tools=[],
        model=ModelAccess(
            base_url="https://example.invalid/v1", model="test-model", api_key=SecretStr("test-only")
        ),
    )
    runtime = AgentScopeRuntime()

    async def invoke(call):
        raise AssertionError("No tools expected")

    events = []
    if code:
        with pytest.raises(RuntimeFailure) as caught:
            async for event in runtime.stream(request, invoke):
                events.append(event)
        assert caught.value.code == code
    else:
        async for event in runtime.stream(request, invoke):
            events.append(event)
        assert [e.payload["content"] for e in events if e.kind == "message.completed"] == ["两小时计划表"]
    assert len(calls) == expected_calls
    assert runtime.usage_by_run[request.run_id]["model_calls"] == 1
    if failure == "broken-stream":
        assert any(e.kind == "message.delta" for e in events)
        assert not any(e.kind == "message.completed" for e in events)


async def test_cancelling_during_connection_backoff_does_not_send_another_request(monkeypatch):
    started = asyncio.Event()
    calls = []

    async def handle(request):
        calls.append(request)
        started.set()
        raise httpx.ConnectError("cannot establish connection", request=request)

    original_client = openai.AsyncClient

    def client(**kwargs):
        kwargs["http_client"] = httpx.AsyncClient(transport=httpx.MockTransport(handle))
        return original_client(**kwargs)

    monkeypatch.setattr(openai, "AsyncClient", client)
    request = RuntimeRequest(
        run_id="cancel-connection",
        attempt_id="a",
        messages=[ChatMessage(role="user", content="test")],
        settings={"temperature": 0.3},
        allowed_tools=[],
        model=ModelAccess(
            base_url="https://example.invalid/v1", model="test-model", api_key=SecretStr("test-only")
        ),
    )
    runtime = AgentScopeRuntime()

    async def invoke(call):
        raise AssertionError("No tools expected")

    async def consume():
        async for event in runtime.stream(request, invoke):
            pass

    task = asyncio.create_task(consume())
    await asyncio.wait_for(started.wait(), 2)
    await runtime.cancel(request.run_id)
    with pytest.raises(asyncio.CancelledError):
        await task
    assert len(calls) == 1


async def test_model_has_separate_bounded_connection_timeout():
    request = RuntimeRequest(
        run_id="timeout-config",
        attempt_id="a",
        messages=[],
        settings={"temperature": 0.3},
        allowed_tools=[],
        model=ModelAccess(
            base_url="https://example.invalid/v1", model="test-model", api_key=SecretStr("test-only")
        ),
    )
    model = make_model(request)
    try:
        assert model.client.timeout.connect == 8.0
        assert model.client.timeout.read == 30.0
        assert model.client.max_retries == 0
    finally:
        await model.client.close()
