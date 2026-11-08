// Web 版 API 客户端 — Vite 代理 /api → rebuild 后端 :18083

const API_BASE = ""; // 空字符串,所有 /api/* 由 Vite proxy 转发
const TRACE_ID_PATTERN = /^tr_[A-Za-z0-9._:-]{8,128}$/;

export function formatApiErrorMessage(message: string, traceId: string | null): string {
  if (!traceId || !TRACE_ID_PATTERN.test(traceId) || message.includes(`排查编号：${traceId}`)) return message;
  return `${message}\n排查编号：${traceId}`;
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = path.startsWith("/") ? `${API_BASE}${path}` : `${API_BASE}/${path}`;
  const res = await fetch(url, { cache: "no-store", ...init });
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${res.statusText}`);
  }
  return res;
}

export async function apiFetchJson<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init);
  return res.json() as Promise<T>;
}

// ── API Envelope ──

export interface ParsedApiEnvelope<T = unknown> {
  ok: boolean;
  data: T | null;
  error: string | null;
  errorCode: string | null;
  details: unknown;
  traceId: string | null;
  status: number;
}

export function parseApiEnvelope<T = unknown>(
  body: Record<string, unknown>,
  status: number,
): ParsedApiEnvelope<T> {
  const success = body.success === true;
  const data = body.data as T | undefined;
  const traceId = typeof body.trace_id === "string" ? body.trace_id : null;
  if (success && data !== undefined && data !== null) {
    return {
      ok: true,
      data,
      error: null,
      errorCode: null,
      details: undefined,
      traceId,
      status,
    };
  }

  const message =
    typeof body.message === "string" && body.message.trim()
      ? body.message.trim()
      : typeof body.error === "string" && body.error.trim()
        ? body.error.trim()
        : `请求未完成（HTTP ${status}）`;
  const errorCode =
    typeof body.error_code === "string" && body.error_code.trim()
      ? body.error_code.trim()
      : "UNKNOWN_ERROR";

  return {
    ok: false,
    data: null,
    error: message,
    errorCode,
    details: body.details,
    traceId,
    status,
  };
}

/** 读取带 success/data/error 的标准封装，保留 error 文案用于向用户展示后端具体原因。 */
/** SPEC-029：发布前常态判定——服务端 release-freshness-gate 对"读正式版"接口统一回
 * NO_CURRENT_RELEASE（消息文案稳定为 "No current Release"）。消费面应呈空态/降级提示，
 * 不进错误横幅（先例：article-associations WP 批 2026-10-29）。 */
export function isNoCurrentReleaseText(text: unknown): boolean {
  return typeof text === "string" && text.includes("No current Release");
}

export async function apiFetchEnvelope<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<ParsedApiEnvelope<T>> {
  try {
    const url = path.startsWith("/") ? `${API_BASE}${path}` : `${API_BASE}/${path}`;
    const res = await fetch(url, { cache: "no-store", ...init });
    let body: Record<string, unknown> = {};
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const parsed = parseApiEnvelope<T>(body, res.status);
    if (res.ok) return parsed;
    return {
      ...parsed,
      ok: false,
      error: formatApiErrorMessage(parsed.error || `请求未完成（HTTP ${res.status}）`, parsed.traceId),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "无法连接到架构图 API 服务";
    return {
      ok: false,
      data: null,
      error: msg,
      errorCode: "NETWORK_ERROR",
      details: undefined,
      traceId: null,
      status: 0,
    };
  }
}

// 结构化 API 错误（seq178）：unwrapEnvelope 抛出时保留信封的 errorCode/details/traceId，
// 业务层可按错误码消费结构化明细（如实体修复写门的 blockers 字段级规则明细），
// message 行为不变（仍含排查编号），既有 catch e.message 消费零影响。
export class ApiError extends Error {
  readonly errorCode: string;
  readonly details: unknown;
  readonly traceId: string | null;

  constructor(message: string, options: { errorCode: string; details?: unknown; traceId?: string | null }) {
    super(message);
    this.name = "ApiError";
    this.errorCode = options.errorCode;
    this.details = options.details ?? null;
    this.traceId = options.traceId ?? null;
  }
}

// 统一信封解包（唯一定义）：ok=false 或 data 缺失 → throw（fallback 为错误文案）
export async function unwrapEnvelope<T>(
  request: Promise<ParsedApiEnvelope<T>>,
  fallback: string,
): Promise<T> {
  const envelope = await request;
  if (!envelope.ok || !envelope.data) {
    throw new ApiError(formatApiErrorMessage(envelope.error || fallback, envelope.traceId), {
      errorCode: envelope.errorCode ?? "UNKNOWN_ERROR",
      details: envelope.details,
      traceId: envelope.traceId,
    });
  }
  return envelope.data;
}
