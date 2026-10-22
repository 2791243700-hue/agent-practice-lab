import os
import subprocess
from pathlib import Path

import pytest
from sqlalchemy import event

from agent_school.errors import AppError
from agent_school.schema import Contracts
from conftest import create_attempt, post
from test_grading import submit


def snapshot_files(school):
    folder = school.config.data_dir / "snapshots"
    return {path.relative_to(folder): path.read_bytes() for path in folder.rglob("*") if path.is_file()}


def test_invalid_lesson_answers_do_not_create_snapshot_directories(client):
    attempt = create_attempt(client, "03-tools")
    school = client.app.state.school
    for index in range(2):
        response = post(
            client,
            "/submissions",
            {
                "attempt_id": attempt["id"],
                "expected_attempt_revision": attempt["revision"],
                "answers": {"question_id": "q", "option_id": "a"},
            },
            "invalid-submission-" + str(index),
        )
        assert response.status_code == 422
    assert not list((school.config.data_dir / "snapshots").glob("*"))
    assert school.store.list("submission") == []


@pytest.mark.parametrize("failure", ["freeze", "grade", "persist"])
def test_failed_submission_removes_only_its_snapshot(client, monkeypatch, failure):
    attempt = create_attempt(client, "02-context")
    school = client.app.state.school
    answers = {"facts": [{"task_id": "submit-summary", "due_date": "2026-11-04", "source_id": "notice-week"}]}
    historical = submit(client, attempt, answers, "historical-submission")
    before = snapshot_files(school)
    before_folders = set((school.config.data_dir / "snapshots").iterdir())
    if failure == "freeze":
        original_write = Path.write_bytes

        def failing_write(path, data):
            result = original_write(path, data)
            if "snapshots" in path.parts:
                raise OSError("snapshot disk failure after partial write")
            return result

        monkeypatch.setattr(Path, "write_bytes", failing_write)
    elif failure == "grade":

        def failing_grade(_):
            raise RuntimeError("grading failed")

        monkeypatch.setattr("agent_school.grading.Grader.evaluate", failing_grade)
    else:
        original_put = school.store.put

        def failing_put(kind, *args, **kwargs):
            if kind == "snapshot":
                raise RuntimeError("snapshot database write failed")
            return original_put(kind, *args, **kwargs)

        monkeypatch.setattr(school.store, "put", failing_put)
    with pytest.raises((OSError, RuntimeError)):
        with school.store.atomic():
            school.submissions.submit(
                {
                    "attempt_id": attempt["id"],
                    "expected_attempt_revision": attempt["revision"],
                    "answers": answers,
                }
            )
    assert snapshot_files(school) == before
    assert set((school.config.data_dir / "snapshots").iterdir()) == before_folders
    assert [s["id"] for s in school.store.list("submission")] == [historical["id"]]


def test_snapshot_id_collision_cannot_remove_a_published_snapshot(client, monkeypatch):
    attempt = create_attempt(client, "03-tools")
    answers = {"course_id": "agent101", "session_date": "2026-11-05", "room": "A301"}
    school = client.app.state.school
    historical = submit(client, attempt, answers)
    before = snapshot_files(school)
    monkeypatch.setattr("agent_school.submissions.new_id", lambda _: historical["id"])
    with pytest.raises(FileExistsError):
        school.submissions.submit(
            {
                "attempt_id": attempt["id"],
                "expected_attempt_revision": attempt["revision"],
                "answers": answers,
            }
        )
    assert snapshot_files(school) == before


def test_failed_submission_cleanup_refuses_linked_snapshot_descendants(client, monkeypatch, tmp_path):
    attempt = create_attempt(client, "03-tools")
    school = client.app.state.school
    answers = {"course_id": "agent101", "session_date": "2026-11-05", "room": "A301"}
    outside = tmp_path / "outside"
    outside.mkdir()
    marker = outside / "keep.txt"
    marker.write_text("unrelated data", encoding="utf-8")
    links = []

    def failing_grade(grader):
        folder = school.workspace.safe(grader.frozen[0]["relative"]).parent
        link = folder / "linked"
        if os.name == "nt":
            result = subprocess.run(
                ["cmd", "/c", "mklink", "/J", str(link), str(outside)], capture_output=True
            )
            if result.returncode:
                pytest.skip("Windows junction creation unavailable")
        else:
            link.symlink_to(outside, target_is_directory=True)
        links.append(link)
        raise RuntimeError("grading failed after snapshot tampering")

    monkeypatch.setattr("agent_school.grading.Grader.evaluate", failing_grade)
    try:
        with pytest.raises(AppError):
            with school.store.atomic():
                school.submissions.submit(
                    {
                        "attempt_id": attempt["id"],
                        "expected_attempt_revision": attempt["revision"],
                        "answers": answers,
                    }
                )
        assert marker.read_text(encoding="utf-8") == "unrelated data"
        assert school.store.list("submission") == []
    finally:
        for link in links:
            if os.name == "nt":
                link.rmdir()
            else:
                link.unlink()


@pytest.mark.parametrize("failure", ["response", "idempotency", "commit"])
def test_outer_request_transaction_failure_removes_only_new_snapshot(client, monkeypatch, failure):
    attempt = create_attempt(client, "03-tools")
    school = client.app.state.school
    answers = {"course_id": "agent101", "session_date": "2026-11-05", "room": "A301"}
    historical = submit(client, attempt, answers)
    before = snapshot_files(school)
    before_folders = set((school.config.data_dir / "snapshots").iterdir())
    commit_ready = False
    if failure == "response":
        original_validate = Contracts.validate

        def failing_validate(contracts, name, value, response=False):
            if name == "Submission" and response:
                raise RuntimeError("submission response validation failed")
            return original_validate(contracts, name, value, response=response)

        monkeypatch.setattr(Contracts, "validate", failing_validate)
    else:
        original_put = school.store.put

        def failing_put(kind, *args, **kwargs):
            nonlocal commit_ready
            if kind == "idempotency":
                if failure == "idempotency":
                    raise RuntimeError("idempotency persistence failed")
                commit_ready = True
            return original_put(kind, *args, **kwargs)

        monkeypatch.setattr(school.store, "put", failing_put)

    def fail_commit(_):
        if commit_ready:
            raise RuntimeError("request transaction commit failed")

    if failure == "commit":
        event.listen(school.store.engine, "commit", fail_commit)
    try:
        response = post(
            client,
            "/submissions",
            {
                "attempt_id": attempt["id"],
                "expected_attempt_revision": attempt["revision"],
                "answers": answers,
            },
            "outer-transaction-failure",
        )
    finally:
        if failure == "commit":
            event.remove(school.store.engine, "commit", fail_commit)
    assert response.status_code == 500
    assert snapshot_files(school) == before
    assert set((school.config.data_dir / "snapshots").iterdir()) == before_folders
    assert [s["id"] for s in school.store.list("submission")] == [historical["id"]]
    assert school.attempt(attempt["id"])["latest_submission_id"] == historical["id"]
