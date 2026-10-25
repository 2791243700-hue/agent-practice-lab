import copy
import io
import json
import zipfile

import pytest

from agent_school.db import Store
from agent_school.grading import Grader
from conftest import create_attempt, post


def reflection_attempt(client, mode="demo", key="reflection-attempt"):
    response = post(
        client,
        "/attempts",
        {
            "lesson_id": "01-task",
            "lesson_version": "1.1.0",
            "mode": mode,
        },
        key,
    )
    assert response.status_code == 201, response.text
    return response.json()


def draft_data():
    return {
        "step": 0,
        "beforeId": "",
        "afterId": "",
        "beforeMessageId": "",
        "afterMessageId": "",
        "changeKind": "",
        "requirement": "",
        "beforeQuote": "",
        "afterQuote": "",
        "judgment": "",
        "explanation": "",
        "nextInstruction": "",
        "facts": {},
        "instruction": "",
        "beforeStartOffset": 0,
        "afterStartOffset": 0,
        "beforeEventSeq": 0,
        "afterEventSeq": 0,
    }


def draft_url(attempt):
    return "/api/v1/attempts/" + attempt["id"] + "/reflection-draft"


def put_draft(client, attempt, data, revision=0, attempt_revision=None):
    return client.put(
        draft_url(attempt),
        json={
            "expected_revision": revision,
            "expected_attempt_revision": attempt["revision"]
            if attempt_revision is None
            else attempt_revision,
            "draft": data,
        },
    )


def seed_run(school, attempt, key, input_text, content="前😀通知。重复。重复。", message_id="reply"):
    run = {
        "id": key,
        "attempt_id": attempt["id"],
        "mode": attempt["mode"],
        "status": "completed",
        "last_seq": 0,
        "input_text": input_text,
        "snapshot": {
            "settings": attempt["settings"],
            "selected_file_ids": [],
            "profile_id": None,
            "profile_revision": None,
            "model": None,
        },
        "pending_approval": None,
        "usage": {"input_tokens": None, "output_tokens": None, "model_calls": 0},
        "error": None,
        "created_at": "2026-10-25T00:00:00Z",
        "started_at": "2026-10-25T00:00:00Z",
        "ended_at": "2026-10-25T00:00:00Z",
    }
    school.store.put("run", key, run)
    event = school.events.append(
        key,
        "message.completed",
        {
            "message_id": message_id,
            "role": "assistant",
            "content": content,
        },
    )
    school.events.append(key, "run.completed", {"status": "completed", "usage": run["usage"]})
    return school.store.get("run", key), event


def pair(client, attempt):
    school = client.app.state.school
    before, before_event = seed_run(school, attempt, "run-z-before", "整理通知")
    after, after_event = seed_run(
        school, attempt, "run-a-after", "整理通知；未知信息标记待确认", "后😀通知。重复。重复。"
    )
    form = school.catalog.get("01-task", "1.1.0")["manifest"]["answer_form"]
    answers = {
        "kind": "reflection",
        "baseline_run_id": before["id"],
        "revised_run_id": after["id"],
        "change": {"category": "constraint", "quote": "未知信息标记待确认"},
        "evidence": {
            "before": {
                "message_id": "reply",
                "event_seq": before_event["seq"],
                "quote": "重复。",
                "start_offset": 9,
            },
            "after": {
                "message_id": "reply",
                "event_seq": after_event["seq"],
                "quote": "😀通知",
                "start_offset": 1,
            },
        },
        "judgment": "satisfied",
        "explanation": "按原文核对。",
        "next_instruction": "",
        "challenge": {
            "challenge_id": form["challenge"]["id"],
            "judgments": [
                {
                    "item_id": item["id"],
                    "decision": "known" if item["id"] in ("start", "place") else "confirm",
                }
                for item in form["challenge"]["items"]
            ],
            "instruction": "整理活动通知，缺少的信息请标记待确认。",
        },
    }
    # The repeated quote selects its second occurrence using code-point offsets.
    answers["evidence"]["before"]["start_offset"] = "前😀通知。重复。重复。".rindex("重复。")
    return answers


def submit_reflection(client, attempt, answers, key="reflection-submit"):
    return post(
        client,
        "/submissions",
        {
            "attempt_id": attempt["id"],
            "expected_attempt_revision": attempt["revision"],
            "answers": answers,
        },
        key,
    )


def test_reflection_published_separately_and_private_answers_not_exposed(client):
    latest = client.get("/api/v1/lessons/01-task").json()
    assert latest["version"] == "1.1.0"
    assert latest["answer_form"]["kind"] == "reflection"
    assert "expected_judgments" not in json.dumps(latest)
    old = client.get("/api/v1/lessons/01-task?version=1.0.0").json()
    assert old["answer_form"]["kind"] == "choice"
    assert create_attempt(client)["lesson_version"] == "1.0.0"


