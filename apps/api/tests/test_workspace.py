import os
import subprocess

import pytest

from conftest import create_attempt


def test_chinese_workspace_material_preview_and_id_boundaries(client):
    attempt = create_attempt(client, "02-context")
    files = client.get("/api/v1/attempts/" + attempt["id"] + "/files")
    assert files.status_code == 200
    material = files.json()["items"][0]
    assert material["id"] == "notice-week"
    preview = client.get("/api/v1/attempts/" + attempt["id"] + "/files/notice-week").json()
    assert "2026-11-04" in preview["content"]
    assert not preview["truncated"]
    assert client.get("/api/v1/attempts/" + attempt["id"] + "/files/other").status_code == 404
    assert client.get("/api/v1/attempts/" + attempt["id"] + "/files/../outside").status_code in (404, 422)


def test_external_junction_or_symlink_and_material_tamper_are_rejected(client, tmp_path):
    attempt = create_attempt(client, "02-context")
    workspace = client.app.state.school.workspace
    path = workspace.physical(attempt["id"], "notice-week")
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / path.name).write_text("outside-secret", encoding="utf-8")
    parent = path.parent
    backup = parent.with_name("original")
    parent.rename(backup)
    if os.name == "nt":
        result = subprocess.run(["cmd", "/c", "mklink", "/J", str(parent), str(outside)], capture_output=True)
        if result.returncode:
            backup.rename(parent)
            pytest.skip("Windows junction creation unavailable")
    else:
        parent.symlink_to(outside, target_is_directory=True)
    try:
        response = client.get("/api/v1/attempts/" + attempt["id"] + "/files/notice-week")
        assert response.status_code in (409, 422)
        assert "outside-secret" not in response.text
    finally:
        if os.name == "nt":
            parent.rmdir()
        else:
            parent.unlink()
        backup.rename(parent)


def test_two_artifacts_publish_as_one_revision_and_old_ids_remain_readable(client):
    attempt = create_attempt(client, "04-permission")
    ws = client.app.state.school.workspace
    items = [
        {
            "task_id": "submit-summary",
            "title": "提交总结",
            "due_date": "2026-11-04",
            "source_id": "notice-week",
        }
    ]
    first = ws.save_todos(attempt["id"], items)
    second = ws.save_todos(attempt["id"], [{**items[0], "title": "课程总结"}])
    assert len(first) == 2 and len(second) == 2
    current = client.get("/api/v1/attempts/" + attempt["id"] + "/files").json()["items"]
    assert len([f for f in current if f["kind"] == "artifact"]) == 2
    old = client.get("/api/v1/attempts/" + attempt["id"] + "/files/" + first[0]["id"] + "/download")
    assert old.status_code == 200 and "提交总结" in old.content.decode()
