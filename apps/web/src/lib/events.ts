import type { Event, Run } from "./types";
import { terminal } from "./types";
export function mergeEvent(events: Event[], next: Event): Event[] {
  if (events.some((e) => e.run_id === next.run_id && e.seq === next.seq))
    return events;
  return [...events, next].sort((a, b) => a.seq - b.seq);
}
export function messages(events: Event[]) {
  const items = new Map<
    string,
    { id: string; text: string; complete: boolean }
  >();
  for (const e of events) {
    if (e.kind === "message.delta") {
      const old = items.get(e.payload.message_id);
      items.set(e.payload.message_id, {
        id: e.payload.message_id,
        text: (old?.text ?? "") + e.payload.delta,
        complete: false,
      });
    }
    if (e.kind === "message.completed")
      items.set(e.payload.message_id, {
        id: e.payload.message_id,
        text: e.payload.content,
        complete: true,
      });
  }
  return [...items.values()];
}
export function eventRun(run: Run, event: Event): Run {
  switch (event.kind) {
    case "run.started":
      return { ...run, status: "running" };
    case "approval.requested":
      return {
        ...run,
        status: "awaiting_approval",
        pending_approval: event.payload.approval,
      };
    case "approval.decided":
      return { ...run, status: "running", pending_approval: null };
    case "run.completed":
    case "run.cancelled":
    case "run.interrupted":
      return {
        ...run,
        status: event.payload.status,
        pending_approval: null,
        usage: event.payload.usage,
      };
    case "run.failed":
      return {
        ...run,
        status: "failed",
        pending_approval: null,
        usage: event.payload.usage,
        error: event.payload.error,
      };
    default:
      return run;
  }
}
export async function streamEvents(
  runId: string,
  after: number,
  signal: AbortSignal,
  receive: (event: Event) => void,
  connection: (message: string) => void,
) {
  let seq = after,
    delay = 1000;
  while (!signal.aborted) {
    try {
      const response = await fetch(
        `/api/v1/runs/${encodeURIComponent(runId)}/events?after_seq=${seq}`,
        {
          signal,
          cache: "no-store",
          headers: { "Last-Event-ID": String(seq) },
        },
      );
      if (response.status === 204) {
        connection("");
        return;
      }
      if (!response.ok || !response.body) {
        connection("事件连接失败，请刷新读取当前运行状态。不会自动重发任务。");
        return;
      }
      connection("已连接 · 实时接收过程");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (!signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder
            .decode(chunk.value, { stream: true })
            .replace(/\r\n/g, "\n");
          let boundary: number;
          while ((boundary = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = frame
              .split("\n")
              .filter((l) => l.startsWith("data:"))
              .map((l) => l.slice(5).trimStart())
              .join("\n");
            if (!data) continue;
            const event = JSON.parse(data) as Event;
            if (event.run_id !== runId || !Number.isSafeInteger(event.seq))
              throw new Error("invalid event");
            if (event.seq <= seq) continue;
            if (event.seq !== seq + 1) throw new Error("sequence gap");
            seq = event.seq;
            receive(event);
            delay = 1000;
            if (event.kind.startsWith("run.") && event.kind !== "run.started") {
              connection("");
              return;
            }
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
    } catch {
      if (signal.aborted) return;
    }
    connection(`连接暂时中断，正在从事件 ${seq} 恢复。任务不会重发。`);
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, delay);
      signal.addEventListener("abort", done, { once: true });
    });
    delay = Math.min(delay * 2, 10000);
  }
}
export const activeRun = (runs: Run[]) =>
  runs.find((run) => !terminal(run.status));
