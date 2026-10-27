"use client";
import { useRef, useState } from "react";
import { ChevronDown, Lightbulb } from "lucide-react";
import { api, pathId } from "@/lib/api";
import type { Profile, Schema } from "@/lib/types";
import { dateTime, ErrorBox, Markdown } from "./ui";

export type RunTipsOptions = {
  tipsProfile?: Profile;
  tipsDisabled?: boolean;
};

export function RunTips({
  runId,
  tipsProfile: profile,
  tipsDisabled = false,
}: RunTipsOptions & { runId: string }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [tips, setTips] = useState<Schema["RunTips"] | null>(null);
  const [busy, setBusy] = useState<"read" | "generate" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [consentProfile, setConsentProfile] = useState<string | null>(null);
  const locked = useRef(false);
  const profileIdentity = profile ? `${profile.id}/${profile.revision}` : null;
  const ready =
    profile?.credential_status === "configured" &&
    profile.connection_check.status === "passed";
  const consent =
    profileIdentity !== null && consentProfile === profileIdentity;
  const endpoint = `/runs/${pathId(runId)}/tips`;

  async function load() {
    if (locked.current) return;
    locked.current = true;
    setBusy("read");
    setError(null);
    try {
      const result = await api<Schema["RunTipsResult"]>(endpoint);
      setTips(result.tips);
      setLoaded(true);
    } catch (e) {
      setError(e);
    } finally {
      locked.current = false;
      setBusy(null);
    }
  }

  async function generate() {
    if (
      locked.current ||
      !loaded ||
      tips ||
      !profile ||
      !ready ||
      !consent ||
      tipsDisabled
    )
      return;
    locked.current = true;
    setBusy("generate");
    setError(null);
    try {
      setTips(
        await api<Schema["RunTips"]>(endpoint, {
          method: "POST",
          idempotent: true,
          body: {
            profile_id: profile.id,
            expected_profile_revision: profile.revision,
          } satisfies Schema["RunTipsCreate"],
        }),
      );
    } catch (e) {
      setError(e);
    } finally {
      locked.current = false;
      setBusy(null);
    }
  }

  return (
    <section className="run-tips" aria-label="本轮学习建议">
      <button
        type="button"
        className="run-tips-toggle"
        aria-label="Tips · 本轮学习建议"
        aria-expanded={open}
        aria-controls={`tips-${runId}`}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next && !loaded && !busy) void load();
        }}
      >
        <span className="run-tips-icon" aria-hidden="true">
          <Lightbulb size={20} />
        </span>
        <span className="run-tips-copy">
          <strong>Tips · 本轮学习建议</strong>
          <span>
            {busy === "generate"
              ? "正在生成，稍后即可查看"
              : tips
                ? "建议已保存，可随时展开回看"
                : "不知道下一步怎么改？看看本轮建议"}
          </span>
        </span>
        <span className="run-tips-action">
          {open ? "收起建议" : "展开建议"}
          <ChevronDown size={15} aria-hidden="true" />
        </span>
      </button>
      {open && (
        <div id={`tips-${runId}`} className="run-tips-content">
          <p className="small muted">模型建议，不代表正式通关</p>
          <p className="small muted">
            建议基于生成时已保存的内容；修改复盘后，已有建议不会自动更新。
          </p>
          {busy && (
            <p className="reply-pending" role="status">
              <span className="spinner" aria-hidden="true" />
              {busy === "read" ? "正在读取已保存的 Tips…" : "正在生成 Tips…"}
            </p>
          )}
          <ErrorBox
            error={error}
            retry={!loaded && !busy ? () => void load() : undefined}
          />
          {tips && (
            <>
              <p className="run-tips-meta small muted">
                {tips.model} ·{" "}
                <time dateTime={tips.created_at}>
                  {dateTime(tips.created_at)}
                </time>
                {" · "}模型调用 {tips.usage.model_calls} 次
                {tips.usage.input_tokens !== null &&
                tips.usage.output_tokens !== null
                  ? ` · Token ${tips.usage.input_tokens + tips.usage.output_tokens}`
                  : " · Token 用量未知"}
              </p>
              {tips.context_truncated && (
                <p className="notice warning">
                  本轮内容较长，生成时只使用了部分上下文；建议可能遗漏信息。
                </p>
              )}
              <Markdown text={tips.assessment} />
              {(
                [
                  ["与本关目标的差异", tips.gaps],
                  ["下一步建议", tips.next_steps],
                ] as const
              ).map(([title, items]) => (
                <div className="run-tips-group" key={title}>
                  <h4>{title}</h4>
                  {items.length ? (
                    <ul>
                      {items.map((item, index) => (
                        <li key={index}>
                          <Markdown text={item} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="small muted">暂无补充。</p>
                  )}
                </div>
              ))}
            </>
          )}
          {loaded && !tips && !busy && (
            <div className="run-tips-consent">
              <p>
                生成 Tips
                会额外调用一次模型，可能消耗额度，并将本关目标、你的任务说明、
                Agent
                回答、工具执行结果，以及关联的已保存复盘填写（包括你的解释和改写）发送到所选模型服务商。
              </p>
              {profile && (
                <p className="small">
                  所选模型：{profile.name} · {profile.model}
                  <br />
                  服务地址：{profile.base_url}
                </p>
              )}
              {!ready && (
                <p className="small muted">
                  请先在模型设置中配置 Key，并选择通过连接检查的模型。
                </p>
              )}
              {tipsDisabled && (
                <p className="small muted">当前操作结束后才能生成 Tips。</p>
              )}
              <label className="run-tips-consent-label">
                <input
                  type="checkbox"
                  checked={consent}
                  disabled={!ready || tipsDisabled}
                  onChange={(event) =>
                    setConsentProfile(
                      event.target.checked ? profileIdentity : null,
                    )
                  }
                />
                <span>我同意发送上述内容，并接受这一次模型调用的费用。</span>
              </label>
              <button
                type="button"
                className="button secondary"
                disabled={!ready || !consent || tipsDisabled}
                onClick={() => void generate()}
              >
                {error ? "重试生成 Tips" : "生成 Tips"}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
