import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RunView } from "../src/components/run-view";
import type { Approval, Event, Run } from "../src/lib/types";
test("approved card waits for the actual matching successful save result", () => {
  const approval: Approval = {
    id: "approval-test",
    run_id: "run-test",
    call_id: "call-test",
    tool_name: "save_todos",
    arguments: { items: [] },
    status: "approved",
    decision: "approve",
    created_at: "2026-10-18T00:00:00Z",
    decided_at: "2026-10-18T00:00:01Z",
    expires_at: "2099-01-01T00:00:00Z",
  };
  const run: Run = {
    id: "run-test",
    attempt_id: "attempt-test",
    mode: "demo",
    status: "running",
    last_seq: 1,
    input_text: "save",
    snapshot: {
      settings: { system_instruction: "", temperature: 0.3 },
      selected_file_ids: [],
      profile_id: null,
      profile_revision: null,
      model: null,
    },
    pending_approval: null,
    usage: { input_tokens: null, output_tokens: null, model_calls: 0 },
    error: null,
    created_at: approval.created_at,
    started_at: approval.created_at,
    ended_at: null,
  };
  const decided: Event = {
    schema_version: "0.1.0",
    run_id: run.id,
    attempt_id: run.attempt_id,
    seq: 1,
    mode: "demo",
    created_at: approval.created_at,
    kind: "approval.decided",
    payload: { approval },
  };
  const completed: Event = {
    ...decided,
    seq: 2,
    kind: "tool.completed",
    payload: {
      result: {
        call_id: "call-test",
        name: "save_todos",
        status: "ok",
        data: { files: [] },
      },
    },
  };
  function html(events: Event[]) {
    return renderToStaticMarkup(createElement(RunView, { run, events }));
  }
  assert.match(html([decided]), /已批准 · 等待工具实际完成/);
  assert.doesNotMatch(html([decided]), /已保存 · 工具执行成功/);
  assert.match(html([decided, completed]), /已保存 · 工具执行成功/);
  const other: Event = {
    ...completed,
    payload: {
      result: { ...completed.payload.result, call_id: "unrelated-call" },
    },
  };
  assert.doesNotMatch(html([decided, other]), /已保存 · 工具执行成功/);
  const failed: Event = {
    ...completed,
    payload: {
      result: {
        call_id: approval.call_id,
        name: "save_todos",
        status: "error",
        data: { code: "TOOL_ERROR", message: "写入失败" },
      },
    },
  };
  assert.doesNotMatch(html([decided, failed]), /已保存 · 工具执行成功/);
  assert.match(html([decided, failed]), /保存失败/);
});
