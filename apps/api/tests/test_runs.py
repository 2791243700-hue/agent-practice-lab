import time

import pytest

from agent_school.contracts import RuntimeEvent
from conftest import create_attempt, post


def test_task_notice_default_referent_is_sent_to_runtime(client):
    captured = []

    class CaptureRuntime:
        usage_by_run = {}

        async def stream(self, request, invoke_tool):
            captured.append(request)
            yield RuntimeEvent(
                kind="message.completed",
                payload={
                    "message_id": "notice",
                    "role": "assistant",
                    "content": "课程总结 11月4日。",
                },
            )

    client.app.state.school.runs.demo = CaptureRuntime()
    attempt = create_attempt(client)
    run = start(client, attempt, text="帮我看看这段通知")
    assert wait_run(client, run["id"])["status"] == "completed"
    prompt = captured[0].settings["system_instruction"]
    assert "未另附通知" in prompt and "默认指本关固定参考通知" in prompt
    assert "2026-11-04" in prompt and "2026-11-06" in prompt
    assert "优先使用学生明确提供或指定的通知" in prompt


@pytest.mark.parametrize("lesson", ["02-context", "03-tools", "04-permission"])
def test_tool_lessons_do_not_receive_material_contents_without_reading(client, lesson):
    captured = []

    class CaptureRuntime:
        def __init__(self):
            self.usage_by_run = {}

        async def stream(self, request, invoke_tool):
            captured.append(request)
            yield RuntimeEvent(
                kind="message.completed",
                payload={"message_id": "capture-message", "role": "assistant", "content": "待核对。"},
            )

    client.app.state.school.runs.demo = CaptureRuntime()
    attempt = create_attempt(client, lesson)
    run = start(client, attempt)
    assert wait_run(client, run["id"])["status"] == "completed"
    assert captured[0].allowed_tools
    prompt = captured[0].settings["system_instruction"]
    assert "本关固定参考通知" not in prompt
    assert "2026-11-04" not in prompt


def wait_run(
    client, run_id, predicate=lambda v: v["status"] in ("completed", "failed", "cancelled", "interrupted")
):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        value = client.get("/api/v1/runs/" + run_id).json()
        if predicate(value):
            return value
        time.sleep(0.01)
    raise AssertionError("Run did not reach expected state: " + str(value))


def start(client, attempt, text="请完成任务。", key="start-run-key", profile_id=None):
    response = post(
        client,
        "/runs",
        {
            "attempt_id": attempt["id"],
            "expected_attempt_revision": attempt["revision"],
            "profile_id": profile_id,
            "input_text": text,
        },
        key,
    )
    assert response.status_code == 202, response.text
    return response.json()


def test_demo_run_idempotency_snapshots_and_event_replay(client):
    attempt = create_attempt(client)
    first = start(client, attempt)
    assert start(client, attempt)["id"] == first["id"]
    finished = wait_run(client, first["id"])
    assert finished["status"] == "completed"
    events = client.get("/api/v1/runs/" + first["id"] + "/event-history").json()
    assert [e["seq"] for e in events["items"]] == list(range(1, len(events["items"]) + 1))
    with client.stream("GET", "/api/v1/runs/" + first["id"] + "/events?after_seq=0") as stream:
        text = stream.read().decode()
    assert "event: run.completed" in text
    assert (
        client.get(
            "/api/v1/runs/" + first["id"] + "/events", headers={"Last-Event-ID": str(finished["last_seq"])}
        ).status_code
        == 204
    )
    assert client.get("/api/v1/runs/" + first["id"] + "/events?after_seq=9999").status_code == 400
    assert len(client.get("/api/v1/attempts/" + attempt["id"] + "/runs").json()["items"]) == 1


def test_global_busy_and_reset_cancel_waiting_approval(client):
    attempt = create_attempt(client, "04-permission")
    client.patch(
        "/api/v1/attempts/" + attempt["id"],
        json={"expected_revision": 1, "settings": attempt["settings"], "selected_file_ids": ["notice-week"]},
    )
    attempt = client.get("/api/v1/attempts/" + attempt["id"]).json()
    run = start(client, attempt)
    pending = wait_run(client, run["id"], lambda r: r["status"] == "awaiting_approval")
    other = create_attempt(client, key="other-attempt-key")
    response = post(
        client,
        "/runs",
        {
            "attempt_id": other["id"],
            "expected_attempt_revision": 1,
            "profile_id": None,
            "input_text": "另一个任务",
        },
        "another-start-key",
    )
    assert response.status_code == 409
    assert (
        post(
            client,
            "/submissions",
            {"attempt_id": attempt["id"], "expected_attempt_revision": 2, "answers": {}},
            "busy-submit-key",
        ).status_code
        == 409
    )
    reset = post(
        client, "/attempts/" + attempt["id"] + "/reset", {"expected_revision": 2}, "reset-running-key"
    )
    assert reset.status_code == 201, reset.text
    assert wait_run(client, run["id"])["status"] == "cancelled"
    assert (
        client.post(
            "/api/v1/approvals/" + pending["pending_approval"]["id"] + "/decision",
            json={"decision": "approve"},
        ).status_code
        == 409
    )
    assert not [
        f
        for f in client.get("/api/v1/attempts/" + reset.json()["id"] + "/files").json()["items"]
        if f["kind"] == "artifact"
    ]
