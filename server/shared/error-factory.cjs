// Component: ErrorFactory — 全仓唯一错误构造工厂（EG-1b，ADR060「31/33 工厂→1 共享工厂」收敛落点）
// @responsible: 统一错误对象构造——code/message/status/details 四字段单一实现，消除本地工厂形状漂移
// @inputs: 错误码、消息、HTTP 状态码（或选项对象）、结构化明细
// @outputs: 带 code/status/details 附加字段的 Error 实例
// @context: Pipeline
//
// 契约（规则 8/30）：
//   - 本模块是 server/ 内唯一的错误工厂**实现体**；各业务文件通过 `const { createError: xError } = require(...)` 或
//     `const xError = bindErrorFactory({ status })` 获得本地视图，禁止再写本地工厂定义（error-factory.test.cjs T7 强制）。
//   - 本工厂不持有错误码表（第二账本禁令，规则 30 身份判定）——错误码唯一事实源 = 抛点真身，
//     账本 = server/shared/error-registry.generated.cjs（由 gen:error-registry 从抛点扫描**生成**，
//     PR-158 副本→计算第一刀：出生即账，账本是派生物不是手抄）。
//   - 出生校验（PR-158）：CHEESE_ERROR_STRICT=1 时未知码即炸（出生未登记=构造失败）——测试/门禁面执法；
//     生产面可用性优先：只发一次结构化 warn 不拦截（错误路径永不因账本过期而崩溃）。
//   - 零语义原则：status 显式传入才挂载（undefined 不设字段），无 status 的错误经 http-app 错误处理器仍 fallback 500——
//     与收敛前各本地工厂的缺省行为逐字节一致。

const path = require("path");

let registryCache;       // { codes } | null（文件缺失/解析失败=无账本，出生校验整体旁路）
let warnedUnknown = new Set();
let strictMode = null;   // 惰性求值一次

function loadRegistry() {
  if (registryCache !== undefined) return registryCache;
  try {
    registryCache = require("./error-registry.generated.cjs");
  } catch {
    registryCache = null; // 生成物缺失（如全新检出未跑生成器）：旁路校验，门禁负责 freshness
  }
  return registryCache;
}

function isStrict() {
  if (strictMode === null) strictMode = process.env.CHEESE_ERROR_STRICT === "1";
  return strictMode;
}

function assertCodeBorn(code) {
  const registry = loadRegistry();
  if (!registry || !registry.codes) return; // 无账本：旁路（freshness 由 check:error-registry 保证）
  if (registry.codes[code]) return;
  if (isStrict()) {
    throw new Error(`错误码出生未登记：'${code}' 不在 error-registry.generated.cjs——先在抛点真身处使用，再运行 npm run gen:error-registry（PR-158 出生即账）`);
  }
  if (!warnedUnknown.has(code)) {
    warnedUnknown.add(code);
    // 零依赖告警（json-logger 是 main 装配的实例，工厂不持有）——可用性优先，只发一次
    process.emitWarning(`错误码未登记：${code}（运行 npm run gen:error-registry 再生成账本）`, "ErrorFactoryUnregisteredCode");
  }
}

function createError(code, message, statusOrOptions, details) {
  assertCodeBorn(code);
  const error = new Error(message);
  error.code = code;
  let resolvedStatus = statusOrOptions;
  let resolvedDetails = details;
  if (statusOrOptions && typeof statusOrOptions === "object") {
    resolvedStatus = statusOrOptions.status;
    resolvedDetails = statusOrOptions.details !== undefined ? statusOrOptions.details : details;
  }
  if (typeof resolvedStatus === "number") error.status = resolvedStatus;
  if (resolvedDetails !== undefined) error.details = resolvedDetails;
  return error;
}

// 带默认值语义的本地视图绑定：等价于原「function serviceError(code, message, status = 400, details)」的缺省行为——
// 调用点少传 status 时使用 defaults.status，显式传参时以显式值为准。
function bindErrorFactory(defaults) {
  const defaultStatus = defaults && typeof defaults.status === "number" ? defaults.status : undefined;
  return function boundError(code, message, status, details) {
    return createError(code, message, status === undefined ? defaultStatus : status, details);
  };
}

// 三参 details 形态绑定用（原 typedError(code, message, details)/contractError(code, message, details) 家族）：
// details 固定挂第三参、不涉 status——与 createError 的 statusOrOptions 位不兼容，故提供独立导出。
function createErrorWithDetails(code, message, details) {
  return createError(code, message, undefined, details);
}

// PR-158：注册物读取口（自证/工具用）——返回 null 表示账本缺失。
function listErrorCodes() {
  const registry = loadRegistry();
  return registry && registry.codes ? Object.keys(registry.codes).sort() : null;
}

module.exports = { createError, bindErrorFactory, createErrorWithDetails, listErrorCodes, assertCodeBorn };
