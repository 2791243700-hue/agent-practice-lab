// Isolated real API + SDK + local scripted provider. Never uses external credentials.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(web, "../..");
const token = randomBytes(32).toString("hex");
const data = mkdtempSync(resolve(tmpdir(), "agent-school-browser-"));
const provider = createServer(async (request, response) => {
  if (
    request.url === "/__test/restart-backend" &&
    request.method === "POST" &&
    request.headers["x-test-control"] === "browser-test-control"
  ) {
    try {
      await restartBackend();
      response.writeHead(200);
      response.end("ready");
    } catch {
      response.writeHead(503);
      response.end("restart failed");
    }
    return;
  }
  if (request.headers.authorization !== "Bearer browser-test-only") {
    response.writeHead(401, { "Content-Type": "application/json" });
    response.end('{"error":{"message":"invalid test credential"}}');
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  const probe = body.tools?.some((t) => t.function.name === "connection_probe");
  const message = probe
    ? {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "probe-browser",
            type: "function",
            function: { name: "connection_probe", arguments: '{"value":"ok"}' },
          },
        ],
      }
    : {
        role: "assistant",
        content: "已根据课程通知整理两项待办，请核对日期和来源。",
      };
  if (body.stream) {
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const chunk = (delta) => ({
      id: "chat-browser",
      object: "chat.completion.chunk",
      created: 1792220000,
      model: "browser-scripted-model",
      choices: [{ index: 0, delta, finish_reason: null }],
    });
    response.write(
      `data: ${JSON.stringify(chunk({ role: "assistant", content: "正在根据课程通知整理。" }))}\n\n`,
    );
    await new Promise((r) => setTimeout(r, 2200));
    if (response.destroyed) return;
    response.write(
      `data: ${JSON.stringify(chunk({ content: message.content }))}\n\n`,
    );
    const end = chunk({});
    end.choices[0].finish_reason = "stop";
    end.usage = { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 };
    response.end(`data: ${JSON.stringify(end)}\n\ndata: [DONE]\n\n`);
    return;
  }
  const result = {
    id: "chat-browser",
    object: "chat.completion",
    created: 1792220000,
    model: "browser-scripted-model",
    choices: [
      { index: 0, message, finish_reason: probe ? "tool_calls" : "stop" },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(result));
});
provider.listen(8101, "127.0.0.1");
const env = {
  ...process.env,
  // Keep local test traffic out of machine-level HTTP proxies.
  HTTP_PROXY: "",
  HTTPS_PROXY: "",
  ALL_PROXY: "",
  http_proxy: "",
  https_proxy: "",
  all_proxy: "",
  NO_PROXY: "127.0.0.1,localhost,::1",
  NEXT_TELEMETRY_DISABLED: "1",
  AGENT_SCHOOL_LOCAL_TOKEN: token,
  AGENT_SCHOOL_DATA: data,
  AGENT_SCHOOL_FRONTEND_ORIGIN: "http://127.0.0.1:3100",
  AGENT_SCHOOL_API_ORIGIN: "http://127.0.0.1:8100",
  AGENT_SCHOOL_DEMO: "1",
  PYTHONUTF8: "1",
};
const python =
  process.env.AGENT_SCHOOL_TEST_PYTHON ??
  resolve(
    root,
    process.platform === "win32"
      ? "apps/api/.venv/Scripts/python.exe"
      : "apps/api/.venv/bin/python",
  );
let stopping = false;
let restarting = false;
function startBackend() {
  return spawn(
    python,
    [
      "-m",
      "uvicorn",
      "agent_school.main:app_factory",
      "--factory",
      "--host",
      "127.0.0.1",
      "--port",
      "8100",
      "--no-access-log",
    ],
    {
      cwd: resolve(root, "apps/api"),
      env,
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    },
  );
}
const children = [
  startBackend(),
  spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3100",
    ],
    { cwd: web, env, stdio: ["ignore", "ignore", "pipe"], windowsHide: true },
  ),
];
function watch(child) {
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  child.on("error", () => {
    console.error(
      "Browser test service could not start. Check the API virtual environment and production build.",
    );
    stop(1);
  });
  child.on("exit", (code) => {
    if (!stopping && !restarting) stop(code ?? 1);
  });
}
for (const child of children) watch(child);
function stopChild(child, force = false) {
  if (!child.pid) return;
  if (process.platform === "win32")
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  else child.kill(force ? "SIGKILL" : "SIGTERM");
}
async function restartBackend() {
  restarting = true;
  const old = children[0];
  const exited = new Promise((resolve) => old.once("exit", resolve));
  stopChild(old, true);
  await exited;
  children[0] = startBackend();
  watch(children[0]);
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch("http://127.0.0.1:8100/api/v1/health", {
        headers: { "X-Local-Token": token },
      });
      if (response.ok) {
        restarting = false;
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  restarting = false;
  throw new Error("restart timeout");
}
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  provider.closeAllConnections();
  provider.close();
  for (const child of children) stopChild(child);
  process.exit(code);
}
process.on("SIGTERM", () => stop());
process.on("SIGINT", () => stop());
