import asyncio
import copy
import json
import threading
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest
from fastapi.testclient import TestClient

from conftest import create_attempt, post
from test_credentials import configure, make_profile

SECRET = "tips-test-secret-never-persist"
VALID_TIPS = {
    "assessment": "任务目标明确，还需要核对运行证据。",
    "gaps": ["缺少对输出约束的核查。"],
    "next_steps": ["补充输出要求，再运行并比较结果。"],
    "evidence": ["本轮输入已说明任务目标。"],
}


@pytest.mark.parametrize("legacy_evidence", [False, True])
def test_new_tips_do_not_generate_or_store_an_evidence_section(client, tips_setup, legacy_evidence):
    school, _, run, profile = tips_setup
    advice = {k: v for k, v in VALID_TIPS.items() if k != "evidence"}
    if legacy_evidence:
        advice["evidence"] = ["旧服务商额外返回的依据，应丢弃"]
    requests = []

    def handle(request):
        requests.append(json.loads(request.content))
        return provider_response(advice)

    model = httpx.AsyncClient(transport=httpx.MockTransport(handle))
    school.tips.client = model
    try:
        response = generate(client, run, profile)
    finally:
        client.portal.call(model.aclose)
    assert response.status_code == 200, response.text
    assert response.json()["evidence"] == []
    assert school.store.get("tips", run["id"])["evidence"] == []
    assert "不要生成依据段落" in requests[0]["messages"][0]["content"]


def seed_run(school, attempt, key="run-tips-target", status="completed", created_at=None, text="目标输入"):
    value = {
        "id": key,
        "attempt_id": attempt["id"],
        "mode": attempt["mode"],
        "status": status,
        "last_seq": 0,
        "input_text": text,
        "snapshot": {
            "settings": copy.deepcopy(attempt["settings"]),
            "selected_file_ids": [],
            "profile_id": None,
            "profile_revision": None,
            "model": None,
        },
        "pending_approval": None,
        "usage": {"input_tokens": None, "output_tokens": None, "model_calls": 0},
        "error": None,
        "created_at": created_at or "2026-10-20T00:00:00Z",
        "started_at": "2026-10-20T00:00:00Z",
        "ended_at": "2026-10-20T00:01:00Z"
        if status in {"completed", "failed", "cancelled", "interrupted"}
        else None,
    }
    school.store.put("run", key, value)
    return value


def checked_profile(client):
    profile = configure(client, make_profile(client), SECRET)
    profile["connection_check"].update(
        status="passed", text_ok=True, tools_ok=True, checked_at="2026-10-20T00:00:00Z"
    )
    client.app.state.school.store.put("profile", profile["id"], profile)
    return profile


def request_body(profile):
    return {"profile_id": profile["id"], "expected_profile_revision": profile["revision"]}


def generate(client, run, profile, key="tips-generate-key", body=None):
    return post(client, "/runs/" + run["id"] + "/tips", body or request_body(profile), key)


def provider_response(content=None, usage=True):
    value = {"choices": [{"message": {"role": "assistant", "content": json.dumps(content or VALID_TIPS)}}]}
    if usage:
        value["usage"] = {"prompt_tokens": 17, "completion_tokens": 23, "total_tokens": 40}
    return httpx.Response(200, json=value)


@pytest.fixture
def tips_setup(client):
    school = client.app.state.school
    attempt = create_attempt(client)
    return school, attempt, seed_run(school, attempt), checked_profile(client)


def test_tips_read_is_empty_before_explicit_generation_and_missing_run_is_404(client):
    run = seed_run(client.app.state.school, create_attempt(client))
    response = client.get("/api/v1/runs/" + run["id"] + "/tips")
    assert response.status_code == 200, response.text
    assert response.json() == {"tips": None}
    assert client.get("/api/v1/runs/run-not-found/tips").status_code == 404


