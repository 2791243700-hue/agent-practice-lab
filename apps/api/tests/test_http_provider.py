import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from conftest import create_attempt, post
from test_credentials import configure
from test_grading import submit
from test_reflection import reflection_attempt
from test_runs import start, wait_run


@pytest.mark.parametrize("version", ["1.0.0", "1.1.0"])
@pytest.mark.parametrize("selected", [False, True])
def test_live_sdk_http_chain_can_pass_first_lesson_without_exporting_key(client, version, selected):
    class Provider(BaseHTTPRequestHandler):
        calls = 0
        task_requests = []

        def log_message(self, *args):
            pass

        def do_POST(self):
            Provider.calls += 1
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            functions = [t["function"]["name"] for t in body.get("tools", [])]
            message = {"role": "assistant", "content": "已完成任务，请核对课程通知。"}
            if "connection_probe" in functions:
                message = {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "probe-http-call",
                            "type": "function",
                            "function": {"name": "connection_probe", "arguments": '{"value":"ok"}'},
                        }
                    ],
                }
            if body.get("stream"):
                Provider.task_requests.append(body)
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                chunk = {
                    "id": "chat-example",
                    "object": "chat.completion.chunk",
                    "created": 1792220000,
                    "model": "tool-model",
                    "choices": [
                        {
                            "index": 0,
                            "delta": {"role": "assistant", "content": message["content"]},
                            "finish_reason": None,
                        }
                    ],
                }
                self.wfile.write(("data: " + json.dumps(chunk) + "\n\n").encode())
                chunk["choices"] = [{"index": 0, "delta": {}, "finish_reason": "stop"}]
                chunk["usage"] = {"prompt_tokens": 10, "completion_tokens": 3, "total_tokens": 13}
                self.wfile.write(("data: " + json.dumps(chunk) + "\n\ndata: [DONE]\n\n").encode())
                return
            value = {
                "id": "chat-example",
                "object": "chat.completion",
                "created": 1792220000,
                "model": "tool-model",
                "choices": [
                    {
                        "index": 0,
                        "message": message,
                        "finish_reason": "tool_calls" if "tool_calls" in message else "stop",
                    }
                ],
                "usage": {"prompt_tokens": 10, "completion_tokens": 3, "total_tokens": 13},
            }
            data = json.dumps(value).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    provider = ThreadingHTTPServer(("127.0.0.1", 0), Provider)
    thread = threading.Thread(target=provider.serve_forever, daemon=True)
    thread.start()
    try:
        response = post(
            client,
            "/model-profiles",
            {
                "name": "本地测试提供商",
                "provider": "openai-compatible",
                "base_url": f"http://127.0.0.1:{provider.server_port}/v1",
                "model": "tool-model",
            },
            "http-profile-key",
        )
        profile = configure(client, response.json(), "http-test-private-key")
        checked = post(
            client,
            "/model-profiles/" + profile["id"] + "/check",
            {"expected_revision": profile["revision"]},
            "http-check-key",
        )
        assert checked.status_code == 200, checked.text
        assert checked.json()["connection_check"]["tools_ok"]
        assert Provider.calls == 3
        assert (
            post(
                client,
                "/model-profiles/" + profile["id"] + "/check",
                {"expected_revision": profile["revision"]},
                "http-check-key",
            ).json()
            == checked.json()
        )
        assert Provider.calls == 3
        attempt = (
            create_attempt(client, mode="live") if version == "1.0.0" else reflection_attempt(client, "live")
        )
        if selected:
            changed = client.patch(
                "/api/v1/attempts/" + attempt["id"],
                json={
                    "expected_revision": attempt["revision"],
                    "settings": attempt["settings"],
                    "selected_file_ids": ["notice-week"],
                },
            )
            assert changed.status_code == 200
            attempt = changed.json()
        runs = []
        messages = []
        for index, text in enumerate(["看看通知", "整理两项任务，列出截止日期，不猜测"]):
            run = start(client, attempt, text, f"http-run-key-{index}", profile["id"])
            finished = wait_run(client, run["id"])
            assert finished["status"] == "completed", finished
            assert finished["usage"]["model_calls"] == 1
            events = client.app.state.school.store.event_list(run["id"])
            complete = [e for e in events if e["kind"] == "message.completed"]
            assert complete and complete[-1]["payload"]["content"] == "已完成任务，请核对课程通知。"
            runs.append(finished)
            messages.append(complete[-1])
        assert len(Provider.task_requests) == 2
        for request in Provider.task_requests:
            supplied = json.dumps(request["messages"], ensure_ascii=False)
            assert "提交课程总结" in supplied
            assert "预约实验室" in supplied
            assert "2026-11-04" in supplied and "2026-11-06" in supplied
            assert not request.get("tools")
        answers = {"question_id": "goal-constraints", "option_id": "clear-goal"}
        if version == "1.1.0":
            challenge = client.get("/api/v1/lessons/01-task").json()["answer_form"]["challenge"]
            answers = {
                "kind": "reflection",
                "baseline_run_id": runs[0]["id"],
                "revised_run_id": runs[1]["id"],
                "change": {"category": "constraint", "quote": "不猜测"},
                "evidence": {
                    side: {
                        "message_id": message["payload"]["message_id"],
                        "event_seq": message["seq"],
                        "quote": "已完成任务",
                        "start_offset": 0,
                    }
                    for side, message in zip(("before", "after"), messages)
                },
                "judgment": "partial",
                "explanation": "还没有列出两项任务。",
                "next_instruction": "逐项列出任务。",
                "challenge": {
                    "challenge_id": challenge["id"],
                    "judgments": [
                        {
                            "item_id": item["id"],
                            "decision": "known" if item["id"] in ("start", "place") else "confirm",
                        }
                        for item in challenge["items"]
                    ],
                    "instruction": "整理活动通知，缺少的信息标记待确认。",
                },
            }
        result = submit(client, attempt, answers)
        assert result["passed"] and result["evaluation_passed"]
        assert client.get("/api/v1/lessons/01-task?version=" + version).json()["completed"]
        if version == "1.0.0":
            assert not client.get("/api/v1/lessons/01-task").json()["completed"]
        assert "http-test-private-key" not in str(client.app.state.school.store.list("run"))
    finally:
        provider.shutdown()
        provider.server_close()
        thread.join(timeout=2)
