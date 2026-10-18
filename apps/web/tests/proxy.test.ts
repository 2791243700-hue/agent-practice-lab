import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { proxy } from "../src/lib/proxy";

test("proxy enforces browser origin/host, overrides token, streams and preserves attachment status", async () => {
  const previous = { ...process.env };
  let calls = 0;
  let received: Record<string, unknown> = {};
  const server = createServer((request, response) => {
    calls++;
    received = {
      token: request.headers["x-local-token"],
      cursor: request.headers["last-event-id"],
      path: request.url,
    };
    if (request.url?.includes("events")) {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write("id: 1\ndata: first\n\n");
      setTimeout(() => response.end("id: 2\ndata: second\n\n"), 100);
    } else {
      response.writeHead(409, {
        "Content-Type": "application/json",
        "Content-Disposition": "attachment; filename=record.json",
      });
      response.end('{"error":"example"}');
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  process.env.AGENT_SCHOOL_LOCAL_TOKEN = "unit-private-token";
  process.env.AGENT_SCHOOL_API_ORIGIN = `http://127.0.0.1:${address.port}`;
  process.env.AGENT_SCHOOL_FRONTEND_ORIGIN = "http://127.0.0.1:3000";
  function request(method = "GET", headers: Record<string, string> = {}) {
    return new Request("http://127.0.0.1:3000/api/v1/health", {
      method,
      headers: { host: "127.0.0.1:3000", ...headers },
    });
  }
  try {
    assert.equal((await proxy(request("POST"), ["health"])).status, 403);
    assert.equal(
      (
        await proxy(request("POST", { origin: "https://evil.example" }), [
          "health",
        ])
      ).status,
      403,
    );
    assert.equal(
      (await proxy(request("GET", { host: "evil.example" }), ["health"]))
        .status,
      403,
    );
    assert.equal((await proxy(request(), ["..", "health"])).status, 404);
    assert.equal(calls, 0);
    const attachment = await proxy(
      request("GET", { "x-local-token": "browser-forgery" }),
      ["exports", "export-id", "download"],
    );
    assert.equal(attachment.status, 409);
    assert.equal(
      attachment.headers.get("content-disposition"),
      "attachment; filename=record.json",
    );
    assert.equal(attachment.headers.get("cache-control"), "no-store");
    assert.equal(received.token, "unit-private-token");
    assert(
      !JSON.stringify([...attachment.headers]).includes("unit-private-token"),
    );
    await attachment.text();
    const response = await proxy(request("GET", { "last-event-id": "9" }), [
      "runs",
      "run-id",
      "events",
    ]);
    assert.equal(received.cursor, "9");
    assert.equal(response.headers.get("x-accel-buffering"), "no");
    const reader = response.body!.getReader();
    const first = await reader.read();
    assert.match(new TextDecoder().decode(first.value), /first/);
    let remainder = "";
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      remainder += new TextDecoder().decode(next.value);
    }
    assert.match(remainder, /second/);
    delete process.env.AGENT_SCHOOL_LOCAL_TOKEN;
    assert.equal((await proxy(request(), ["health"])).status, 503);
  } finally {
    process.env = previous;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
