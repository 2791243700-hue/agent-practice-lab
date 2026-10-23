import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SubmissionDialog } from "../src/components/submission-dialog";
import type { Lesson, Submission } from "../src/lib/types";

const lesson = { id: "lesson-1", order: 1 } as Lesson;
const submission: Submission = {
  id: "submission-1",
  attempt_id: "attempt-1",
  lesson_version: "1.0.0",
  mode: "live",
  passed: true,
  evaluation_passed: true,
  created_at: "2026-10-23T00:00:00Z",
  answers: {},
  rules: [
    {
      rule_id: "required-1",
      required: true,
      passed: true,
      message: "已保存任务清单",
      evidence_refs: ["private-evidence-id"],
    },
  ],
  evidence: [],
};

function render(result: Submission) {
  return renderToStaticMarkup(
    createElement(SubmissionDialog, {
      submission: result,
      lesson,
      onClose() {},
    }),
  );
}

test("a passed submission offers a compact dialog with details collapsed", () => {
  const html = render(submission);
  assert.match(html, /<dialog[^>]+aria-labelledby=/);
  assert.match(html, /本关已通关/);
  assert.match(html, /留在当前关卡/);
  assert.match(html, /查看详细验收记录/);
  assert.doesNotMatch(
    html,
    /已保存任务清单|private-evidence-id|submission-feedback/,
  );
});

test("a failed submission shows only failed required messages in its summary", () => {
  const html = render({
    ...submission,
    passed: false,
    evaluation_passed: false,
    rules: [
      { ...submission.rules[0], passed: false, message: "请保存任务清单" },
      {
        ...submission.rules[0],
        required: false,
        passed: false,
        message: "可优化排版",
      },
      { ...submission.rules[0], rule_id: "satisfied", message: "已满足的规则" },
    ],
  });
  assert.match(html, /本次尚未通过/);
  assert.match(html, /请保存任务清单/);
  assert.doesNotMatch(html, /可优化排版|已满足的规则|private-evidence-id/);
});

test("demo results clearly exclude formal completion", () => {
  assert.match(
    render({ ...submission, mode: "demo", passed: false }),
    /演示检查通过 · 不计正式完成/,
  );
  assert.match(
    render({
      ...submission,
      mode: "demo",
      passed: false,
      evaluation_passed: false,
    }),
    /演示检查未通过 · 不计正式完成/,
  );
});
