import copy

from agent_school.errors import AppError, revision
from agent_school.service import now


class ReflectionService:
    def __init__(self, school):
        self.school = school
        self.store = school.store

    def get_draft(self, attempt_id):
        self.school.attempt(attempt_id)
        return self.store.get("reflection-draft", attempt_id, missing_ok=True) or {
            "attempt_id": attempt_id,
            "revision": 0,
            "draft": None,
            "updated_at": None,
        }

    def put_draft(self, attempt_id, body):
        with self.store.atomic():
            attempt = self.school.attempt(attempt_id, True)
            revision(attempt, body["expected_attempt_revision"])
            lesson = self.school.catalog.get(attempt["lesson_id"], attempt["lesson_version"])
            if lesson["manifest"]["answer_form"]["kind"] not in ("reflection", "brief_reflection"):
                raise AppError(message="此实验不使用复盘草稿。")
            self.school.contracts.validate("ReflectionDraftData", body["draft"])
            current = self.get_draft(attempt_id)
            revision(current, body["expected_revision"])
            data = copy.deepcopy(body["draft"])
            self.validate_references(attempt, lesson, data)
            value = {
                "attempt_id": attempt_id,
                "revision": current["revision"] + 1,
                "draft": data,
                "updated_at": now(),
            }
            self.school.contracts.validate("ReflectionDraft", value, response=True)
            return self.store.put("reflection-draft", attempt_id, value)

    def validate_references(self, attempt, lesson, data):
        items = {item["id"] for item in lesson["manifest"]["answer_form"]["challenge"]["items"]}
        if not set(data["facts"]) <= items:
            raise AppError(message="草稿只能使用本关提供的小变式项目。")
        for side in ("before", "after"):
            run_id = data[side + "Id"]
            if not run_id:
                continue
            run = self.store.get("run", run_id)
            if run["attempt_id"] != attempt["id"] or run["mode"] != attempt["mode"]:
                raise AppError(message="草稿只能引用本实验同一模式的运行。")
            message_id = data[side + "MessageId"]
            seq = data[side + "EventSeq"]
            if message_id and not any(
                event["kind"] == "message.completed"
                and event["payload"]["message_id"] == message_id
                and (not seq or event["seq"] == seq)
                for event in self.store.event_list(run_id)
            ):
                raise AppError(message="草稿引用的完整消息不存在。")
