import io
import json
import zipfile

from conftest import create_attempt, post
from test_credentials import configure, make_profile
from test_runs import start, wait_run


def test_export_freezes_learning_data_and_excludes_model_connections(client):
    configure(client, make_profile(client))
    a = create_attempt(client)
    run = start(client, a)
    wait_run(client, run["id"])
    response = post(
        client, "/attempts/" + a["id"] + "/exports", {"expected_revision": 1}, "export-operation-key"
    )
    assert response.status_code == 201, response.text
    info = response.json()
    raw = client.get("/api/v1/exports/" + info["id"] + "/download")
    assert raw.status_code == 200
    assert raw.headers["content-type"].startswith("application/zip")
    with zipfile.ZipFile(io.BytesIO(raw.content)) as archive:
        assert "learning.json" in archive.namelist()
        content = archive.read("learning.json").decode()
        assert "secret-test-key" not in content
        assert "https://model.example" not in content
        assert "profile_id" not in content
        assert "test-local-token" not in content
    assert client.get("/api/v1/exports/" + info["id"]).json() == info


def test_learning_summary_pairs_completed_answers_and_cached_tips_with_each_round(client, monkeypatch):
    school = client.app.state.school

    async def unexpected_model_call(*args, **kwargs):
        raise AssertionError("Export must only read saved Tips")

    monkeypatch.setattr(school.tips, "request_model", unexpected_model_call)
    attempt = create_attempt(client)
    first = start(client, attempt, text="帮我阅读课程通知")
    wait_run(client, first["id"])
    second = start(client, attempt, text="列出通知里的截止日期", key="second-export-run")
    wait_run(client, second["id"])
    advice = {
        "assessment": "已明确交付形式。",
        "gaps": ["尚缺日期。"],
        "next_steps": ["把日期也列出来。"],
        "evidence": ["回答里有两项待办。"],
    }
    school.store.put(
        "tips",
        first["id"],
        {**advice, "profile_id": "private-profile", "model": "private-model", "api_key": "private-key"},
    )
    response = post(client, f"/attempts/{attempt['id']}/exports", {"expected_revision": 1}, "export-two-runs")
    assert response.status_code == 201, response.text
    raw = client.get(f"/api/v1/exports/{response.json()['id']}/download")
    with zipfile.ZipFile(io.BytesIO(raw.content)) as archive:
        learning = archive.read("learning.json").decode()
        summary = archive.read("学习摘要.md").decode()
    runs = json.loads(learning)["runs"]
    assert [(r["id"], r["tips"]) for r in runs] == [(first["id"], advice), (second["id"], None)]
    for private in ("private-profile", "private-model", "private-key", "api_key"):
        assert private not in learning and private not in summary
    first_round, second_round = summary.split("## 第 2 轮")
    assert first["input_text"] in first_round and second["input_text"] in second_round
    assert first_round.count("【演示】") == second_round.count("【演示】") == 1
    for message in [advice["assessment"], *advice["gaps"], *advice["next_steps"], *advice["evidence"]]:
        assert message in first_round and message not in second_round
    assert "尚未生成 Tips" in second_round and "尚未生成 Tips" not in first_round
