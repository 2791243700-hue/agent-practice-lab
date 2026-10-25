import hashlib
import io
import json
import zipfile

from fastapi.responses import Response

from agent_school.errors import AppError, new_id, revision
from agent_school.service import now


class ExportService:
    def __init__(self, school):
        self.school = school

    def create(self, attempt_id, body):
        school = self.school
        attempt = school.attempt(attempt_id)
        revision(attempt, body["expected_revision"])
        school.idle(attempt)
        lesson = school.catalog.get(attempt["lesson_id"], attempt["lesson_version"])
        runs = [r for r in school.store.list("run") if r["attempt_id"] == attempt_id]
        clean_runs = []
        events = []
        for run in runs:
            clean = {**run, "snapshot": {k: run["snapshot"][k] for k in ("settings", "selected_file_ids")}}
            clean_runs.append(clean)
            events.extend(school.store.event_list(run["id"]))
        submissions = [s for s in school.store.list("submission") if s["attempt_id"] == attempt_id]
        key = new_id("export")
        snapshot = school.workspace.freeze(attempt_id, key)
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
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
