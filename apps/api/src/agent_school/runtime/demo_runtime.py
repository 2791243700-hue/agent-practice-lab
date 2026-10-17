from agent_school.contracts import RuntimeEvent, ToolCall

class DemoRuntime:
    """Deterministic teaching simulation, never accepted as live evidence."""
    def __init__(self):
        self.usage_by_run={}

    async def cancel(self, run_id):
        return None

    async def stream(self, request, invoke_tool):
        allowed={v.name for v in request.allowed_tools}
        step=0
        async def call(name, arguments):
            nonlocal step
            step+=1
            return await invoke_tool(ToolCall(id=f"demo-call-{step}",name=name,arguments=arguments))
        if "list_materials" in allowed:
            material=await call("list_materials",{})
            if material.data["materials"]:
                await call("read_material",{"file_id":material.data["materials"][0]["id"]})
        if "lookup_course" in allowed:
            await call("lookup_course",{"course_id":"agent101"})
        if "save_todos" in allowed:
            items=[{"task_id":"submit-summary","title":"提交课程总结","due_date":"2026-11-04","source_id":"notice-week"},
                   {"task_id":"reserve-lab","title":"预约实验室","due_date":"2026-11-06","source_id":"notice-week"}]
            result=await call("save_todos",{"items":items})
            if result.status=="denied":
                await call("save_todos",{"items":items})
        content="【演示】请核对课程资料和工具记录；演示检查不计正式通关。"
        yield RuntimeEvent(kind="message.delta",payload={"message_id":"demo-message","delta":content})
        yield RuntimeEvent(kind="message.completed",payload={"message_id":"demo-message","role":"assistant","content":content})
        self.usage_by_run[request.run_id]={"input_tokens":None,"output_tokens":None,"model_calls":0}

