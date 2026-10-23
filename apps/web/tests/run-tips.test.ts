import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RunView } from "../src/components/run-view";
import type { Run } from "../src/lib/types";

const run: Run = {
  id: "tips-run",
  attempt_id: "tips-attempt",
  mode: "live",
  status: "completed",
  last_seq: 0,
  input_text: "整理任务",
  snapshot: {
    settings: { system_instruction: "", temperature: 0.3 },
    selected_file_ids: [],
    profile_id: null,
    profile_revision: null,
    model: null,
  },
  pending_approval: null,
  usage: { model_calls: 1, input_tokens: null, output_tokens: null },
  error: null,
  created_at: "2026-10-23T00:00:00Z",
  started_at: "2026-10-23T00:00:00Z",
  ended_at: "2026-10-23T00:00:00Z",
};

test("terminal runs offer collapsed Tips without making a model request", () => {
  const html = renderToStaticMarkup(
    createElement(RunView, { run, events: [] }),
  );
  assert.match(html, /Tips · 本轮学习建议/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /生成 Tips|同意发送/);
});

test("an active run does not offer Tips", () => {
  const html = renderToStaticMarkup(
    createElement(RunView, { run: { ...run, status: "running" }, events: [] }),
  );
  assert.doesNotMatch(html, /Tips · 本轮学习建议/);
});
