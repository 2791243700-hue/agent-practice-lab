import json

from agent_school.errors import AppError, new_id


class Grader:
    def __init__(self, school, attempt, lesson, answers, frozen):
        self.school, self.attempt, self.lesson, self.answers, self.frozen = (
            school,
            attempt,
            lesson,
            answers,
            frozen,
        )
        self.runs = [
            r
            for r in school.store.list("run")
            if r["attempt_id"] == attempt["id"] and r["mode"] == attempt["mode"]
        ]
        self.events = [
            e
            for e in school.store.event_list_for_runs([run["id"] for run in self.runs])
            if e["attempt_id"] == attempt["id"] and e["mode"] == attempt["mode"]
        ]
        self.event_order = {(e["run_id"], e["seq"]): index for index, e in enumerate(self.events)}
        self.evidence = []
        self.evidence_keys = {}
        self.details = {}
        self.run_map = {r["id"]: r for r in self.runs}

    def ev(self, event):
        key = (event["run_id"], event["seq"])
        if key not in self.evidence_keys:
            value = {
                "id": new_id("evidence"),
                "kind": "event",
                "run_id": event["run_id"],
                "event_seq": event["seq"],
            }
            self.evidence.append(value)
            self.evidence_keys[key] = value["id"]
        return self.evidence_keys[key]

    def answer_ref(self):
        key = "answers"
        if key not in self.evidence_keys:
            value = {"id": new_id("evidence"), "kind": "answer", "answers": self.answers}
            self.evidence.append(value)
            self.evidence_keys[key] = value["id"]
        return self.evidence_keys[key]

    def tool_events(self, name, status="ok"):
        values = []
        for event in self.events:
            if event["kind"] != "tool.completed":
                continue
            result = event["payload"]["result"]
            if result["name"] != name or result["status"] != status:
                continue
            requested = next(
                (
                    e
                    for e in self.events
                    if e["run_id"] == event["run_id"]
                    and e["kind"] == "tool.requested"
                    and e["payload"]["call"]["id"] == result["call_id"]
                    and e["payload"]["call"]["name"] == name
                    and e["seq"] < event["seq"]
                ),
                None,
            )
            if requested:
                values.append((event, requested))
        return values

    def validate_answers(self):
        form = self.lesson["manifest"]["answer_form"]
        kind = form["kind"]
        schema = {
            "choice": "ChoiceAnswers",
            "facts": "FactsAnswers",
            "course": "CourseAnswers",
            "artifact": "Empty",
        }[kind]
        try:
            self.school.contracts.validate(schema, self.answers)
        except AppError as exc:
            for field in exc.body["error"]["fields"]:
                field["path"] = "/answers" + field["path"]
            raise
        if kind == "choice":
            if self.answers["question_id"] != form["question_id"] or self.answers["option_id"] not in {
                o["id"] for o in form["options"]
            }:
                raise AppError(message="请选择本关提供的题目选项。")
        elif kind == "facts":
            facts = self.answers["facts"]
            if len({f["task_id"] for f in facts}) != len(facts):
                raise AppError(message="每个任务只能核对一次。")
            if any(
                f["task_id"] not in {t["task_id"] for t in form["tasks"]}
                or f["source_id"] not in {s["source_id"] for s in form["sources"]}
                for f in facts
            ):
                raise AppError(message="请选择本关任务和来源。")
        elif kind == "course" and self.answers["course_id"] != form["course_id"]:
            raise AppError(message="请核对本关指定的课程。")

    def valid_denials(self):
        for event, req in self.tool_events("save_todos", "denied"):
            result = event["payload"]["result"]
            inspection = self.school.store.get(
                "inspection", event["run_id"] + "~" + result["call_id"], missing_ok=True
            )
            decision = next(
                (
                    e
                    for e in self.events
                    if e["run_id"] == event["run_id"]
                    and e["kind"] == "approval.decided"
                    and e["payload"]["approval"]["call_id"] == result["call_id"]
                    and e["payload"]["approval"]["status"] == "denied"
                    and e["payload"]["approval"]["arguments"] == req["payload"]["call"]["arguments"]
                    and req["seq"] < e["seq"] < event["seq"]
                ),
                None,
            )
            if (
                inspection
                and inspection["passed"]
                and inspection["before_hashes"] == inspection["after_hashes"]
                and decision
            ):
                yield event, decision, inspection

    def evaluate_rule(self, rule):
        kind, params = rule["evaluator"], rule["params"]
        refs = []
        if kind == "distinct_completed_runs":
            candidates = {}
            for run in self.runs:
                if run["status"] == "completed":
                    candidates.setdefault(run["input_text"].strip(), run)
            chosen = list(candidates.values())[: params["minimum"]]
            for run in chosen:
                event = next(
                    (e for e in self.events if e["run_id"] == run["id"] and e["kind"] == "run.completed"),
                    None,
                )
                if event:
                    refs.append(self.ev(event))
            return len(chosen) >= params["minimum"] and len(refs) >= params["minimum"], refs
        if kind == "choice_answer":
            return self.answers == params_to_answer(params), [self.answer_ref()]
        if kind == "read_and_check_facts":
            problems = []
            for source in params["required_source_ids"]:
                match = next(
                    (
                        (e, req)
                        for e, req in self.tool_events("read_material")
                        if req["payload"]["call"]["arguments"]["file_id"] == source
                        and e["payload"]["result"]["data"]["source_id"] == source
                        and source in self.run_map[e["run_id"]]["snapshot"]["selected_file_ids"]
                    ),
                    None,
                )
                if match:
                    refs.append(self.ev(match[0]))
                else:
                    problems.append("尚未成功读取资料 " + source)
            actual = {v["task_id"]: v for v in self.answers["facts"]}
            correct = all(actual.get(v["task_id"]) == v for v in params["expected_facts"])
            for fact in params["expected_facts"]:
                task = fact["task_id"]
                label = next(
                    (
                        item["label"]
                        for item in self.lesson["manifest"]["answer_form"]["tasks"]
                        if item["task_id"] == task
                    ),
                    task,
                )
                if task not in actual:
                    problems.append("缺少任务「" + label + "」的核对信息")
                else:
                    if actual[task]["due_date"] != fact["due_date"]:
                        problems.append("任务「" + label + "」的截止日期不正确，请核对原文")
                    if actual[task]["source_id"] != fact["source_id"]:
                        problems.append("任务「" + label + "」的来源不正确")
            if problems:
                self.details[rule["id"]] = "；".join(problems) + "。"
            return len(refs) == len(params["required_source_ids"]) and correct, refs + [self.answer_ref()]
        if kind == "lookup_and_check_course":
            match = next(
                (
                    (e, req)
                    for e, req in self.tool_events("lookup_course")
                    if req["payload"]["call"]["arguments"]["course_id"] == params["course_id"]
                    and e["payload"]["result"]["data"] == params
                ),
                None,
            )
            if match:
                refs.append(self.ev(match[0]))
                fields = [
                    label
                    for field, label in (("session_date", "课程日期"), ("room", "教室"))
                    if self.answers[field] != params[field]
                ]
                if fields:
                    self.details[rule["id"]] = "、".join(fields) + "与工具查询结果不一致，请重新核对。"
            else:
                self.details[rule["id"]] = "尚未找到指定课程的成功查询记录，请让 Agent 先调用查询工具。"
            return match is not None and self.answers == params, refs + [self.answer_ref()]
        if kind == "denied_without_write":
            for event, decision, inspection in self.valid_denials():
                entry = {k: inspection[k] for k in ("check", "passed", "before_hashes", "after_hashes")}
                value = {"id": new_id("evidence"), "kind": "inspection", **entry}
                self.evidence.append(value)
                return True, [self.ev(event), self.ev(decision), value["id"]]
            return False, []
        if kind == "approved_todos_artifact":
            artifacts = [f for f in self.frozen if f["info"]["kind"] == "artifact"]
            if len(artifacts) != 2 or not all(f["consistent"] for f in artifacts):
                return False, []
            ids = {f["info"]["id"] for f in artifacts}
            match = None
            for event, req in self.tool_events("save_todos"):
                if not any(
                    self.event_order[(denied["run_id"], denied["seq"])]
                    < self.event_order[(req["run_id"], req["seq"])]
                    for denied, _, _ in self.valid_denials()
                ):
                    continue
                files = event["payload"]["result"]["data"]["files"]
                if {f["id"] for f in files} != ids:
                    continue
                if any(
                    f["sha256"] != next(a["info"]["sha256"] for a in artifacts if a["info"]["id"] == f["id"])
                    for f in files
                ):
                    continue
                decision = next(
                    (
                        e
                        for e in self.events
                        if e["run_id"] == event["run_id"]
                        and e["kind"] == "approval.decided"
                        and e["payload"]["approval"]["call_id"] == event["payload"]["result"]["call_id"]
                        and e["payload"]["approval"]["status"] == "approved"
                        and e["payload"]["approval"]["arguments"] == req["payload"]["call"]["arguments"]
                        and req["seq"] < e["seq"] < event["seq"]
                    ),
                    None,
                )
                if decision:
                    match = (event, decision)
                    break
            if match is None:
                return False, []
            try:
                data = next(f for f in artifacts if f["info"]["media_type"] == "application/json")
                rows = json.loads(self.school.workspace.read_path(data["relative"]))
                by_id = {row["task_id"]: row for row in rows}
                correct = len(by_id) == len(rows) == len(params["expected_items"]) and all(
                    all(by_id.get(item["task_id"], {}).get(k) == v for k, v in item.items())
                    for item in params["expected_items"]
                )
            except (ValueError, KeyError, TypeError, StopIteration, AppError):
                correct = False
            refs = [self.ev(match[0]), self.ev(match[1])]
            for item in artifacts:
                evidence = {"id": new_id("evidence"), "kind": "file", "file": item["info"]}
                self.evidence.append(evidence)
                refs.append(evidence["id"])
            return correct, refs
        raise ValueError("Unsupported course evaluator")

    def evaluate(self):
        self.validate_answers()
        rules = []
        for rule in self.lesson["manifest"]["rules"]:
            passed, refs = self.evaluate_rule(rule)
            rules.append(
                {
                    "rule_id": rule["id"],
                    "passed": passed,
                    "required": rule["required"],
                    "message": ("已完成：" + rule["message"])
                    if passed
                    else self.details.get(rule["id"], "请检查并补充：" + rule["message"]),
                    "evidence_refs": refs,
                }
            )
        return rules, self.evidence


def params_to_answer(params):
    return {"question_id": params["question_id"], "option_id": params["correct_option_id"]}
