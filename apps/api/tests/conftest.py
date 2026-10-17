from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[3]


@pytest.fixture
def config(tmp_path):
    from agent_school.config import Config

    return Config(
        root=ROOT, data_dir=tmp_path / "学习 数据", local_token="test-local-token", demo_enabled=True
    )


@pytest.fixture
def client(config):
    from agent_school.main import create_app

    with TestClient(create_app(config), base_url="http://127.0.0.1:8000") as client:
        client.headers["X-Local-Token"] = config.local_token
        yield client


def post(client, path, body, key="test-operation-key"):
    return client.post("/api/v1" + path, json=body, headers={"Idempotency-Key": key})


def create_attempt(client, lesson="01-task", mode="demo", key="create-attempt-key"):
    response = post(client, "/attempts", {"lesson_id": lesson, "lesson_version": "1.0.0", "mode": mode}, key)
    assert response.status_code == 201, response.text
    return response.json()
