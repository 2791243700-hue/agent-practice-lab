import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
if (process.platform !== "win32") {
  console.log("Windows launcher smoke skipped on this platform.");
  process.exit(0);
}
const root = resolve(process.cwd(), "../..");
const data = mkdtempSync(resolve(tmpdir(), "agent-school-launcher-web-"));
function powershell(script, args = []) {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      resolve(root, "scripts", script),
      "-DataDir",
      data,
      ...args,
    ],
    { cwd: root, encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0)
    throw new Error(`${script} failed: ${result.stderr || result.stdout}`);
}
try {
  powershell("start.ps1", ["-WebPort", "3200", "-ApiPort", "8200", "-Demo"]);
  let ready = false;
  for (let count = 0; count < 60; count++) {
    try {
      const health = await fetch("http://127.0.0.1:3200/api/v1/health");
      if (health.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("Frontend proxy did not become ready");
  const lessons = await (
    await fetch("http://127.0.0.1:3200/api/v1/lessons")
  ).json();
  if (lessons.items.length !== 4)
    throw new Error(
      "Expected four courses through the launcher's private token",
    );
  const page = await fetch("http://127.0.0.1:3200");
  if (!page.ok) throw new Error("Home page unavailable");
  console.log(
    "Windows launcher + Next.js dev + API proxy smoke: PASS (4 courses, HTTP 200).",
  );
} finally {
  powershell("stop.ps1");
}
