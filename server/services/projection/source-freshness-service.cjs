// @responsible: 比较预期与实际来源修订以判定新鲜度并生成指纹。
const crypto = require("node:crypto");

function freshnessError(message) {
  const error = new Error(message);
  error.code = "INVALID_FRESHNESS_INPUT";
  return error;
}

function revision(value, field) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw freshnessError(`${field} must be a string`);
  return value.trim() || null;
}

function compareFreshness(expected = {}, actual = {}, now = () => new Date()) {
  if (!expected || typeof expected !== "object" || Array.isArray(expected)) throw freshnessError("expected must be an object");
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) throw freshnessError("actual must be an object");
  const fields = ["sourceHash", "sourceRevision", "factRevision", "ruleRevision", "snapshotHash"];
  const changedFields = fields.filter((field) => revision(expected[field], `expected.${field}`) !== revision(actual[field], `actual.${field}`));
  const hasUnknown = fields.some((field) => revision(expected[field], `expected.${field}`) === null || revision(actual[field], `actual.${field}`) === null);
  return {
    status: hasUnknown ? "unknown" : changedFields.length ? "stale" : "fresh",
    checkedAt: now().toISOString(),
    changedFields,
  };
}

function fingerprint(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw freshnessError("fingerprint input must be an object");
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(input, Object.keys(input).sort())).digest("hex")}`;
}

function createSourceFreshnessService({ now = () => new Date() } = {}) {
  function check(expected, actual) { return compareFreshness(expected, actual, now); }
  return { check, fingerprint };
}

module.exports = { createSourceFreshnessService, compareFreshness, fingerprint };
