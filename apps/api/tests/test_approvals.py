from conftest import create_attempt, post
from test_runs import start, wait_run

def permission_run(client):
    a=create_attempt(client,"04-permission")
    response=client.patch("/api/v1/attempts/"+a["id"],json={"expected_revision":1,
        "settings":a["settings"],"selected_file_ids":["notice-week"]})
    a=response.json()
    run=start(client,a)
    return a,run,wait_run(client,run["id"],lambda r:r["status"]=="awaiting_approval")["pending_approval"]

def test_deny_does_not_write_and_next_approval_executes_exactly_once(client):
    a,run,pending=permission_run(client)
    path="/api/v1/approvals/"+pending["id"]+"/decision"
    assert client.post(path,json={"decision":"deny"}).status_code==200
    assert client.post(path,json={"decision":"deny"}).status_code==200
    assert client.post(path,json={"decision":"approve"}).status_code==409
    assert not [f for f in client.get("/api/v1/attempts/"+a["id"]+"/files").json()["items"] if f["kind"]=="artifact"]
    next_approval=wait_run(client,run["id"],lambda r:r["pending_approval"] and r["pending_approval"]["id"]!=pending["id"])["pending_approval"]
    path="/api/v1/approvals/"+next_approval["id"]+"/decision"
    assert client.post(path,json={"decision":"approve"}).status_code==200
    assert client.post(path,json={"decision":"approve"}).status_code==200
    assert wait_run(client,run["id"])["status"]=="completed"
    artifacts=[f for f in client.get("/api/v1/attempts/"+a["id"]+"/files").json()["items"] if f["kind"]=="artifact"]
    assert len(artifacts)==2

def test_expired_approval_cannot_write_even_before_cleanup(client):
    a,run,pending=permission_run(client)
    school=client.app.state.school
    stored=school.store.get("approval",pending["id"])
    stored["expires_at"]="2020-01-01T00:00:00Z"
    school.store.put("approval",stored["id"],stored)
    response=client.post("/api/v1/approvals/"+pending["id"]+"/decision",json={"decision":"approve"})
    assert response.status_code==409
    assert response.json()["error"]["code"]=="APPROVAL_EXPIRED"
    assert wait_run(client,run["id"])["status"]=="failed"
