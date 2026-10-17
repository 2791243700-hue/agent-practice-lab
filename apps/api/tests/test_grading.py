import json
from conftest import create_attempt, post
from test_runs import start, wait_run
from test_approvals import permission_run

def submit(client,attempt,answers,key="submit-result-key"):
    response=post(client,"/submissions",{"attempt_id":attempt["id"],
        "expected_attempt_revision":attempt["revision"],"answers":answers},key)
    assert response.status_code==201,response.text
    return response.json()

def test_first_lesson_requires_two_distinct_runs_and_demo_never_passes_officially(client):
    a=create_attempt(client)
    first=start(client,a,"看看通知","first-run-key");wait_run(client,first["id"])
    one=submit(client,a,{"question_id":"goal-constraints","option_id":"clear-goal"},"first-submit-key")
    assert not one["evaluation_passed"]
    second=start(client,a,"列出目标、截止日期和来源","second-run-key");wait_run(client,second["id"])
    result=submit(client,a,{"question_id":"goal-constraints","option_id":"clear-goal"},"second-submit-key")
    assert result["evaluation_passed"] and not result["passed"]
    assert client.get("/api/v1/attempts/"+a["id"]).json()["progress"]!="completed"
    assert set(ref for r in result["rules"] for ref in r["evidence_refs"]) <= {e["id"] for e in result["evidence"]}

def test_facts_require_real_material_read_and_correct_values(client):
    a=create_attempt(client,"02-context")
    facts={"facts":[{"task_id":"submit-summary","due_date":"2026-11-04","source_id":"notice-week"},
                    {"task_id":"reserve-lab","due_date":"2026-11-06","source_id":"notice-week"}]}
    assert not submit(client,a,facts)["evaluation_passed"]
    a=client.patch("/api/v1/attempts/"+a["id"],json={"expected_revision":1,
        "settings":a["settings"],"selected_file_ids":["notice-week"]}).json()
    run=start(client,a);wait_run(client,run["id"])
    assert submit(client,a,facts,"read-facts-submit")["evaluation_passed"]
    facts["facts"][0]["due_date"]="2026-11-03"
    failed=submit(client,a,facts,"wrong-facts-submit")
    assert not failed["evaluation_passed"] and not failed["rules"][0]["passed"]
    assert failed["rules"][0]["message"]

def test_course_query_requires_matching_parameters_and_answer_shape(client):
    a=create_attempt(client,"03-tools")
    run=start(client,a);wait_run(client,run["id"])
    result=submit(client,a,{"course_id":"agent101","session_date":"2026-11-05","room":"A301"})
    assert result["evaluation_passed"]
    assert post(client,"/submissions",{"attempt_id":a["id"],"expected_attempt_revision":1,
        "answers":{"question_id":"q","option_id":"a"}},"wrong-answer-shape").status_code==422

def test_permission_artifacts_need_denial_approval_and_consistent_frozen_files(client):
    a,run,pending=permission_run(client)
    client.post("/api/v1/approvals/"+pending["id"]+"/decision",json={"decision":"deny"})
    next_pending=wait_run(client,run["id"],lambda r:r["pending_approval"] and r["pending_approval"]["id"]!=pending["id"])["pending_approval"]
    client.post("/api/v1/approvals/"+next_pending["id"]+"/decision",json={"decision":"approve"})
    wait_run(client,run["id"])
    result=submit(client,a,{})
    assert result["evaluation_passed"] and not result["passed"]
    file=next(e["file"] for e in result["evidence"] if e["kind"]=="file" and e["file"]["media_type"]=="application/json")
    frozen=client.get("/api/v1/submissions/"+result["id"]+"/files/"+file["id"]+"/download").content
    physical=client.app.state.school.workspace.physical(a["id"],file["id"])
    physical.write_text("[]",encoding="utf-8")
    second=submit(client,a,{},"tampered-submit-key")
    assert not second["evaluation_passed"]
    assert client.get("/api/v1/submissions/"+result["id"]).json()==result
    assert client.get("/api/v1/submissions/"+result["id"]+"/files/"+file["id"]+"/download").content==frozen
