from conftest import create_attempt, post


def test_attempts_isolate_settings_reject_spoofing_and_stale_updates(client):
    first = create_attempt(client)
    second = create_attempt(client, key="second-attempt-key")
    response = client.patch(
        "/api/v1/attempts/" + first["id"],
        json={
            "expected_revision": 1,
            "settings": {"system_instruction": "说明目标", "temperature": 0.2},
            "selected_file_ids": [],
        },
    )
    assert response.status_code == 200
    assert response.json()["revision"] == 2
    assert client.get("/api/v1/attempts/" + second["id"]).json()["settings"] != response.json()["settings"]
    assert (
        client.patch(
            "/api/v1/attempts/" + first["id"],
            json={
                "expected_revision": 1,
                "settings": first["settings"],
                "selected_file_ids": [],
            },
        ).status_code
        == 409
    )
    bad = post(
        client,
        "/attempts",
        {"lesson_id": "01-task", "lesson_version": "1.0.0", "mode": "demo", "owner_id": "fake"},
        "spoof-owner-key",
    )
    assert bad.status_code == 422
    client.app.state.school.store.put(
        "attempt", "foreign-attempt", {**second, "id": "foreign-attempt"}, owner="someone-else"
    )
    assert client.get("/api/v1/attempts/foreign-attempt").status_code == 404


def test_idempotency_reset_pagination_and_mode_are_enforced(client):
    first = create_attempt(client)
    assert create_attempt(client)["id"] == first["id"]
    assert (
        post(
            client,
            "/attempts",
            {"lesson_id": "02-context", "lesson_version": "1.0.0", "mode": "demo"},
            "create-attempt-key",
        ).status_code
        == 409
    )
    reset = post(client, "/attempts/" + first["id"] + "/reset", {"expected_revision": 1}, "reset-attempt-key")
    assert reset.status_code == 201
    assert reset.json()["id"] != first["id"]
    assert (
        post(
            client, "/attempts/" + first["id"] + "/reset", {"expected_revision": 1}, "reset-attempt-key"
        ).json()["id"]
        == reset.json()["id"]
    )
    old = client.get("/api/v1/attempts/" + first["id"]).json()
    assert old["status"] == "superseded"
    assert old["reset_to_attempt_id"] == reset.json()["id"]
    page = client.get("/api/v1/attempts?limit=1").json()
    assert len(page["items"]) == 1 and page["next_cursor"]
    next_page = client.get("/api/v1/attempts", params={"limit": 1, "cursor": page["next_cursor"]}).json()
    assert next_page["items"][0]["id"] != page["items"][0]["id"]
    assert client.get("/api/v1/attempts?cursor=invalid").status_code == 400
