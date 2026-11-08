// Component: Entity-Compliance-Severity
// @responsible: 诊断严重度枚举单源（模式4：消除跨路径手写 severity 字符串散落）
// @inputs: 无
// @outputs: SEVERITY 枚举 + 归一化 helper
// @context: Vault — #940 模式4 诊断分级枚举固化
//
// 三级制对齐 #939/#862：BLOCKER=error(阻断) / SUGGESTION=warn(建议) / REFERENCE=info(参考)。
// 所有 entity-readiness 诊断的 severity 必须来自 rules.json（声明式）或本枚举的归一化函数，
// 禁止在引擎/service/routes 里手写 "error"/"warn"/"blocker"/"warning" 字符串做比较或赋值。

// 唯一枚举（写入值）：new 命名对齐 rules.json 的 error/warn/info
const SEVERITY = Object.freeze({
  ERROR: "error",        // 阻断（旧 blocker）
  WARN: "warn",          // 建议（旧 warning）
  INFO: "info",          // 参考
});

// legacy 别名 → 枚举（消费旧 finding 时归一化，避免散落 "blocker"/"warning" 比较）
const LEGACY_ALIASES = Object.freeze({
  blocker: SEVERITY.ERROR,
  error: SEVERITY.ERROR,
  warning: SEVERITY.WARN,
  warn: SEVERITY.WARN,
  info: SEVERITY.INFO,
});

/** 归一化任意 severity 输入为枚举值（未知值 fallback warn）。 */
function normalizeSeverity(value) {
  if (value === undefined || value === null) return SEVERITY.WARN;
  return LEGACY_ALIASES[String(value).toLowerCase()] || SEVERITY.WARN;
}

/** 是否阻断（error 级）。 */
function isBlocking(value) {
  return normalizeSeverity(value) === SEVERITY.ERROR;
}

/** 是否建议（warn 级）。 */
function isSuggestion(value) {
  return normalizeSeverity(value) === SEVERITY.WARN;
}

/** 是否参考（info 级）。 */
function isReference(value) {
  return normalizeSeverity(value) === SEVERITY.INFO;
}

module.exports = {
  SEVERITY,
  LEGACY_ALIASES,
  normalizeSeverity,
  isBlocking,
  isSuggestion,
  isReference,
};
