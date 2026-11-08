// Component: API-Envelope — ported from 架构图系统/electron/shared/api-envelope.cjs.
// @responsible: 生成统一成功、失败响应包络和 trace id；sendJSON 是全部 JSON 响应的唯一出口（路由／错误处理器／404／410）。
// @inputs: 业务数据、错误字段与 trace 上下文；Fastify reply（PR-085 第 1 步起——原 Node res 形态随 route-dispatch 退役）
// @outputs: 标准 HTTP API envelope（success/data/trace_id ｜ success:false/error/error_code/message/details/trace_id）
// @context: Canvas。响应出站契约探针（seq196 enforce／shadow，ADR060）自 PR-085 第 1 步起由 http-app.cjs 的 onSend 钩子承载
//           （ADR-010 决策 5：不交框架 schema.response 序列化），本模块只保留探针注册点；覆盖面＝全部 JSON 响应 ≥ 原 sendJSON 内联。
const { createTraceId, getTraceId } = require("./request-context.cjs");

function okEnvelope(data, options = {}) {
  return { success: true, data, trace_id: options.traceId || createTraceId() };
}

function errorEnvelope({ errorCode = "INTERNAL_ERROR", message = "请求失败", details, traceId } = {}) {
  const body = { success: false, error: message, error_code: errorCode, message, trace_id: traceId || createTraceId() };
  if (details !== undefined) body.details = details;
  return body;
}

function errorCodeForStatus(status) {
  if (status === 400) return "VALIDATION_ERROR";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 503) return "SERVICE_UNAVAILABLE";
  return "INTERNAL_ERROR";
}

/** 以 status 与业务 body 组装封套（纯函数，供 sendJSON 与测试复用）。 */
function buildEnvelope(status, body, traceId) {
  return status < 400
    ? okEnvelope(body, { traceId })
    : errorEnvelope({ errorCode: body?.error_code || errorCodeForStatus(status), message: body?.message || body?.error || "请求失败", details: body?.details, traceId });
}

/**
 * 唯一 JSON 出口：reply 为 Fastify reply。
 * - trace_id 取当前请求上下文（AsyncLocalStorage），响应头 X-Trace-Id 同值；
 * - reply.raw.errorCode 供 pino-http 日志行 error_code 字段（json-logger httpFields）；
 * - 返回 reply（async handler 可 `return sendJSON(...)`，与 Fastify「send 后 return reply」惯例一致）。
 */
function sendJSON(reply, status, body) {
  const traceId = getTraceId() || createTraceId();
  const payload = buildEnvelope(status, body, traceId);
  reply.raw.errorCode = status >= 400 ? payload.error_code : null;
  reply.header("X-Trace-Id", traceId);
  return reply.code(status).type("application/json; charset=utf-8").send(payload);
}

// 探针注册点：仅 main.cjs 启动接线写入；http-app onSend 钩子经 getResponseSchemaProbe 取用；测试经 __getResponseSchemaProbe 观测灰度语义。
// seq196 探针契约：probe(url, method, status, envelopePayload) → {action, violations}（api-schema-validator.createContractResponseProbe 产物）。
let responseSchemaProbe = null;
function setResponseSchemaProbe(probe) {
  responseSchemaProbe = typeof probe === "function" ? probe : null;
}
function getResponseSchemaProbe() {
  // seq196：默认 enforce（未设=开）；"0"=显式关闭；其余值（含 legacy "1"）=开。
  if (process.env.API_RESPONSE_SCHEMA_CHECK === "0") return null;
  return responseSchemaProbe;
}

module.exports = {
  createTraceId, okEnvelope, errorEnvelope, errorCodeForStatus, buildEnvelope, sendJSON,
  setResponseSchemaProbe, getResponseSchemaProbe, __getResponseSchemaProbe: getResponseSchemaProbe,
};
