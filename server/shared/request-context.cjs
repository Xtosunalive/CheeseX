// Component: Request-Context
// @responsible: Propagate one passive correlation id through an asynchronous request chain.

const crypto = require("node:crypto");
const { AsyncLocalStorage } = require("node:async_hooks");

const storage = new AsyncLocalStorage();
const TRACE_ID_PATTERN = /^tr_[A-Za-z0-9._:-]{8,128}$/;

function createTraceId() {
  return `tr_${crypto.randomUUID()}`;
}

function resolveTraceId(value) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === "string" && TRACE_ID_PATTERN.test(candidate)
    ? candidate
    : createTraceId();
}

function runWithRequestContext(context, callback) {
  const traceId = resolveTraceId(context && context.traceId);
  return storage.run({ ...(context || {}), traceId }, callback);
}

// PR-085：框架钩子形态下无法用 run() 包住后续生命周期，改用 enterWith——在 onRequest 钩子内进入后，
// 同一请求的后续钩子／handler／嵌套 await 均可读到（探针 E1/E2 实证并发隔离）。
// store 形状：{ traceId, principal }——principal 由第 2 步身份层（auth-stack 解析后）写入，
// operator-context.getOperatorId() 从中读取（5 个下游消费点零改动，ADR-010 决策 6）。
function enterRequestContext(context) {
  const traceId = resolveTraceId(context && context.traceId);
  const store = { principal: null, ...(context || {}), traceId };
  storage.enterWith(store);
  return store;
}

function setPrincipal(principal) {
  const store = storage.getStore();
  if (!store) throw new Error("setPrincipal 须在请求上下文内调用（onRequest 钩子后）");
  store.principal = principal;
}

function getPrincipal() {
  return storage.getStore()?.principal || null;
}

function getRequestContext() {
  return storage.getStore() || null;
}

function getTraceId() {
  return getRequestContext()?.traceId || null;
}

module.exports = {
  TRACE_ID_PATTERN,
  createTraceId,
  enterRequestContext,
  getRequestContext,
  getPrincipal,
  getTraceId,
  resolveTraceId,
  runWithRequestContext,
  setPrincipal,
};
