"use client";
import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Download } from "lucide-react";
import { quoteMatches } from "@/lib/reflection";
import {
  useReflectionDraft,
  type ReflectionDraftData as Draft,
} from "@/lib/use-reflection-draft";
import type { Attempt, Event, Run, Schema } from "@/lib/types";
import { dateTime } from "./ui";
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
}: {
  attempt: Attempt;
  runs: Run[];
  events: Record<string, Event[]>;
  disabled: boolean;
  form: Omit<Schema["ReflectionForm"], "kind">;
  onSubmit: (answers: Schema["ReflectionAnswers"]) => Promise<void>;
  onRefresh?: () => Promise<void>;
}) {
  const { draft, setDraft, loaded, dirty, saving, error, conflict, reload } =
    useReflectionDraft(attempt, onRefresh);
  const [issues, setIssues] = useState<string[]>([]);
  const heading = useRef<HTMLHeadingElement>(null);
  const step = draft.step;
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
  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((old) => ({ ...old, [key]: value }));
    setIssues([]);
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
    setIssues([]);
  }
  function go(next: number) {
    update("step", next);
    requestAnimationFrame(() => {
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView({ block: "nearest" });
    });
  }
  function finish() {
    const problems: string[] = [];
    if (!pairReady) problems.push("请选择前后两轮已完成、任务说明不同的尝试。");
    if (!requirementReady)
      problems.push(
        "请从改进后的指令中引用一处新增或改写的要求，并选择改动类型。",
      );
    if (!evidenceReady)
      problems.push(
        "请引用两次回答的完整消息原文并选择引用位置；未满足要求时再写一条改进指令。",
      );
    if (!draft.explanation.trim()) problems.push("请写下你的判断理由。");
    if (!draft.instruction.trim()) problems.push("请给新情境写一条要求。");
    if (
      !form.challenge.items.every((item) =>
        ["known", "confirm"].includes(draft.facts[item.id]),
      )
    )
      problems.push("请完成通知信息判断。");
    setIssues(problems);
    if (problems.length) return;
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
        通过代表基础操作及结构化核对完成，解释与改写质量不自动评分。
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
            disabled={!loaded || disabled}
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
              <fieldset className="review-judgment">
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
                  rows={3}
                  maxLength={2000}
                  required
                  value={draft.explanation}
                  onChange={(event) =>
                    update("explanation", event.target.value)
                  }
                  placeholder="指出要求和回答之间的具体对应，或仍然存在的问题。解释不自动评分。"
                />
              </label>
              {draft.judgment && draft.judgment !== "satisfied" && (
                <label>
                  如果再试一次，你会怎样修改指令？
                  <textarea
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
                rows={3}
                maxLength={2000}
                required
                value={draft.instruction}
                onChange={(event) => update("instruction", event.target.value)}
              />
            </label>
            <p className="small muted">
              这道练习不调用模型。系统核对信息判断，不自动评价你的解释和改写质量。
            </p>
          </>
        )}
        {issues.length > 0 && (
          <div className="notice warning" role="alert">
            <strong>还有这些地方需要核对</strong>
            <ul>
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
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
                disabled={!ready[step]}
                onClick={() => go(step + 1)}
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
