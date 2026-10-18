import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Event } from "../src/lib/types";
import { mergeEvent, messages, streamEvents } from "../src/lib/events";
const base = {
  schema_version: "0.1.0" as const,
  run_id: "run-test",
  attempt_id: "attempt-test",
  mode: "demo" as const,
  created_at: "2026-10-18T00:00:00Z",
};
test("replayed sequences are deduplicated and completed messages replace partial output", () => {
  const first: Event = {
    ...base,
    kind: "message.delta",
    seq: 1,
    payload: { message_id: "message-test", delta: "partial" },
  };
  const completed: Event = {
    ...base,
    kind: "message.completed",
    seq: 2,
    payload: {
      message_id: "message-test",
      role: "assistant",
      content: "complete",
    },
  };
  let events = mergeEvent([], first);
  events = mergeEvent(events, first);
  events = mergeEvent(events, completed);
  assert.equal(events.length, 2);
  assert.deepEqual(messages(events), [
    { id: "message-test", text: "complete", complete: true },
  ]);
});
test("SSE reconnect carries the last sequence and 204 stops retries without POST", async () => {
  const original = globalThis.fetch;
  const requests: { method: string; cursor: string | null }[] = [];
  const seen: Event[] = [];
  const controller = new AbortController();
  let count = 0;
  globalThis.fetch = async (_input, init) => {
    requests.push({
      method: init?.method ?? "GET",
      cursor: new Headers(init?.headers).get("Last-Event-ID"),
    });
    if (count++ === 0) {
      const event: Event = {
        ...base,
        kind: "message.delta",
        seq: 5,
        payload: { message_id: "message-test", delta: "one" },
      };
      return new Response(
        `id: 5\nevent: message.delta\ndata: ${JSON.stringify(event)}\n\n`,
      );
    }
    return new Response(null, { status: 204 });
  };
  try {
    await streamEvents(
      "run-test",
      4,
      controller.signal,
      (e) => seen.push(e),
      () => {},
    );
    assert.equal(seen.length, 1);
    assert.deepEqual(requests, [
      { method: "GET", cursor: "4" },
      { method: "GET", cursor: "5" },
    ]);
  } finally {
    globalThis.fetch = original;
  }
});
test("wire discriminator adapter matches the unchanged contract constants", () => {
  const api = JSON.parse(
    readFileSync(
      new URL("../../../contracts/openapi.json", import.meta.url),
      "utf8",
    ),
  );
  for (const [name, kind] of Object.entries({
    ChoiceForm: "choice",
    FactsForm: "facts",
    CourseForm: "course",
    ArtifactForm: "artifact",
    RunStartedEvent: "run.started",
    ToolCompletedEvent: "tool.completed",
    ApprovalDecidedEvent: "approval.decided",
  }))
    assert.equal(api.components.schemas[name].properties.kind.const, kind);
});

test("temporary HTTP failure resumes at the same cursor and receives a terminal event", async () => {
  const original = globalThis.fetch;
  const requests: { method: string; cursor: string | null }[] = [];
  const seen: Event[] = [];
  globalThis.fetch = async (_input, init) => {
    requests.push({
      method: init?.method ?? "GET",
      cursor: new Headers(init?.headers).get("Last-Event-ID"),
    });
    if (requests.length === 1) return new Response(null, { status: 503 });
    const event: Event = {
      ...base,
      kind: "run.interrupted",
      seq: 5,
      payload: {
        status: "interrupted",
        reason: "process_restart",
        usage: { input_tokens: null, output_tokens: null, model_calls: 0 },
      },
    };
    return new Response(
      `id: 5\nevent: run.interrupted\ndata: ${JSON.stringify(event)}\n\n`,
    );
  };
  try {
    await streamEvents(
      "run-test",
      4,
      new AbortController().signal,
      (e) => seen.push(e),
      () => {},
    );
    assert.deepEqual(requests, [
      { method: "GET", cursor: "4" },
      { method: "GET", cursor: "4" },
    ]);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].kind, "run.interrupted");
  } finally {
    globalThis.fetch = original;
  }
});

test("permanent SSE errors stop instead of retrying invalid access or cursors", async () => {
  const original = globalThis.fetch;
  try {
    for (const status of [400, 401, 403, 404]) {
      let requests = 0;
      globalThis.fetch = async () => {
        requests++;
        return new Response(null, { status });
      };
      await streamEvents(
        "run-test",
        4,
        new AbortController().signal,
        () => assert.fail("no events"),
        () => {},
      );
      assert.equal(requests, 1);
    }
  } finally {
    globalThis.fetch = original;
  }
});
