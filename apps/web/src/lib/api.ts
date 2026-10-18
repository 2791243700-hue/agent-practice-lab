import type { Schema } from "./types";
export class ApiError extends Error {
  constructor(public detail: Schema["ErrorResponse"]["error"]) {
    super(detail.message);
  }
}
const hints: Partial<Record<Schema["ErrorCode"], string>> = {
  LOCAL_TOKEN_INVALID:
    "本地服务连接失效，请用启动脚本重新启动前后端。无需登录。",
  MODEL_AUTH_FAILED:
    "模型服务未接受 API Key，请检查 Key 是否有效及额度是否充足。",
  MODEL_TIMEOUT: "模型响应超时，请检查网络和服务商状态后手动重试。",
  MODEL_INCOMPATIBLE:
    "该模型未通过标准工具调用检查，请选择支持工具调用的模型。",
  MODEL_NOT_READY: "请先在模型设置中输入 Key，并通过连接检查。",
  CREDENTIAL_MISSING: "Key 已清除或本地服务已重启，请重新输入 Key。",
  REVISION_CONFLICT: "设置已在其他页面更新，请刷新后再操作。",
  IDEMPOTENCY_IN_PROGRESS:
    "之前的操作尚未确认结束。请刷新查看状态，避免重复消耗额度。",
  APPROVAL_EXPIRED: "这次批准请求已过期，请查看运行状态后重新发起一轮任务。",
  APPROVAL_INVALIDATED: "运行已停止或重启，这次批准请求已失效。",
  ATTEMPT_SUPERSEDED: "这是重新开始前的历史实验，请打开新的实验继续。",
};
export function errorText(error: unknown): string {
  return error instanceof ApiError
    ? `${hints[error.detail.code] ?? error.message}${error.detail.fields.length ? " " + error.detail.fields.map((f) => f.message).join("；") : ""}（${error.detail.code}）`
    : "无法连接本地服务，请检查启动状态后重试。";
}
export const pathId = encodeURIComponent;
// Retain keys for ambiguous transport failures. No credentials use this cache.
const pendingKeys = new Map<string, string>();
export async function api<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    idempotent?: boolean;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const { method = "GET", body, idempotent, signal } = options;
  const fingerprint = idempotent
    ? `${method}:${path}:${JSON.stringify(body)}`
    : "";
  let key = fingerprint ? pendingKeys.get(fingerprint) : undefined;
  if (fingerprint && !key) {
    key = crypto.randomUUID();
    pendingKeys.set(fingerprint, key);
  }
  const response = await fetch(`/api/v1${path}`, {
    method,
    signal,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    let detail: Schema["ErrorResponse"]["error"];
    try {
      detail = (await response.json()).error;
    } catch {
      throw new Error("transport");
    }
    if (!detail?.code) throw new Error("transport");
    if (fingerprint && !["IDEMPOTENCY_IN_PROGRESS"].includes(detail.code))
      pendingKeys.delete(fingerprint);
    throw new ApiError(detail);
  }
  const result = response.status === 204 ? undefined : await response.json();
  if (fingerprint) pendingKeys.delete(fingerprint);
  return result as T;
}
export async function allPages<T>(path: string): Promise<T[]> {
  const result: T[] = [];
  let cursor: string | null = null;
  do {
    const page: { items: T[]; next_cursor: string | null } = await api(
      `${path}${path.includes("?") ? "&" : "?"}limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    result.push(...page.items);
    cursor = page.next_cursor;
  } while (cursor);
  return result;
}
