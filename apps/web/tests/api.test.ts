import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { api, ApiError } from "../src/lib/api";
import { proxy } from "../src/lib/proxy";

test("retry after a proxy loses a committed response reuses the key and creates only one run", async () => {
  const originalFetch = globalThis.fetch;
  const previousEnv = { ...process.env };
  const committed = new Map<string, string>();
  const receivedKeys: string[] = [];
  const backend = createServer(async (request, response) => {
    for await (const chunk of request) void chunk;
    const key = String(request.headers["idempotency-key"]);
    receivedKeys.push(key);
    if (!committed.has(key)) committed.set(key, `run-${committed.size + 1}`);
    if (receivedKeys.length === 1) {
      // The operation succeeded, but the proxy cannot know its result.
      request.socket.destroy();
      return;
    }
    response.writeHead(202, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ id: committed.get(key) }));
  });
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  const address = backend.address();
  assert(address && typeof address !== "string");
  process.env.AGENT_SCHOOL_LOCAL_TOKEN = "unit-private-token";
  process.env.AGENT_SCHOOL_API_ORIGIN = `http://127.0.0.1:${address.port}`;
  process.env.AGENT_SCHOOL_FRONTEND_ORIGIN = "http://127.0.0.1:3000";
  globalThis.fetch = async (input, init) => {
    if (typeof input === "string" && input.startsWith("/api/v1/")) {
      const headers = new Headers(init?.headers);
      headers.set("Host", "127.0.0.1:3000");
      headers.set("Origin", "http://127.0.0.1:3000");
      return proxy(
        new Request(`http://127.0.0.1:3000${input}`, { ...init, headers }),
        ["runs"],
      );
    }
    return originalFetch(input, init);
  };
  const options = {
    method: "POST",
    idempotent: true,
    body: { input_text: "same manual operation" },
  };
  try {
    await assert.rejects(
      api("/runs", options),
      (error) =>
        error instanceof ApiError && error.detail.code === "MODEL_UNAVAILABLE",
    );
    assert.equal(
      receivedKeys.length,
      1,
      "failed writes must never retry automatically",
    );
    assert.deepEqual(await api("/runs", options), { id: "run-1" });
    assert.equal(receivedKeys[0], receivedKeys[1]);
    assert.equal(committed.size, 1);
    // After a confirmed success, a later deliberate action is new work.
    assert.deepEqual(await api("/runs", options), { id: "run-2" });
    assert.notEqual(receivedKeys[1], receivedKeys[2]);
  } finally {
    globalThis.fetch = originalFetch;
    process.env = previousEnv;
    backend.closeAllConnections();
    await new Promise<void>((resolve) => backend.close(() => resolve()));
  }
});
