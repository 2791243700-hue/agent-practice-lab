import test from "node:test";
import assert from "node:assert/strict";
import { briefCandidates, initialBriefPair } from "../src/lib/brief-reflection";
import type { Attempt, Event, Run } from "../src/lib/types";

for (const times of [
  ["2026-10-30T12:00:00Z", "2026-10-30T11:00:00Z"],
  ["2026-10-30T12:00:00Z", "2026-10-30T12:00:00Z"],
]) {
  test(`pair selection respects durable creation order despite clocks ${times.join(" / ")}`, () => {
    const attempt = { id: "attempt", mode: "live" } as Attempt;
    const runs = [
      { id: "z-first", creation_index: 0, created_at: times[0] },
      { id: "a-second", creation_index: 1, created_at: times[1] },
    ].map((run) => ({
      ...run,
      attempt_id: "attempt",
      mode: "live",
      status: "completed",
    })) as Run[];
    const events = Object.fromEntries(
      runs.map((run) => [
        run.id,
        [
          {
            kind: "message.completed",
            payload: { role: "assistant", content: "完整回答" },
          },
        ],
      ]),
    ) as unknown as Record<string, Event[]>;
    const candidates = briefCandidates(attempt, [...runs].reverse(), events);
    assert.deepEqual(
      candidates.map((run) => run.id),
      ["z-first", "a-second"],
    );
    assert.deepEqual(
      initialBriefPair({ beforeId: "", afterId: "" }, candidates),
      { beforeId: "z-first", afterId: "a-second" },
    );
  });
}

test("default pair uses the latest two complete assistant replies in this attempt", () => {
  const attempt = { id: "attempt", mode: "live" } as Attempt;
  const runs = [
    "old",
    "new",
    "latest",
    "failed",
    "foreign",
    "empty",
    "user",
  ].map((id, index) => ({
    id,
    attempt_id: id === "foreign" ? "other" : "attempt",
    mode: "live",
    status: id === "failed" ? "failed" : "completed",
    created_at: `2026-10-29T00:00:0${index}Z`,
  })) as Run[];
  const events = Object.fromEntries(
    runs.map((run) => [
      run.id,
      [
        {
          kind: "message.completed",
          payload: {
            role: run.id === "user" ? "user" : "assistant",
            content: run.id === "empty" ? "  " : "完整回答",
          },
        },
      ],
    ]),
  ) as unknown as Record<string, Event[]>;
  const candidates = briefCandidates(attempt, runs, events);
  assert.deepEqual(
    candidates.map((run) => run.id),
    ["old", "new", "latest"],
  );
  assert.deepEqual(
    initialBriefPair({ beforeId: "", afterId: "" }, candidates),
    { beforeId: "new", afterId: "latest" },
  );
  assert.equal(
    initialBriefPair({ beforeId: "old", afterId: "latest" }, candidates),
    null,
  );
  assert.equal(
    initialBriefPair({ beforeId: "old", afterId: "" }, candidates),
    null,
  );
  assert.equal(
    initialBriefPair({ beforeId: "", afterId: "" }, candidates.slice(0, 1)),
    null,
  );
});