def test_reflection_draft_persists_with_independent_revision_and_conflicts(client):
    attempt = reflection_attempt(client)
    assert client.get(draft_url(attempt)).json() == {
        "attempt_id": attempt["id"],
        "revision": 0,
        "draft": None,
        "updated_at": None,
    }
    data = {**draft_data(), "explanation": "尚在编辑😀"}
    saved = put_draft(client, attempt, data)
    assert saved.status_code == 200, saved.text
    assert saved.json()["revision"] == 1 and saved.json()["draft"] == data
    assert client.get("/api/v1/attempts/" + attempt["id"]).json()["revision"] == 1
    reopened = Store(client.app.state.school.config.data_dir)
    try:
        assert reopened.get("reflection-draft", attempt["id"]) == saved.json()
    finally:
        reopened.close()
    assert put_draft(client, attempt, data).json()["error"]["code"] == "REVISION_CONFLICT"
    assert put_draft(client, attempt, data, 1, 99).json()["error"]["code"] == "REVISION_CONFLICT"
    assert client.get(draft_url(attempt)).json() == saved.json()


def test_draft_history_readable_after_reset_but_only_active_reflection_writable(client):
    attempt = reflection_attempt(client)
    saved = put_draft(client, attempt, draft_data()).json()
    reset = post(
        client, "/attempts/" + attempt["id"] + "/reset", {"expected_revision": 1}, "reset-reflection"
    )
    assert reset.status_code == 201, reset.text
    assert client.get(draft_url(attempt)).json() == saved
    assert put_draft(client, attempt, draft_data(), 1).json()["error"]["code"] == "ATTEMPT_SUPERSEDED"
    assert client.get(draft_url(reset.json())).json()["draft"] is None
    old = create_attempt(client)
    assert put_draft(client, old, draft_data()).status_code == 422
    assert client.get("/api/v1/attempts/missing/reflection-draft").status_code == 404


@pytest.mark.parametrize("judgment", ["satisfied", "partial", "unsatisfied"])
@pytest.mark.parametrize("mode", ["demo", "live"])
def test_reflection_accepts_exact_unicode_quotes_and_all_honest_judgments(client, judgment, mode):
    attempt = reflection_attempt(client, mode)
    answers = pair(client, attempt)
    answers.update(judgment=judgment, next_instruction="请核对缺失信息" if judgment != "satisfied" else "")
    response = submit_reflection(client, attempt, answers)
    assert response.status_code == 201, response.text
    result = response.json()
    assert result["evaluation_passed"]
    assert result["passed"] == (mode == "live")
    assert len(result["rules"]) == 4
    assert all(rule["evidence_refs"] for rule in result["rules"])
    assert {ref for rule in result["rules"] for ref in rule["evidence_refs"]} <= {
        e["id"] for e in result["evidence"]
    }


@pytest.mark.parametrize(
    "mutation,failed_rule",
    [
        ("reverse", "reflection-pair"),
        ("same", "reflection-pair"),
        ("failed", "reflection-pair"),
        ("empty_message", "reflection-pair"),
        ("change_old", "reflection-change"),
        ("change_missing", "reflection-change"),
        ("quote", "reflection-quotes"),
        ("utf16_offset", "reflection-quotes"),
        ("challenge", "reflection-challenge"),
        ("missing_judgment", "reflection-challenge"),
    ],
)
def test_semantically_incorrect_reflections_create_failed_submissions(client, mutation, failed_rule):
    attempt = reflection_attempt(client)
    answers = pair(client, attempt)
    school = client.app.state.school
    if mutation == "reverse":
        answers["baseline_run_id"], answers["revised_run_id"] = (
            answers["revised_run_id"],
            answers["baseline_run_id"],
        )
        answers["evidence"]["before"], answers["evidence"]["after"] = (
            answers["evidence"]["after"],
            answers["evidence"]["before"],
        )
    elif mutation == "same":
        answers["revised_run_id"] = answers["baseline_run_id"]
        answers["evidence"]["after"] = copy.deepcopy(answers["evidence"]["before"])
    elif mutation == "failed":
        run = school.store.get("run", answers["revised_run_id"])
        school.store.put("run", run["id"], {**run, "status": "failed"})
    elif mutation == "empty_message":
        seed_run(school, attempt, "run-empty", "整理通知；未知信息标记待确认", "")
        answers["revised_run_id"] = "run-empty"
    elif mutation.startswith("change_"):
        answers["change"]["quote"] = "整理通知" if mutation == "change_old" else "从未要求过"
    elif mutation == "quote":
        answers["evidence"]["after"]["quote"] = "并不存在"
    elif mutation == "utf16_offset":
        answers["evidence"]["before"]["start_offset"] += 1
    elif mutation == "challenge":
        answers["challenge"]["judgments"][0]["decision"] = "confirm"
    else:
        answers["challenge"]["judgments"].pop()
    response = submit_reflection(client, attempt, answers)
    assert response.status_code == 201, response.text
    result = response.json()
    assert not result["evaluation_passed"]
    assert not next(rule for rule in result["rules"] if rule["rule_id"] == failed_rule)["passed"]


