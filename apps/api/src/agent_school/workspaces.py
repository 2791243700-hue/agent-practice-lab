import hashlib
import json
import os
import shutil
from pathlib import Path

from agent_school.errors import AppError, new_id
from agent_school.service import now

MAX_FILE = 1048576


class WorkspaceStore:
    def __init__(self, school):
        self.school = school
        self.store = school.store
        self.root = school.config.data_dir.absolute()
        self.safe("workspaces").mkdir(parents=True, exist_ok=True)

    def safe(self, relative):
        value = Path(relative)
        if value.is_absolute() or ".." in value.parts or ":" in str(relative) or "\\" in str(relative):
            raise AppError("TOOL_ERROR", "文件路径不被允许。", 409)
        target = self.root / value
        for item in [
            self.root,
            *[self.root.joinpath(*value.parts[:i]) for i in range(1, len(value.parts) + 1)],
        ]:
            if item.is_symlink() or (hasattr(item, "is_junction") and item.is_junction()):
                raise AppError("TOOL_ERROR", "实验目录中的链接不可读取。", 409)
        if not target.resolve().is_relative_to(self.root.resolve()):
            raise AppError("TOOL_ERROR", "文件越过实验边界。", 409)
        return target

    def read_path(self, relative):
        path = self.safe(relative)
        try:
            descriptor = os.open(
                path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0)
            )
            with os.fdopen(descriptor, "rb") as stream:
                value = stream.read(MAX_FILE + 1)
        except (OSError, ValueError):
            raise AppError("TOOL_ERROR", "实验文件无法读取。", 409) from None
        if len(value) > MAX_FILE:
            raise AppError("LIMIT_EXCEEDED", "文件超过 1 MiB 限制。", 413)
        return value

    def record(self, attempt_id, file_id):
        self.school.attempt(attempt_id)
        record = self.store.get("file", attempt_id + "~" + file_id)
        if record["attempt_id"] != attempt_id:
            raise AppError("NOT_FOUND", "没有找到该文件。", 404)
        return record

    def physical(self, attempt_id, file_id):
        """Resolve a recorded file; never accepts a user supplied path."""
        return self.safe(self.record(attempt_id, file_id)["relative"])

    def read(self, attempt_id, file_id, verify=True):
        record = self.record(attempt_id, file_id)
        data = self.read_path(record["relative"])
        if verify and hashlib.sha256(data).hexdigest() != record["info"]["sha256"]:
            raise AppError("TOOL_ERROR", "文件内容已变化，请重新开始或重新生成产物。", 409)
        return record["info"], data

    def info(self, file_id, title, display, media, data, kind="artifact", source_id=None):
        return {
            "id": file_id,
            "kind": kind,
            "source_id": source_id,
            "title": title,
            "display_path": display,
            "media_type": media,
            "size_bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
            "created_at": now(),
        }

    def create(self, attempt_id, lesson):
        for material in lesson["materials"]:
            relative = f"workspaces/{attempt_id}/materials/{material['id']}.md"
            path = self.safe(relative)
            path.parent.mkdir(parents=True, exist_ok=True)
            data = material["content"].encode("utf-8")
            path.write_bytes(data)
            info = self.info(
                material["id"],
                material["title"],
                material["path"],
                material["media_type"],
                data,
                kind="material",
                source_id=material["id"],
            )
            self.store.put(
                "file",
                attempt_id + "~" + material["id"],
                {"attempt_id": attempt_id, "relative": relative, "info": info, "current": True},
            )

    def list(self, attempt_id):
        self.school.attempt(attempt_id)
        return [
            record["info"]
            for record in self.store.list("file")
            if record["attempt_id"] == attempt_id and record["current"]
        ]

    def preview(self, attempt_id, file_id):
        info, data = self.read(attempt_id, file_id)
        content = data.decode("utf-8")
        return {"file": info, "content": content[:20000], "truncated": len(content) > 20000}

    def hashes(self, attempt_id):
        return sorted(
            hashlib.sha256(self.read(attempt_id, f["id"], verify=False)[1]).hexdigest()
            for f in self.list(attempt_id)
            if f["kind"] == "artifact"
        )

    def save_todos(self, attempt_id, items):
        items = self.school.credentials.redact(items)
        self.school.contracts.validate(
            "SaveTodosCall", {"id": "validation-call", "name": "save_todos", "arguments": {"items": items}}
        )
        if len({v["task_id"] for v in items}) != len(items):
            raise AppError(message="待办任务 ID 不能重复。")
        attempt = self.school.attempt(attempt_id, True)
        lesson = self.school.catalog.get(attempt["lesson_id"], attempt["lesson_version"])
        sources = {v["id"] for v in lesson["materials"]}
        if any(v["source_id"] not in sources for v in items):
            raise AppError(message="待办必须引用本关资料。")
        group = new_id("group")
        temporary = f"workspaces/{attempt_id}/artifacts/.{group}"
        final = f"workspaces/{attempt_id}/artifacts/{group}"
        folder = self.safe(temporary)
        folder.mkdir(parents=True)
        markdown = (
            "# 课程待办\n\n"
            + "\n".join(
                "- "
                + v["title"].replace("\n", " ")
                + " | 截止："
                + v["due_date"]
                + " | 来源："
                + v["source_id"]
                for v in items
            )
            + "\n"
        )
        blobs = [
            ("todos.md", "待办清单", "text/markdown", markdown.encode()),
            (
                "todos.json",
                "结构化待办",
                "application/json",
                (json.dumps(items, ensure_ascii=False, indent=2) + "\n").encode(),
            ),
        ]
        try:
            for name, title, media, data in blobs:
                if len(data) > MAX_FILE:
                    raise AppError("LIMIT_EXCEEDED", "待办内容过大。", 413)
                self.safe(temporary + "/" + name).write_bytes(data)
            os.replace(folder, self.safe(final))
        except BaseException:
            if folder.exists() and not folder.is_symlink():
                shutil.rmtree(folder)
            raise
        result = []
        with self.store.atomic():
            for record in self.store.list("file"):
                if (
                    record["attempt_id"] == attempt_id
                    and record["info"]["kind"] == "artifact"
                    and record["current"]
                ):
                    record["current"] = False
                    self.store.put("file", attempt_id + "~" + record["info"]["id"], record)
            for name, title, media, data in blobs:
                info = self.info(new_id("file"), title, "artifacts/" + name, media, data)
                self.store.put(
                    "file",
                    attempt_id + "~" + info["id"],
                    {"attempt_id": attempt_id, "relative": final + "/" + name, "info": info, "current": True},
                )
                result.append(info)
        return result

    def freeze(self, attempt_id, snapshot_id):
        # A snapshot is owned exclusively by this invocation, never reused.
        folder = self.snapshot_folder(snapshot_id)
        folder.mkdir(parents=True, exist_ok=False)
        try:
            frozen = []
            for info in self.list(attempt_id):
                original, data = self.read(attempt_id, info["id"], verify=False)
                relative = f"snapshots/{snapshot_id}/{info['id']}"
                self.safe(relative).write_bytes(data)
                actual = hashlib.sha256(data).hexdigest()
                frozen.append(
                    {
                        "info": {**original, "sha256": actual, "size_bytes": len(data)},
                        "relative": relative,
                        "consistent": actual == original["sha256"],
                    }
                )
            return frozen
        except BaseException:
            self.discard_snapshot(snapshot_id)
            raise

    def snapshot_folder(self, snapshot_id):
        if not snapshot_id or len(Path(snapshot_id).parts) != 1 or snapshot_id in (".", ".."):
            raise AppError("TOOL_ERROR", "快照路径不被允许。", 409)
        return self.safe("snapshots/" + snapshot_id)

    def discard_snapshot(self, snapshot_id):
        folder = self.snapshot_folder(snapshot_id)
        if not folder.exists():
            return
        # Validate the resolved boundary and all descendants before recursive
        # deletion. Never traverse a symlink or a Windows junction.
        root = self.root.resolve()
        if folder.resolve().parent != (root / "snapshots").resolve() or not folder.resolve().is_relative_to(
            root
        ):
            raise AppError("TOOL_ERROR", "快照越过实验边界。", 409)
        for directory, subdirs, files in os.walk(folder, followlinks=False):
            self.safe(Path(directory).relative_to(self.root).as_posix())
            for name in [*subdirs, *files]:
                self.safe((Path(directory) / name).relative_to(self.root).as_posix())
        shutil.rmtree(folder)
