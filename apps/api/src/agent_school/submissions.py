from fastapi.responses import Response
from urllib.parse import quote
from agent_school.errors import new_id, not_found, revision
from agent_school.grading import Grader
from agent_school.service import now

class SubmissionService:
    def __init__(self, school):
        self.school=school
        self.store=school.store

    def submit(self, body):
        attempt=self.school.attempt(body["attempt_id"],True)
        revision(attempt,body["expected_attempt_revision"])
        self.school.idle(attempt)
        lesson=self.school.catalog.get(attempt["lesson_id"],attempt["lesson_version"])
        key=new_id("submission")
        frozen=self.school.workspace.freeze(attempt["id"],key)
        grader=Grader(self.school,attempt,lesson,body["answers"],frozen)
        rules,evidence=grader.evaluate()
        required=[r for r in rules if r["required"]]
        evaluation_passed=bool(required) and all(r["passed"] for r in required)
        passed=attempt["mode"]=="live" and evaluation_passed
        value={"id":key,"attempt_id":attempt["id"],"lesson_version":attempt["lesson_version"],
            "mode":attempt["mode"],"passed":passed,"evaluation_passed":evaluation_passed,
            "created_at":now(),"rules":rules,"evidence":evidence,"answers":body["answers"]}
        self.store.put("submission",key,value)
        self.store.put("snapshot",key,{"attempt_id":attempt["id"],"files":frozen,
            "lesson":lesson,"attempt":attempt})
        attempt.update(latest_submission_id=key,progress="completed" if passed else attempt["progress"])
        self.store.put("attempt",attempt["id"],attempt)
        return value

    def download(self, submission_id, file_id):
        self.store.get("submission",submission_id)
        snapshot=self.store.get("snapshot",submission_id)
        file=next((f for f in snapshot["files"] if f["info"]["id"]==file_id),None)
        if file is None:
            not_found()
        data=self.school.workspace.read_path(file["relative"])
        import hashlib
        if hashlib.sha256(data).hexdigest()!=file["info"]["sha256"]:
            from agent_school.errors import AppError
            raise AppError("TOOL_ERROR","提交快照已损坏。",409)
        return Response(data,media_type="application/octet-stream",
            headers={"Content-Disposition":"attachment; filename*=UTF-8''"+quote(file["info"]["display_path"].split("/")[-1])})

