"use client";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Download } from "lucide-react";
import { quoteMatches } from "@/lib/reflection";
import {
  useReflectionDraft,
  type ReflectionDraftData as Draft,
} from "@/lib/use-reflection-draft";
import type { Attempt, Event, Run, Schema } from "@/lib/types";
import { dateTime } from "./ui";
import {
  focusValidationField,
  validationAttributes,
  ValidationSummary,
  type ValidationIssue,
} from "./form-validation";
const steps = ["选择两轮", "标出改动", "核对回答", "换个情境"];
function Highlight({
  text,
  quote,
  offset,
}: {
  text: string;
  quote: string;
  offset?: number;
}) {
  const chars = Array.from(text);
  const start = offset ?? quoteMatches(text, quote)[0];
  return (
    <p className="review-source-text">
      {start === undefined ? (
        text
      ) : (
        <>
          {chars.slice(0, start).join("")}
          <mark>{quote}</mark>
          {chars.slice(start + Array.from(quote).length).join("")}
        </>
      )}
    </p>
  );
}
export function ConversationReview({
  attempt,
  runs,
  events,
  disabled,
  form,
  onSubmit,
  onRefresh,
  modelAssessed = false,
  onValidateSubmission,
}: {
  attempt: Attempt;
  runs: Run[];
  events: Record<string, Event[]>;
  disabled: boolean;
  form: Omit<Schema["ReflectionForm"], "kind">;
  onSubmit: (answers: Schema["ReflectionAnswers"]) => Promise<void>;
  onRefresh?: () => Promise<void>;
  modelAssessed?: boolean;
  onValidateSubmission?: () => boolean;
}) {
  const { draft, setDraft, loaded, dirty, saving, error, conflict, reload } =
    useReflectionDraft(attempt, onRefresh);
  const prefix = useId();
  const fieldId = (key: string) => `${prefix}-${key}`;
  const [showValidation, setShowValidation] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{ id: string } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusStepHeading = useRef(false);
  const complete = (run?: Run) =>
    (events[run?.id ?? ""] ?? []).filter(
      (event): event is Extract<Event, { kind: "message.completed" }> =>
        event.kind === "message.completed" && !!event.payload.content.trim(),
    );
  const candidates = runs.filter(
    (run) =>
      run.attempt_id === attempt.id &&
      run.mode === attempt.mode &&
      run.status === "completed" &&
      complete(run).length > 0,
  );
  const before = candidates.find((run) => run.id === draft.beforeId);
  const after = candidates.find((run) => run.id === draft.afterId);
  const citation = (side: "before" | "after") => {
    const event = complete(side === "before" ? before : after).find(
      (event) =>
        event.payload.message_id === draft[`${side}MessageId`] &&
        event.seq === draft[`${side}EventSeq`],
    );
    const quote = draft[`${side}Quote`];
    const offset = draft[`${side}StartOffset`];
    return event && quoteMatches(event.payload.content, quote).includes(offset)
      ? {
          message_id: event.payload.message_id,
          event_seq: event.seq,
          quote,
          start_offset: offset,
        }
      : null;
  };
  const pairReady = !!(
    before &&
    after &&
    before.id !== after.id &&
    before.input_text.trim() !== after.input_text.trim()
  );
  const requirementReady = !!(
    pairReady &&
    draft.changeKind &&
    draft.requirement.trim() &&
    after!.input_text.includes(draft.requirement.trim()) &&
    !before!.input_text.includes(draft.requirement.trim())
  );
  const evidenceReady = !!(
    pairReady &&
    citation("before") &&
    citation("after") &&
    draft.judgment &&
    draft.explanation.trim() &&
    (draft.judgment === "satisfied" || draft.nextInstruction.trim())
  );
  const variationReady =
    !!draft.instruction.trim() &&
    form.challenge.items.every((item) =>
      ["known", "confirm"].includes(draft.facts[item.id]),
    );
  const ready = [pairReady, requirementReady, evidenceReady, variationReady];
  const firstIncomplete = ready.findIndex((complete) => !complete);
  const lastUnlocked = firstIncomplete < 0 ? steps.length - 1 : firstIncomplete;
  const step = Math.min(draft.step, lastUnlocked);
  const missing: (ValidationIssue & { step: number })[] = [];
  function check(at: number, key: string, valid: unknown, message: string) {
    if (!valid) missing.push({ step: at, id: fieldId(key), message });
  }
  check(
    0,
    "beforeId",
    before,
    candidates.length < 2
      ? "先完成至少两轮有完整回答的任务，再选择第一次尝试。"
      : "请选择第一次尝试。",
  );
  check(
    0,
    "afterId",
    after &&
      before &&
      before.id !== after.id &&
      before.input_text.trim() !== after.input_text.trim(),
    "请选择另一轮已完成、任务说明不同的改进后尝试。",
  );
  check(1, "changeKind", draft.changeKind, "请选择主要改动的类型。");
  check(
    1,
    "requirement",
    draft.requirement.trim() &&
      after?.input_text.includes(draft.requirement.trim()) &&
      !before?.input_text.includes(draft.requirement.trim()),
    "请引用第二轮新增的要求：文字须与第二轮原文一致，且第一轮没有这一片段。",
  );
  for (const side of ["before", "after"] as const) {
    const label = side === "before" ? "第一次" : "改进后";
    const selected = complete(side === "before" ? before : after).find(
      (event) =>
        event.payload.message_id === draft[`${side}MessageId`] &&
        event.seq === draft[`${side}EventSeq`],
    );
    check(2, `${side}MessageId`, selected, `请选择${label}回答的完整消息。`);
    const matches = quoteMatches(
      selected?.payload.content ?? "",
      draft[`${side}Quote`],
    );
    check(
      2,
      `${side}Quote`,
      matches.length > 0,
      `请从${label}的完整回答中引用一段准确原文，保留文字和标点。`,
    );
    if (matches.length)
      check(
        2,
        `${side}StartOffset`,
        citation(side),
        `请核对${label}引文的出现位置。`,
      );
  }
  check(2, "judgment", draft.judgment, "请选择改进后的回答是否满足新增要求。");
  check(
    2,
    "explanation",
    draft.explanation.trim(),
    "请结合引用，说明你的判断理由。",
  );
  if (draft.judgment && draft.judgment !== "satisfied")
    check(
      2,
      "nextInstruction",
      draft.nextInstruction.trim(),
      "尚未完全满足要求，请填写下一次准备修改的指令。",
    );
  for (const item of form.challenge.items)
    check(
      3,
      `fact-${item.id}`,
      ["known", "confirm"].includes(draft.facts[item.id]),
      `请判断“${item.label}”是通知已说明，还是需要确认。`,
    );
  check(
    3,
    "instruction",
    draft.instruction.trim(),
    "请给新情境补充一条具体要求。",
  );
  const issues = showValidation
    ? missing.filter((issue) => issue.step === step)
    : [];
  const field = (key: string) => validationAttributes(fieldId(key), issues);
  useLayoutEffect(() => {
    if (focusRequest) focusValidationField(focusRequest.id);
  }, [focusRequest, step]);
  useLayoutEffect(() => {
    if (!focusStepHeading.current) return;
    focusStepHeading.current = false;
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: "nearest" });
  }, [step]);
  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((old) => ({ ...old, [key]: value }));
  }
  function selectRun(key: "beforeId" | "afterId", value: string) {
    setDraft((old) => ({
      ...old,
      [key]: value,
      ...(key === "beforeId" ? { afterId: "" } : {}),
      beforeMessageId: "",
      afterMessageId: "",
      beforeEventSeq: 0,
      afterEventSeq: 0,
      beforeStartOffset: 0,
      afterStartOffset: 0,
      beforeQuote: "",
      afterQuote: "",
      changeKind: "",
      requirement: "",
      judgment: "",
      explanation: "",
      nextInstruction: "",
    }));
  }
  function go(next: number) {
    if (next > lastUnlocked) return;
    focusStepHeading.current = next !== step;
    setFocusRequest(null);
    setShowValidation(false);
    update("step", next);
  }
  function finish() {
    if (!validate(missing)) return;
    if (onValidateSubmission && !onValidateSubmission()) return;
    const answers: Schema["ReflectionAnswers"] = {
      kind: "reflection",
      baseline_run_id: before!.id,
      revised_run_id: after!.id,
      change: {
        category: draft.changeKind as Schema["ReflectionChange"]["category"],
        quote: draft.requirement.trim(),
      },
      evidence: { before: citation("before")!, after: citation("after")! },
      judgment: draft.judgment as Schema["ReflectionAnswers"]["judgment"],
      explanation: draft.explanation,
      next_instruction: draft.nextInstruction,
      challenge: {
        challenge_id: form.challenge.id,
        judgments: form.challenge.items.map((item) => ({
          item_id: item.id,
          decision: draft.facts[item.id] as "known" | "confirm",
        })),
        instruction: draft.instruction,
      },
    };
    void onSubmit(structuredClone(answers));
  }
  function validate(problems: typeof missing) {
    setShowValidation(true);
    if (!problems.length) return true;
    const first = problems[0];
    focusStepHeading.current = false;
    setDraft((old) => ({ ...old, step: first.step }));
    setFocusRequest({ id: first.id });
    return false;
  }
  function download() {
    const text = JSON.stringify(
      {
        attempt_id: attempt.id,
        lesson_version: attempt.lesson_version,
        draft,
        citations: { before: citation("before"), after: citation("after") },
      },
      null,
      2,
    );
    const url = URL.createObjectURL(
      new Blob([text], { type: "application/json;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `复盘草稿-${attempt.id}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="conversation-review" data-testid="conversation-review">
      <p className="review-note">
        {form.prompt}{" "}
        {modelAssessed
          ? "本版本需同时通过真实证据检查和模型对改动、引用解释及新情境指令的内容验收。"
          : "通过代表基础操作及结构化核对完成，解释与改写质量不自动评分。"}
      </p>
      <p className="small muted">
        想听取模型对解释的建议，可先等草稿保存，再到改进后那一轮主动生成
        Tips；它不影响正式通关。
      </p>
      <p className="small muted" role="status">
        {!loaded
          ? "正在读取复盘草稿…"
          : dirty
            ? saving
              ? "正在保存复盘草稿…"
              : "复盘草稿有未保存修改"
            : "复盘草稿已保存"}
        ；草稿保存不代表正式提交。
      </p>
      {error && (
        <div className="notice warning" role="alert">
          {error}
          {conflict && "其他页面已修改草稿，已停止自动保存，不会覆盖。"}
          <button
            type="button"
            className="text-button"
            onClick={() => {
              if (
                !dirty ||
                confirm("重新读取将替换本页修改，请先下载草稿备份。继续？")
              )
                reload();
            }}
          >
            重新读取服务端草稿
          </button>
        </div>
      )}
      <button type="button" className="text-button" onClick={download}>
        <Download size={15} />
        下载当前草稿备份
      </button>
      <nav className="review-steps" aria-label="复盘步骤">
        {steps.map((label, index) => (
          <button
            type="button"
            key={label}
            disabled={!loaded || disabled || index > lastUnlocked}
            title={index > lastUnlocked ? "请先完成前面的步骤" : undefined}
            aria-current={step === index ? "step" : undefined}
            onClick={() => go(index)}
          >
            <span>
              {ready[index] ? (
                <Check size={14} aria-label="已填写" />
              ) : (
                index + 1
              )}
            </span>
            {label}
          </button>
        ))}
      </nav>
      <p className="small muted">完成当前步骤后解锁下一步，可返回前面修改。</p>
      <h3 ref={heading} tabIndex={-1} className="review-step-heading">
        {step + 1}.{" "}
        {
          [
            "选出你想比较的两次尝试",
            "你具体补充了什么要求？",
            "回答有没有照着你的要求做？",
            "换一段通知，试着独立判断",
          ][step]
        }
      </h3>
      <fieldset disabled={disabled || !loaded} className="review-fields">
        <legend className="sr-only">{steps[step]}</legend>
        <ValidationSummary issues={issues} />
        {step === 0 && (
          <>
            <p className="small muted">
              只列出本次实训中已完成且有完整回答的轮次。先选第一次尝试，再选之后的一轮；提交时核对实际运行顺序。
            </p>
            {candidates.length < 2 && (
              <div className="review-empty">
                还需要至少两轮完整对话。
                <a href="#task-input">回到对话，继续尝试 →</a>
              </div>
            )}
            <div className="review-pair">
              {(["before", "after"] as const).map((side) => {
                const run = side === "before" ? before : after;
                return (
                  <article className="review-run" key={side}>
                    <label>
                      {side === "before" ? "第一次尝试" : "改进后的尝试"}
                      <select
                        {...field(side === "before" ? "beforeId" : "afterId")}
                        value={
                          draft[side === "before" ? "beforeId" : "afterId"]
                        }
                        disabled={side === "after" && !before}
                        onChange={(event) =>
                          selectRun(
                            side === "before" ? "beforeId" : "afterId",
                            event.target.value,
                          )
                        }
                      >
                        <option value="">请选择一轮对话</option>
                        {candidates.map((candidate, index) => (
                          <option
                            key={candidate.id}
                            value={candidate.id}
                            disabled={
                              side === "after" &&
                              (!before ||
                                candidate.id === before.id ||
                                candidate.input_text.trim() ===
                                  before.input_text.trim())
                            }
                          >
                            第 {index + 1} 轮 · {dateTime(candidate.created_at)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {run ? (
                      <>
                        <strong className="review-caption">你的任务说明</strong>
                        <Highlight text={run.input_text} quote="" />
                        <details>
                          <summary>查看这一轮的完整回答</summary>
                          {complete(run).map((event) => (
                            <Highlight
                              key={event.seq}
                              text={event.payload.content}
                              quote=""
                            />
                          ))}
                        </details>
                      </>
                    ) : (
                      <p className="muted small">
                        选择后在这里回看指令与回答。
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          </>
        )}
        {step === 1 &&
          (!pairReady ? (
            <p className="review-empty">请先在第一步选好两轮不同的尝试。</p>
          ) : (
            <>
              <div className="review-source">
                <strong>改进后的任务说明</strong>
                <Highlight
                  text={after!.input_text}
                  quote={draft.requirement.trim()}
                />
              </div>
              <label>
                主要改动是什么？
                <select
                  {...field("changeKind")}
                  value={draft.changeKind}
                  onChange={(event) => update("changeKind", event.target.value)}
                >
                  <option value="">选择你这次改动的类型</option>
                  <option value="goal">明确目标</option>
                  <option value="constraint">补充限制</option>
                  <option value="output">规定输出方式</option>
                </select>
              </label>
              <label>
                引用新增或改写的要求
                <textarea
                  {...field("requirement")}
                  rows={2}
                  maxLength={4000}
                  value={draft.requirement}
                  onChange={(event) =>
                    update("requirement", event.target.value)
                  }
                  placeholder="从上面的任务说明中复制一段原文，匹配后会自动标亮。"
                />
              </label>
              {!!draft.requirement.trim() && !requirementReady && (
                <p className="review-inline-error" role="alert">
                  请核对改动类型和引用：这段文字须出现在第二轮指令中，且不能与第一轮完全重复。
                </p>
              )}
            </>
          ))}
        {step === 2 &&
          (!pairReady ? (
            <p className="review-empty">请先在第一步选好两轮不同的尝试。</p>
          ) : (
            <>
              <div className="review-source review-requirement">
                <strong>这次新增的要求</strong>
                <p>{draft.requirement}</p>
              </div>
              <div className="review-pair">
                {(["before", "after"] as const).map((side) => {
                  const available = complete(
                    side === "before" ? before : after,
                  );
                  const selected = available.find(
                    (event) =>
                      event.payload.message_id === draft[`${side}MessageId`] &&
                      event.seq === draft[`${side}EventSeq`],
                  );
                  const text = selected?.payload.content ?? "";
                  const matches = quoteMatches(text, draft[`${side}Quote`]);
                  return (
                    <article className="review-run" key={side}>
                      <strong>
                        {side === "before" ? "第一次的回答" : "改进后的回答"}
                      </strong>
                      <label>
                        {side === "before"
                          ? "第一次引用消息"
                          : "改进后引用消息"}
                        <select
                          {...field(`${side}MessageId`)}
                          value={selected?.seq ?? ""}
                          onChange={(event) => {
                            const message = available.find(
                              (item) => item.seq === Number(event.target.value),
                            );
                            setDraft((old) => ({
                              ...old,
                              [`${side}MessageId`]:
                                message?.payload.message_id ?? "",
                              [`${side}EventSeq`]: message?.seq ?? 0,
                              [`${side}Quote`]: "",
                              [`${side}StartOffset`]: 0,
                            }));
                          }}
                        >
                          <option value="">请选择完整消息</option>
                          {available.map((event) => (
                            <option key={event.seq} value={event.seq}>
                              消息 {event.payload.message_id} · 事件 #
                              {event.seq}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Highlight
                        text={text}
                        quote={draft[`${side}Quote`]}
                        offset={citation(side)?.start_offset}
                      />
                      <label>
                        {side === "before"
                          ? "第一次回答的依据"
                          : "改进后回答的依据"}
                        <textarea
                          {...field(`${side}Quote`)}
                          rows={3}
                          maxLength={4000}
                          value={draft[`${side}Quote`]}
                          onChange={(event) => {
                            const quote = event.target.value;
                            setDraft((old) => ({
                              ...old,
                              [`${side}Quote`]: quote,
                              [`${side}StartOffset`]:
                                quoteMatches(text, quote)[0] ?? 0,
                            }));
                          }}
                          placeholder="复制这条完整消息中与你的要求相关的一段原文。"
                        />
                      </label>
                      {!!draft[`${side}Quote`] && !citation(side) && (
                        <p role="alert" className="review-inline-error">
                          未在这轮完整回答中找到引用，请选择消息并保留原文的文字与标点。
                        </p>
                      )}
                      {matches.length > 0 && (
                        <label>
                          引用位置（{side === "before" ? "第一次" : "改进后"}）
                          <select
                            {...field(`${side}StartOffset`)}
                            value={draft[`${side}StartOffset`]}
                            onChange={(event) =>
                              update(
                                `${side}StartOffset`,
                                Number(event.target.value),
                              )
                            }
                          >
                            {matches.map((offset, index) => (
                              <option key={offset} value={offset}>
                                第 {index + 1} 处 · 码点 {offset}
                              </option>
                            ))}
                          </select>
                        </label>
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
                <legend>改进后的回答是否满足新增要求？</legend>
                {[
                  ["satisfied", "满足要求"],
                  ["partial", "部分满足"],
                  ["unsatisfied", "没有满足"],
                ].map(([value, label]) => (
                  <label className="option" key={value}>
                    <input
                      type="radio"
                      name={`review-judgment-${attempt.id}`}
                      value={value}
                      checked={draft.judgment === value}
                      onChange={() => update("judgment", value)}
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
              <label>
                结合引用，说说你的判断
                <textarea
                  {...field("explanation")}
                  rows={3}
                  maxLength={2000}
                  required
                  value={draft.explanation}
                  onChange={(event) =>
                    update("explanation", event.target.value)
                  }
                  placeholder={
                    modelAssessed
                      ? "结合原文说明新增要求与前后回答的具体对应，或仍存在的问题。"
                      : "指出要求和回答之间的具体对应，或仍然存在的问题。解释不自动评分。"
                  }
                />
              </label>
              {draft.judgment && draft.judgment !== "satisfied" && (
                <label>
                  如果再试一次，你会怎样修改指令？
                  <textarea
                    {...field("nextInstruction")}
                    rows={2}
                    maxLength={2000}
                    value={draft.nextInstruction}
                    onChange={(event) =>
                      update("nextInstruction", event.target.value)
                    }
                  />
                </label>
              )}
            </>
          ))}
        {step === 3 && (
          <>
            <div className="review-source">
              <strong>{form.challenge.title}</strong>
              <p>{form.challenge.notice}</p>
            </div>
            <p>
              你想让 Agent
              整理参加前的准备清单。先判断哪些信息已有依据，哪些还需要确认。
            </p>
            <div className="review-facts">
              {form.challenge.items.map((item) => (
                <label key={item.id}>
                  {item.label}
                  <select
                    {...field(`fact-${item.id}`)}
                    value={draft.facts[item.id] ?? ""}
                    onChange={(event) =>
                      update("facts", {
                        ...draft.facts,
                        [item.id]: event.target.value,
                      })
                    }
                  >
                    <option value="">请根据通知判断</option>
                    <option value="known">通知已说明</option>
                    <option value="confirm">需要确认</option>
                  </select>
                </label>
              ))}
            </div>
            <label>
              给 Agent 补充一条要求
              <textarea
                {...field("instruction")}
                rows={3}
                maxLength={2000}
                required
                value={draft.instruction}
                onChange={(event) => update("instruction", event.target.value)}
              />
            </label>
            <p className="small muted">
              {modelAssessed
                ? "填写这道练习不会调用模型，正式提交时才进行内容验收。"
                : "这道练习不调用模型。系统核对信息判断，不自动评价你的解释和改写质量。"}
            </p>
          </>
        )}
        <div className="review-actions">
          <span className="small muted">
            {ready.filter(Boolean).length} / 4 步已填写
          </span>
          <div className="button-row">
            {step > 0 && (
              <button
                className="button secondary"
                type="button"
                onClick={() => go(step - 1)}
              >
                <ArrowLeft size={15} />
                上一步
              </button>
            )}
            {step < 3 ? (
              <button
                className="button"
                type="button"
                onClick={() => {
                  if (validate(missing.filter((issue) => issue.step <= step)))
                    go(step + 1);
                }}
              >
                下一步
                <ArrowRight size={15} />
              </button>
            ) : (
              <button className="button" type="button" onClick={finish}>
                提交验收
              </button>
            )}
          </div>
        </div>
      </fieldset>
    </div>
  );
}
