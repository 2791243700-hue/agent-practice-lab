from conftest import post
from fastapi.testclient import TestClient


def make_profile(client):
    response = post(
        client,
        "/model-profiles",
        {
            "name": "课堂模型",
            "provider": "openai-compatible",
            "base_url": "https://model.example/v1",
            "model": "tool-model",
        },
        "profile-create-key",
    )
    assert response.status_code == 201, response.text
    return response.json()


def configure(client, profile, key="secret-test-key-987654"):
    response = client.put(
        "/api/v1/model-profiles/" + profile["id"] + "/credential",
        json={"api_key": key, "expected_revision": profile["revision"]},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_credentials_never_persist_or_return_and_restart_invalidates_check(client, config, caplog):
    profile = configure(client, make_profile(client))
    assert profile["credential_status"] == "configured"
    assert "secret-test-key" not in str(profile)
    assert "secret-test-key" not in str(client.app.state.school.store.list("profile"))
    assert "secret-test-key" not in caplog.text
    from agent_school.main import create_app

    client.portal.call(client.app.state.school.close)
    with TestClient(
        create_app(config), base_url="http://127.0.0.1:8000", headers={"X-Local-Token": config.local_token}
    ) as restarted:
        value = restarted.get("/api/v1/model-profiles/" + profile["id"]).json()
        assert value["credential_status"] == "missing"
        assert value["connection_check"]["status"] == "unchecked"


def test_bad_profile_urls_and_stale_or_unknown_fields_rejected(client):
    for index, url in enumerate(
        [
            "https://user:password@model.example/v1",
            "https://model.example/v1?key=123",
            "https://model.example/v1#secret",
            "http://remote.example/v1",
            "file:///tmp/model",
        ]
    ):
        response = post(
            client,
            "/model-profiles",
            {"name": "模型", "provider": "openai-compatible", "base_url": url, "model": "model"},
            f"bad-profile-url-{index}",
        )
        assert response.status_code == 422
    profile = make_profile(client)
    assert (
        client.put(
            "/api/v1/model-profiles/" + profile["id"] + "/credential",
            json={"api_key": "secret", "expected_revision": 99},
        ).status_code
        == 409
    )
    assert (
        client.put(
            "/api/v1/model-profiles/" + profile["id"] + "/credential",
            json={"api_key": "secret", "expected_revision": 1, "remember": True},
        ).status_code
        == 422
    )


def test_pasting_configured_key_into_instruction_is_redacted_before_persistence(client):
    from conftest import create_attempt

    configure(client, make_profile(client), "accidental-secret-key")
    attempt = create_attempt(client)
    response = client.patch(
        "/api/v1/attempts/" + attempt["id"],
        json={
            "expected_revision": 1,
            "settings": {"system_instruction": "不要保存 accidental-secret-key", "temperature": 0.3},
            "selected_file_ids": [],
        },
    )
    assert response.status_code == 200
    assert "accidental-secret-key" not in response.text
    assert "accidental-secret-key" not in str(client.app.state.school.store.list("attempt"))
