import json

import pytest
from sqlalchemy import delete, update

from agent_school.models import events as event_table
from conftest import post
from test_model_assessment import install, provider, response_for
from test_reflection import draft_data, put_draft, seed_run
from test_tips import checked_profile


def brief_attempt(client, mode="live", key="brief-attempt"):
    response = post(
        client,
        "/attempts",
        {
            "lesson_id": "01-task",
            "lesson_version": "1.3.0",
            "mode": mode,
        },
        key,
    )
    assert response.status_code == 201, response.text
    return response.json()


def brief_pair(client, attempt):
    school = client.app.state.school
    seed_run(school, attempt, "brief-before", "整理课程通知", "提交总结和预约实验室。")
    seed_run(
        school,
        attempt,
        "brief-after",
        "整理课程通知，按日期列清单",
        "- 11月4日：提交总结\n- 11月6日：预约实验室",
    )
    return {
        "kind": "brief_reflection",
        "baseline_run_id": "brief-before",
        "revised_run_id": "brief-after",
        "judgment": "partial",
        "explanation": "第二轮列出了日期和事项，但没有写明年份。",
    }


def test_brief_latest_and_archived_forms_are_independent(client):
    latest = client.get("/api/v1/lessons/01-task").json()
    assert latest["version"] == "1.3.0"
    assert latest["answer_form"]["kind"] == "brief_reflection"
    assert len(latest["assessment_policy"]["criteria"]) == 2
    old = client.get("/api/v1/lessons/01-task?version=1.2.0").json()
    assert old["answer_form"]["kind"] == "reflection"
    assert len(old["assessment_policy"]["criteria"]) == 3


def test_run_listing_exposes_durable_order_even_when_clock_moves_backward(client):
    attempt = brief_attempt(client, mode="demo")
    brief_pair(client, attempt)
    school = client.app.state.school
    after = school.store.get("run", "brief-after")
    after["created_at"] = "2026-10-24T00:00:00Z"
    school.store.put("run", after["id"], after)
    response = client.get(f"/api/v1/attempts/{attempt['id']}/runs")
    assert response.status_code == 200
    order = {run["id"]: run.get("creation_index") for run in response.json()["items"]}
    assert order == {"brief-before": 0, "brief-after": 1}


def test_brief_submission_collects_real_evidence_without_quotes_or_challenge(client):
    attempt = brief_attempt(client)
    answers = brief_pair(client, attempt)
    school = client.app.state.school
    # Unselected runs and optional exercise drafts must not affect formal assessment.
    seed_run(school, attempt, "brief-unselected", "UNSELECTED_INPUT", "UNSELECTED_REPLY")
    draft = {
        **draft_data(),
        "beforeId": "brief-before",
        "afterId": "brief-after",
        "explanation": answers["explanation"],
        "facts": {"end": "known"},
        "instruction": "OPTIONAL_DRAFT_NOT_FOR_GRADING",
    }
    assert put_draft(client, attempt, draft).status_code == 200
    profile = checked_profile(client)
    contexts = []

    def handle(request):
        contexts.append(json.loads(json.loads(request.content)["messages"][1]["content"]))
        return provider(response_for(request))

    body = {
        "attempt_id": attempt["id"],
        "expected_attempt_revision": 1,
        "answers": answers,
        "assessment": {
            "profile_id": profile["id"],
            "expected_profile_revision": profile["revision"],
            "consent": True,
        },
    }
    model = install(client, school, handle)
    try:
        result = post(client, "/submissions", body, "brief-submit")
        replay = post(client, "/submissions", body, "brief-submit")
    finally:
        client.portal.call(model.aclose)
    assert result.status_code == 201, result.text
    grade = result.json()
    assert grade["passed"] is True
    assert replay.json() == grade and len(contexts) == 1
    assert grade["answers"] == answers
    context = contexts[0]
    assert set(c["id"] for c in context["rubric"]["criteria"]) == {"meaningful-change", "grounded-reflection"}
    assert context["sources"]["input:brief-before"] == "整理课程通知"
    assert context["sources"]["input:brief-after"] == "整理课程通知，按日期列清单"
    encoded = json.dumps(context, ensure_ascii=False)
    assert "11月4日" in encoded
    assert "challenge" not in context["lesson"]
    assert "OPTIONAL_DRAFT_NOT_FOR_GRADING" not in encoded
    assert "UNSELECTED" not in encoded
    assert any(e.get("run_id") == "brief-before" for e in grade["evidence"])
    assert any(e.get("run_id") == "brief-after" for e in grade["evidence"])


@pytest.mark.parametrize(
    "invalid",
    ["same", "reversed", "foreign", "failed", "empty", "user_only", "no_completion", "blank_explanation"],
)
def test_brief_invalid_evidence_never_calls_assessor(client, invalid):
    attempt = brief_attempt(client)
    answers = brief_pair(client, attempt)
    school = client.app.state.school
    if invalid == "same":
        answers["revised_run_id"] = answers["baseline_run_id"]
    elif invalid == "reversed":
        answers["baseline_run_id"], answers["revised_run_id"] = (
            answers["revised_run_id"],
            answers["baseline_run_id"],
        )
    elif invalid == "foreign":
        other = brief_attempt(client, key="other-attempt")
        seed_run(school, other, "foreign-run", "其他任务")
        answers["revised_run_id"] = "foreign-run"
    elif invalid == "failed":
        run = school.store.get("run", "brief-after")
        run["status"] = "failed"
        school.store.put("run", run["id"], run)
    elif invalid in ("empty", "user_only", "no_completion"):
        run, _ = seed_run(school, attempt, "bad-message", "改进要求", "" if invalid == "empty" else "有内容")
        answers["revised_run_id"] = run["id"]
        # Rewrite the isolated fixture's event rows through its SQLite connection.
        events = school.store.event_list(run["id"])
        if invalid == "user_only":
            events[0]["payload"]["role"] = "user"
            with school.store.atomic() as connection:
                connection.execute(
                    update(event_table)
                    .where(event_table.c.run_id == run["id"], event_table.c.seq == events[0]["seq"])
                    .values(data=events[0])
                )
        elif invalid == "no_completion":
            with school.store.atomic() as connection:
                connection.execute(
                    delete(event_table).where(
                        event_table.c.run_id == run["id"], event_table.c.seq == events[-1]["seq"]
                    )
                )
    else:
        answers["explanation"] = "  "
    calls = []
    model = install(client, school, lambda request: calls.append(request) or provider(response_for(request)))
    try:
        response = post(
            client,
            "/submissions",
            {
                "attempt_id": attempt["id"],
                "expected_attempt_revision": 1,
                "answers": answers,
                "assessment": {"profile_id": "unused", "expected_profile_revision": 1, "consent": True},
            },
            "bad-brief",
        )
    finally:
        client.portal.call(model.aclose)
    assert calls == []
    assert response.status_code == 422 or (response.status_code == 201 and not response.json()["passed"])


def test_brief_draft_keeps_partial_optional_work(client):
    attempt = brief_attempt(client, mode="demo")
    data = {**draft_data(), "explanation": "还在核对", "facts": {"end": "known"}}
    saved = put_draft(client, attempt, data)
    assert saved.status_code == 200, saved.text
    assert client.get(f"/api/v1/attempts/{attempt['id']}/reflection-draft").json()["draft"] == data