@pytest.mark.parametrize(
    "mutation",
    [
        "unknown_run",
        "foreign_run",
        "foreign_owner",
        "wrong_mode",
        "message",
        "event",
        "challenge_id",
        "item_id",
        "duplicate_item",
    ],
)
def test_forged_references_rejected_without_snapshot(client, mutation):
    attempt = reflection_attempt(client)
    answers = pair(client, attempt)
    school = client.app.state.school
    if mutation == "unknown_run":
        answers["baseline_run_id"] = "run-unknown"
    elif mutation == "foreign_run":
        other = reflection_attempt(client, key="other-attempt")
        seed_run(school, other, "run-foreign", "整理通知")
        answers["baseline_run_id"] = "run-foreign"
    elif mutation in ("foreign_owner", "wrong_mode"):
        run = school.store.get("run", answers["baseline_run_id"])
        if mutation == "wrong_mode":
            school.store.put("run", run["id"], {**run, "mode": "live"})
        else:
            school.store.remove("run", run["id"])
            school.store.put("run", run["id"], run, owner="another-owner")
    elif mutation == "message":
        answers["evidence"]["before"]["message_id"] = "invented"
    elif mutation == "event":
        answers["evidence"]["before"]["event_seq"] = 999
    elif mutation == "challenge_id":
        answers["challenge"]["challenge_id"] = "another-challenge"
    elif mutation == "item_id":
        answers["challenge"]["judgments"][0]["item_id"] = "invented"
    else:
        answers["challenge"]["judgments"].append(answers["challenge"]["judgments"][0])
    response = submit_reflection(client, attempt, answers)
    assert response.status_code in (404, 422), response.text
    assert school.store.list("submission") == []
    assert not list((school.config.data_dir / "snapshots").glob("*"))


def test_reflection_export_and_submission_are_frozen_independently_of_draft(client):
    attempt = reflection_attempt(client)
    answers = pair(client, attempt)
    result = submit_reflection(client, attempt, answers).json()
    saved = put_draft(client, attempt, {**draft_data(), "explanation": "草稿一"}).json()
    response = post(
        client, "/attempts/" + attempt["id"] + "/exports", {"expected_revision": 1}, "reflection-export"
    )
    assert response.status_code == 201, response.text
    export = response.json()
    put_draft(client, attempt, {**draft_data(), "explanation": "草稿二"}, 1)
    raw = client.get("/api/v1/exports/" + export["id"] + "/download")
    with zipfile.ZipFile(io.BytesIO(raw.content)) as archive:
        learning = json.loads(archive.read("learning.json"))
    assert learning["reflection_draft"] == saved
    assert learning["submissions"] == [result]
    assert client.get("/api/v1/submissions/" + result["id"]).json() == result
    assert result["answers"] == answers


@pytest.mark.parametrize(
    "invalid",
    ["unknown_run", "foreign_run", "message", "event", "unknown_fact", "owner", "oversize", "extra"],
)
def test_invalid_or_foreign_draft_fields_leave_saved_revision_unchanged(client, invalid):
    attempt = reflection_attempt(client)
    answers = pair(client, attempt)
    data = draft_data()
    saved = put_draft(client, attempt, data).json()
    data.update(beforeId=answers["baseline_run_id"], beforeMessageId="reply", beforeEventSeq=1)
    school = client.app.state.school
    if invalid == "unknown_run":
        data["beforeId"] = "run-unknown"
    elif invalid == "foreign_run":
        other = reflection_attempt(client, key="draft-other-attempt")
        seed_run(school, other, "run-other", "整理通知")
        data["beforeId"] = "run-other"
    elif invalid == "message":
        data["beforeMessageId"] = "not-a-message"
    elif invalid == "event":
        data["beforeEventSeq"] = 999
    elif invalid == "unknown_fact":
        data["facts"] = {"not-a-challenge-item": "confirm"}
    elif invalid == "owner":
        run = school.store.get("run", data["beforeId"])
        school.store.remove("run", run["id"])
        school.store.put("run", run["id"], run, owner="another-owner")
    elif invalid == "oversize":
        data["explanation"] = "a" * 6001
    else:
        data["unexpected"] = "field"
    response = put_draft(client, attempt, data, 1)
    assert response.status_code in (404, 422), response.text
    assert client.get(draft_url(attempt)).json() == saved