@pytest.mark.parametrize("status", ["completed", "failed", "cancelled", "interrupted"])
def test_terminal_tips_use_one_tool_free_call_and_cache_without_changing_grades(client, tips_setup, status):
    school, attempt, run, profile = tips_setup
    run["status"] = status
    school.store.put("run", run["id"], run)
    school.store.put("history", attempt["id"], [{"role": "assistant", "content": "已有对话"}])
    school.store.put(
        "submission",
        "submission-existing",
        {
            "id": "submission-existing",
            "attempt_id": attempt["id"],
            "passed": False,
            "created_at": "2026-10-20T00:02:00Z",
            "rules": [],
            "evidence": [{"run_id": run["id"]}],
        },
    )
    before = {kind: school.store.list(kind) for kind in ("attempt", "run", "history", "submission")}
    requests = []

    def handle(request):
        requests.append(request)
        return provider_response()

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as model:
            school.tips.client = model
            first = await asyncio.to_thread(generate, client, run, profile)
            second = await asyncio.to_thread(generate, client, run, profile, "tips-another-key")
            return first, second

    first, second = asyncio.run(exercise())
    assert first.status_code == 200, first.text
    tips = first.json()
    assert second.json() == tips
    assert client.get("/api/v1/runs/" + run["id"] + "/tips").json() == {"tips": tips}
    assert tips["run_id"] == run["id"] and tips["attempt_id"] == attempt["id"]
    assert tips["profile_id"] == profile["id"] and tips["model"] == profile["model"]
    assert tips["assessment"] == VALID_TIPS["assessment"]
    assert tips["usage"] == {"input_tokens": 17, "output_tokens": 23, "model_calls": 1}
    assert len(requests) == 1
    request = requests[0]
    assert request.url.path == "/v1/chat/completions"
    payload = json.loads(request.content)
    assert payload["model"] == profile["model"]
    assert "tools" not in payload and "tool_choice" not in payload
    assert SECRET not in json.dumps(payload)
    assert school.store.get("tips", run["id"]) == tips
    assert school.store.get("tips_pending", run["id"], missing_ok=True) is None
    assert {kind: school.store.list(kind) for kind in before} == before
    assert school.slot is None and school.busy_profile is None


def test_cached_tips_survive_restart_and_deleted_profile(client, config, tips_setup):
    school, _, run, profile = tips_setup
    model = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: provider_response()))
    school.tips.client = model
    response = generate(client, run, profile)
    assert response.status_code == 200, response.text
    saved = response.json()
    client.portal.call(model.aclose)
    school.store.remove("profile", profile["id"])
    client.portal.call(school.close)
    from agent_school.main import create_app

    with TestClient(
        create_app(config), base_url="http://127.0.0.1:8000", headers={"X-Local-Token": config.local_token}
    ) as reopened:
        assert reopened.get("/api/v1/runs/" + run["id"] + "/tips").json() == {"tips": saved}
        cached = generate(reopened, run, profile, "after-restart-key")
        assert cached.status_code == 200, cached.text
        assert cached.json() == saved
        assert not reopened.app.state.school.credentials.values


@pytest.mark.parametrize("status", ["queued", "running", "awaiting_approval"])
def test_nonterminal_runs_never_call_provider(client, tips_setup, status):
    school, _, run, profile = tips_setup
    run["status"] = status
    school.store.put("run", run["id"], run)
    calls = []
    model = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: calls.append(request)))
    school.tips.client = model
    try:
        response = generate(client, run, profile)
    finally:
        client.portal.call(model.aclose)
    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == "RUN_BUSY"
    assert not calls


@pytest.mark.parametrize(
    "condition,expected",
    [
        ("unchecked", "MODEL_NOT_READY"),
        ("no-key", "CREDENTIAL_MISSING"),
        ("revision", "REVISION_CONFLICT"),
        ("busy", "RUN_BUSY"),
    ],
)
def test_generation_validates_before_provider_call(client, tips_setup, condition, expected):
    school, _, run, profile = tips_setup
    body = request_body(profile)
    if condition == "unchecked":
        profile["connection_check"]["status"] = "unchecked"
        school.store.put("profile", profile["id"], profile)
    elif condition == "no-key":
        school.credentials.delete("local-owner", profile["id"])
    elif condition == "revision":
        body["expected_profile_revision"] += 1
    else:
        school.slot = "other-work"
    calls = []
    model = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: calls.append(request)))
    school.tips.client = model
    try:
        response = generate(client, run, profile, body=body)
    finally:
        client.portal.call(model.aclose)
        school.slot = None
    assert response.json()["error"]["code"] == expected, response.text
    assert not calls
    assert school.store.get("tips_pending", run["id"], missing_ok=True) is None


