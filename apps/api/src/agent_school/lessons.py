import copy
import json
from pathlib import Path

from agent_school.errors import not_found


def confined(root, relative):
    root = Path(root).resolve()
    path = Path(relative)
    if path.is_absolute() or "\\" in str(relative) or ":" in str(relative) or ".." in path.parts:
        raise ValueError("Path outside course package")
    target = root / path
    for parent in [target, *target.parents]:
        if parent == root:
            break
        if parent.is_symlink() or (hasattr(parent, "is_junction") and parent.is_junction()):
            raise ValueError("Linked course file")
    if not target.resolve().is_relative_to(root):
        raise ValueError("Path outside course package")
    return target


class LessonCatalog:
    def __init__(self, store, contracts, directory):
        self.store, self.contracts = store, contracts
        for folder in sorted(Path(directory).iterdir()):
            if folder.is_dir():
                self.import_package(folder)

    def import_package(self, folder):
        folder = Path(folder)
        manifest = json.loads(confined(folder, "manifest.json").read_text(encoding="utf-8"))
        self.contracts.lesson_validator.validate(manifest)
        intro = confined(folder, manifest["intro_file"]).read_text(encoding="utf-8")
        task = confined(folder, manifest["task_file"]).read_text(encoding="utf-8")
        if not intro.strip() or not manifest["rules"]:
            raise ValueError("Empty intro or grading rules")
        materials = []
        identifiers = set()
        for item in manifest["initial_files"]:
            if item["id"] in identifiers:
                raise ValueError("Duplicate material ID")
            identifiers.add(item["id"])
            source = confined(folder, item["path"])
            if source.stat().st_size > 1048576:
                raise ValueError("Material too large")
            materials.append({**item, "content": source.read_text(encoding="utf-8")})
        self.publish({"manifest": manifest, "intro": intro, "task": task, "materials": materials})

    def publish(self, value):
        manifest = value["manifest"]
        self.contracts.lesson_validator.validate(manifest)
        if not value["intro"].strip() or not any(rule["required"] for rule in manifest["rules"]):
            raise ValueError("Empty intro or no required grading rules")
        self.validate_grading(manifest)
        key = manifest["id"] + "@" + manifest["version"]
        old = self.store.get("lesson", key, owner="system", missing_ok=True)
        if old is not None and old != value:
            raise ValueError("Cannot change published lesson version")
        self.store.put("lesson", key, value, owner="system")

    def validate_grading(self, manifest):
        form = manifest["answer_form"]
        material_ids = {material["id"] for material in manifest["initial_files"]}
        if form["kind"] == "facts" and any(
            source["source_id"] not in material_ids for source in form["sources"]
        ):
            raise ValueError("Answer form references missing course material")
        forms = {
            "choice_answer": "choice",
            "read_and_check_facts": "facts",
            "lookup_and_check_course": "course",
            "denied_without_write": "artifact",
            "approved_todos_artifact": "artifact",
        }
        for rule in manifest["rules"]:
            evaluator, params = rule["evaluator"], rule["params"]
            if evaluator in forms and form["kind"] != forms[evaluator]:
                raise ValueError("Answer form does not match grading evaluator")
            if evaluator == "choice_answer" and (
                params["question_id"] != form["question_id"]
                or params["correct_option_id"] not in {option["id"] for option in form["options"]}
            ):
                raise ValueError("Grading answer is not available in choice form")
            if evaluator == "lookup_and_check_course" and params["course_id"] != form["course_id"]:
                raise ValueError("Grading course does not match answer form")
            if evaluator == "read_and_check_facts":
                if not set(params["required_source_ids"]) <= material_ids:
                    raise ValueError("Grading requires missing course material")
                tasks = {task["task_id"] for task in form["tasks"]}
                sources = {source["source_id"] for source in form["sources"]}
                facts = params["expected_facts"]
                if len({fact["task_id"] for fact in facts}) != len(facts) or any(
                    fact["task_id"] not in tasks or fact["source_id"] not in sources for fact in facts
                ):
                    raise ValueError("Grading facts are not available in answer form")
            if evaluator == "approved_todos_artifact" and any(
                item["source_id"] not in material_ids for item in params["expected_items"]
            ):
                raise ValueError("Grading artifact references missing course material")

    def get(self, lesson_id, version=None):
        if version is not None:
            return self.store.get("lesson", lesson_id + "@" + version, owner="system")
        values = [v for v in self.store.list("lesson", owner="system") if v["manifest"]["id"] == lesson_id]
        if not values:
            not_found()

        def version_key(value):
            version = value["manifest"]["version"]
            # Every component has the same tuple shape; numeric releases sort
            # above text at the same position. Raw spelling breaks numeric ties.
            return tuple((1, int(v), "") if v.isdecimal() else (0, 0, v) for v in version.split(".")), version

        return max(values, key=version_key)

    def public(self, value, completed=False):
        m = value["manifest"]
        return {
            k: copy.deepcopy(m[k])
            for k in (
                "id",
                "version",
                "title",
                "description",
                "order",
                "objectives",
                "completion_criteria",
                "allowed_tools",
                "settings_policy",
                "answer_form",
                "limits",
            )
        } | {
            "completed": completed,
            "intro_markdown": value["intro"],
            "task_markdown": value["task"],
            "materials": [
                {
                    "id": f["id"],
                    "title": f["title"],
                    "display_path": f["path"],
                    "media_type": f["media_type"],
                    "size_bytes": len(f["content"].encode("utf-8")),
                }
                for f in value["materials"]
            ],
        }