@pytest.mark.parametrize("field", ["baseline_run_id", "change", "evidence", "challenge"])
def test_incomplete_reflection_answers_rejected_before_freeze(client, field):
    attempt = reflection_attempt(client)
    answers = pair(client, attempt)
    del answers[field]
    assert submit_reflection(client, attempt, answers).status_code == 422
    assert client.app.state.school.store.list("submission") == []
    assert not list((client.app.state.school.config.data_dir / "snapshots").glob("*"))


@pytest.mark.parametrize("judgment", ["partial", "unsatisfied"])
def test_unmet_judgment_requires_next_instruction_before_freeze(client, judgment):
    attempt = reflection_attempt(client)
    answers = pair(client, attempt)
    answers.update(judgment=judgment, next_instruction="  ")
    assert submit_reflection(client, attempt, answers).status_code == 422
    assert client.app.state.school.store.list("submission") == []
    assert not list((client.app.state.school.config.data_dir / "snapshots").glob("*"))


def test_reflection_chronology_survives_store_reopen_and_no_answer_quality_keywords(client):
    attempt = reflection_attempt(client, "live")
    answers = pair(client, attempt)
    answers.update(explanation="甲", next_instruction="乙", judgment="unsatisfied")
    answers["challenge"]["instruction"] = "丙"
    response = submit_reflection(client, attempt, answers)
    assert response.status_code == 201, response.text
    result = response.json()
    assert result["passed"]
    school = copy.copy(client.app.state.school)
    school.store = Store(school.config.data_dir)
    try:
        snapshot = school.store.get("snapshot", result["id"])
        rules, _ = Grader(
            school, snapshot["attempt"], snapshot["lesson"], result["answers"], snapshot["files"]
        ).evaluate()
        assert all(rule["passed"] for rule in rules)
        assert snapshot["lesson"]["manifest"]["version"] == "1.1.0"
        assert (
            snapshot["lesson"]["manifest"]["answer_form"]["challenge"]["id"]
            == answers["challenge"]["challenge_id"]
        )
    finally:
        school.store.close()


def test_reflection_response_validation_failure_rolls_back_grade_and_snapshot(client, monkeypatch):
    attempt = reflection_attempt(client)
    answers = pair(client, attempt)
    school = client.app.state.school
    validate = school.contracts.validate

    def reject_response(name, value, response=False):
        if name == "Submission" and response:
            raise RuntimeError("invalid response")
        return validate(name, value, response)

    monkeypatch.setattr(school.contracts, "validate", reject_response)
    response = submit_reflection(client, attempt, answers)
    assert response.status_code == 500
    assert school.store.list("submission") == []
    assert school.store.list("snapshot") == []
    assert not list((school.config.data_dir / "snapshots").glob("*"))
    assert school.attempt(attempt["id"])["latest_submission_id"] is None


def test_reflection_draft_write_failure_rolls_back_revision(client, monkeypatch):
    attempt = reflection_attempt(client)
    saved = put_draft(client, attempt, draft_data()).json()
    school = client.app.state.school
    put = school.store.put

    def fail_after_write(kind, key, value, **kwargs):
        result = put(kind, key, value, **kwargs)
        if kind == "reflection-draft":
            raise OSError("disk failure")
        return result

    monkeypatch.setattr(school.store, "put", fail_after_write)
    response = put_draft(client, attempt, {**draft_data(), "explanation": "new"}, 1)
    assert response.status_code == 500
    assert client.get(draft_url(attempt)).json() == saved


@pytest.mark.parametrize("invalid", ["challenge", "missing", "duplicate", "unknown", "form"])
def test_reflection_publishing_rejects_inconsistent_private_challenge(client, invalid):
    catalog = client.app.state.school.catalog
    lesson = copy.deepcopy(catalog.get("01-task", "1.1.0"))
    manifest = lesson["manifest"]
    manifest["version"] = "invalid-reflection"
    params = manifest["rules"][-1]["params"]
    if invalid == "challenge":
        params["challenge_id"] = "other"
    elif invalid == "missing":
        params["expected_judgments"].pop()
    elif invalid == "duplicate":
        params["expected_judgments"].append(params["expected_judgments"][0])
    elif invalid == "unknown":
        params["expected_judgments"][0]["item_id"] = "unknown"
    else:
        manifest["answer_form"] = {"kind": "artifact", "prompt": "other"}
    catalog.contracts.lesson_validator.validate(manifest)
    with pytest.raises(ValueError):
        catalog.publish(lesson)
    assert catalog.store.get("lesson", "01-task@invalid-reflection", owner="system", missing_ok=True) is None
