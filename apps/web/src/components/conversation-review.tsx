"use client";
import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Download } from "lucide-react";
import { messages } from "@/lib/events";
import type { Attempt, Event, Run } from "@/lib/types";
import { dateTime } from "./ui";

const steps = ["选择两轮", "标出改动", "核对回答", "换个情境"];
const variation = [
  { id: "start", label: "开始时间", known: true },
  { id: "place", label: "集合地点", known: true },
  { id: "end", label: "结束时间", known: false },
  { id: "signup", label: "是否需要报名", known: false },
] as const;
type Draft = {
  beforeId: string;
  afterId: string;
  changeKind: string;
  requirement: string;
  beforeQuote: string;
  afterQuote: string;
  judgment: string;
  explanation: string;
  nextInstruction: string;
  facts: Record<string, string>;
  instruction: string;
};
const emptyDraft: Draft = {
  beforeId: "",
  afterId: "",
  changeKind: "",
  requirement: "",
  beforeQuote: "",
  afterQuote: "",
  judgment: "",
  explanation: "",
  nextInstruction: "",
  facts: {},
  instruction: "",
};

function Highlight({ text, quote }: { text: string; quote: string }) {
  const value = quote.trim();
  const index = value ? text.indexOf(value) : -1;
  return (
    <p className="review-source-text">
      {index < 0 ? (
        text
      ) : (
        <>
          {text.slice(0, index)}
          <mark>{value}</mark>
          {text.slice(index + value.length)}
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
}: {
  attempt: Attempt;
  runs: Run[];
  events: Record<string, Event[]>;
  disabled: boolean;
}) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [issues, setIssues] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const candidates = runs
    .filter(
      (run) =>
        run.attempt_id === attempt.id &&
        run.mode === attempt.mode &&
        run.status === "completed" &&
        messages(events[run.id] ?? []).some((m) => m.complete && m.text.trim()),
    )
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const before = candidates.find((r) => r.id === draft.beforeId);
  const after = candidates.find((r) => r.id === draft.afterId);
  const output = (run?: Run) =>
    run ? messages(events[run.id] ?? []).filter((m) => m.complete) : [];
  const beforeMessages = output(before);
  const afterMessages = output(after);
  const beforeText = beforeMessages.map((m) => m.text).join("\n\n");
  const afterText = afterMessages.map((m) => m.text).join("\n\n");
  const quoted = (items: ReturnType<typeof output>, value: string) =>
    !!value.trim() && items.some((m) => m.text.includes(value.trim()));
  const pairReady = !!(
    before &&
    after &&
    candidates.indexOf(before) < candidates.indexOf(after) &&
    before.input_text.trim() !== after.input_text.trim()
  );
  const requirementReady = !!(
    pairReady &&
    draft.changeKind &&
    draft.requirement.trim() &&
    after?.input_text.includes(draft.requirement.trim()) &&
    !before?.input_text.includes(draft.requirement.trim())
  );
  const evidenceReady = !!(
    pairReady &&
    quoted(beforeMessages, draft.beforeQuote) &&
    quoted(afterMessages, draft.afterQuote) &&
    draft.judgment &&
    draft.explanation.trim() &&
    (draft.judgment === "满足要求" || draft.nextInstruction.trim())
  );
  const variationReady =
    variation.every(
      (item) => draft.facts[item.id] === (item.known ? "known" : "confirm"),
    ) && !!draft.instruction.trim();
  const ready = [pairReady, requirementReady, evidenceReady, variationReady];
  const stamp = JSON.stringify({ draft, beforeText, afterText });
  const reviewed = ready.every(Boolean) && confirmed === stamp;

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((old) => ({ ...old, [key]: value }));
    setIssues([]);
  }
  function selectRun(key: "beforeId" | "afterId", value: string) {
    setDraft((old) => ({
      ...old,
      [key]: value,
      ...(key === "beforeId" ? { afterId: "" } : {}),
      changeKind: "",
      requirement: "",
      beforeQuote: "",
      afterQuote: "",
      judgment: "",
      explanation: "",
      nextInstruction: "",
    }));
    setIssues([]);
  }
  function go(next: number) {
    setStep(next);
    setIssues([]);
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
        "请引用两次回答的原文，写出判断依据；未满足要求时再写一条改进指令。",
      );
    for (const item of variation) {
      if (draft.facts[item.id] !== (item.known ? "known" : "confirm"))
        problems.push(`“${item.label}”的判断还需核对，请回看活动通知。`);
    }
    if (!draft.instruction.trim())
      problems.push("请给新情境补充一条任务要求。");
    setIssues(problems);
    if (!problems.length) setConfirmed(stamp);
  }
  function download() {
    const reference = (run: Run | undefined, quote: string) => {
      const event = (events[run?.id ?? ""] ?? []).find(
        (e) =>
          e.kind === "message.completed" &&
          e.payload.content.includes(quote.trim()),
      );
      return `${run?.id ?? ""} / 事件 #${event?.seq ?? ""}`;
    };
    const text = [
      "# 第一关复盘验收记录（本地预览，不计正式成绩）",
      `实训：${attempt.id}；课程：${attempt.lesson_id}@${attempt.lesson_version}；模式：${attempt.mode}`,
      "## 两次任务说明",
      `第一次（${before?.id}）：\n${before?.input_text}`,
      `改进后（${after?.id}）：\n${after?.input_text}`,
      `改动类型：${draft.changeKind}\n新增要求：${draft.requirement}`,
      "## 回答依据",
      `第一次：${draft.beforeQuote}\n引用：${reference(before, draft.beforeQuote)}`,
      `改进后：${draft.afterQuote}\n引用：${reference(after, draft.afterQuote)}`,
      `我的判断：${draft.judgment}\n依据：${draft.explanation}`,
      `下一次修改：${draft.nextInstruction || "暂未填写"}`,
      "## 换个情境",
      "活动通知：周六 10:00 在图书馆一楼集合，请携带学生证。",
      ...variation.map(
        (item) =>
          `${item.label}：${draft.facts[item.id] === "known" ? "通知已说明" : "需要确认"}`,
      ),
      `补充的要求：${draft.instruction}`,
      "本页仅核对引用和小练习答案，未对解释、改写质量评分；正式成绩以课程验收结果为准。",
    ].join("\n\n");
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/markdown;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `第一关复盘-${attempt.id}.md`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="conversation-review" data-testid="conversation-review">
      <p className="review-note">
        从自己的对话找依据，不必把第二次回答说成更好。当前预览仅核对引用和信息判断，解释与改写尚未评分，不生成正式通关成绩。草稿仅在本页保留，刷新或离开前可下载。
      </p>
      <nav className="review-steps" aria-label="复盘步骤">
        {steps.map((label, index) => (
          <button
            type="button"
            key={label}
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
      <fieldset disabled={disabled} className="review-fields">
        <legend className="sr-only">{steps[step]}</legend>
        {step === 0 && (
          <>
            <p className="small muted">
              只列出本次实训中已完成且有完整回答的轮次。先选第一次尝试，再选之后的一轮。
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
                        onChange={(e) =>
                          selectRun(
                            side === "before" ? "beforeId" : "afterId",
                            e.target.value,
                          )
                        }
                      >
                        <option value="">请选择一轮对话</option>
                        {candidates.map((r, index) => (
                          <option
                            key={r.id}
                            value={r.id}
                            disabled={
                              side === "after" &&
                              (!before ||
                                index <= candidates.indexOf(before) ||
                                r.input_text.trim() ===
                                  before.input_text.trim())
                            }
                          >
                            第 {index + 1} 轮 · {dateTime(r.created_at)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {side === "after" &&
                      before &&
                      !candidates.some(
                        (candidate) =>
                          candidates.indexOf(candidate) >
                            candidates.indexOf(before) &&
                          candidate.input_text.trim() !==
                            before.input_text.trim(),
                      ) && (
                        <p className="small muted">
                          这轮之后还没有不同的完整尝试。可以换一轮作为第一次，或回到对话继续。
                        </p>
                      )}
                    {run ? (
                      <>
                        <strong className="review-caption">你的任务说明</strong>
                        <Highlight text={run.input_text} quote="" />
                        <details>
                          <summary>查看这一轮的完整回答</summary>
                          <Highlight
                            text={side === "before" ? beforeText : afterText}
                            quote=""
                          />
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
        {step === 1 && (
          <>
            {!pairReady ? (
              <p className="review-empty">请先在第一步选好两轮不同的尝试。</p>
            ) : (
              <>
                <div className="review-source">
                  <strong>改进后的任务说明</strong>
                  <Highlight
                    text={after!.input_text}
                    quote={draft.requirement}
                  />
                </div>
                <label>
                  主要改动是什么？
                  <select
                    value={draft.changeKind}
                    onChange={(e) => update("changeKind", e.target.value)}
                  >
                    <option value="">选择你这次改动的类型</option>
                    <option>明确目标</option>
                    <option>补充限制</option>
                    <option>规定输出方式</option>
                  </select>
                </label>
                <label>
                  引用新增或改写的要求
                  <textarea
                    rows={2}
                    maxLength={4000}
                    value={draft.requirement}
                    onChange={(e) => update("requirement", e.target.value)}
                    placeholder="从上面的任务说明中复制一段原文，匹配后会自动标亮。"
                  />
                </label>
                {!!draft.requirement.trim() && !requirementReady && (
                  <p className="review-inline-error" role="alert">
                    请核对改动类型和引用：这段文字须出现在第二轮指令中，且不能与第一轮完全重复。
                  </p>
                )}
              </>
            )}
          </>
        )}
        {step === 2 && (
          <>
            {!pairReady ? (
              <p className="review-empty">请先在第一步选好两轮不同的尝试。</p>
            ) : (
              <>
                {draft.requirement.trim() && (
                  <div className="review-source review-requirement">
                    <strong>这次新增的要求</strong>
                    <p>{draft.requirement}</p>
                  </div>
                )}
                <div className="review-pair">
                  {(["before", "after"] as const).map((side) => {
                    const key =
                      side === "before" ? "beforeQuote" : "afterQuote";
                    const text = side === "before" ? beforeText : afterText;
                    return (
                      <article className="review-run" key={side}>
                        <strong>
                          {side === "before" ? "第一次的回答" : "改进后的回答"}
                        </strong>
                        <Highlight text={text} quote={draft[key]} />
                        <label>
                          {side === "before"
                            ? "第一次回答的依据"
                            : "改进后回答的依据"}
                          <textarea
                            rows={3}
                            maxLength={4000}
                            value={draft[key]}
                            onChange={(e) => update(key, e.target.value)}
                            placeholder="复制这次回答中与你的要求相关的一段原文。"
                          />
                        </label>
                        {!!draft[key].trim() &&
                          !quoted(
                            side === "before" ? beforeMessages : afterMessages,
                            draft[key],
                          ) && (
                            <p role="alert" className="review-inline-error">
                              未在这轮完整回答中找到引用，请保留原文的文字与标点。
                            </p>
                          )}
                      </article>
                    );
                  })}
                </div>
                <fieldset className="review-judgment">
                  <legend>改进后的回答是否满足新增要求？</legend>
                  {["满足要求", "部分满足", "没有满足"].map((value) => (
                    <label className="option" key={value}>
                      <input
                        type="radio"
                        name={`review-judgment-${attempt.id}`}
                        value={value}
                        checked={draft.judgment === value}
                        onChange={() => update("judgment", value)}
                      />
                      {value}
                    </label>
                  ))}
                </fieldset>
                <label>
                  结合引用，说说你的判断
                  <textarea
                    rows={3}
                    maxLength={2000}
                    value={draft.explanation}
                    onChange={(e) => update("explanation", e.target.value)}
                    placeholder="指出要求和回答之间的具体对应，或仍然存在的问题。"
                  />
                </label>
                {draft.judgment && draft.judgment !== "满足要求" && (
                  <label>
                    如果再试一次，你会怎样修改指令？
                    <textarea
                      rows={2}
                      maxLength={2000}
                      value={draft.nextInstruction}
                      onChange={(e) =>
                        update("nextInstruction", e.target.value)
                      }
                      placeholder="写出准备补充或调整的一条要求。"
                    />
                  </label>
                )}
              </>
            )}
          </>
        )}
        {step === 3 && (
          <>
            <div className="review-source">
              <strong>活动通知 · 虚构练习</strong>
              <p>周六 10:00 在图书馆一楼集合，请携带学生证。</p>
            </div>
            <p>
              你想让 Agent
              整理参加前的准备清单。先判断哪些信息已有依据，哪些还需要确认。
            </p>
            <div className="review-facts">
              {variation.map((item) => (
                <label key={item.id}>
                  {item.label}
                  <select
                    value={draft.facts[item.id] ?? ""}
                    onChange={(e) =>
                      update("facts", {
                        ...draft.facts,
                        [item.id]: e.target.value,
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
                value={draft.instruction}
                onChange={(e) => update("instruction", e.target.value)}
                placeholder="想一想：怎样让它处理通知中没有提供的信息？"
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
                核对并完成复盘
              </button>
            )}
          </div>
        </div>
        {reviewed && (
          <div className="review-summary" role="status">
            <strong>复盘已整理</strong>
            <p>
              引用已关联，两类信息判断已核对。解释和改写尚未评分，这不代表正式通过。
            </p>
            <div className="button-row">
              <button
                type="button"
                className="button secondary"
                onClick={download}
              >
                <Download size={15} />
                下载复盘记录
              </button>
              <a href="#task-input" className="text-button">
                回到对话继续改进 ↑
              </a>
            </div>
          </div>
        )}
      </fieldset>
    </div>
  );
}
