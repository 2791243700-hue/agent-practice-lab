import asyncio
from dataclasses import dataclass

from agent_school.contracts import ChatMessage, RuntimeRequest, ToolSpec
from agent_school.errors import AppError, error_body, new_id, revision
from agent_school.events import TERMINAL
from agent_school.runtime.agentscope_runtime import AgentScopeRuntime, RuntimeFailure
from agent_school.runtime.demo_runtime import DemoRuntime
from agent_school.service import now

EMPTY_USAGE = {"input_tokens": None, "output_tokens": None, "model_calls": 0}


@dataclass
class RunContext:
    run_id: str
    attempt: dict
    remaining: float
    task: asyncio.Task | None = None
    timer: asyncio.Task | None = None
    started: float | None = None
    cancel_reason: str | None = None
    timed_out: bool = False

    def pause(self):
        if self.started is not None:
            self.remaining -= asyncio.get_running_loop().time() - self.started
            self.started = None
        if self.timer:
            self.timer.cancel()
            self.timer = None

    def resume(self):
        if self.started is not None or not self.task or self.task.done() or self.cancel_reason:
            return
        self.started = asyncio.get_running_loop().time()

        async def expire():
            await asyncio.sleep(max(0, self.remaining))
            self.timed_out = True
            self.task.cancel()

        self.timer = asyncio.create_task(expire())


