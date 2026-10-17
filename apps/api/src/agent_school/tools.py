import copy
from agent_school.contracts import ToolResult
from agent_school.errors import AppError
from agent_school.runtime.agentscope_runtime import RuntimeFailure
from agent_school.service import fingerprint

class ToolGateway:
    def __init__(self, school):
        self.school=school

    async def invoke(self, context, call):
        school=self.school
        key=context.run_id+"~"+call.id
        old=school.store.get("tool-result",key,missing_ok=True)
        if old:
            if old["fingerprint"]!=fingerprint(call.model_dump()):
                raise RuntimeFailure("TOOL_ERROR")
            return ToolResult(**old["result"])
        run=school.store.get("run",context.run_id)
        if run["status"] not in ("running","awaiting_approval") or context.cancel_reason:
            raise RuntimeFailure("TOOL_ERROR")
        lesson=school.catalog.get(context.attempt["lesson_id"],context.attempt["lesson_version"])
        if call.name not in lesson["manifest"]["allowed_tools"]:
            raise RuntimeFailure("TOOL_ERROR")
        school.contracts.validate("ToolCall",call.model_dump())
        school.events.append(run["id"],"tool.requested",{"call":call.model_dump()})
        data={}
        status="ok"
        try:
            if call.name=="list_materials":
                data={"materials":[{k:f[k] for k in ("id","title","display_path","media_type","size_bytes")}
                    for f in school.workspace.list(context.attempt["id"])
                    if f["kind"]=="material" and f["id"] in run["snapshot"]["selected_file_ids"]]}
            elif call.name=="read_material":
                file_id=call.arguments["file_id"]
                if file_id not in run["snapshot"]["selected_file_ids"]:
                    raise AppError(message="Agent 只能读取本轮选择的材料。")
                preview=school.workspace.preview(context.attempt["id"],file_id)
                data={"source_id":file_id,"content":preview["content"],"truncated":preview["truncated"]}
            elif call.name=="lookup_course":
                if call.arguments["course_id"]!="agent101":
                    raise AppError("NOT_FOUND","没有找到指定课程。",404)
                data={"course_id":"agent101","session_date":"2026-11-05","room":"A301"}
            elif call.name=="save_todos":
                before=school.workspace.hashes(context.attempt["id"])
                approved=await school.approvals.request(context,call)
                if context.cancel_reason:
                    raise RuntimeFailure("TOOL_ERROR")
                if approved:
                    data={"files":school.workspace.save_todos(context.attempt["id"],call.arguments["items"])}
                else:
                    status="denied"
                    data={"message":"用户拒绝保存，未修改文件。"}
                    after=school.workspace.hashes(context.attempt["id"])
                    school.store.put("inspection",key,{"run_id":run["id"],"call_id":call.id,
                        "check":"no_write_on_denial","passed":before==after,
                        "before_hashes":before,"after_hashes":after})
        except AppError as exc:
            if exc.code=="APPROVAL_EXPIRED":
                raise
            status="error"
            data={"code":"TOOL_ERROR","message":"工具操作失败，请检查材料、参数或文件状态。"}
        result=ToolResult(call_id=call.id,name=call.name,status=status,data=school.credentials.redact(data))
        with school.store.atomic():
            school.store.put("tool-result",key,{"fingerprint":fingerprint(call.model_dump()),"result":result.model_dump()})
            school.events.append(run["id"],"tool.completed",{"result":result.model_dump()})
        return result

