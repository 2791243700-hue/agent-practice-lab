import copy
import json
from pathlib import Path
from functools import lru_cache
from jsonschema import Draft202012Validator, FormatChecker
from agent_school.errors import AppError

class Contracts:
    def __init__(self, root):
        self.root = Path(root)
        self.openapi = json.loads((self.root / "contracts/openapi.json").read_text(encoding="utf-8"))
        self.schemas = self.openapi["components"]["schemas"]
        self.validators = {}
        self.lesson_validator = Draft202012Validator(
            json.loads((self.root / "contracts/lesson.schema.json").read_text(encoding="utf-8")),
            format_checker=FormatChecker())

    def schema(self, name):
        def expand(value):
            if isinstance(value, dict):
                if "$ref" in value:
                    return expand(self.schemas[value["$ref"].rsplit("/", 1)[-1]])
                return {k:expand(v) for k,v in value.items()}
            if isinstance(value, list):
                return [expand(v) for v in value]
            return value
        return expand(self.schemas[name])

    def validate(self, name, value, response=False):
        if name not in self.validators:
            self.validators[name] = Draft202012Validator(
                self.schema(name), format_checker=FormatChecker())
        errors = list(self.validators[name].iter_errors(value))
        if errors:
            if response:
                raise RuntimeError("Response violates contract: " + name)
            fields = [{"path":"/" + "/".join(str(p).replace("~","~0").replace("/","~1") for p in e.path),
                       "message":"该字段缺失、类型不正确或超出允许范围。"} for e in errors[:20]]
            raise AppError(fields=fields)
        return value

