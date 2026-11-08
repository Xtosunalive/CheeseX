// Component: Entity-Compliance-Helpers
// @responsible: Shared normalization and finding helpers for entity compliance.
// @inputs: 未规范化字段值与规则参数
// @outputs: 规范化值、比较结果与 finding 对象
// @context: Vault

// eslint-disable-next-line no-restricted-syntax -- 单源定义处（seq195 立法：KEBAB_RE 唯一事实源）
var KEBAB_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
var DATE_RE = require("../../../shared/date-contract.mjs").DATE_PATTERN; // seq208：date 形状单源引用（shared/date-contract 唯一载体）
// eslint-disable-next-line no-restricted-syntax -- 单源定义处（seq195 立法：SEMVER_RE 唯一事实源）
var SEMVER_RE = /^\d+\.\d+(\.\d+)?([.-].+)?$/;

function normalizeString(val) {
  if (typeof val === "string") return val.trim();
  if (typeof val === "number") return String(val);
  if (typeof val === "boolean") return String(val);
  if (Array.isArray(val)) {
    if (val.length === 0) return "";
    return normalizeString(val[0]);
  }
  return "";
}

function isKebabCase(s) {
  if (!s || typeof s !== "string") return false;
  return KEBAB_RE.test(s.trim());
}

function isDateString(s) {
  if (!s || typeof s !== "string") return false;
  return DATE_RE.test(s.trim());
}

function isSemverLike(s) {
  if (!s || typeof s !== "string") return false;
  return SEMVER_RE.test(s.trim());
}

function compareSemver(a, b) {
  var aParts = String(a).trim().split(".").map(Number);
  var bParts = String(b).trim().split(".").map(Number);
  var len = Math.max(aParts.length, bParts.length);
  for (var i = 0; i < len; i++) {
    var av = aParts[i] || 0;
    var bv = bParts[i] || 0;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

function finding(ruleId, label, severity, passed, opts) {
  opts = opts || {};
  return {
    ruleId: ruleId,
    field: opts.field || undefined,
    label: label,
    severity: severity,
    passed: passed,
    value: opts.value !== undefined ? opts.value : null,
    expected: opts.expected || undefined,
    message: opts.message || (passed ? "通过" : "检查未通过"),
    hint: opts.hint || "",
    unresolvedTargets: Array.isArray(opts.unresolvedTargets) ? opts.unresolvedTargets : undefined,
    unknownRelations: Array.isArray(opts.unknownRelations) ? opts.unknownRelations : undefined,
    _group: opts._group,
  };
}

module.exports = {
  normalizeString: normalizeString,
  KEBAB_RE: KEBAB_RE,
  DATE_RE: DATE_RE,
  SEMVER_RE: SEMVER_RE,
  isKebabCase: isKebabCase,
  isDateString: isDateString,
  isSemverLike: isSemverLike,
  compareSemver: compareSemver,
  finding: finding,
};