@pytest.mark.parametrize(
    "content",
    [
        "not json",
        "```json\n{}\n```",
        "[]",
        '{"assessment":"only"}',
        json.dumps({**VALID_TIPS, "next_steps": []}),
        json.dumps({**VALID_TIPS, "extra": "unexpected"}),
        json.dumps({**VALID_TIPS, "assessment": "x" * 1300}),
        "x" * 70000,
    ],
    ids=[
        "malformed",
        "markdown",
        "array",
        "missing-fields",
        "empty-steps",
        "extra-field",
        "oversized-field",
        "oversized-content",
    ],
)
def test_invalid_provider_content_is_rejected_without_cache_or_retry(client, tips_setup, content):
    school, _, run, profile = tips_setup
    calls = []

    def handle(request):
        calls.append(request)
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})

    model = httpx.AsyncClient(transport=httpx.MockTransport(handle))
    school.tips.client = model
    try:
        response = generate(client, run, profile)
    finally:
        client.portal.call(model.aclose)
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "TIPS_INVALID"
    assert len(calls) == 1
    assert school.slot is None and school.busy_profile is None
    assert school.store.get("tips", run["id"], missing_ok=True) is None
    assert school.store.get("tips_pending", run["id"], missing_ok=True) is None


@pytest.mark.parametrize(
    "failure,status,code",
    [(401, 401, "MODEL_AUTH_FAILED"), (503, 503, "MODEL_UNAVAILABLE"), ("timeout", 504, "MODEL_TIMEOUT")],
)
def test_provider_errors_are_sanitized_and_release_generation_slot(
    client, tips_setup, caplog, failure, status, code
):
    school, _, run, profile = tips_setup
    calls = []

    def handle(request):
        calls.append(request)
        if len(calls) == 1:
            if failure == "timeout":
                raise httpx.ReadTimeout("private-provider-detail " + SECRET, request=request)
            return httpx.Response(failure, json={"error": {"message": "private-provider-detail " + SECRET}})
        return provider_response(usage=False)

    model = httpx.AsyncClient(transport=httpx.MockTransport(handle))
    school.tips.client = model
    try:
        response = generate(client, run, profile)
        assert response.status_code == status, response.text
        assert response.json()["error"]["code"] == code
        assert len(calls) == 1
        assert school.slot is None and school.busy_profile is None
        assert school.store.get("tips_pending", run["id"], missing_ok=True) is None
        assert "private-provider-detail" not in response.text + caplog.text
        assert SECRET not in response.text + caplog.text
        retry = generate(client, run, profile, "explicit-second-attempt")
        assert retry.status_code == 200, retry.text
        assert retry.json()["usage"] == {"input_tokens": None, "output_tokens": None, "model_calls": 1}
        assert len(calls) == 2
    finally:
        client.portal.call(model.aclose)


def test_durable_pending_request_is_uncertain_and_never_reissued(client, tips_setup):
    school, _, run, profile = tips_setup
    school.store.put("tips_pending", run["id"], {"run_id": run["id"], "profile_id": profile["id"]})
    response = generate(client, run, profile)
    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == "TIPS_UNCERTAIN"
    assert school.store.get("tips_pending", run["id"])
    assert school.slot is None


def test_generation_holds_global_slot_and_profile_until_finished(client, tips_setup):
    school, attempt, run, profile = tips_setup
    entered, release = threading.Event(), threading.Event()
    calls = []

    async def handle(request):
        calls.append(request)
        entered.set()
        await asyncio.to_thread(release.wait, 5)
        return provider_response()

    model = httpx.AsyncClient(transport=httpx.MockTransport(handle))
    school.tips.client = model
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(generate, client, run, profile)
        try:
            assert entered.wait(5), "tips generation never reached mock provider"
            assert school.slot is not None and school.busy_profile == profile["id"]
            assert school.store.get("tips_pending", run["id"])
            other_run = seed_run(school, attempt, key="run-other-tips")
            blocked = generate(client, other_run, profile, "simultaneous-tips")
            assert blocked.status_code == 409
            assert blocked.json()["error"]["code"] == "RUN_BUSY"
            blocked_run = post(
                client,
                "/runs",
                {
                    "attempt_id": attempt["id"],
                    "expected_attempt_revision": attempt["revision"],
                    "profile_id": None,
                    "input_text": "blocked",
                },
                "run-during-tips",
            )
            assert blocked_run.json()["error"]["code"] == "RUN_BUSY"
            mutation = client.delete(
                "/api/v1/model-profiles/" + profile["id"], params={"expected_revision": profile["revision"]}
            )
            assert mutation.status_code == 409
            assert mutation.json()["error"]["code"] == "PROFILE_BUSY"
            assert len(calls) == 1
        finally:
            release.set()
            response = pending.result(timeout=5)
            client.portal.call(model.aclose)
    assert response.status_code == 200, response.text
    assert school.slot is None and school.busy_profile is None