class RunService:
    def __init__(self, school):
        self.school = school
        self.store = school.store
        self.runtime = AgentScopeRuntime()
        self.demo = DemoRuntime()
        self.contexts = {}
        self.resetting = set()
        self.recover()

    def recover(self):
        for run in self.store.list("run"):
            if run["status"] not in TERMINAL:
                self.school.approvals.invalidate(run["id"])
                self.finish(run["id"], "interrupted", {"reason": "process_restart"})

    def create(self, body):
        school = self.school
        attempt = school.attempt(body["attempt_id"], True)
        revision(attempt, body["expected_attempt_revision"])
        if attempt["id"] in self.resetting:
            raise AppError("ATTEMPT_BUSY", "正在重置，请稍后重试。", 409, True)
        if school.slot is not None:
            raise AppError("RUN_BUSY", "已有运行或连接检查正在进行。", 409, True)
        access = None
        profile = None
        if attempt["mode"] == "live":
            if body["profile_id"] is None:
                raise AppError("MODE_MISMATCH", "真实运行需要选择模型配置。")
            access = school.profiles.resolve(body["profile_id"])
            profile = self.store.get("profile", body["profile_id"])
        elif body["profile_id"] is not None:
            raise AppError("MODE_MISMATCH", "演示运行不使用个人模型配置。")
        lesson = school.catalog.get(attempt["lesson_id"], attempt["lesson_version"])
        run = {
            "id": new_id("run"),
            "attempt_id": attempt["id"],
            "mode": attempt["mode"],
            "status": "queued",
            "last_seq": 0,
            "input_text": school.credentials.redact(body["input_text"]),
            "snapshot": {
                "settings": attempt["settings"],
                "selected_file_ids": attempt["selected_file_ids"],
                "profile_id": body["profile_id"],
                "profile_revision": profile["revision"] if profile else None,
                "model": profile["model"] if profile else None,
            },
            "pending_approval": None,
            "usage": EMPTY_USAGE.copy(),
            "error": None,
            "created_at": now(),
            "started_at": None,
            "ended_at": None,
        }
        school.slot = run["id"]
        school.busy_profile = body["profile_id"]
        self.store.put("run", run["id"], run)
        attempt.update(
            active_run_id=run["id"],
            progress="in_progress" if attempt["progress"] != "completed" else "completed",
        )
        self.store.put("attempt", attempt["id"], attempt)
        history = school.store.get("history", attempt["id"], missing_ok=True) or []
        messages = [ChatMessage(**v) for v in history]
        messages.append(ChatMessage(role="user", content=run["input_text"]))
        specs = []
        mapping = {
            "list_materials": "ListMaterialsCall",
            "read_material": "ReadMaterialCall",
            "lookup_course": "LookupCourseCall",
            "save_todos": "SaveTodosCall",
        }
        for name in lesson["manifest"]["allowed_tools"]:
            specs.append(
                ToolSpec(
                    name=name,
                    description={
                        "list_materials": "列出本轮所选材料",
                        "read_material": "读取所选资料，保留来源",
                        "lookup_course": "查询课程安排",
                        "save_todos": "保存带任务 ID、日期和材料来源的待办，需要用户逐次批准",
                    }[name],
                    input_schema=school.contracts.schema(mapping[name])["properties"]["arguments"],
                    approval_required=name == "save_todos",
                )
            )
        platform = "你是教学资料助手。遵守工具和授权边界，不猜测事实。当前课题：\n" + lesson["task"]
        settings = {
            **attempt["settings"],
            "system_instruction": platform + "\n学生设置：\n" + attempt["settings"]["system_instruction"],
        }
        request = RuntimeRequest(
            run_id=run["id"],
            attempt_id=attempt["id"],
            messages=messages,
            settings=settings,
            allowed_tools=specs,
            model=access,
            mode=attempt["mode"],
        )
        context = RunContext(run["id"], attempt, school.config.execution_timeout)
        self.contexts[run["id"]] = context
        context.task = asyncio.create_task(self.execute(context, request))
        return run

    def finish(self, run_id, status, payload=None, usage=None):
        with self.store.atomic():
            run = self.store.get("run", run_id)
            if run["status"] in TERMINAL:
                return run
            self.school.approvals.invalidate(run_id)
            run = self.store.get("run", run_id)
            run.update(status=status, pending_approval=None, ended_at=now(), usage=usage or run["usage"])
            if status == "failed":
                run["error"] = (payload or {}).get("error") or error_body(
                    "EXECUTION_FAILED", "任务未能完成。"
                )
            self.store.put("run", run_id, run)
            data = {"status": status, "usage": run["usage"], **(payload or {})}
            self.school.events.append(run_id, "run." + status, data)
            attempt = self.school.attempt(run["attempt_id"])
            if attempt["active_run_id"] == run_id:
                attempt["active_run_id"] = None
                self.store.put("attempt", attempt["id"], attempt)
            return self.store.get("run", run_id)

    async def execute(self, context, request):
        runtime = self.demo if request.mode == "demo" else self.runtime
        with self.store.atomic():
            run = self.store.get("run", context.run_id)
            run.update(status="running", started_at=now())
            self.store.put("run", run["id"], run)
            self.school.events.append(run["id"], "run.started", {"status": "running"})
        context.resume()
        history = []
        try:
            async for event in runtime.stream(
                request, lambda call: self.school.gateway.invoke(context, call)
            ):
                self.school.events.append(context.run_id, event.kind, event.payload)
                if event.kind == "message.completed":
                    history.append(
                        {
                            "role": "assistant",
                            "content": self.school.credentials.redact(event.payload["content"]),
                        }
                    )
            if context.cancel_reason or asyncio.current_task().cancelling():
                raise asyncio.CancelledError
            usage = runtime.usage_by_run.pop(context.run_id, EMPTY_USAGE.copy())
            self.finish(context.run_id, "completed", usage=usage)
            previous = self.store.get("history", request.attempt_id, missing_ok=True) or []
            self.store.put(
                "history",
                request.attempt_id,
                previous
                + [
                    {"role": "user", "content": self.school.credentials.redact(request.messages[-1].content)},
                    *history,
                ],
            )
        except asyncio.CancelledError:
            usage = runtime.usage_by_run.pop(context.run_id, EMPTY_USAGE.copy())
            if context.timed_out:
                self.finish(
                    context.run_id,
                    "failed",
                    {"error": error_body("RUN_TIMEOUT", "运行超过时间限制。")},
                    usage,
                )
            else:
                self.finish(context.run_id, "cancelled", {"reason": context.cancel_reason or "user"}, usage)
        except Exception as exc:
            usage = runtime.usage_by_run.pop(context.run_id, EMPTY_USAGE.copy())
            code = exc.code if isinstance(exc, (AppError, RuntimeFailure)) else "EXECUTION_FAILED"
            if code not in self.school.contracts.schemas["ErrorCode"]["enum"]:
                code = "EXECUTION_FAILED"
            self.finish(
                context.run_id,
                "failed",
                {"error": error_body(code, "任务未完成，请查看工具记录或检查模型连接。")},
                usage,
            )
        finally:
            context.pause()
            self.contexts.pop(context.run_id, None)
            if self.school.slot == context.run_id:
                self.school.slot = None
                self.school.busy_profile = None

    def cancel(self, run_id, reason="user"):
        run = self.store.get("run", run_id)
        context = self.contexts.get(run_id)
        if context and context.task and not context.task.done():
            context.cancel_reason = reason
            context.task.cancel()
            if run["status"] == "queued":
                run = self.finish(run_id, "cancelled", {"reason": reason})
                self.contexts.pop(run_id, None)
                if self.school.slot == run_id:
                    self.school.slot = self.school.busy_profile = None
        return run

    async def prepare_reset(self, attempt_id, body):
        attempt = self.school.attempt(attempt_id, True)
        revision(attempt, body["expected_revision"])
        self.resetting.add(attempt_id)
        try:
            if attempt["active_run_id"]:
                run_id = attempt["active_run_id"]
                context = self.contexts.get(run_id)
                self.cancel(run_id, "reset")
                if context and context.task:
                    _, pending = await asyncio.wait({context.task}, timeout=self.school.config.reset_timeout)
                    if pending:
                        raise AppError("ATTEMPT_BUSY", "旧任务尚未结束，请稍后重新尝试重置。", 503, True)
        except BaseException:
            self.resetting.discard(attempt_id)
            raise

    async def close(self):
        tasks = []
        for context in list(self.contexts.values()):
            if context.task:
                context.cancel_reason = "user"
                context.task.cancel()
                tasks.append(context.task)
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
