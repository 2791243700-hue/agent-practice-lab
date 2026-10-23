"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, ShieldCheck, Wrench } from "lucide-react";
import { ApiError, api, pathId } from "@/lib/api";
import { messages } from "@/lib/events";
import type { Approval, Event, Run } from "@/lib/types";
import { runLabels, terminal, toolLabels } from "@/lib/types";
import { dateTime, ErrorBox, Markdown, useAction } from "./ui";
import { RunTips, type RunTipsOptions } from "./run-tips";
function ApprovalCard({
  initial,
  events,
  readOnly,
}: {
  initial: Approval;
  events: Event[];
  readOnly: boolean;
}) {
  const [approval, setApproval] = useState(initial);
  const [now, setNow] = useState(Date.now());
  const action = useAction();
  useEffect(() => setApproval(initial), [initial]);
  useEffect(() => {
    if (approval.status !== "pending") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [approval.status]);
  const result = events.find(
    (e) =>
      e.kind === "tool.completed" &&
      e.payload.result.call_id === approval.call_id,
  );
  const saved =
    result?.kind === "tool.completed" && result.payload.result.status === "ok";
  const expired = Date.parse(approval.expires_at) <= now;
  const labels = {
    pending: expired ? "请求已到期，正在等待服务端状态" : "请检查这次保存请求",
    approved: saved ? "已保存 · 工具执行成功" : "已批准 · 等待工具实际完成",
    denied: "已拒绝 · 此次操作不会保存",
    expired: "请求已过期",
    cancelled: "请求已失效",
  };
  function decide(decision: "approve" | "deny") {
    void action.act(async () => {
      setApproval(
        await api<Approval>(`/approvals/${pathId(approval.id)}/decision`, {
          method: "POST",
          body: { decision },
        }),
      );
    });
  }
  return (
    <section
      className={`approval-card ${saved ? "saved" : ""}`}
      aria-label="保存操作授权"
    >
      <div className="approval-title">
        <ShieldCheck size={22} />
        <div>
          <strong>{labels[approval.status]}</strong>
          <p>仅批准这一次 save_todos 调用</p>
        </div>
      </div>
      <p className="small">
        保存位置：当前实训的产物目录 · todos.md 与结构化清单
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>事项</th>
              <th>截止日期</th>
              <th>来源</th>
            </tr>
          </thead>
          <tbody>
            {approval.arguments.items.map((item, i) => (
              <tr key={i}>
                <td>
                  {item.title}
                  <small>{item.task_id}</small>
                </td>
                <td>{item.due_date}</td>
                <td>{item.source_id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details>
        <summary>查看完整工具参数</summary>
        <pre>{JSON.stringify(approval.arguments, null, 2)}</pre>
      </details>
      <p className="small muted">
        有效至 {dateTime(approval.expires_at)}
        。批准后还需等待工具返回，再打开产物核对。
      </p>
      <ErrorBox error={action.error} />
      {approval.status === "pending" && (
        <div className="button-row">
          <button
            className="button secondary"
            disabled={readOnly || expired || action.busy}
            onClick={() => decide("deny")}
          >
            拒绝此次保存
          </button>
          <button
            className="button"
            disabled={readOnly || expired || action.busy}
            onClick={() => decide("approve")}
          >
            批准此次保存
          </button>
        </div>
      )}
      {approval.status === "approved" &&
        result?.kind === "tool.completed" &&
        result.payload.result.status === "error" && (
          <p role="alert" className="danger-text">
            保存失败：{result.payload.result.data.message}
          </p>
        )}
    </section>
  );
}
export function PendingMessage({ text }: { text: string }) {
  return (
    <article className="run-view" data-testid="pending-message">
      <div className="message user-message">
        <span className="message-author">你的任务说明</span>
        <p>{text}</p>
      </div>
      <p className="reply-pending" role="status">
        <span className="spinner" aria-hidden="true" />
        正在发送任务…
      </p>
    </article>
  );
}

export function RunView({
  run,
  events,
  ...tipsOptions
}: { run: Run; events: Event[] } & RunTipsOptions) {
  const output = messages(events);
  const approvals = new Map<string, Approval>();
  for (const e of events)
    if (e.kind === "approval.requested" || e.kind === "approval.decided")
      approvals.set(e.payload.approval.id, e.payload.approval);
  if (run.pending_approval && !approvals.has(run.pending_approval.id))
    approvals.set(run.pending_approval.id, run.pending_approval);
  return (
    <article className="run-view" data-testid="run-view">
      <div className="run-meta">
        <span
          className={`badge ${run.status === "failed" ? "warning" : "subtle"}`}
        >
          {runLabels[run.status]}
        </span>
        <time>{dateTime(run.created_at)}</time>
        <span>
          模型调用 {run.usage.model_calls} 次 · Token{" "}
          {run.usage.input_tokens === null || run.usage.output_tokens === null
            ? "用量未知"
            : run.usage.input_tokens + run.usage.output_tokens}
        </span>
      </div>
      <div className="message user-message">
        <span className="message-author">你的任务说明</span>
        <p>{run.input_text}</p>
      </div>
      {events
        .filter((e) => e.kind === "tool.requested")
        .map((e) => {
          if (e.kind !== "tool.requested") return null;
          const call = e.payload.call;
          const result = events.find(
            (r) =>
              r.kind === "tool.completed" &&
              r.payload.result.call_id === call.id,
          );
          return (
            <details
              id={`tool-${run.id}-${e.seq}`}
              className="tool-event"
              key={e.seq}
            >
              <summary>
                <Wrench size={16} />
                <strong>{toolLabels[call.name]}</strong>
                <span>
                  {result?.kind === "tool.completed"
                    ? result.payload.result.status === "ok"
                      ? call.name === "save_todos"
                        ? "已保存"
                        : "成功"
                      : result.payload.result.status === "denied"
                        ? "已拒绝，未保存"
                        : "失败"
                    : terminal(run.status)
                      ? "未完成"
                      : "处理中"}
                </span>
              </summary>
              <div className="tool-details">
                <p>工具输入 · 事件 #{e.seq}</p>
                <pre>{JSON.stringify(call.arguments, null, 2)}</pre>
                {result?.kind === "tool.completed" && (
                  <div>
                    <p>实际执行结果 · 事件 #{result.seq}</p>
                    <pre>
                      {JSON.stringify(result.payload.result.data, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </details>
          );
        })}
      {[...approvals.values()].map((a) => (
        <ApprovalCard
          key={a.id}
          initial={a}
          events={events}
          readOnly={terminal(run.status)}
        />
      ))}
      {output.length === 0 &&
        !terminal(run.status) &&
        run.status !== "awaiting_approval" && (
          <div
            className="message assistant-message reply-pending"
            role="status"
          >
            <span className="spinner" aria-hidden="true" />
            {run.status === "queued"
              ? "任务已接收，等待开始…"
              : "Agent 正在准备回答…"}
          </div>
        )}
      {output.map((m) => (
        <div className="message assistant-message" key={m.id}>
          <span className="message-author">
            <span className="agent-dot" /> 教学 Agent{" "}
            {m.complete && <CheckCircle2 size={12} />}
          </span>
          {m.complete && !m.text ? (
            <p className="notice warning">
              本轮没有返回完整回答。请检查模型连接，并查看本轮事件记录。
            </p>
          ) : (
            <Markdown text={m.text} />
          )}
          {!m.complete && (
            <small className="muted">
              {terminal(run.status) ? "未完成的输出" : "正在输出…"}
            </small>
          )}
        </div>
      ))}
      {run.error && <ErrorBox error={new ApiError(run.error.error)} />}
      {run.status === "interrupted" && (
        <div className="notice warning">
          本地服务重启使本轮中断。记录已保留，请重新配置 Key 后主动开启新一轮。
        </div>
      )}
      {terminal(run.status) && (
        <RunTips key={run.id} runId={run.id} {...tipsOptions} />
      )}
      <details className="run-snapshot">
        <summary>本轮配置与事件记录（{events.length}）</summary>
        <pre>{JSON.stringify(run.snapshot, null, 2)}</pre>
        {events.map((e) => (
          <div id={`event-${run.id}-${e.seq}`} key={e.seq}>
            <a href={`#event-${run.id}-${e.seq}`}>#{e.seq}</a> · {e.kind} ·{" "}
            {dateTime(e.created_at)}
            <pre>{JSON.stringify(e.payload, null, 2)}</pre>
          </div>
        ))}
      </details>
    </article>
  );
}