def test_context_is_versioned_bounded_and_excludes_future_other_attempt_and_private_rules(client):
    school = client.app.state.school
    attempt = create_attempt(client)
    checked_profile(client)
    prior = seed_run(
        school, attempt, "run-prior", created_at="2026-10-19T00:00:00Z", text="prior-input-evidence"
    )
    school.store.append_event(
        prior["id"],
        {"kind": "message.completed", "payload": {"role": "assistant", "content": "prior-output-evidence"}},
    )
    run = seed_run(school, attempt)
    seed_run(school, attempt, "run-future", created_at="2026-10-21T00:00:00Z", text="future-input-excluded")
    other = create_attempt(client, key="other-tips-attempt")
    seed_run(school, other, "run-unrelated", created_at="2026-10-18T00:00:00Z", text="other-attempt-excluded")
    school.store.put("history", attempt["id"], [{"role": "assistant", "content": "mutable-history-excluded"}])
    school.store.append_event(
        run["id"],
        {"kind": "message.completed", "payload": {"role": "assistant", "content": "target-output " + SECRET}},
    )
    run = school.store.get("run", run["id"])
    context = school.tips.context(run)
    lesson = school.catalog.get(attempt["lesson_id"], attempt["lesson_version"])
    assert context["lesson"]["id"] == attempt["lesson_id"]
    assert context["lesson"]["version"] == attempt["lesson_version"]
    assert context["lesson"]["objectives"] == lesson["manifest"]["objectives"]
    assert context["lesson"]["completion_criteria"] == lesson["manifest"]["completion_criteria"]
    assert context["target_run_id"] == run["id"]
    assert [item["id"] for item in context["runs"]] == [prior["id"], run["id"]]
    text = json.dumps(context, ensure_ascii=False)
    assert "prior-output-evidence" in text and "target-output" in text
    for forbidden in (
        "future-input-excluded",
        "other-attempt-excluded",
        "mutable-history-excluded",
        SECRET,
        "correct_option_id",
        "distinct_completed_runs",
        "choice_answer",
    ):
        assert forbidden not in text


def test_provider_result_redacts_keys_before_persistence(client, tips_setup):
    school, _, run, profile = tips_setup
    model = httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda request: provider_response({**VALID_TIPS, "assessment": "Copied secret " + SECRET})
        )
    )
    school.tips.client = model
    try:
        response = generate(client, run, profile)
    finally:
        client.portal.call(model.aclose)
    assert response.status_code == 200, response.text
    assert SECRET not in response.text
    assert SECRET not in json.dumps(school.store.list("tips"))


def test_tips_require_explicit_idempotency_key(client, tips_setup):
    _, _, run, profile = tips_setup
    response = client.post("/api/v1/runs/" + run["id"] + "/tips", json=request_body(profile))
    assert response.status_code == 422


@pytest.mark.parametrize(
    "envelope",
    [
        {},
        {"choices": []},
        {"choices": [None]},
        {"choices": ["invalid"]},
        {"choices": [{"message": None}]},
        {"choices": [{"message": []}]},
        {"choices": [{"message": {"content": json.dumps(VALID_TIPS)}}], "usage": [1]},
        {"choices": [{"message": {"content": None}}]},
        {"choices": [{"finish_reason": "length", "message": {"content": json.dumps(VALID_TIPS)}}]},
        {"choices": [{"message": {"content": json.dumps(VALID_TIPS), "tool_calls": [{"id": "unexpected"}]}}]},
    ],
    ids=[
        "no-choices",
        "empty-choices",
        "null-choice",
        "string-choice",
        "null-message",
        "list-message",
        "list-usage",
        "null-content",
        "truncated",
        "tool-call",
    ],
)
def test_invalid_provider_envelopes_do_not_become_cached_tips(client, tips_setup, envelope):
    school, _, run, profile = tips_setup
    model = httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(200, json=envelope))
    )
    school.tips.client = model
    try:
        response = generate(client, run, profile)
    finally:
        client.portal.call(model.aclose)
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "TIPS_INVALID"
    assert school.store.get("tips", run["id"], missing_ok=True) is None
    assert school.store.get("tips_pending", run["id"], missing_ok=True) is None
    assert school.slot is None and school.busy_profile is None


