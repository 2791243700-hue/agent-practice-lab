import copy
import json

import pytest

from conftest import create_attempt


def test_intro_available_without_key_and_answers_are_private(client):
    lessons = client.get("/api/v1/lessons").json()["items"]
    assert len(lessons) == 4
    for lesson in lessons:
        response = client.get("/api/v1/lessons/" + lesson["id"])
        assert response.status_code == 200
        value = response.json()
        assert len(value["intro_markdown"]) > 100
        assert "rules" not in value
        assert "correct_option_id" not in response.text


def test_version_archive_survives_course_changes(client):
    attempt = create_attempt(client)
    catalog = client.app.state.school.catalog
    old = catalog.get("01-task", "1.0.0")
    updated = copy.deepcopy(old)
    updated["manifest"]["version"] = "2.0.0"
    updated["intro"] = "新的课程导读"
    catalog.publish(updated)
    detail = client.get("/api/v1/lessons/01-task?version=" + attempt["lesson_version"]).json()
    assert detail["intro_markdown"] == old["intro"]
    assert client.get("/api/v1/lessons/01-task").json()["version"] == "2.0.0"


def test_course_missing_intro_or_republishing_changed_version_rejected(client, tmp_path):
    catalog = client.app.state.school.catalog
    original = catalog.get("01-task", "1.0.0")
    changed = copy.deepcopy(original)
    changed["intro"] = "changed"
    with pytest.raises(ValueError):
        catalog.publish(changed)
    package = tmp_path / "invalid"
    package.mkdir()
    manifest = copy.deepcopy(original["manifest"])
    (package / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises((ValueError, FileNotFoundError)):
        catalog.import_package(package)
