"use client";
import {
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  Download,
  FileText,
  Send,
  Square,
  RotateCcw,
  Lightbulb,
  CircleAlert,
  PanelLeftClose,
  PanelLeftOpen,
  CircleHelp,
  Info,
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
import { ErrorBox, Loading, Markdown, useAction } from "@/components/ui";
import { PendingMessage, RunView } from "@/components/run-view";
import {
  CompletionStatus,
  formatLearningDate,
} from "@/components/learning-status";
import { PracticePanel } from "@/components/practice-panel";
import { SubmissionPanel } from "@/components/feedback";
import { SubmissionDialog } from "@/components/submission-dialog";

const practiceExamples: Record<string, string> = {
  "01-task":
    "想让助手安排周末时，只说“帮我做个计划”太笼统。可以补充：“我周六下午有两小时，想在家休息，请安排两项轻松的活动，并说明各需多久。”你可以观察：补充目标、时间和要求后，结果有什么变化。",
  "02-context":
    "想让助手列购物清单，可以先提供冰箱里的食材清单，并要求“根据这份清单，只列出还缺的食材”。随后检查它是否真的读取了清单，有没有把家里已有的东西再次列入。",
  "03-tools":
    "假设助手有图书库存查询工具，你让它查一本书是否可借。要查看它是否传入了正确的书名、查询是否成功，以及最后的回答是否与返回结果一致。只说“有库存”还不够。",
  "04-permission":
    "假设助手准备保存一份旅行打包清单，你发现漏了雨伞，可以先拒绝这次保存，请它补充后再检查新的请求。确认后批准，最后打开实际生成的文件，看看雨伞是否真的加进去了。",
};

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
  const preferred = useSearchParams().get("profile");
  return (
    <Practice key={`${id}/${preferred ?? ""}`} id={id} preferred={preferred} />
  );
}
function Practice({ id, preferred }: { id: string; preferred: string | null }) {
  const router = useRouter();
  const action = useAction();
  const [loadError, setLoadError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [events, setEvents] = useState<Record<string, Event[]>>({});
  const [files, setFiles] = useState<Schema["FileInfo"][]>([]);
  const [preview, setPreview] = useState<Schema["FilePreview"] | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [panels, setPanels] = useState({
    mission: true,
    preparation: true,
    artifacts: true,
  });
  const previewRef = useRef<HTMLDivElement>(null);
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (preview) {
      previewRef.current?.scrollIntoView({ block: "center" });
      previewRef.current?.focus({ preventScroll: true });
    }
  }, [preview]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [input, setInput] = useState("");
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const historyEndRef = useRef<HTMLDivElement>(null);
  const followingOutputRef = useRef(false);
  const [settings, setSettings] = useState<Schema["Settings"]>({
    system_instruction: "",
    temperature: 0.3,
  });
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [submissions, setSubmissions] = useState<Schema["SubmissionSummary"][]>(
    [],
  );
  const [feedback, setFeedback] = useState<Submission | null>(null);
  const feedbackTriggerRef = useRef<HTMLElement | null>(null);
  const [connection, setConnection] = useState("");
  const [intro, setIntro] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const resetTriggerRef = useRef<HTMLButtonElement>(null);
  const [download, setDownload] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const endpoint = `/attempts/${pathId(id)}`;
  async function openPreview(fileId: string, trigger: HTMLButtonElement) {
    await action.act(async () => {
      const value = await api<Schema["FilePreview"]>(
        `${endpoint}/files/${pathId(fileId)}`,
      );
      previewTriggerRef.current = trigger;
      setSidebarOpen(true);
      setPanels((old) => ({ ...old, artifacts: true }));
      setPreview(value);
    });
  }
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
        const readyProfiles = p.items.filter(
          (profile) =>
            profile.credential_status === "configured" &&
            profile.connection_check.status === "passed",
        );
        setProfileId(
          readyProfiles.find((profile) => profile.id === preferred)?.id ??
            readyProfiles[0]?.id ??
            "",
        );
      }
    },
    [endpoint, preferred],
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
  useLayoutEffect(() => {
    const history = historyRef.current;
    const end = historyEndRef.current;
    if (!history || !end) return;
    const live = Boolean(activeId || pendingMessage);
    history.scrollTo({ top: history.scrollHeight, behavior: "instant" });
    if (live || followingOutputRef.current) {
      const bounds = end.getBoundingClientRect();
      if (bounds.bottom > window.innerHeight - 24 || bounds.top < 16) {
        end.scrollIntoView({ block: "nearest", behavior: "instant" });
      }
    }
    followingOutputRef.current = live;
  }, [runs, events, pendingMessage, activeId]);
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
  const example = practiceExamples[lesson.id];
  const readsMaterials = lesson.allowed_tools.includes("read_material");
  const missingMaterials = readsMaterials && selectedFiles.length === 0;
  const preparationPending = dirty || missingMaterials;
  async function submit(answers: Schema["Answers"]) {
    feedbackTriggerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
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
      <header className="practice-header">
        <div className="practice-header-nav">
          <nav className="practice-crumbs" aria-label="课程位置">
            <Link className="back-link" href="/">
              <ArrowLeft size={15} />
              全部课程
            </Link>
            <span>
              / 第 {lesson.order} 关 ·{" "}
              {attempt.mode === "demo" ? "演示练习" : "正式实训"}
            </span>
          </nav>
          <div className="practice-header-actions">
            {!historical && (
              <button
                ref={resetTriggerRef}
                className="text-button"
                disabled={action.busy}
                aria-expanded={resetConfirm}
                aria-controls="reset-environment-confirmation"
                onClick={() => setResetConfirm((v) => !v)}
              >
                <RotateCcw size={15} />
                重置环境
              </button>
            )}
            <button className="text-button" onClick={() => setIntro((v) => !v)}>
              <BookOpen size={15} />
              {intro ? "收起导读" : "查看本关介绍"}
            </button>
            <Link href="/help" aria-label="使用帮助">
              <CircleHelp size={16} aria-hidden="true" />
              帮助
            </Link>
          </div>
        </div>
        <div className="practice-heading-row">
          <h1>{lesson.title}</h1>
          <div className="practice-heading-status">
            <CompletionStatus
              mode={attempt.mode}
              completed={attempt.progress === "completed"}
            />
            <details
              className="practice-info"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.currentTarget.open = false;
                  event.currentTarget.querySelector("summary")?.focus();
                }
              }}
            >
              <summary aria-label="实训信息" title="实训信息">
                <Info size={19} aria-hidden="true" />
              </summary>
              <div className="practice-info-popover">
                <strong>实训信息</strong>
                <dl>
                  <dt>开始日期（上海时间）</dt>
                  <dd>
                    <time dateTime={attempt.created_at}>
                      {formatLearningDate(attempt.created_at)}
                    </time>
                  </dd>
                  <dt>课程版本</dt>
                  <dd>{attempt.lesson_version}</dd>
                  <dt>运行模式</dt>
                  <dd>{attempt.mode === "demo" ? "演示练习" : "正式实训"}</dd>
                </dl>
              </div>
            </details>
          </div>
        </div>
      </header>
      <ErrorBox error={loadError} />
      <ErrorBox error={action.error} />
      {resetConfirm && !historical && (
        <div
          id="reset-environment-confirmation"
          className="notice warning"
          role="region"
          aria-label="重置当前关卡环境"
        >
          <p>
            重置将先停止当前任务，再创建同版本、同模式的全新实训，恢复默认材料和
            Agent 设置。旧消息、提交和产物仍可回看，模型 Key
            保留；未保存的输入会丢弃，已发生的模型费用无法撤销。
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
                const profileQuery =
                  a.mode === "live" && profileId
                    ? `?profile=${pathId(profileId)}`
                    : "";
                router.push(`/practice/${pathId(a.id)}${profileQuery}`);
              })
            }
          >
            确认重置环境
          </button>
          <button
            className="text-button"
            disabled={action.busy}
            onClick={() => {
              setResetConfirm(false);
              resetTriggerRef.current?.focus();
            }}
          >
            取消
          </button>
        </div>
      )}
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
      <div
        className={`practice-layout${sidebarOpen ? "" : " sidebar-collapsed"}`}
      >
        <aside
          className={`practice-sidebar${sidebarOpen ? "" : " is-collapsed"}`}
          aria-label="任务与设置侧栏"
        >
          <button
            type="button"
            className="practice-sidebar-toggle"
            aria-label={
              sidebarOpen ? "收起任务与设置侧栏" : "展开任务与设置侧栏"
            }
            title={sidebarOpen ? "收起任务与设置侧栏" : "展开任务与设置侧栏"}
            aria-expanded={sidebarOpen}
            aria-controls="practice-sidebar-content"
            onClick={() => setSidebarOpen((old) => !old)}
          >
            {sidebarOpen ? (
              <PanelLeftClose size={20} aria-hidden="true" />
            ) : (
              <PanelLeftOpen size={20} aria-hidden="true" />
            )}
            <span hidden={!sidebarOpen}>任务与设置</span>
          </button>
          <div
            className="practice-controls"
            id="practice-sidebar-content"
            hidden={!sidebarOpen}
          >
            <PracticePanel
              id="practice-mission"
              className="task-panel"
              title="这一关，做什么？"
              eyebrow="01 / YOUR MISSION"
              open={panels.mission}
              onToggle={() =>
                setPanels((old) => ({ ...old, mission: !old.mission }))
              }
            >
              <Markdown text={lesson.task_markdown} />
              {example && (
                <div className="mission-example">
                  <h3>
                    <Lightbulb size={17} aria-hidden="true" />
                    举一个小例子
                  </h3>
                  <Markdown text={example} />
                </div>
              )}
              <details>
                <summary>完成标准</summary>
                <ul>
                  {lesson.completion_criteria.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </details>
            </PracticePanel>
            <PracticePanel
              className="preparation-panel"
              id="practice-preparation"
              title="材料与 Agent 设置"
              eyebrow="02 / PREPARE"
              open={panels.preparation}
              onToggle={() =>
                setPanels((old) => ({ ...old, preparation: !old.preparation }))
              }
            >
              <div className="material-list">
                {lesson.materials.map((m) => (
                  <div key={m.id}>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        disabled={historical || action.busy}
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
                      disabled={action.busy}
                      onClick={(event) =>
                        void openPreview(m.id, event.currentTarget)
                      }
                    >
                      预览原文
                    </button>
                  </div>
                ))}
              </div>
              <fieldset disabled={historical || action.busy}>
                <legend className="sr-only">下一轮运行设置</legend>
                <p className="field-help">
                  {readsMaterials
                    ? "选中只是允许读取。实际读过与否，请查看工具执行结果。"
                    : "本关不需要读取文件，可以保留默认的材料选择。"}
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
            </PracticePanel>
            <PracticePanel
              id="practice-artifacts"
              className="artifact-panel"
              title="产物与原文预览"
              eyebrow="OUTPUT / CHECK THE RESULT"
              open={panels.artifacts}
              onToggle={() =>
                setPanels((old) => ({ ...old, artifacts: !old.artifacts }))
              }
            >
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
                      onClick={(event) =>
                        void openPreview(f.id, event.currentTarget)
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
                <div
                  className="file-preview"
                  ref={previewRef}
                  role="region"
                  aria-label={`${preview.file.title}预览`}
                  tabIndex={-1}
                >
                  <div>
                    <strong>{preview.file.title}</strong>
                    <button
                      className="text-button"
                      onClick={() => {
                        setPreview(null);
                        const trigger = previewTriggerRef.current;
                        if (trigger?.closest("#practice-preparation")) {
                          setSidebarOpen(true);
                          setPanels((old) => ({ ...old, preparation: true }));
                        }
                        requestAnimationFrame(() => trigger?.focus());
                      }}
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
            </PracticePanel>
          </div>
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
            <div
              className="conversation-history"
              ref={historyRef}
              role="region"
              aria-label="对话记录"
            >
              {!runs.length && !pendingMessage && (
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
                <RunView
                  key={run.id}
                  run={run}
                  events={events[run.id] ?? []}
                  tipsProfile={selectedProfile}
                  tipsDisabled={
                    !!active ||
                    syncing ||
                    action.busy ||
                    pendingMessage !== null
                  }
                />
              ))}
              {pendingMessage !== null && (
                <PendingMessage text={pendingMessage} />
              )}
              <div
                ref={historyEndRef}
                className="conversation-end"
                aria-hidden="true"
              />
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
                    if (
                      preparationPending ||
                      !ready ||
                      active ||
                      syncing ||
                      action.busy ||
                      pendingMessage !== null ||
                      !input.trim()
                    )
                      return;
                    void action.act(async () => {
                      const text = input.trim();
                      setPendingMessage(text);
                      setInput("");
                      try {
                        const run = await api<Run>("/runs", {
                          method: "POST",
                          idempotent: true,
                          body: {
                            attempt_id: id,
                            expected_attempt_revision: attempt.revision,
                            profile_id:
                              attempt.mode === "demo" ? null : profileId,
                            input_text: text,
                          } satisfies Schema["RunCreate"],
                        });
                        setRuns((old) =>
                          old.some((r) => r.id === run.id)
                            ? old
                            : [...old, run],
                        );
                      } catch (error) {
                        setInput(text);
                        throw error;
                      } finally {
                        setPendingMessage(null);
                      }
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
                          preparationPending ||
                          !input.trim()
                        }
                      >
                        <Send size={15} />
                        {action.busy ? "正在发送…" : "发送任务"}
                      </button>
                    )}
                  </div>
                  {preparationPending && (
                    <div
                      className="composer-preparation notice warning"
                      role="status"
                    >
                      <CircleAlert size={17} aria-hidden="true" />
                      <span>
                        {missingMaterials
                          ? "发送前，请先在第 2 板块选择材料并保存。"
                          : "材料或设置尚未保存，请先完成第 2 板块。"}{" "}
                        <a
                          href="#practice-preparation"
                          onClick={(event) => {
                            event.preventDefault();
                            setSidebarOpen(true);
                            setPanels((old) => ({ ...old, preparation: true }));
                            requestAnimationFrame(() => {
                              const section = document.getElementById(
                                "practice-preparation",
                              );
                              section?.scrollIntoView({ block: "start" });
                              section?.focus({ preventScroll: true });
                            });
                          }}
                        >
                          前往设置 ↑
                        </a>
                      </span>
                    </div>
                  )}
                </form>
              </div>
            )}
          </section>
          <SubmissionPanel
            attempt={attempt}
            lesson={lesson}
            history={submissions}
            disabled={
              !!active ||
              historical ||
              dirty ||
              syncing ||
              action.busy ||
              pendingMessage !== null
            }
            onSubmit={submit}
            onView={async (id) => {
              feedbackTriggerRef.current =
                document.activeElement instanceof HTMLElement
                  ? document.activeElement
                  : null;
              setFeedback(await api<Submission>(`/submissions/${pathId(id)}`));
            }}
          />
          {feedback && (
            <SubmissionDialog
              submission={feedback}
              lesson={lesson}
              profileId={attempt.mode === "live" ? profileId : undefined}
              onClose={() => setFeedback(null)}
              returnFocusTo={feedbackTriggerRef.current}
              onViewEvent={(runId, seq) => {
                setFeedback(null);
                requestAnimationFrame(() => {
                  const target = document.getElementById(
                    `event-${runId}-${seq}`,
                  );
                  if (!target) return;
                  const details = target.closest("details");
                  if (details) details.open = true;
                  target.tabIndex = -1;
                  target.focus({ preventScroll: true });
                  target.scrollIntoView({ block: "center" });
                });
              }}
            />
          )}
          <section className="practice-utilities">
            <div>
              <strong>保留这次学习</strong>
              <p>
                导出不会包含模型连接配置或
                Key。需要重新练习时，可使用页面顶部的“重置环境”。
              </p>
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
            </div>
            {download && (
              <a className="button secondary" href={download}>
                学习记录已就绪，下载 ZIP
              </a>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
