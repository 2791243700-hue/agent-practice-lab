"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, KeyRound, Link2, Plus, ShieldCheck } from "lucide-react";
import { api, pathId } from "@/lib/api";
import type { Profile, Schema } from "@/lib/types";
import { ErrorBox, Heading, Loading, useAction } from "@/components/ui";
export default function SettingsPage() {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [base, setBase] = useState("");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const [notice, setNotice] = useState("");
  const [checkConsent, setCheckConsent] = useState(false);
  const action = useAction();
  const query = useSearchParams();
  const returnTo = query.get("returnTo");
  const back =
    returnTo && /^\/practice\/[A-Za-z0-9_-]+$/.test(returnTo) ? returnTo : null;
  const profile = profiles?.find((p) => p.id === selected);
  async function load() {
    const p = await api<Schema["ProfileList"]>("/model-profiles");
    setProfiles(p.items);
    return p.items;
  }
  useEffect(() => {
    void action.act(async () => {
      const items = await load();
      if (items[0]) choose(items[0]);
    });
  }, []);
  function choose(p?: Profile) {
    setSelected(p?.id ?? "");
    setName(p?.name ?? "");
    setBase(p?.base_url ?? "");
    setModel(p?.model ?? "");
    setKey("");
    setCheckConsent(false);
    setNotice("");
  }
  const changed =
    profile &&
    (profile.name !== name ||
      profile.base_url !== base ||
      profile.model !== model);
  return (
    <>
      <Heading
        eyebrow="SETUP / 模型连接"
        title="为你的 Agent 连接一个模型"
        description="模型负责理解任务。API Key 是访问模型服务的凭证，需要由你在服务商处申请。"
      />
      <ErrorBox error={action.error} />
      {notice && (
        <div role="status" className="notice success">
          {notice}
        </div>
      )}
      {profiles === null ? (
        <Loading />
      ) : (
        <div className="settings-layout">
          <section className="panel">
            <div className="panel-heading">
              <h2>01 · 连接信息</h2>
              <button className="text-button" onClick={() => choose()}>
                <Plus size={15} />
                新建配置
              </button>
            </div>
            <label>
              选择已有配置
              <select
                value={selected}
                onChange={(e) =>
                  choose(profiles.find((p) => p.id === e.target.value))
                }
              >
                <option value="">新建模型连接</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action.act(async () => {
                  const body = {
                    name: name.trim(),
                    provider: "openai-compatible" as const,
                    base_url: base.trim(),
                    model: model.trim(),
                  };
                  const p = await api<Profile>(
                    `/model-profiles${profile ? `/${pathId(profile.id)}` : ""}`,
                    {
                      method: profile ? "PUT" : "POST",
                      idempotent: !profile,
                      body: profile
                        ? { ...body, expected_revision: profile.revision }
                        : body,
                    },
                  );
                  await load();
                  choose(p);
                  setNotice("连接信息已保存。接下来输入 API Key。");
                });
              }}
            >
              <label>
                配置名称
                <input
                  required
                  maxLength={80}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：我的学习模型"
                />
              </label>
              <label>
                API 根地址
                <input
                  required
                  type="url"
                  maxLength={2048}
                  value={base}
                  onChange={(e) => setBase(e.target.value)}
                  placeholder="https://你的服务商地址/v1"
                  aria-describedby="base-help"
                />
              </label>
              <p id="base-help" className="field-help">
                从服务商的官方文档复制。需要 /v1 时请包含它，不要填写
                /chat/completions。
              </p>
              <label>
                模型名称
                <input
                  required
                  maxLength={200}
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="填写服务商提供的准确模型 ID"
                />
              </label>
              <p className="field-help">
                需支持文本和标准工具调用；当前接入 OpenAI-compatible Chat
                Completions。
              </p>
              <button className="button" disabled={action.busy}>
                {action.busy ? "处理中…" : "保存连接信息"}
              </button>
            </form>
            {profile && (
              <>
                <hr />
                <h2>02 · 输入 API Key</h2>
                <p className="small muted">
                  {profile.credential_status === "configured"
                    ? "本地后端已配置 Key，页面无法读回。可输入新的 Key 替换。"
                    : "尚未配置 Key，或本地服务重启后已清除。"}
                </p>
                <form
                  autoComplete="off"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const entered = key;
                    setKey("");
                    void action.act(async () => {
                      await api<Profile>(
                        `/model-profiles/${pathId(profile.id)}/credential`,
                        {
                          method: "PUT",
                          body: {
                            api_key: entered,
                            expected_revision: profile.revision,
                          } satisfies Schema["CredentialSet"],
                        },
                      );
                      await load();
                      setNotice(
                        "Key 已提交到本地后端内存，输入框已清空。请完成连接检查。",
                      );
                    });
                  }}
                >
                  <label>
                    API Key
                    <input
                      type="password"
                      required
                      maxLength={8192}
                      autoComplete="off"
                      spellCheck={false}
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                      placeholder="只在这里输入你的 Key"
                    />
                  </label>
                  <div className="button-row">
                    <button
                      className="button secondary"
                      disabled={action.busy || !!changed}
                    >
                      提交 Key
                    </button>
                    {profile.credential_status === "configured" && (
                      <button
                        className="text-button danger-text"
                        type="button"
                        disabled={action.busy}
                        onClick={() =>
                          void action.act(async () => {
                            await api(
                              `/model-profiles/${pathId(profile.id)}/credential?expected_revision=${profile.revision}`,
                              { method: "DELETE" },
                            );
                            setKey("");
                            await load();
                            setNotice("Key 已从本地后端内存清除。");
                          })
                        }
                      >
                        清除当前 Key
                      </button>
                    )}
                  </div>
                </form>
                <hr />
                <h2>03 · 检查连接</h2>
                <div
                  className={`connection-state ${profile.connection_check.status}`}
                >
                  <Link2 size={20} />
                  <div>
                    <strong>
                      {profile.connection_check.status === "passed"
                        ? "连接检查通过"
                        : profile.connection_check.status === "failed"
                          ? "连接检查未通过"
                          : "尚未通过连接检查"}
                    </strong>
                    <p>{profile.connection_check.message}</p>
                    <span>
                      文本调用：
                      {profile.connection_check.text_ok ? "通过" : "未通过"} ·
                      工具调用：
                      {profile.connection_check.tools_ok ? "通过" : "未通过"}
                    </span>
                  </div>
                </div>
                {profile.connection_check.error_code && (
                  <p className="small danger-text">
                    {profile.connection_check.error_code} · 检查
                    Key、网络和模型的工具支持情况后手动重试。
                  </p>
                )}
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={checkConsent}
                    onChange={(e) => setCheckConsent(e.target.checked)}
                  />
                  我知道连接检查会发送最多 3 次模型请求，可能消耗服务商额度。
                </label>
                <button
                  className="button"
                  disabled={
                    action.busy ||
                    !!changed ||
                    profile.credential_status !== "configured" ||
                    !checkConsent
                  }
                  onClick={() =>
                    void action.act(async () => {
                      setNotice("正在检查，最多约 30 秒…");
                      try {
                        await api(
                          `/model-profiles/${pathId(profile.id)}/check`,
                          {
                            method: "POST",
                            idempotent: true,
                            body: { expected_revision: profile.revision },
                          },
                        );
                        const items = await load();
                        setNotice(
                          items.find((p) => p.id === profile.id)
                            ?.connection_check.status === "passed"
                            ? "文本和工具检查均通过，可以开始实训。"
                            : "检查未通过，请查看检查结果。",
                        );
                      } finally {
                        await load();
                      }
                    })
                  }
                >
                  {action.busy ? "正在处理…" : "检查连接"}
                </button>
                {changed && (
                  <p className="small danger-text">
                    请先保存修改后的连接信息。
                  </p>
                )}
                {back && profile.connection_check.status === "passed" && (
                  <Link className="button secondary" href={back}>
                    返回实训 →
                  </Link>
                )}
              </>
            )}
          </section>
          <aside>
            <section className="panel setup-guide">
              <span className="round-icon">
                <KeyRound size={25} />
              </span>
              <h2>第一次配置？照着做就好。</h2>
              <ol>
                <li>
                  <strong>选择模型服务商</strong>
                  <p>
                    在其官方平台创建自己的账户，确认支持工具调用并开通所需额度。
                  </p>
                </li>
                <li>
                  <strong>复制三项信息</strong>
                  <p>
                    API 根地址、模型名称、API
                    Key。它们通常位于服务商的开发者控制台。
                  </p>
                </li>
                <li>
                  <strong>检查后再开始</strong>
                  <p>只有文本和工具调用都通过，才可以运行正式实训。</p>
                </li>
              </ol>
              <Link href="/help">阅读详细使用说明 →</Link>
            </section>
            <div className="privacy-note">
              <ShieldCheck size={20} />
              <div>
                <strong>你的 Key，由你掌管</strong>
                <p>
                  仅暂存于本地后端内存。关闭或重启后需重新输入；不会写入浏览器存储、日志或学习记录导出。
                </p>
              </div>
            </div>
            <div className="privacy-note">
              <CheckCircle2 size={20} />
              <div>
                <strong>设置会影响下一轮运行</strong>
                <p>
                  正在运行的任务使用自己的配置快照。连接被占用时请先等待任务结束。
                </p>
              </div>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
