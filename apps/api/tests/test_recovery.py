import asyncio
import copy
from conftest import create_attempt, post
from test_runs import start, wait_run
from test_approvals import permission_run

def test_restart_marks_active_run_interrupted_and_invalidates_approval(client):
    from agent_school.service import School
    a,run,pending=permission_run(client)
    school=client.app.state.school
    # Simulate persisted crash state in a separate fresh data directory, not two active servers.
    import tempfile
    from pathlib import Path
    from agent_school.config import Config
    with tempfile.TemporaryDirectory() as tmp:
        config=Config(root=school.config.root,data_dir=Path(tmp),local_token="recovery-test-token",demo_enabled=True)
        original=School(config)
        original.store.put("attempt",a["id"],school.store.get("attempt",a["id"]))
        original.store.put("run",run["id"],school.store.get("run",run["id"]))
        original.store.put("approval",pending["id"],school.store.get("approval",pending["id"]))
        # Events must be consistent with the persisted last_seq.
        for e in school.store.event_list(run["id"]):
            saved=original.store.get("run",run["id"]);saved["last_seq"]=e["seq"]-1
            original.store.put("run",run["id"],saved)
            original.store.append_event(run["id"],e)
        original.store.close()
        recovered=School(config)
        assert recovered.store.get("run",run["id"])["status"]=="interrupted"
        assert recovered.store.get("approval",pending["id"])["status"]=="cancelled"
        assert recovered.attempt(a["id"])["active_run_id"] is None
        events=recovered.store.event_list(run["id"])
        assert events[-1]["kind"]=="run.interrupted"
        assert len([e for e in events if e["kind"]=="approval.decided"])==1
        recovered.store.close()

async def test_execution_budget_excludes_approval_wait(config):
    from agent_school.service import School
    from agent_school.contracts import RuntimeEvent, ToolCall
    school=School(config)
    config.execution_timeout=0.10
    class SlowApproval:
        usage_by_run={}
        async def stream(self,request,invoke):
            await invoke(ToolCall(id="slow-save",name="save_todos",arguments={"items":[
                {"task_id":"submit-summary","title":"总结","due_date":"2026-11-04","source_id":"notice-week"}]}))
            yield RuntimeEvent(kind="message.completed",payload={"message_id":"done","role":"assistant","content":"已保存"})
    school.runs.demo=SlowApproval()
    a=school.create_attempt({"lesson_id":"04-permission","lesson_version":"1.0.0","mode":"demo"})
    run=school.runs.create({"attempt_id":a["id"],"expected_attempt_revision":1,"profile_id":None,"input_text":"保存"})
    for _ in range(100):
        value=school.store.get("run",run["id"])
        if value["pending_approval"]: break
        await asyncio.sleep(0.005)
    await asyncio.sleep(0.15)
    assert school.store.get("run",run["id"])["status"]=="awaiting_approval"
    school.approvals.decide(value["pending_approval"]["id"],"approve")
    await school.runs.contexts[run["id"]].task
    assert school.store.get("run",run["id"])["status"]=="completed"
    await school.close()

async def test_timeout_cancellation_and_queued_cancel_release_global_slot(config):
    from agent_school.service import School
    school=School(config)
    config.execution_timeout=0.03
    class Blocking:
        usage_by_run={}
        async def stream(self,request,invoke):
            await asyncio.Event().wait()
            yield
    school.runs.demo=Blocking()
    a=school.create_attempt({"lesson_id":"01-task","lesson_version":"1.0.0","mode":"demo"})
    body={"attempt_id":a["id"],"expected_attempt_revision":1,"profile_id":None,"input_text":"测试"}
    run=school.runs.create(body)
    task=school.runs.contexts[run["id"]].task
    await task
    assert school.store.get("run",run["id"])["error"]["error"]["code"]=="RUN_TIMEOUT"
    assert school.slot is None
    queued=school.runs.create(body)
    school.runs.cancel(queued["id"])
    await asyncio.sleep(0)
    assert school.store.get("run",queued["id"])["status"]=="cancelled"
    assert school.slot is None
    await school.close()
