"use client";
import { useId, useLayoutEffect, useState } from "react";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { pathId } from "@/lib/api";
import type {
  Attempt,
  Event,
  Lesson,
  Profile,
  Run,
  Schema,
  Submission,
} from "@/lib/types";
import { dateTime, ErrorBox, useAction } from "./ui";
import { ConversationReview } from "./conversation-review";
import {
  focusValidationField,
  validationAttributes,
  ValidationSummary,
  type ValidationIssue,
} from "./form-validation";

export type AssessmentSubmission = {
  assessment?: Schema["AssessmentConsent"];
  learning_reflection?: string;
};

export function SubmissionFeedback({
  submission,
  onViewEvent,
}: {
  submission: Submission;
  onViewEvent?: (runId: string, seq: number) => void;
}) {
  const title =
    submission.model_assessment?.status === "unavailable"
      ? "模型验收未完成，请检查后主动重试。"
      : submission.passed
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
      {"kind" in submission.answers &&
        submission.answers.kind === "reflection" &&
        !submission.model_assessment && (
          <p className="small muted">
            本次采用原版本规则，不含正式模型内容评分。
          </p>
        )}
      {submission.model_assessment && (
        <div className="notice" data-testid="model-assessment-result">
          <strong>{submission.model_assessment.message}</strong>
          <p className="small">
            评分标准 {submission.model_assessment.rubric_version} · 模型调用{" "}
            {submission.model_assessment.usage.model_calls} 次
            {submission.model_assessment.model &&
              ` · ${submission.model_assessment.model}`}
            {submission.model_assessment.error_code &&
              ` · ${submission.model_assessment.error_code}`}
          </p>
          {submission.learning_reflection && (
            <p>我的核对说明：{submission.learning_reflection}</p>
          )}
          {submission.model_assessment.checks.map((check) => (
            <details key={check.criterion_id}>
              <summary>
                {check.passed ? "通过" : "需改进"} · {check.reason}
              </summary>
              {check.suggestion && <p>改进建议：{check.suggestion}</p>}
              {check.citations.map((citation, index) => (
                <blockquote key={index}>
                  {citation.quote}
                  <span className="small muted">（{citation.source_id}）</span>
                </blockquote>
              ))}
            </details>
          ))}
        </div>
      )}
      {"kind" in submission.answers &&
        submission.answers.kind === "reflection" && (
          <div
            className="reflection-submitted"
            data-testid="reflection-submitted"
          >
            <h3>提交时的复盘答案</h3>
            <p>
              两轮运行：<code>{submission.answers.baseline_run_id}</code> →{" "}
              <code>{submission.answers.revised_run_id}</code>
            </p>
            <p>新增要求：{submission.answers.change.quote}</p>
            <p>
              我的判断：
              {
                {
                  satisfied: "满足要求",
                  partial: "部分满足",
                  unsatisfied: "没有满足",
                }[submission.answers.judgment]
              }
            </p>
            <p>判断依据：{submission.answers.explanation || "未填写"}</p>
            <p>后续指令：{submission.answers.next_instruction || "未填写"}</p>
            {(["before", "after"] as const).map((side) => {
              const answers = submission.answers as Schema["ReflectionAnswers"];
              const citation = answers.evidence[side];
              const runId =
                side === "before"
                  ? answers.baseline_run_id
                  : answers.revised_run_id;
              return (
                <div className="evidence" key={side}>
                  <strong>
                    {side === "before" ? "第一次回答引用" : "改进后回答引用"}
                  </strong>
                  <blockquote>{citation.quote}</blockquote>
                  <span>
                    消息 {citation.message_id} · 事件 #{citation.event_seq} ·
                    码点 {citation.start_offset}
                  </span>
                  <a
                    href={`#event-${runId}-${citation.event_seq}`}
                    onClick={
                      onViewEvent
                        ? (event) => {
                            event.preventDefault();
                            onViewEvent(runId, citation.event_seq);
                          }
                        : undefined
                    }
                  >
                    定位这段原文
                  </a>
                </div>
              );
            })}
            <p>小变式：{submission.answers.challenge.challenge_id}</p>
            <ul>
              {submission.answers.challenge.judgments.map((item) => (
                <li key={item.item_id}>
                  {item.item_id}：
                  {item.decision === "known" ? "通知已说明" : "需要确认"}
                </li>
              ))}
            </ul>
            <p>
              补充要求：{submission.answers.challenge.instruction || "未填写"}
            </p>
            <p className="small muted">
              这份答案在提交时冻结，后续草稿修改不会改变本次记录。
              {submission.model_assessment
                ? "本版本同时检查客观证据与模型内容评分；请结合引用核对模型反馈。"
                : "通过代表基础操作及结构化核对，不表示自由解释质量已自动验证。"}
            </p>
          </div>
        )}
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
                          <a
                            href={`#event-${e.run_id}-${e.event_seq}`}
                            onClick={
                              onViewEvent
                                ? (event) => {
                                    event.preventDefault();
                                    onViewEvent(e.run_id, e.event_seq);
                                  }
                                : undefined
                            }
                          >
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
  runs,
  events,
  disabled,
  onSubmit,
  onView,
  onRefresh,
  assessmentProfile,
}: {
  attempt: Attempt;
  lesson: Lesson;
  history: Schema["SubmissionSummary"][];
  runs: Run[];
  events: Record<string, Event[]>;
  disabled: boolean;
  onSubmit: (
    answers: Schema["Answers"],
    options?: AssessmentSubmission,
  ) => Promise<void>;
  onView: (id: string) => Promise<void>;
  onRefresh?: () => Promise<void>;
  assessmentProfile?: Profile;
}) {
  const action = useAction();
  const form = lesson.answer_form;
  const [option, setOption] = useState("");
  const [facts, setFacts] = useState<
    Record<string, { due_date: string; source_id: string }>
  >({});
  const [session, setSession] = useState("");
  const [room, setRoom] = useState("");
  const [learningReflection, setLearningReflection] = useState("");
  const [consentIdentity, setConsentIdentity] = useState<string | null>(null);
  const prefix = useId();
  const fieldId = (key: string) => `${prefix}-${key}`;
  const [showValidation, setShowValidation] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{ id: string } | null>(null);
  const modelAssessment = !!lesson.assessment_policy;
  const needsConsent = modelAssessment && attempt.mode === "live";
  const identity = assessmentProfile
    ? `${assessmentProfile.id}/${assessmentProfile.revision}`
    : null;
  const modelReady =
    !!assessmentProfile &&
    assessmentProfile.credential_status === "configured" &&
    assessmentProfile.connection_check.status === "passed";
  const missing: ValidationIssue[] = [];
  function check(key: string, valid: unknown, message: string) {
    if (!valid) missing.push({ id: fieldId(key), message });
  }
  if (form.kind === "choice")
    check("choice", option, "请选择本关理解题的答案。");
  if (form.kind === "facts")
    for (const task of form.tasks) {
      check(
        `date-${task.task_id}`,
        facts[task.task_id]?.due_date,
        `请填写“${task.label}”的截止日期。`,
      );
      check(
        `source-${task.task_id}`,
        facts[task.task_id]?.source_id,
        `请选择“${task.label}”的依据来源。`,
      );
    }
  if (form.kind === "course") {
    check("session", session, "请根据实际查询结果填写课程日期。");
    check("room", room.trim(), "请根据实际查询结果填写教室。");
  }
  if (needsConsent) {
    if (form.kind !== "reflection")
      check(
        "reflection",
        learningReflection.trim(),
        "请用自己的话填写核对说明。",
      );
    check(
      "model",
      modelReady,
      "请先选择已配置 Key、且通过连接检查的验收模型。",
    );
    if (modelReady)
      check(
        "consent",
        identity !== null && consentIdentity === identity,
        "请确认本次模型验收的内容发送范围和费用，并勾选同意。",
      );
  }
  const issues = showValidation ? missing : [];
  const field = (key: string) => validationAttributes(fieldId(key), issues);
  useLayoutEffect(() => {
    if (focusRequest) focusValidationField(focusRequest.id);
  }, [focusRequest]);
  function validateSubmission() {
    setShowValidation(true);
    if (!missing.length) return true;
    setFocusRequest({ id: missing[0].id });
    return false;
  }
  async function send(answers: Schema["Answers"]) {
    if (!validateSubmission()) return;
    setShowValidation(false);
    const options: AssessmentSubmission = {};
    if (needsConsent && assessmentProfile)
      options.assessment = {
        profile_id: assessmentProfile.id,
        expected_profile_revision: assessmentProfile.revision,
        consent: true,
      };
    if (needsConsent && form.kind !== "reflection")
      options.learning_reflection = learningReflection;
    setConsentIdentity(null);
    await action.act(() => onSubmit(answers, options));
  }
  const showReview = form.kind === "reflection";
  const titles = {
    reflection: "对照两轮尝试，完成复盘验收",
    choice: "核对理解，提交验收",
    facts: "核对事实与来源",
    course: "核对工具与查询结果",
    artifact: "核对授权与保存产物",
  };
  const guidance = {
    reflection: "核对两轮引用，提交正式结构化验收。",
    choice: "运行完成只是一步。请核对材料和结果，再提交本次实训的证据与答案。",
    facts: "系统会核对实际读取记录、日期与原文来源；只勾选材料不代表已经读取。",
    course:
      "系统会核对真实查询记录、课程编号、日期与教室；口头说已查到不能代替工具结果。",
    artifact:
      "系统会核对拒绝未写入、后续批准、保存结果与产物内容；批准不等于已经保存。",
  };
  return (
    <section className="panel" id="submit">
      <div className="panel-heading">
        <div>
          <div className="eyebrow">CHECK YOUR UNDERSTANDING</div>
          <h2>
            {showReview ? "对照两轮尝试，完成复盘验收" : titles[form.kind]}
          </h2>
        </div>
        <span
          className={`badge ${attempt.mode === "demo" ? "demo" : "subtle"}`}
        >
          {attempt.mode === "demo" ? "演示评测" : "正式验收"}
        </span>
      </div>
      <ValidationSummary issues={issues} />
      {modelAssessment && (
        <div className="notice model-assessment-consent">
          <strong>
            {attempt.mode === "demo"
              ? "演示只检查操作证据，不计正式通过"
              : "正式通关需通过客观证据检查和模型内容验收"}
          </strong>
          <details>
            <summary>查看本版本模型验收标准</summary>
            <ul>
              {lesson.assessment_policy!.criteria.map((criterion) => (
                <li key={criterion.id}>
                  <strong>{criterion.title}</strong>：{criterion.description}
                </li>
              ))}
            </ul>
          </details>
          {needsConsent && (
            <>
              <p className="small">
                提交会先核对实际操作证据；全部合格后额外调用一次模型，将课程资料、任务、回答、工具与产物、你的作答及解释发送到所选服务商。每次重新提交都可能产生费用；调用失败不放行、不自动重试。
              </p>
              <p className="small" tabIndex={-1} {...field("model")}>
                验收模型：
                {assessmentProfile
                  ? `${assessmentProfile.name} · ${assessmentProfile.model} · ${assessmentProfile.base_url}`
                  : "请先选择已通过连接检查的模型"}
                {!modelReady && (
                  <a
                    href={`/settings?returnTo=${encodeURIComponent(`/practice/${attempt.id}`)}`}
                  >
                    前往模型设置
                  </a>
                )}
              </p>
              {form.kind !== "reflection" && (
                <label>
                  我的核对说明
                  <textarea
                    {...field("reflection")}
                    maxLength={6000}
                    rows={3}
                    disabled={disabled || action.busy}
                    value={learningReflection}
                    onChange={(event) =>
                      setLearningReflection(event.target.value)
                    }
                    placeholder="你核对了哪些具体依据？回答或产物与原文、工具结果怎样对应？有哪些问题，如何处理？"
                  />
                </label>
              )}
              <label className="check-label">
                <input
                  {...field("consent")}
                  type="checkbox"
                  checked={identity !== null && consentIdentity === identity}
                  disabled={!modelReady || disabled || action.busy}
                  onChange={(event) =>
                    setConsentIdentity(event.target.checked ? identity : null)
                  }
                />
                我同意发送上述内容，并接受本次模型验收可能产生的费用。
              </label>
            </>
          )}
        </div>
      )}
      {form.kind === "reflection" ? (
        <ConversationReview
          attempt={attempt}
          runs={runs}
          events={events}
          disabled={disabled || action.busy}
          form={form}
          modelAssessed={modelAssessment}
          onValidateSubmission={validateSubmission}
          onRefresh={onRefresh}
          onSubmit={async (answers) => {
            await send(answers);
          }}
        />
      ) : (
        <p className="small muted">{guidance[form.kind]}</p>
      )}
      <ErrorBox error={action.error} />
      {!!action.error && needsConsent && (
        <p className="small muted">
          若请求结果不明确，请先查看历史提交，避免重复调用。确认需要重新验收后，可刷新、重新勾选同意并主动提交；新请求可能再次计费。
        </p>
      )}
      {!showReview && (
        <>
          <form
            noValidate
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
              void send(answers);
            }}
          >
            <fieldset disabled={disabled || action.busy}>
              <legend className="sr-only">本关作答</legend>
              {form.kind === "choice" && (
                <>
                  <p>
                    <strong>{form.prompt}</strong>
                  </p>
                  <div tabIndex={-1} {...field("choice")}>
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
                  </div>
                </>
              )}
              {form.kind === "facts" &&
                form.tasks.map((t) => (
                  <div className="fact-row" key={t.task_id}>
                    <strong>{t.label}</strong>
                    <label>
                      截止日期
                      <input
                        {...field(`date-${t.task_id}`)}
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
                        {...field(`source-${t.task_id}`)}
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
                        {...field("session")}
                        required
                        type="date"
                        value={session}
                        onChange={(e) => setSession(e.target.value)}
                      />
                    </label>
                    <label>
                      教室
                      <input
                        {...field("room")}
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
        </>
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
