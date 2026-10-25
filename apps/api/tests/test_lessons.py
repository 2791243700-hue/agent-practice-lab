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


def test_latest_version_accepts_mixed_legal_strings_and_prefers_numeric_release(client):
    catalog = client.app.state.school.catalog
    original = catalog.get("01-task", "1.0.0")
    for version in ["2.0.beta", "2.0.alpha", "2.00.0", "2.0.00", "2.0.²", "2..text"]:
        updated = copy.deepcopy(original)
        updated["manifest"]["version"] = version
        catalog.publish(updated)
    assert catalog.get("01-task")["manifest"]["version"] == "2.00.0"
    assert client.get("/api/v1/lessons").status_code == 200
    latest = copy.deepcopy(original)
    latest["manifest"]["version"] = "2.0.10"
    catalog.publish(latest)
    assert catalog.get("01-task")["manifest"]["version"] == "2.0.10"


@pytest.mark.parametrize("via_import", [False, True])
@pytest.mark.parametrize(
    "invalid", ["optional", "form", "question", "option", "course", "fact-task", "fact-source"]
)
def test_publish_rejects_unusable_grading_configuration(client, tmp_path, via_import, invalid):
    catalog = client.app.state.school.catalog
    lesson_id = {"course": "03-tools", "fact-task": "02-context", "fact-source": "02-context"}.get(
        invalid, "01-task"
    )
    value = copy.deepcopy(catalog.get(lesson_id, "1.0.0"))
    manifest = value["manifest"]
    manifest["version"] = "invalid-config"
    if invalid == "optional":
        for rule in manifest["rules"]:
            rule["required"] = False
    elif invalid == "form":
        manifest["answer_form"] = {"kind": "artifact", "prompt": "save"}
    else:
        params = manifest["rules"][-1]["params"]
        if invalid in ("question", "option", "course"):
            params[
                {"question": "question_id", "option": "correct_option_id", "course": "course_id"}[invalid]
            ] = "unknown"
        else:
            params["expected_facts"][0]["task_id" if invalid == "fact-task" else "source_id"] = "unknown"
    # These manifests meet the JSON schema; publication must enforce semantic usability.
    catalog.contracts.lesson_validator.validate(manifest)
    with pytest.raises(ValueError):
        if via_import:
            package = tmp_path / "course"
            package.mkdir()
            (package / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            (package / manifest["intro_file"]).write_text(value["intro"], encoding="utf-8")
            (package / manifest["task_file"]).write_text(value["task"], encoding="utf-8")
            for material in value["materials"]:
                target = package / material["path"]
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(material["content"], encoding="utf-8")
            catalog.import_package(package)
        else:
            catalog.publish(value)
    assert catalog.store.get("lesson", lesson_id + "@invalid-config", owner="system", missing_ok=True) is None


@pytest.mark.parametrize("via_import", [False, True])
@pytest.mark.parametrize("invalid", ["required-source", "form-source", "artifact-source"])
def test_publish_rejects_grading_sources_missing_from_course_materials(client, tmp_path, via_import, invalid):
    catalog = client.app.state.school.catalog
    lesson_id = "04-permission" if invalid == "artifact-source" else "02-context"
    value = copy.deepcopy(catalog.get(lesson_id, "1.0.0"))
    manifest = value["manifest"]
    manifest["version"] = "missing-source"
    if invalid == "required-source":
        manifest["rules"][0]["params"]["required_source_ids"] = ["missing-material"]
    elif invalid == "form-source":
        manifest["answer_form"]["sources"].append({"source_id": "missing-material", "label": "不存在的资料"})
    else:
        manifest["rules"][1]["params"]["expected_items"][0]["source_id"] = "missing-material"
    catalog.contracts.lesson_validator.validate(manifest)
    with pytest.raises(ValueError):
        if via_import:
            package = tmp_path / "course"
            package.mkdir()
            (package / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            (package / manifest["intro_file"]).write_text(value["intro"], encoding="utf-8")
            (package / manifest["task_file"]).write_text(value["task"], encoding="utf-8")
            for material in value["materials"]:
                target = package / material["path"]
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(material["content"], encoding="utf-8")
            catalog.import_package(package)
        else:
            catalog.publish(value)
    assert catalog.store.get("lesson", lesson_id + "@missing-source", owner="system", missing_ok=True) is None
