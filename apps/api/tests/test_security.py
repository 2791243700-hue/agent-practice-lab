from conftest import create_attempt, post

def test_local_token_origin_and_secret_request_fields_rejected(client):
    assert client.get("/api/v1/me",headers={"X-Local-Token":"wrong"}).status_code==401
    assert client.get("/api/v1/me",headers={"host":"evil.example"}).status_code==401
    assert post(client,"/attempts",{"lesson_id":"01-task","lesson_version":"1.0.0","mode":"demo"},
        "safe-key-origin").status_code==201
    blocked=client.post("/api/v1/attempts",json={"lesson_id":"01-task","lesson_version":"1.0.0","mode":"demo"},
        headers={"Origin":"https://evil.example","Idempotency-Key":"bad-origin-key"})
    assert blocked.status_code==403
    a=create_attempt(client)
    response=client.post("/api/v1/runs",json={"attempt_id":a["id"],"profile_id":None,
        "expected_attempt_revision":1,"input_text":"test","owner_id":"fake"},
        headers={"Idempotency-Key":"spoof-run-key"})
    assert response.status_code==422
    assert len(client.app.state.school.store.list("run"))==0
