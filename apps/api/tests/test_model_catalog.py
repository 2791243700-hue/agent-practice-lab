import httpx
import pytest

from conftest import post


def transport(client, request, handler):
    connection = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    client.app.state.school.profiles.connector.client = connection
    request.addfinalizer(lambda: client.portal.call(connection.aclose))


def connect(client, provider="deepseek", **extra):
    return post(
        client,
        "/model-profiles/connect",
        {"provider_id": provider, "api_key": "catalog-test-secret", **extra},
        "catalog-connect-" + provider,
    )


@pytest.mark.parametrize(
    "provider,url",
    [("deepseek", "https://api.deepseek.com/models"), ("openai", "https://api.openai.com/v1/models")],
)
def test_import_discovers_only_selected_provider_and_never_persists_key(
    client, config, request, provider, url
):
    seen = []

    def handle(call):
        seen.append(str(call.url))
        assert call.method == "GET"
        assert call.headers["Authorization"] == "Bearer catalog-test-secret"
        return httpx.Response(
            200, json={"data": [{"id": "chat-b"}, {"id": "chat-a", "name": "Chat A"}, {"id": "chat-b"}]}
        )

    transport(client, request, handle)
    response = connect(client, provider)
    assert response.status_code == 201, response.text
    result = response.json()
    profile = result["profile"]
    assert profile["credential_status"] == "configured"
    assert profile["connection_check"]["status"] == "unchecked"
    assert [m["id"] for m in result["catalog"]["items"]] == ["chat-a", "chat-b"]
    assert profile["model"] == "chat-a"
    assert connect(client, provider).json() == result
    assert seen == [url]
    assert "catalog-test-secret" not in response.text
    assert all(
        b"catalog-test-secret" not in p.read_bytes()
        for p in config.data_dir.rglob("*")
        if p.is_file() and p.name != "backend.lock"
    )


@pytest.mark.parametrize("status", [401, 403, 429, 503, 302])
def test_failed_discovery_keeps_no_profile_or_credential_and_sanitizes_errors(client, request, status):
    transport(
        client,
        request,
        lambda call: httpx.Response(
            status,
            headers={"Location": "https://elsewhere.example/models"},
            json={"error": {"message": "catalog-test-secret"}},
        ),
    )
    response = connect(client)
    assert response.status_code == (401 if status in (401, 403) else 503 if status in (429, 503) else 422)
    assert "error" in response.json()
    assert "catalog-test-secret" not in response.text
    assert client.get("/api/v1/model-profiles").json()["items"] == []
    assert client.app.state.school.credentials.values == {}
    assert client.app.state.school.slot is None


def test_compatible_manual_model_is_explicit_and_does_not_probe_network(client, request):
    def forbidden(call):
        raise AssertionError("manual connection must not probe a service")

    transport(client, request, forbidden)
    response = connect(
        client,
        "openai-compatible",
        base_url="https://compatible.example/v1",
        model_id="chosen-chat",
        name="My Key",
    )
    assert response.status_code == 201, response.text
    assert response.json()["catalog"]["source"] == "manual"
    assert response.json()["profile"]["model"] == "chosen-chat"
    assert response.json()["profile"]["connection_check"]["status"] == "unchecked"
    assert connect(client, "openai", base_url="https://elsewhere.example/v1").status_code == 422


def test_model_change_clears_check_but_rename_preserves_it_and_delete_is_independent(client, request):
    transport(
        client, request, lambda call: httpx.Response(200, json={"data": [{"id": "chat-a"}, {"id": "chat-b"}]})
    )
    first = connect(client).json()["profile"]
    second = connect(client, "openai").json()["profile"]
    school = client.app.state.school
    first["connection_check"].update(status="passed", text_ok=True, tools_ok=True)
    school.store.put("profile", first["id"], first)
    body = {k: first[k] for k in ("name", "provider", "base_url", "model")}
    renamed = client.put(
        "/api/v1/model-profiles/" + first["id"],
        json={**body, "name": "Renamed Key", "expected_revision": first["revision"]},
    ).json()
    assert renamed["connection_check"]["status"] == "passed"
    changed = client.put(
        "/api/v1/model-profiles/" + first["id"],
        json={**body, "model": "chat-b", "expected_revision": renamed["revision"]},
    ).json()
    assert changed["connection_check"]["status"] == "unchecked"
    models = client.get("/api/v1/model-profiles/" + first["id"] + "/models")
    assert models.status_code == 200, models.text
    school.busy_profile = first["id"]
    assert (
        client.delete(
            "/api/v1/model-profiles/" + first["id"] + "?expected_revision=" + str(changed["revision"])
        ).status_code
        == 409
    )
    school.busy_profile = None
    assert (
        client.delete(
            "/api/v1/model-profiles/" + first["id"] + "?expected_revision=" + str(changed["revision"])
        ).status_code
        == 204
    )
    assert not school.credentials.configured(first["id"])
    assert school.credentials.configured(second["id"])
    assert [p["id"] for p in client.get("/api/v1/model-profiles").json()["items"]] == [second["id"]]


def test_discovery_rejects_empty_bad_or_secret_echoed_models_and_does_not_follow_redirects(client, request):
    transport(
        client, request, lambda call: httpx.Response(200, json={"data": [{"id": "catalog-test-secret"}]})
    )
    response = connect(client)
    assert response.status_code == 422
    assert "catalog-test-secret" not in response.text
    assert not client.app.state.school.credentials.values


def test_import_redacts_name_and_rejects_key_in_url(client, request):
    transport(client, request, lambda call: httpx.Response(200, json={"data": [{"id": "chat-a"}]}))
    response = connect(client, name="my catalog-test-secret")
    assert response.status_code == 201, response.text
    assert "catalog-test-secret" not in response.text
    bad = connect(
        client,
        "openai-compatible",
        base_url="https://compatible.example/catalog-test-secret",
        model_id="chat",
    )
    assert bad.status_code == 422
    assert "catalog-test-secret" not in bad.text