def test_historical_run_on_superseded_attempt_can_generate_tips(client, tips_setup):
    school, attempt, run, profile = tips_setup
    reset = post(
        client,
        "/attempts/" + attempt["id"] + "/reset",
        {"expected_revision": attempt["revision"]},
        "reset-before-tips",
    )
    assert reset.status_code == 201, reset.text
    assert school.attempt(attempt["id"])["status"] == "superseded"
    model = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: provider_response()))
    school.tips.client = model
    try:
        response = generate(client, run, profile)
    finally:
        client.portal.call(model.aclose)
    assert response.status_code == 200, response.text
    assert response.json()["attempt_id"] == attempt["id"]


def test_context_truncation_retains_target_and_marks_incomplete_evidence(client):
    school = client.app.state.school
    attempt = create_attempt(client)
    for index in range(12):
        seed_run(
            school,
            attempt,
            f"run-prior-{index:02}",
            created_at=f"2026-10-19T00:00:{index:02}Z",
            text="p" * 7000,
        )
    run = seed_run(school, attempt)
    for index in range(105):
        school.store.append_event(
            run["id"],
            {
                "kind": "message.completed",
                "payload": {"role": "assistant", "content": f"evidence-{index}" + "e" * 5000},
            },
        )
    context = school.tips.context(school.store.get("run", run["id"]))
    assert context["context_truncated"] is True
    assert context["runs"][-1]["id"] == run["id"]
    assert len(context["runs"]) <= 10
    assert len(context["runs"][-1]["events"]) <= 100
    assert len(json.dumps(context, ensure_ascii=False)) <= 60000
    assert "evidence-104" in json.dumps(context)


def test_streaming_deltas_do_not_hide_tool_evidence_or_falsely_mark_context_truncated(client):
    school = client.app.state.school
    attempt = create_attempt(client)
    prior = seed_run(school, attempt, "run-stream-prior", text="处理通知")
    run = seed_run(school, attempt, "run-stream-target", text="明确目标、约束和输出要求后处理通知")
    for item in (prior, run):
        school.store.append_event(item["id"], {"kind": "run.started", "payload": {}})
        school.store.append_event(
            item["id"],
            {"kind": "tool.completed", "payload": {"result": {"name": "read_material", "status": "ok"}}},
        )
        for index in range(200):
            school.store.append_event(
                item["id"],
                {"kind": "message.delta", "payload": {"message_id": "stream-message", "delta": str(index)}},
            )
        school.store.append_event(
            item["id"],
            {
                "kind": "message.completed",
                "payload": {"message_id": "stream-message", "content": "已列出两项任务。"},
            },
        )
        school.store.append_event(item["id"], {"kind": "run.completed", "payload": {"status": "completed"}})
    context = school.tips.context(school.store.get("run", run["id"]))
    assert context["context_truncated"] is False
    assert context["platform_facts"]["completed_run_count"] == 2
    assert context["platform_facts"]["distinct_completed_input_count"] == 2
    assert context["lesson"]["available_tools"] == []
    assert context["lesson"]["answer_form"]["kind"] == "choice"
    for item in context["runs"]:
        kinds = [e["kind"] for e in item["events"]]
        assert "tool.completed" in kinds
        assert "message.completed" in kinds
        assert "message.delta" not in kinds


@pytest.mark.parametrize("clock_skew", [False, True], ids=["equal-clock", "clock-moves-backward"])
def test_context_uses_durable_creation_order_after_updates_and_restart(client, config, clock_skew):
    school = client.app.state.school
    attempt = create_attempt(client)
    prior = seed_run(
        school, attempt, "run-z-prior", created_at="2026-10-20T00:00:00Z", text="earlier-created"
    )
    target = seed_run(
        school,
        attempt,
        "run-m-target",
        created_at="2026-10-19T00:00:00Z" if clock_skew else prior["created_at"],
        text="target-created",
    )
    seed_run(
        school,
        attempt,
        "run-a-future",
        created_at="2026-10-18T00:00:00Z" if clock_skew else prior["created_at"],
        text="future-created-excluded",
    )
    # Updating the earlier run must preserve its original durable position.
    prior["status"] = "failed"
    school.store.put("run", prior["id"], prior)

    def check_context(current_school):
        context = current_school.tips.context(current_school.store.get("run", target["id"]))
        assert [item["id"] for item in context["runs"]] == [prior["id"], target["id"]]
        assert "earlier-created" in json.dumps(context)
        assert "future-created-excluded" not in json.dumps(context)

    check_context(school)
    client.portal.call(school.close)
    from agent_school.main import create_app

    with TestClient(
        create_app(config), base_url="http://127.0.0.1:8000", headers={"X-Local-Token": config.local_token}
    ) as reopened:
        check_context(reopened.app.state.school)
