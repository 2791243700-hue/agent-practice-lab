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
        if parent.is_symlink() or (hasattr(parent,"is_junction") and parent.is_junction()):
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
            source = confined(folder,item["path"])
            if source.stat().st_size > 1048576:
                raise ValueError("Material too large")
            materials.append({**item,"content":source.read_text(encoding="utf-8")})
        self.publish({"manifest":manifest,"intro":intro,"task":task,"materials":materials})

    def publish(self, value):
        manifest = value["manifest"]
        key = manifest["id"] + "@" + manifest["version"]
        old = self.store.get("lesson",key,owner="system",missing_ok=True)
        if old is not None and old != value:
            raise ValueError("Cannot change published lesson version")
        self.store.put("lesson",key,value,owner="system")

    def get(self, lesson_id, version=None):
        if version is not None:
            return self.store.get("lesson",lesson_id+"@"+version,owner="system")
        values = [v for v in self.store.list("lesson",owner="system") if v["manifest"]["id"]==lesson_id]
        if not values:
            not_found()
        def version_key(value):
            return tuple(int(v) if v.isdigit() else v for v in value["manifest"]["version"].split("."))
        return max(values,key=version_key)

    def public(self, value, completed=False):
        m = value["manifest"]
        return {k:copy.deepcopy(m[k]) for k in ("id","version","title","description","order","objectives",
            "completion_criteria","allowed_tools","settings_policy","answer_form","limits")} | {
            "completed":completed, "intro_markdown":value["intro"],"task_markdown":value["task"],
            "materials":[{"id":f["id"],"title":f["title"],"display_path":f["path"],
                "media_type":f["media_type"],"size_bytes":len(f["content"].encode("utf-8"))} for f in value["materials"]]}

