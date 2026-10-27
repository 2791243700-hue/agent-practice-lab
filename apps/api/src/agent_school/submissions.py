from urllib.parse import quote

from fastapi.responses import Response

from agent_school.errors import AppError, new_id, not_found, revision
from agent_school.grading import Grader
from agent_school.model_assessment import ModelAssessor
from agent_school.service import now


class SubmissionService:
    def __init__(self, school):
        self.school = school
        self.store = school.store
        self.assessor = ModelAssessor(school)

    async def prepare(self, body, params):
        attempt = self.school.attempt(body["attempt_id"], True)
        revision(attempt, body["expected_attempt_revision"])
        self.school.idle(attempt)
        lesson = self.school.catalog.get(attempt["lesson_id"], attempt["lesson_version"])
        policy = lesson["manifest"].get("assessment_policy")
        if not policy:
            return None
        live = attempt["mode"] == "live"
        if live and not body.get("assessment", {}).get("consent"):
            raise AppError(message="正式验收需要同意额外模型调用并选择验收模型。")
        if (
            live
            and lesson["manifest"]["answer_form"]["kind"] != "reflection"
            and not body.get("learning_reflection", "").strip()
        ):
            raise AppError(message="请用自己的话填写核对说明。")
        if self.school.slot is not None:
            raise AppError("RUN_BUSY", "请等待当前任务或模型请求结束。", 409, True)
        grader = Grader(self.school, attempt, lesson, body["answers"], [])
        grader.validate_answers()
        key = new_id("submission")
        frozen = self.school.workspace.freeze(attempt["id"], key)
        grader.frozen = frozen
        try:
            rules, evidence = grader.evaluate()
            objective_passed = all(r["passed"] for r in rules if r["required"])
            result = self.assessor.result(policy, "skipped", "客观证据尚未全部合格，本次未调用模型。")
            if not live:
                result["message"] = "演示仅核对客观证据，不调用验收模型、不计正式通过。"
            elif objective_passed:
                consent = body["assessment"]
                profile = self.store.get("profile", consent["profile_id"])
                revision(profile, consent["expected_profile_revision"])
                access = self.school.profiles.resolve(profile["id"])
                context = self.assessor.context(grader, body.get("learning_reflection"))
                self.school.slot = "assessment:" + attempt["id"]
                self.school.busy_profile = profile["id"]
                try:
                    params["_assessment_started"] = True
                    result = await self.assessor.assess(access, context)
                finally:
                    self.school.slot = None
                    self.school.busy_profile = None
            titles = {c["id"]: c["title"] for c in policy["criteria"]}
            refs = [grader.answer_ref()]
            if result["status"] == "completed":
                for check in result["checks"]:
                    rules.append(
                        {
                            "rule_id": "model-" + check["criterion_id"],
                            "required": True,
                            "passed": check["passed"],
                            "message": titles[check["criterion_id"]]
                            + "："
                            + check["reason"]
                            + (" 建议：" + check["suggestion"] if check["suggestion"] else ""),
                            "evidence_refs": refs,
                        }
                    )
            else:
                rules.append(
                    {
                        "rule_id": "model-assessment",
                        "required": live,
                        "passed": False,
                        "message": result["message"],
                        "evidence_refs": refs,
                    }
                )
            return {
                "key": key,
                "frozen": frozen,
                "rules": rules,
                "evidence": evidence,
                "model_assessment": result,
            }
        except BaseException:
            self.school.workspace.discard_snapshot(key)
            raise

    def submit(self, body, prepared=None):
        attempt = self.school.attempt(body["attempt_id"], True)
        revision(attempt, body["expected_attempt_revision"])
        self.school.idle(attempt)
        lesson = self.school.catalog.get(attempt["lesson_id"], attempt["lesson_version"])
        if lesson["manifest"].get("assessment_policy") and prepared is None:
            raise AppError(message="本课程必须完成模型验收准备。")
        grader = Grader(self.school, attempt, lesson, body["answers"], [])
        grader.validate_answers()
        key = prepared["key"] if prepared else new_id("submission")
        frozen = prepared["frozen"] if prepared else self.school.workspace.freeze(attempt["id"], key)
        try:
            grader.frozen = frozen
            rules, evidence = (prepared["rules"], prepared["evidence"]) if prepared else grader.evaluate()
            required = [r for r in rules if r["required"]]
            evaluation_passed = bool(required) and all(r["passed"] for r in required)
            passed = attempt["mode"] == "live" and evaluation_passed
            value = {
                "id": key,
                "attempt_id": attempt["id"],
                "lesson_version": attempt["lesson_version"],
                "mode": attempt["mode"],
                "passed": passed,
                "evaluation_passed": evaluation_passed,
                "created_at": now(),
                "rules": rules,
                "evidence": evidence,
                "answers": body["answers"],
                **(
                    {"learning_reflection": body["learning_reflection"]}
                    if body.get("learning_reflection")
                    else {}
                ),
                **({"model_assessment": prepared["model_assessment"]} if prepared else {}),
            }
            with self.store.atomic():
                self.store.on_rollback(lambda: self.school.workspace.discard_snapshot(key))
                self.store.put("submission", key, value)
                self.store.put(
                    "snapshot",
                    key,
                    {"attempt_id": attempt["id"], "files": frozen, "lesson": lesson, "attempt": attempt},
                )
                attempt.update(
                    latest_submission_id=key, progress="completed" if passed else attempt["progress"]
                )
                self.store.put("attempt", attempt["id"], attempt)
            return value
        except BaseException:
            self.school.workspace.discard_snapshot(key)
            raise

    def download(self, submission_id, file_id):
        self.store.get("submission", submission_id)
        snapshot = self.store.get("snapshot", submission_id)
        file = next((f for f in snapshot["files"] if f["info"]["id"] == file_id), None)
        if file is None:
            not_found()
        data = self.school.workspace.read_path(file["relative"])
        import hashlib

        if hashlib.sha256(data).hexdigest() != file["info"]["sha256"]:
            from agent_school.errors import AppError

            raise AppError("TOOL_ERROR", "提交快照已损坏。", 409)
        return Response(
            data,
            media_type="application/octet-stream",
            headers={
                "Content-Disposition": "attachment; filename*=UTF-8''"
                + quote(file["info"]["display_path"].split("/")[-1])
            },
        )
