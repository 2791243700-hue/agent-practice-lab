import hashlib
import io
import json
import zipfile

from fastapi.responses import Response

from agent_school.errors import AppError, new_id, revision
from agent_school.service import now


def learning_summary(title, runs, answers):
    lines = ["# 学习摘要", "", title, ""]
    if not runs:
        lines.append("本次实验尚无运行记录。")
    for index, run in enumerate(runs, start=1):
        lines.extend([f"## 第 {index} 轮", "", "### 任务", "", run["input_text"], "", "### 回答", ""])
        lines.extend(["\n\n".join(answers[run["id"]]) or "本轮没有完整回答。", "", "### Tips", ""])
        tips = run["tips"]
        if tips is None:
            lines.extend(["本轮尚未生成 Tips。", ""])
            continue
        lines.extend(["**总结**", "", tips["assessment"], ""])
        for key, label in (("gaps", "与目标的差距"), ("next_steps", "下一步建议"), ("evidence", "依据")):
            if tips[key]:
                lines.extend([f"**{label}**", "", *["- " + entry for entry in tips[key]], ""])
    return "\n".join(lines).rstrip() + "\n"


class ExportService:
    def __init__(self, school):
        self.school = school

    def create(self, attempt_id, body):
        school = self.school
        attempt = school.attempt(attempt_id)
        revision(attempt, body["expected_revision"])
        school.idle(attempt)
        lesson = school.catalog.get(attempt["lesson_id"], attempt["lesson_version"])
        runs = [r for r in school.store.list_in_creation_order("run") if r["attempt_id"] == attempt_id]
        clean_runs = []
        events = []
        answers = {}
        for run in runs:
            tips = school.store.get("tips", run["id"], missing_ok=True)
            clean = {
                **run,
                "snapshot": {k: run["snapshot"][k] for k in ("settings", "selected_file_ids")},
                "tips": {k: tips[k] for k in ("assessment", "gaps", "next_steps", "evidence")}
                if tips
                else None,
            }
            clean_runs.append(clean)
            run_events = school.store.event_list(run["id"])
            events.extend(run_events)
            answers[run["id"]] = [
                event["payload"]["content"]
                for event in run_events
                if event["kind"] == "message.completed" and event["payload"]["content"].strip()
            ]
        submissions = [s for s in school.store.list("submission") if s["attempt_id"] == attempt_id]
        key = new_id("export")
        snapshot = school.workspace.freeze(attempt_id, key)
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr(
                "学习摘要.md", learning_summary(lesson["manifest"]["title"], clean_runs, answers)
            )
            archive.writestr(
                "learning.json",
                json.dumps(
                    {
                        "attempt": attempt,
                        "runs": clean_runs,
                        "events": events,
                        "submissions": submissions,
                        "reflection_draft": school.reflection.get_draft(attempt_id),
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
            )
            archive.writestr(
                "lesson.json", json.dumps(school.catalog.public(lesson), ensure_ascii=False, indent=2)
            )
            for file in snapshot:
                archive.writestr(
                    "files/" + file["info"]["id"] + "/" + file["info"]["display_path"].split("/")[-1],
                    school.workspace.read_path(file["relative"]),
                )
            for submission in submissions:
                frozen = school.store.get("snapshot", submission["id"])
                for file in frozen["files"]:
                    archive.writestr(
                        "submissions/" + submission["id"] + "/" + file["info"]["id"],
                        school.workspace.read_path(file["relative"]),
                    )
        data = buffer.getvalue()
        if len(data) > 25 * 1024 * 1024:
            raise AppError("LIMIT_EXCEEDED", "导出包超过 25 MiB 限制。", 413)
        relative = "exports/" + key + ".zip"
        path = school.workspace.safe(relative)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        value = {
            "id": key,
            "attempt_id": attempt_id,
            "status": "ready",
            "size_bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
            "created_at": now(),
        }
        school.store.put("export", key, value)
        school.store.put("export-path", key, {"relative": relative})
        return value

    def download(self, export_id):
        value = self.school.store.get("export", export_id)
        record = self.school.store.get("export-path", export_id)
        path = self.school.workspace.safe(record["relative"])
        with path.open("rb") as stream:
            data = stream.read(25 * 1024 * 1024 + 1)
        if len(data) != value["size_bytes"] or hashlib.sha256(data).hexdigest() != value["sha256"]:
            raise AppError("TOOL_ERROR", "导出包已损坏，请重新导出。", 409)
        return Response(
            data,
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{export_id}.zip"'},
        )
