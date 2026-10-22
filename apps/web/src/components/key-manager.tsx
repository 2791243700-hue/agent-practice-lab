"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  KeyRound,
  Link2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { ApiError, api, pathId } from "@/lib/api";
import type { Profile, Schema } from "@/lib/types";
import { ErrorBox, Heading, Loading, useAction } from "./ui";

type Provider = "deepseek" | "openai" | "openai-compatible";
type Catalog = Schema["ModelCatalog"];
function providerName(profile: Profile) {
  const host = new URL(profile.base_url).hostname;
  return host === "api.deepseek.com"
    ? "DeepSeek"
    : host === "api.openai.com"
      ? "OpenAI"
      : "兼容接口";
}
export default function KeyManager() {
  const action = useAction();
  const query = useSearchParams();
  const returnTo = query.get("returnTo");
  const back =
    returnTo && /^\/practice\/[A-Za-z0-9_-]+$/.test(returnTo) ? returnTo : null;
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [selected, setSelected] = useState("");
  const [catalogs, setCatalogs] = useState<Record<string, Catalog>>({});
  const [adding, setAdding] = useState(true);
  const [key, setKey] = useState("");
  const [provider, setProvider] = useState<Provider | "">("");
  const [providerChosen, setProviderChosen] = useState(false);
  const [name, setName] = useState("");
  const [base, setBase] = useState("");
  const [manual, setManual] = useState(false);
  const [manualModel, setManualModel] = useState("");
  const [editingName, setEditingName] = useState("");
  const [editingModel, setEditingModel] = useState("");
  const [notice, setNotice] = useState("");
  const [checkConsent, setCheckConsent] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const profile = profiles?.find((p) => p.id === selected);
  const catalog = profile ? catalogs[profile.id] : null;

  async function load() {
    const result = await api<Schema["ProfileList"]>("/model-profiles");
    setProfiles(result.items);
    return result.items;
  }
  function choose(p: Profile) {
    setSelected(p.id);
    setAdding(false);
    setEditingName(p.name);
    setEditingModel(p.model);
    setKey("");
    setCheckConsent(false);
    setDeleting(null);
    setNotice("");
  }
  async function fetchModels(p: Profile) {
    let result: Catalog;
    try {
      result = await api<Catalog>(`/model-profiles/${pathId(p.id)}/models`);
    } catch (error) {
      if (
        !(error instanceof ApiError) ||
        error.detail.code !== "MODEL_CATALOG_UNSUPPORTED" ||
        providerName(p) !== "兼容接口"
      )
        throw error;
      result = { items: [{ id: p.model }], source: "manual" };
    }
    setCatalogs((old) => ({ ...old, [p.id]: result }));
  }
  useEffect(() => {
    void action.act(async () => {
      const items = await load();
      if (items[0]) {
        choose(items[0]);
        if (items[0].credential_status === "configured")
          await fetchModels(items[0]);
      }
    });
  }, []);
  function beginAdd() {
    setAdding(true);
    setKey("");
    setName("");
    setProvider("");
    setProviderChosen(false);
    setBase("");
    setManual(false);
    setManualModel("");
    setNotice("");
    action.setError(null);
  }
  async function update(
    p: Profile,
    changes: { name?: string; model?: string },
  ) {
    const result = await api<Profile>(`/model-profiles/${pathId(p.id)}`, {
      method: "PUT",
      body: {
        name: p.name,
        provider: p.provider,
        base_url: p.base_url,
        model: p.model,
        ...changes,
        expected_revision: p.revision,
      },
    });
    await load();
    choose(result);
  }
  async function remove(p: Profile) {
    await api(
      `/model-profiles/${pathId(p.id)}?expected_revision=${p.revision}`,
      { method: "DELETE" },
    );
    setCatalogs((old) => {
      const next = { ...old };
      delete next[p.id];
      return next;
    });
    const items = await load();
    if (selected === p.id) {
      if (items[0]) choose(items[0]);
      else {
        setSelected("");
        beginAdd();
      }
    }
    setDeleting(null);
    setNotice("Key 和对应连接已删除，其他 Key 与学习记录保留。");
  }
  const choices = catalog?.items ?? [];
  return (
    <>
      <Heading
        eyebrow="SETUP / 模型连接"
        title="添加 Key，选择你的模型"
        description="DeepSeek、OpenAI 自动填写连接地址，也可接入其他兼容服务。"
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
        <div className="settings-layout key-manager-layout">
          <section className="panel key-library">
            <div className="panel-heading">
              <h2>
                我的 Key <span className="muted small">{profiles.length}</span>
              </h2>
              <KeyRound size={19} />
            </div>
            <button
              className="button secondary full"
              disabled={action.busy}
              onClick={beginAdd}
            >
              <Plus size={16} />
              添加 Key
            </button>
            {!profiles.length && (
              <p className="muted small key-empty">
                先添加一个 Key，再选择模型。
              </p>
            )}
            <div className="key-cards">
              {profiles.map((p) => (
                <article
                  className={`key-card ${!adding && selected === p.id ? "selected" : ""}`}
                  key={p.id}
                >
                  <button
                    className="key-choice"
                    disabled={action.busy}
                    aria-pressed={!adding && selected === p.id}
                    onClick={() =>
                      void action.act(async () => {
                        choose(p);
                        if (
                          p.credential_status === "configured" &&
                          !catalogs[p.id]
                        )
                          await fetchModels(p);
                      })
                    }
                  >
                    <strong>{p.name}</strong>
                    <span>
                      {providerName(p)} ·{" "}
                      {p.credential_status === "configured"
                        ? "Key 已配置"
                        : "需重新输入 Key"}
                    </span>
                    <small>{p.model}</small>
                  </button>
                  <button
                    className="key-delete"
                    aria-label={`删除 ${p.name}`}
                    disabled={action.busy}
                    onClick={() => setDeleting(p.id)}
                  >
                    <Trash2 size={16} />
                  </button>
                  {deleting === p.id && (
                    <div className="key-delete-confirm">
                      <p>删除此 Key 及连接配置？之后可重新添加。</p>
                      <div className="button-row">
                        <button
                          className="button danger"
                          disabled={action.busy}
                          onClick={() => void action.act(() => remove(p))}
                        >
                          确认删除 Key
                        </button>
                        <button
                          className="text-button"
                          onClick={() => setDeleting(null)}
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              ))}
            </div>
            <div className="key-memory-note">
              <ShieldCheck size={19} />
              <p>
                Key
                只保存在本次运行的后端内存中。重启后，名称和模型偏好仍在，需要重新输入
                Key。
              </p>
            </div>
          </section>
          <section className="panel key-workspace">
            {adding ? (
              <>
                <div className="eyebrow">01 / ADD YOUR KEY</div>
                <h2>添加 API Key</h2>
                <p className="small muted">
                  粘贴 Key 后识别服务商并获取模型，不再需要手填官方 API 地址。
                </p>
                <form
                  autoComplete="off"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!provider || !key.trim()) return;
                    const entered = key.trim();
                    setKey("");
                    void action.act(async () => {
                      const result = await api<Schema["KeyConnectionResult"]>(
                        "/model-profiles/connect",
                        {
                          method: "POST",
                          idempotent: true,
                          body: {
                            api_key: entered,
                            provider_id: provider,
                            ...(name.trim() ? { name: name.trim() } : {}),
                            ...(provider === "openai-compatible"
                              ? {
                                  base_url: base.trim(),
                                  ...(manual
                                    ? { model_id: manualModel.trim() }
                                    : {}),
                                }
                              : {}),
                          },
                        },
                      );
                      setCatalogs((old) => ({
                        ...old,
                        [result.profile.id]: result.catalog,
                      }));
                      await load();
                      choose(result.profile);
                      setNotice(
                        result.catalog.source === "manual"
                          ? "Key 已添加，模型为手动指定，请完成连接检查。"
                          : `Key 已添加，服务商返回 ${result.catalog.items.length} 个模型。选好后请检查连接。`,
                      );
                    });
                  }}
                >
                  <label>
                    API Key
                    <input
                      autoFocus
                      type="password"
                      required
                      maxLength={8192}
                      autoComplete="off"
                      spellCheck={false}
                      value={key}
                      onChange={(event) => {
                        const value = event.target.value;
                        setKey(value);
                        if (!providerChosen)
                          setProvider(
                            /^sk-(proj|svcacct)-/.test(value.trim())
                              ? "openai"
                              : "",
                          );
                      }}
                      placeholder="粘贴你的 API Key"
                    />
                  </label>
                  <label>
                    服务商
                    <select
                      aria-label="服务商"
                      required
                      value={provider}
                      onChange={(event) => {
                        setProvider(event.target.value as Provider);
                        setProviderChosen(true);
                      }}
                    >
                      <option value="">请选择服务商</option>
                      <option value="deepseek">DeepSeek</option>
                      <option value="openai">OpenAI</option>
                      <option value="openai-compatible">其他兼容接口</option>
                    </select>
                  </label>
                  <p className="field-help">
                    Key 格式相似时需选择一次服务商；只向这里选定的服务商发送
                    Key。OpenAI 格式仅作自动建议，请核对。
                  </p>
                  {provider && provider !== "openai-compatible" && (
                    <p className="key-destination">
                      连接地址已填写：
                      {provider === "deepseek"
                        ? "https://api.deepseek.com"
                        : "https://api.openai.com/v1"}
                    </p>
                  )}
                  {provider === "openai-compatible" && (
                    <>
                      <label>
                        API 根地址
                        <input
                          required
                          type="url"
                          maxLength={2048}
                          value={base}
                          onChange={(event) => setBase(event.target.value)}
                          placeholder="https://你的服务商地址/v1"
                        />
                      </label>
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={manual}
                          onChange={(event) => setManual(event.target.checked)}
                        />
                        手动填写模型（接口无法列出模型时）
                      </label>
                      {manual && (
                        <label>
                          模型名称
                          <input
                            required
                            maxLength={200}
                            value={manualModel}
                            onChange={(event) =>
                              setManualModel(event.target.value)
                            }
                          />
                        </label>
                      )}
                    </>
                  )}
                  <label>
                    Key 名称（可选）
                    <input
                      maxLength={80}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="例如：我的学习 Key；不填会自动命名"
                    />
                  </label>
                  <button
                    className="button"
                    disabled={action.busy || !provider || !key.trim()}
                  >
                    {action.busy
                      ? "正在连接…"
                      : manual && provider === "openai-compatible"
                        ? "添加 Key 并使用手动模型"
                        : "识别并获取模型"}
                  </button>
                </form>
              </>
            ) : profile ? (
              <>
                <div className="panel-heading">
                  <h2>模型与连接</h2>
                  <span className="badge subtle">{providerName(profile)}</span>
                </div>
                <p className="key-destination">{profile.base_url}</p>
                <form
                  className="key-name-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void action.act(async () => {
                      await update(profile, { name: editingName.trim() });
                      setNotice("Key 名称已更新。");
                    });
                  }}
                >
                  <label>
                    Key 名称
                    <input
                      required
                      maxLength={80}
                      value={editingName}
                      onChange={(event) => setEditingName(event.target.value)}
                    />
                  </label>
                  <button
                    className="button secondary"
                    disabled={
                      action.busy ||
                      !editingName.trim() ||
                      editingName === profile.name
                    }
                  >
                    保存名称
                  </button>
                </form>
                {profile.credential_status !== "configured" && (
                  <p className="notice warning">
                    这个 Key 尚未输入或已在重启后清除。请重新输入后获取模型。
                  </p>
                )}
                <label>
                  选择模型
                  <select
                    aria-label="选择模型"
                    value={profile.model}
                    disabled={
                      action.busy || profile.credential_status !== "configured"
                    }
                    onChange={(event) => {
                      const value = event.target.value;
                      void action.act(async () => {
                        await update(profile, { model: value });
                        setNotice("模型已切换，请重新检查连接。");
                      });
                    }}
                  >
                    {!choices.some((item) => item.id === profile.model) && (
                      <option value={profile.model}>
                        {profile.model}（当前配置，需检查）
                      </option>
                    )}
                    {choices.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name ? `${item.name} (${item.id})` : item.id}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="key-model-help">
                  <p className="field-help">
                    {catalog?.source === "manual"
                      ? "当前模型为手动指定，访问权限尚需检查。"
                      : "模型列表由服务商返回；文本和工具兼容性以下方连接检查为准。"}
                  </p>
                  {catalog?.source === "manual" && (
                    <p className="field-help">
                      使用手动模型时会保留当前模型；接口不提供模型列表不会影响
                      Key 提交或连接检查。
                    </p>
                  )}
                  <button
                    className="text-button"
                    disabled={
                      action.busy || profile.credential_status !== "configured"
                    }
                    onClick={() => void action.act(() => fetchModels(profile))}
                  >
                    <RefreshCw size={14} />
                    刷新模型列表
                  </button>
                </div>
                {providerName(profile) === "兼容接口" && (
                  <details>
                    <summary>高级：手动指定模型</summary>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void action.act(async () => {
                          await update(profile, { model: editingModel.trim() });
                          setNotice("已更新手动模型，请检查连接。");
                        });
                      }}
                    >
                      <label>
                        模型名称
                        <input
                          required
                          maxLength={200}
                          value={editingModel}
                          onChange={(event) =>
                            setEditingModel(event.target.value)
                          }
                        />
                      </label>
                      <button
                        className="button secondary"
                        disabled={action.busy}
                      >
                        保存模型
                      </button>
                    </form>
                  </details>
                )}
                <hr />
                <h2>
                  {profile.credential_status === "configured"
                    ? "替换或清除 Key"
                    : "重新输入 Key"}
                </h2>
                <form
                  autoComplete="off"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const entered = key.trim();
                    setKey("");
                    void action.act(async () => {
                      const result = await api<Profile>(
                        `/model-profiles/${pathId(profile.id)}/credential`,
                        {
                          method: "PUT",
                          body: {
                            api_key: entered,
                            expected_revision: profile.revision,
                          },
                        },
                      );
                      setCatalogs((old) => {
                        const next = { ...old };
                        delete next[profile.id];
                        return next;
                      });
                      await load();
                      choose(result);
                      await fetchModels(result);
                      setNotice(
                        "Key 已提交到本地后端内存，输入框已清空。请完成连接检查。",
                      );
                    });
                  }}
                >
                  <label>
                    API Key
                    <input
                      required
                      type="password"
                      maxLength={8192}
                      autoComplete="off"
                      spellCheck={false}
                      value={key}
                      onChange={(event) => setKey(event.target.value)}
                      placeholder="重新粘贴 Key；现有 Key 无法读回"
                    />
                  </label>
                  <div className="button-row">
                    <button className="button secondary" disabled={action.busy}>
                      提交 Key
                    </button>
                    {profile.credential_status === "configured" && (
                      <button
                        type="button"
                        className="text-button danger-text"
                        disabled={action.busy}
                        onClick={() =>
                          void action.act(async () => {
                            await api(
                              `/model-profiles/${pathId(profile.id)}/credential?expected_revision=${profile.revision}`,
                              { method: "DELETE" },
                            );
                            setKey("");
                            await load();
                            setCatalogs((old) => {
                              const next = { ...old };
                              delete next[profile.id];
                              return next;
                            });
                            setCheckConsent(false);
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
                <h2>检查连接</h2>
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
                    {profile.connection_check.error_code} ·
                    核对服务商、额度和工具支持情况后重试。
                  </p>
                )}
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={checkConsent}
                    onChange={(event) => setCheckConsent(event.target.checked)}
                  />
                  我知道连接检查会发送最多 3 次模型请求，可能消耗服务商额度。
                </label>
                <div className="button-row">
                  <button
                    className="button"
                    disabled={
                      action.busy ||
                      !checkConsent ||
                      profile.credential_status !== "configured"
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
                        } finally {
                          const items = await load();
                          setNotice(
                            items.find((p) => p.id === profile.id)
                              ?.connection_check.status === "passed"
                              ? "文本和工具检查均通过，可以开始实训。"
                              : "检查未通过，请查看检查结果。",
                          );
                        }
                      })
                    }
                  >
                    {action.busy ? "正在处理…" : "检查连接"}
                  </button>
                  {back && profile.connection_check.status === "passed" && (
                    <Link
                      className="button secondary"
                      href={`${back}?profile=${pathId(profile.id)}`}
                    >
                      返回实训 →
                    </Link>
                  )}
                </div>
              </>
            ) : null}
          </section>
        </div>
      )}
      <div className="quiet-note">
        <CheckCircle2 size={16} />
        获取模型列表不会自动发起对话；只有你确认检查或发送实训任务时才请求模型生成内容。
      </div>
    </>
  );
}
