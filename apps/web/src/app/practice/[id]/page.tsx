"use client";
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  Download,
  FileText,
  Send,
  Square,
  RotateCcw,
} from "lucide-react";
import { allPages, api, pathId } from "@/lib/api";
import { activeRun, eventRun, mergeEvent, streamEvents } from "@/lib/events";
import type {
  Attempt,
  Event,
  EventPage,
  Lesson,
  Profile,
  Run,
  Schema,
  Submission,
} from "@/lib/types";
import {
  ErrorBox,
  Heading,
  Loading,
  Markdown,
  useAction,
} from "@/components/ui";
import { RunView } from "@/components/run-view";
import { SubmissionFeedback, SubmissionPanel } from "@/components/feedback";

async function historyEvents(run: Run): Promise<Event[]> {
  const result: Event[] = [];
  let after = 0,
    more = true;
  while (more) {
    const page = await api<EventPage>(
      `/runs/${pathId(run.id)}/event-history?after_seq=${after}&limit=500`,
    );
    result.push(...page.items);
    after = page.next_after_seq;
    more = page.has_more;
  }
  return result;
}
export default function PracticePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <Practice key={id} id={id} />;
}
function Practice({ id }: { id: string }) {
  const router = useRouter();
  const action = useAction();
  const [loadError, setLoadError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [events, setEvents] = useState<Record<string, Event[]>>({});
  const [files, setFiles] = useState<Schema["FileInfo"][]>([]);
  const [preview, setPreview] = useState<Schema["FilePreview"] | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [input, setInput] = useState("");
  const [settings, setSettings] = useState<Schema["Settings"]>({
    system_instruction: "",
    temperature: 0.3,
  });
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [submissions, setSubmissions] = useState<Schema["SubmissionSummary"][]>(
    [],
  );
  const [feedback, setFeedback] = useState<Submission | null>(null);
  const [connection, setConnection] = useState("");
  const [intro, setIntro] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [download, setDownload] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const endpoint = `/attempts/${pathId(id)}`;
  const refresh = useCallback(
    async (initial = false) => {
      const a = await api<Attempt>(endpoint);
      const [l, r, f, p, s] = await Promise.all([
        api<Lesson>(
          `/lessons/${pathId(a.lesson_id)}?version=${encodeURIComponent(a.lesson_version)}`,
        ),
        allPages<Run>(`${endpoint}/runs`),
        api<Schema["FileList"]>(`${endpoint}/files`),
        api<Schema["ProfileList"]>("/model-profiles"),
        allPages<Schema["SubmissionSummary"]>(`${endpoint}/submissions`),
      ]);
      // Rebuild visible history from persisted events before subscribing after its cursor.
      const histories = await Promise.all(
        r.map(async (run) => [run.id, await historyEvents(run)] as const),
      );
      setAttempt(a);
      setLesson(l);
      setRuns(
        r
          .reverse()
          .map((run) =>
            (histories.find(([runId]) => runId === run.id)?.[1] ?? []).reduce(
              eventRun,
              run,
            ),
          ),
      );
      setFiles(f.items);
      setProfiles(p.items);
      setSubmissions(s);
      setEvents((old) => {
        const next = { ...old };
        for (const [runId, items] of histories) {
          let merged = items;
          for (const e of old[runId] ?? []) merged = mergeEvent(merged, e);
          next[runId] = merged;
        }
        return next;
      });
      if (initial) {
        setSettings(a.settings);
        setSelectedFiles(a.selected_file_ids);
        setProfileId(
          p.items.find(
            (p) =>
              p.credential_status === "configured" &&
              p.connection_check.status === "passed",
          )?.id ?? "",
        );
        if (a.latest_submission_id)
          setFeedback(
            await api<Submission>(
              `/submissions/${pathId(a.latest_submission_id)}`,
            ),
          );
      }
    },
    [endpoint],
  );
  useEffect(() => {
    let cancelled = false;
    void refresh(true).catch((e) => {
      if (!cancelled) setLoadError(e);
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);
  const active = activeRun(runs);
  const activeId = active?.id;
  useEffect(() => {
    if (!activeId) return;
    const controller = new AbortController();
    const after = (events[activeId] ?? []).at(-1)?.seq ?? 0;
    void streamEvents(
      activeId,
      after,
      controller.signal,
      (event) => {
        setEvents((old) => ({
          ...old,
          [activeId]: mergeEvent(old[activeId] ?? [], event),
        }));
        setRuns((old) =>
          old.map((r) => (r.id === activeId ? eventRun(r, event) : r)),
        );
        if (event.kind.startsWith("run.") && event.kind !== "run.started") {
          setSyncing(true);
          void refresh()
            .catch(setLoadError)
            .finally(() => setSyncing(false));
        }
      },
      setConnection,
    );
    return () => controller.abort();
    // Only a run identity changes the subscription; cursor advances inside streamEvents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, refresh]);
  if (!attempt || !lesson)
    return (
      <>
        <ErrorBox
          error={loadError}
          retry={() => {
            setLoadError(null);
            void refresh(true).catch(setLoadError);
          }}
        />
        {!loadError && <Loading />}
      </>
    );
  const historical = attempt.status === "superseded";
  const dirty =
    JSON.stringify(settings) !== JSON.stringify(attempt.settings) ||
    JSON.stringify([...selectedFiles].sort()) !==
      JSON.stringify([...attempt.selected_file_ids].sort());
  const selectedProfile = profiles.find((p) => p.id === profileId);
  const ready =
    attempt.mode === "demo" ||
    (selectedProfile?.connection_check.status === "passed" &&
      selectedProfile.credential_status === "configured");
  async function submit(answers: Schema["Answers"]) {
    const result = await api<Submission>("/submissions", {
      method: "POST",
      idempotent: true,
      body: {
        attempt_id: id,
        expected_attempt_revision: attempt!.revision,
        answers,
      } satisfies Schema["SubmissionCreate"],
    });
    setFeedback(result);
    await refresh();
  }
  return (
    <>
      <div className="practice-breadcrumb">
        <Link className="back-link" href="/">
          <ArrowLeft size={15} />
          全部课程
        </Link>
        <span>/ 第 {lesson.order} 关 / 实训</span>
        <button className="text-button" onClick={() => setIntro((v) => !v)}>
          <BookOpen size={15} />
          {intro ? "收起导读" : "查看本关介绍"}
        </button>
      </div>
      <Heading
        eyebrow={`EXPERIMENT ${String(lesson.order).padStart(2, "0")} / LEARNING IN ACTION`}
        title={lesson.title}
        description={`v${attempt.lesson_version} · ${historical ? "历史实验，只读回看" : attempt.progress === "completed" ? "本实训已正式通过" : "按照任务尝试，完成后提交验收"}`}
      >
        <span
          className={`badge ${attempt.mode === "demo" ? "demo" : "success"}`}
        >
          {attempt.mode === "demo"
            ? "演示模式 · 不计正式通过"
            : "正式实训 · 使用自备模型"}
        </span>
      </Heading>
      <ErrorBox error={loadError} />
      <ErrorBox error={action.error} />
      {attempt.mode === "demo" && (
        <div className="notice warning">
          这是确定性演示，用来熟悉操作。演示检查通过不会计入正式课程完成。
          <Link href={`/lessons/${pathId(lesson.id)}`}>
            返回导读开始正式实训 →
          </Link>
        </div>
      )}
      {historical && (
        <div className="notice warning">
          此实验已重新开始，旧记录仍可回看和导出。
          {attempt.reset_to_attempt_id && (
            <Link href={`/practice/${pathId(attempt.reset_to_attempt_id)}`}>
              继续新的实验 →
            </Link>
          )}
        </div>
      )}
      {intro && (
        <article className="panel intro-review">
          <Markdown text={lesson.intro_markdown} />
        </article>
      )}
      <div className="practice-layout">
        <aside className="practice-controls">
          <section className="panel task-panel">
            <div className="eyebrow">01 / YOUR MISSION</div>
            <h2>这一关，做什么？</h2>
            <Markdown text={lesson.task_markdown} />
            <details>
              <summary>完成标准</summary>
              <ul>
                {lesson.completion_criteria.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </details>
          </section>
          <section className="panel">
            <div className="eyebrow">02 / PREPARE</div>
            <h2>材料与 Agent 设置</h2>
            <fieldset disabled={historical || action.busy}>
              <legend className="sr-only">下一轮运行设置</legend>
              <div className="material-list">
                {lesson.materials.map((m) => (
                  <div key={m.id}>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={selectedFiles.includes(m.id)}
                        onChange={(e) =>
                          setSelectedFiles(
                            e.target.checked
                              ? [...selectedFiles, m.id]
                              : selectedFiles.filter((x) => x !== m.id),
                          )
                        }
                      />
                      <FileText size={15} />
                      {m.title}
                    </label>
                    <button
                      className="text-button"
                      onClick={() =>
                        void action.act(async () =>
                          setPreview(
                            await api<Schema["FilePreview"]>(
                              `${endpoint}/files/${pathId(m.id)}`,
                            ),
                          ),
                        )
                      }
                    >
                      预览原文
                    </button>
                  </div>
                ))}
              </div>
              <p className="field-help">
                选中只是允许读取。实际读过与否，请查看工具执行结果。第一关直接使用任务内通知，无需读取工具。
              </p>
              <details>
                <summary>调整 Agent 的工作方式</summary>
                <label>
                  系统指令
                  <textarea
                    maxLength={2000}
                    rows={4}
                    value={settings.system_instruction}
                    disabled={
                      !lesson.settings_policy.editable_fields.includes(
                        "system_instruction",
                      )
                    }
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        system_instruction: e.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  变化程度（temperature）：{settings.temperature}
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={settings.temperature}
                    disabled={
                      !lesson.settings_policy.editable_fields.includes(
                        "temperature",
                      )
                    }
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        temperature: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <p className="field-help">
                  数值越低通常越稳定，不保证内容正确。
                </p>
              </details>
              <button
                className="button secondary full"
                disabled={historical || action.busy || !dirty}
                onClick={() =>
                  void action.act(async () => {
                    const a = await api<Attempt>(endpoint, {
                      method: "PATCH",
                      body: {
                        expected_revision: attempt.revision,
                        settings,
                        selected_file_ids: selectedFiles,
                      } satisfies Schema["AttemptUpdate"],
                    });
                    setAttempt(a);
                  })
                }
              >
                {dirty ? "保存下一轮设置" : "设置已同步"}
              </button>
            </fieldset>
            <p className="field-help">
              修改仅影响下一轮；当前运行使用已冻结的设置。
            </p>
            <div className="tools-allowed">
              <strong>本关可用工具</strong>
              <p>
                {lesson.allowed_tools.length
                  ? lesson.allowed_tools.join(" / ")
                  : "本关先练习任务表达，不调用工具。"}
              </p>
            </div>
          </section>
          <section className="panel artifact-panel">
            <div className="eyebrow">OUTPUT / CHECK THE RESULT</div>
            <h2>产物与原文预览</h2>
            {files.filter((f) => f.kind === "artifact").length === 0 && (
              <p className="muted small">
                尚无产物。第四关批准保存并实际执行成功后会出现在这里。
              </p>
            )}
            {files
              .filter((f) => f.kind === "artifact")
              .map((f) => (
                <div className="file-row" key={f.id}>
                  <button
                    className="text-button"
                    disabled={action.busy}
                    onClick={() =>
                      void action.act(async () =>
                        setPreview(
                          await api<Schema["FilePreview"]>(
                            `${endpoint}/files/${pathId(f.id)}`,
                          ),
                        ),
                      )
                    }
                  >
                    <FileText size={15} />
                    {f.title}
                  </button>
                  <a
                    aria-label={`下载 ${f.title}`}
                    href={`/api/v1${endpoint}/files/${pathId(f.id)}/download`}
                  >
                    <Download size={16} />
                  </a>
                </div>
              ))}
            {preview && (
              <div className="file-preview">
                <div>
                  <strong>{preview.file.title}</strong>
                  <button
                    className="text-button"
                    onClick={() => setPreview(null)}
                  >
                    关闭预览
                  </button>
                </div>
                <pre>{preview.content}</pre>
                {preview.truncated && (
                  <p className="notice warning">
                    预览已截断，仅显示前 20000 字符。请下载完整文件。
                  </p>
                )}
                <a
                  className="text-button"
                  href={`/api/v1${endpoint}/files/${pathId(preview.file.id)}/download`}
                >
                  下载完整文件 <Download size={14} />
                </a>
              </div>
            )}
          </section>
        </aside>
        <div className="practice-main">
          <section className="panel conversation">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">03 / TRY & OBSERVE</div>
                <h2>与 Agent 一起完成任务</h2>
              </div>
              <span className="small muted">{runs.length} 轮尝试</span>
            </div>
            <div className="conversation-history">
              {!runs.length && (
                <div className="conversation-empty">
                  <span className="agent-mark">✳</span>
                  <h3>先用自己的话，说出你的任务。</h3>
                  <p>
                    从简单要求开始，再补充目标、约束和输出格式。
                    <br />
                    你可以查看每一轮回答，比较哪些变化更有帮助。
                  </p>
                </div>
              )}
              {runs.map((run) => (
                <RunView key={run.id} run={run} events={events[run.id] ?? []} />
              ))}
            </div>
            {connection && (
              <p className="stream-status" role="status">
                <span className="local-dot" />
                {connection}
              </p>
            )}
            {!historical && (
              <div className="composer">
                <div className="model-picker">
                  {attempt.mode === "live" ? (
                    <>
                      <label>
                        本轮模型
                        <select
                          aria-label="本轮模型"
                          value={profileId}
                          onChange={(e) => setProfileId(e.target.value)}
                          disabled={!!active || action.busy}
                        >
                          <option value="">选择已检查的模型</option>
                          {profiles.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                              {p.connection_check.status !== "passed" ||
                              p.credential_status !== "configured"
                                ? "（需检查）"
                                : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Link
                        href={`/settings?returnTo=${encodeURIComponent(`/practice/${id}`)}`}
                      >
                        模型设置 ↗
                      </Link>
                    </>
                  ) : (
                    <span className="badge demo">
                      无 Key 演示，按预设流程执行
                    </span>
                  )}
                </div>
                {!ready && (
                  <div className="notice warning">
                    请先配置模型、输入 Key 并通过连接检查。
                    <Link
                      href={`/settings?returnTo=${encodeURIComponent(`/practice/${id}`)}`}
                    >
                      去设置 →
                    </Link>
                  </div>
                )}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action.act(async () => {
                      const run = await api<Run>("/runs", {
                        method: "POST",
                        idempotent: true,
                        body: {
                          attempt_id: id,
                          expected_attempt_revision: attempt.revision,
                          profile_id:
                            attempt.mode === "demo" ? null : profileId,
                          input_text: input.trim(),
                        } satisfies Schema["RunCreate"],
                      });
                      setRuns((old) =>
                        old.some((r) => r.id === run.id) ? old : [...old, run],
                      );
                      setInput("");
                    });
                  }}
                >
                  <label htmlFor="task-input" className="sr-only">
                    任务说明
                  </label>
                  <textarea
                    id="task-input"
                    required
                    maxLength={10000}
                    rows={4}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="你希望 Agent 做什么？有什么限制？结果应该是什么样子？"
                    disabled={!!active || action.busy}
                  />
                  <div className="composer-bottom">
                    <span>发送会调用你的模型，可能消耗额度。</span>
                    {active ? (
                      <button
                        className="button secondary"
                        type="button"
                        disabled={action.busy}
                        onClick={() =>
                          void action.act(async () => {
                            const run = await api<Run>(
                              `/runs/${pathId(active.id)}/cancel`,
                              { method: "POST", body: {} },
                            );
                            setRuns((old) =>
                              old.map((r) => (r.id === run.id ? run : r)),
                            );
                            if (!activeRun([run])) await refresh();
                          })
                        }
                      >
                        <Square size={13} />
                        停止本轮
                      </button>
                    ) : (
                      <button
                        className="button"
                        disabled={
                          !ready ||
                          action.busy ||
                          syncing ||
                          dirty ||
                          !input.trim()
                        }
                      >
                        <Send size={15} />
                        {action.busy ? "正在发送…" : "发送任务"}
                      </button>
                    )}
                  </div>
                  {dirty && (
                    <p className="small amber-text">
                      有未保存的材料或设置，请先保存下一轮设置。
                    </p>
                  )}
                </form>
              </div>
            )}
          </section>
          <SubmissionPanel
            attempt={attempt}
            lesson={lesson}
            history={submissions}
            disabled={!!active || historical || dirty || syncing}
            onSubmit={submit}
            onView={async (id) =>
              setFeedback(await api<Submission>(`/submissions/${pathId(id)}`))
            }
          />
          {feedback && (
            <section className="panel">
              <SubmissionFeedback submission={feedback} />
            </section>
          )}
          <section className="practice-utilities">
            <div>
              <strong>保留这次学习，或重新尝试</strong>
              <p>导出不会包含模型连接配置或 Key。重新开始会保留这份旧记录。</p>
            </div>
            <div className="button-row">
              <button
                className="button secondary"
                disabled={!!active || action.busy}
                onClick={() =>
                  void action.act(async () => {
                    const ex = await api<Schema["Export"]>(
                      `${endpoint}/exports`,
                      {
                        method: "POST",
                        idempotent: true,
                        body: { expected_revision: attempt.revision },
                      },
                    );
                    setDownload(`/api/v1/exports/${pathId(ex.id)}/download`);
                  })
                }
              >
                <Download size={15} />
                导出学习记录
              </button>
              {!historical && (
                <button
                  className="text-button"
                  disabled={action.busy}
                  onClick={() => setResetConfirm((v) => !v)}
                >
                  <RotateCcw size={14} />
                  重新开始
                </button>
              )}
            </div>
            {download && (
              <a className="button secondary" href={download}>
                学习记录已就绪，下载 ZIP
              </a>
            )}
            {resetConfirm && (
              <div className="notice warning">
                <p>
                  将先停止当前任务，再创建同版本的新实训。旧消息、提交和产物仍可回看；停止不能撤销已发生的模型费用或保存。
                </p>
                <button
                  className="button"
                  disabled={action.busy}
                  onClick={() =>
                    void action.act(async () => {
                      const a = await api<Attempt>(`${endpoint}/reset`, {
                        method: "POST",
                        idempotent: true,
                        body: { expected_revision: attempt.revision },
                      });
                      router.push(`/practice/${pathId(a.id)}`);
                    })
                  }
                >
                  确认重新开始
                </button>
                <button
                  className="text-button"
                  onClick={() => setResetConfirm(false)}
                >
                  继续当前实验
                </button>
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
