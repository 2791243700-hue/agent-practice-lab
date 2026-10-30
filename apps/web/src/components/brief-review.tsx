"use client";
import { useEffect, useId, useLayoutEffect, useState } from "react";
import { briefCandidates, initialBriefPair } from "@/lib/brief-reflection";
import { useReflectionDraft } from "@/lib/use-reflection-draft";
import type { Attempt, Event, Run, Schema } from "@/lib/types";
import { dateTime } from "./ui";
import {
  focusValidationField,
  validationAttributes,
  ValidationSummary,
  type ValidationIssue,
} from "./form-validation";

export function BriefReview({
  attempt,
  runs,
  events,
  disabled,
  form,
  onSubmit,
  onRefresh,
  onValidateSubmission,
}: {
  attempt: Attempt;
  runs: Run[];
  events: Record<string, Event[]>;
  disabled: boolean;
  form: Schema["BriefReflectionForm"];
  onSubmit: (answers: Schema["BriefReflectionAnswers"]) => Promise<void>;
  onRefresh?: () => Promise<void>;
  onValidateSubmission?: () => boolean;
}) {
  const { draft, setDraft, loaded, dirty, saving, error, conflict, reload } =
    useReflectionDraft(attempt, onRefresh);
  const prefix = useId();
  const [showValidation, setShowValidation] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{ id: string } | null>(null);
  const [selfCheck, setSelfCheck] = useState(false);
  const candidates = briefCandidates(attempt, runs, events);
  const autoPair = initialBriefPair(draft, candidates);
  const beforeId = autoPair?.beforeId;
  const afterId = autoPair?.afterId;
  useEffect(() => {
    if (loaded && !error && beforeId && afterId)
      setDraft((old) =>
        old.beforeId || old.afterId ? old : { ...old, beforeId, afterId },
      );
  }, [loaded, error, beforeId, afterId, setDraft]);
  useLayoutEffect(() => {
    if (focusRequest) focusValidationField(focusRequest.id);
  }, [focusRequest]);
  const beforeIndex = candidates.findIndex((run) => run.id === draft.beforeId);
  const afterIndex = candidates.findIndex((run) => run.id === draft.afterId);
  const missing: ValidationIssue[] = [];
  const id = (key: string) => `${prefix}-${key}`;
  if (beforeIndex < 0)
    missing.push({
      id: id("beforeId"),
      message: "先完成两轮有完整回答的对话，再选择第一次尝试。",
    });
  if (afterIndex < 0 || afterIndex <= beforeIndex)
    missing.push({
      id: id("afterId"),
      message: "请选择第一次尝试之后完成的另一轮对话。",
    });
  if (!draft.judgment)
    missing.push({
      id: id("judgment"),
      message: "请选择第二次回答是否符合新增要求。",
    });
  if (!draft.explanation.trim())
    missing.push({
      id: id("explanation"),
      message: "请用一句话说明你从回答中看到了什么。",
    });
  const issues = showValidation ? missing : [];
  const field = (key: string) => validationAttributes(id(key), issues);
  function download() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `reflection-${attempt.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  async function submit() {
    setShowValidation(true);
    if (missing.length) {
      setFocusRequest({ id: missing[0].id });
      return;
    }
    if (onValidateSubmission && !onValidateSubmission()) return;
    await onSubmit({
      kind: "brief_reflection",
      baseline_run_id: draft.beforeId,
      revised_run_id: draft.afterId,
      judgment: draft.judgment as Schema["BriefReflectionAnswers"]["judgment"],
      explanation: draft.explanation.trim(),
    });
  }
  return (
    <div data-testid="brief-review" className="conversation-review">
      <p>两轮对话已自动带入。核对回答，选一个判断，再写一句依据就可以提交。</p>
      <p className="small muted">
        不用复制原文或填写引用位置。发现回答不符合要求，也可以如实说明并通过验收。
      </p>
      <p role="status" className="small muted">
        {!loaded
          ? "正在读取复盘草稿…"
          : dirty
            ? saving
              ? "正在保存复盘草稿…"
              : "复盘草稿有未保存修改"
            : "复盘草稿已保存"}
      </p>
      {error && (
        <div role="alert" className="notice warning">
          {error}
          {conflict && "其他页面已修改草稿，自动保存已停止。"}
          <button
            type="button"
            className="text-button"
            onClick={() => {
              if (
                !dirty ||
                confirm("重新读取将替换本页修改，请先下载草稿备份。继续？")
              )
                void reload();
            }}
          >
            重新读取服务端草稿
          </button>
        </div>
      )}
      <details>
        <summary>草稿备份</summary>
        <button type="button" className="text-button" onClick={download}>
          下载当前草稿备份
        </button>
      </details>
      <fieldset disabled={disabled || !loaded} className="review-fields">
        <legend className="sr-only">两轮对话与一句复盘</legend>
        <ValidationSummary issues={issues} />
        {candidates.length < 2 && (
          <p className="review-empty">
            还需要至少两轮完整对话。
            <a href="#task-input">回到对话，补充要求再试一次 →</a>
          </p>
        )}
        <div className="review-pair">
          {(["before", "after"] as const).map((side) => {
            const key = side === "before" ? "beforeId" : "afterId";
            const run = candidates.find((item) => item.id === draft[key]);
            return (
              <article className="review-run" key={side}>
                <label>
                  {side === "before" ? "第一次尝试" : "改进后的尝试"}
                  <select
                    {...field(key)}
                    value={draft[key]}
                    onChange={(event) => {
                      const value = event.target.value;
                      setDraft((old) => ({ ...old, [key]: value }));
                    }}
                  >
                    <option value="">请选择一轮对话</option>
                    {candidates.map((candidate, index) => (
                      <option
                        key={candidate.id}
                        value={candidate.id}
                        disabled={side === "after" && index <= beforeIndex}
                      >
                        第 {index + 1} 轮 · {dateTime(candidate.created_at)}
                      </option>
                    ))}
                  </select>
                </label>
                {run && (
                  <>
                    <strong>你的任务说明</strong>
                    <p className="review-source-text">{run.input_text}</p>
                    <details>
                      <summary>查看这一轮的完整回答</summary>
                      {(events[run.id] ?? []).map((event) =>
                        event.kind === "message.completed" &&
                        event.payload.role === "assistant" &&
                        event.payload.content.trim() ? (
                          <p className="review-source-text" key={event.seq}>
                            {event.payload.content}
                          </p>
                        ) : null,
                      )}
                    </details>
                  </>
                )}
              </article>
            );
          })}
        </div>
        <fieldset
          className="review-judgment"
          tabIndex={-1}
          {...field("judgment")}
        >
          <legend>第二次回答符合你新增的要求吗？</legend>
          {(
            [
              ["satisfied", "符合"],
              ["partial", "部分符合"],
              ["unsatisfied", "不符合"],
            ] as const
          ).map(([value, label]) => (
            <label className="option" key={value}>
              <input
                type="radio"
                name={`${prefix}-judgment`}
                checked={draft.judgment === value}
                onChange={() =>
                  setDraft((old) => ({ ...old, judgment: value }))
                }
              />
              {label}
            </label>
          ))}
        </fieldset>
        <label>
          你从哪里看出来的？
          <textarea
            {...field("explanation")}
            rows={3}
            maxLength={2000}
            value={draft.explanation}
            onChange={(event) => {
              const value = event.target.value;
              setDraft((old) => ({ ...old, explanation: value }));
            }}
            placeholder="用一句话说清：我新增了什么要求，回答哪里做到了，或哪里还没做到。"
          />
        </label>
        <div className="review-actions">
          <p className="small muted">
            系统会带入所选两轮的指令和完整回答作为验收依据。
          </p>
          <button
            className="button"
            type="button"
            onClick={() => void submit()}
          >
            提交验收
          </button>
        </div>
        <details className="review-source">
          <summary>选做：再试一个情境（不影响通关）</summary>
          <h3>{form.challenge.title}</h3>
          <p>{form.challenge.notice}</p>
          <p>
            想让 Agent 整理参加前的准备清单，哪些信息已有依据，哪些还需确认？
          </p>
          <div className="review-facts">
            {form.challenge.items.map((item) => (
              <label key={item.id}>
                {item.label}
                <select
                  value={draft.facts[item.id] ?? ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    setDraft((old) => ({
                      ...old,
                      facts: { ...old.facts, [item.id]: value },
                    }));
                  }}
                >
                  <option value="">可以跳过</option>
                  <option value="known">通知已说明</option>
                  <option value="confirm">需要确认</option>
                </select>
              </label>
            ))}
          </div>
          <label>
            给 Agent 补充一条要求（选填）
            <textarea
              rows={2}
              maxLength={2000}
              value={draft.instruction}
              onChange={(event) => {
                const value = event.target.value;
                setDraft((old) => ({ ...old, instruction: value }));
              }}
            />
          </label>
          <button
            className="button secondary"
            type="button"
            onClick={() => setSelfCheck((value) => !value)}
          >
            {selfCheck ? "收起自查提示" : "查看自查提示"}
          </button>
          {selfCheck && (
            <p data-testid="optional-self-check">{form.self_check}</p>
          )}
          <p className="small muted">
            这项练习不调用模型，不参与正式验收。填写内容随草稿保存，可随时回来继续。
          </p>
        </details>
      </fieldset>
    </div>
  );
}
