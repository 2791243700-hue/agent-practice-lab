"use client";
import { useState } from "react";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { pathId } from "@/lib/api";
import type { Attempt, Lesson, Schema, Submission } from "@/lib/types";
import { dateTime, ErrorBox, useAction } from "./ui";

export function SubmissionFeedback({ submission }: { submission: Submission }) {
  const title = submission.passed
    ? "正式通过，做得有依据。"
    : submission.mode === "demo"
      ? submission.evaluation_passed
        ? "演示检查通过 · 不计正式完成"
        : "演示仍有待补充项 · 不计正式完成"
      : "还差几步，按反馈继续尝试。";
  return (
    <div className="feedback" data-testid="submission-feedback">
      <div className={`feedback-title ${submission.passed ? "passed" : ""}`}>
        <CheckCircle2 size={23} />
        <div>
          <h3>{title}</h3>
          <p>
            <time dateTime={submission.created_at}>
              {dateTime(submission.created_at)}
            </time>
          </p>
        </div>
      </div>
      {submission.rules.map((rule) => (
        <div className="rule" key={rule.rule_id}>
          {rule.passed ? (
            <CheckCircle2 className="success-text" size={19} />
          ) : (
            <CircleAlert className="amber-text" size={19} />
          )}
          <div>
            <strong>
              {rule.passed ? "已满足" : "需要补充"} ·{" "}
              {rule.required ? "必要项" : "建议项"}
            </strong>
            <p>{rule.message}</p>
            {rule.evidence_refs.length > 0 && (
              <details>
                <summary>查看验收依据（{rule.evidence_refs.length}）</summary>
                {rule.evidence_refs.map((ref) => {
                  const e = submission.evidence.find((e) => e.id === ref);
                  return (
                    <div className="evidence" key={ref}>
                      <code>{ref}</code>
                      {e &&
                        ("file" in e ? (
                          <a
                            href={`/api/v1/submissions/${pathId(submission.id)}/files/${pathId(e.file.id)}/download`}
                          >
                            下载提交时快照：{e.file.title}
                          </a>
                        ) : "run_id" in e ? (
                          <a href={`#event-${e.run_id}-${e.event_seq}`}>
                            查看运行事件 #{e.event_seq}
                          </a>
                        ) : "answers" in e ? (
                          <pre>{JSON.stringify(e.answers, null, 2)}</pre>
                        ) : (
                          <span>
                            文件检查：{e.passed ? "通过" : "未通过"}（{e.check}
                            ）
                          </span>
                        ))}
                    </div>
                  );
                })}
              </details>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
export function SubmissionPanel({
  attempt,
  lesson,
  history,
  disabled,
  onSubmit,
  onView,
}: {
  attempt: Attempt;
  lesson: Lesson;
  history: Schema["SubmissionSummary"][];
  disabled: boolean;
  onSubmit: (answers: Schema["Answers"]) => Promise<void>;
  onView: (id: string) => Promise<void>;
}) {
  const action = useAction();
  const form = lesson.answer_form;
  const [option, setOption] = useState("");
  const [facts, setFacts] = useState<
    Record<string, { due_date: string; source_id: string }>
  >({});
  const [session, setSession] = useState("");
  const [room, setRoom] = useState("");
  return (
    <section className="panel" id="submit">
      <div className="panel-heading">
        <div>
          <div className="eyebrow">CHECK YOUR UNDERSTANDING</div>
          <h2>核对理解，提交验收</h2>
        </div>
        <span
          className={`badge ${attempt.mode === "demo" ? "demo" : "subtle"}`}
        >
          {attempt.mode === "demo" ? "演示评测" : "正式验收"}
        </span>
      </div>
      <p className="small muted">
        运行完成只是一步。请核对材料和结果，再提交本次实训的证据与答案。
      </p>
      <ErrorBox error={action.error} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          let answers: Schema["Answers"] = {};
          if (form.kind === "choice")
            answers = { question_id: form.question_id, option_id: option };
          if (form.kind === "facts")
            answers = {
              facts: form.tasks.map((t) => ({
                task_id: t.task_id,
                due_date: facts[t.task_id]?.due_date ?? "",
                source_id: facts[t.task_id]?.source_id ?? "",
              })),
            };
          if (form.kind === "course")
            answers = {
              course_id: form.course_id,
              session_date: session,
              room,
            };
          void action.act(() => onSubmit(answers));
        }}
      >
        <fieldset disabled={disabled || action.busy}>
          <legend className="sr-only">本关作答</legend>
          {form.kind === "choice" && (
            <>
              <p>
                <strong>{form.prompt}</strong>
              </p>
              {form.options.map((o) => (
                <label className="option" key={o.id}>
                  <input
                    required
                    type="radio"
                    name="understanding"
                    value={o.id}
                    checked={option === o.id}
                    onChange={() => setOption(o.id)}
                  />
                  {o.label}
                </label>
              ))}
            </>
          )}
          {form.kind === "facts" &&
            form.tasks.map((t) => (
              <div className="fact-row" key={t.task_id}>
                <strong>{t.label}</strong>
                <label>
                  截止日期
                  <input
                    type="date"
                    required
                    value={facts[t.task_id]?.due_date ?? ""}
                    onChange={(e) =>
                      setFacts({
                        ...facts,
                        [t.task_id]: {
                          due_date: e.target.value,
                          source_id: facts[t.task_id]?.source_id ?? "",
                        },
                      })
                    }
                  />
                </label>
                <label>
                  依据来源
                  <select
                    required
                    value={facts[t.task_id]?.source_id ?? ""}
                    onChange={(e) =>
                      setFacts({
                        ...facts,
                        [t.task_id]: {
                          due_date: facts[t.task_id]?.due_date ?? "",
                          source_id: e.target.value,
                        },
                      })
                    }
                  >
                    <option value="">请根据原文选择</option>
                    {form.sources.map((s) => (
                      <option key={s.source_id} value={s.source_id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ))}
          {form.kind === "course" && (
            <>
              <p>{form.prompt}</p>
              <div className="form-grid">
                <label>
                  课程日期
                  <input
                    required
                    type="date"
                    value={session}
                    onChange={(e) => setSession(e.target.value)}
                  />
                </label>
                <label>
                  教室
                  <input
                    required
                    maxLength={120}
                    value={room}
                    onChange={(e) => setRoom(e.target.value)}
                    placeholder="根据查询结果填写"
                  />
                </label>
              </div>
            </>
          )}
          {form.kind === "artifact" && (
            <p>{form.prompt} 提交时会冻结当前产物和操作记录。</p>
          )}
          <button className="button" disabled={disabled || action.busy}>
            {action.busy ? "正在验收…" : "提交验收"}
          </button>
        </fieldset>
      </form>
      {disabled && (
        <p className="small muted">
          当前实训运行未结束，或已经重新开始。运行结束后才可提交。
        </p>
      )}
      <details className="history">
        <summary>历史提交（{history.length}）</summary>
        {!history.length && <p className="muted small">尚无提交。</p>}
        {history.map((s) => (
          <button
            key={s.id}
            disabled={action.busy}
            className="history-item"
            onClick={() => void action.act(() => onView(s.id))}
          >
            <span>{dateTime(s.created_at)}</span>
            <span>
              {s.passed
                ? "正式通过"
                : s.mode === "demo"
                  ? s.evaluation_passed
                    ? "演示检查通过"
                    : "演示未通过"
                  : "待完善"}{" "}
              →
            </span>
          </button>
        ))}
      </details>
    </section>
  );
}
