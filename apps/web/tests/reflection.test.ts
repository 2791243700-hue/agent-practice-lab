import test from "node:test";
import assert from "node:assert/strict";
import { quoteMatches, DraftWriter } from "../src/lib/reflection";
test("citations retain repeated occurrences and Unicode code point offsets", () => {
  assert.deepEqual(quoteMatches("😀重复；重复", "重复"), [1, 4]);
  assert.deepEqual(quoteMatches("一一一", "一一"), [0, 1]);
  assert.deepEqual(quoteMatches("😀原文", ""), []);
});
test("draft writer serializes snapshots and uses the latest acknowledged revision", async () => {
  const sent: { revision: number; value: string }[] = [];
  const releases: (() => void)[] = [];
  const writer = new DraftWriter<string>(3, async (revision, value) => {
    sent.push({ revision, value });
    await new Promise<void>((resolve) => releases.push(resolve));
    return revision + 1;
  });
  const first = writer.save("first");
  const second = writer.save("second");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(sent, [{ revision: 3, value: "first" }]);
  releases.shift()!();
  await first;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(sent, [
    { revision: 3, value: "first" },
    { revision: 4, value: "second" },
  ]);
  releases.shift()!();
  await second;
});
test("a failed draft write blocks queued writes until explicit recovery", async () => {
  let calls = 0;
  const writer = new DraftWriter<string>(1, async () => {
    calls++;
    throw new Error("REVISION_CONFLICT");
  });
  const results = await Promise.allSettled([
    writer.save("local one"),
    writer.save("local two"),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(
    results.map((result) => result.status),
    ["rejected", "rejected"],
  );
});
