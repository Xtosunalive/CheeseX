// Component: Version-Contract
// @responsible: 归一化产品版本、比较半开有效区间并校验版本注册表。
// @inputs: versions.yaml、文章 product/version、组件与关系 since/until
// @outputs: 规范化版本值、诊断和可复用有效期判断
// @context: Vault

const VERSION_PATTERN = /^v?\d+(?:\.\d+){1,3}$/i;
// eslint-disable-next-line no-restricted-syntax -- 单源定义处（seq195 立法：SNAPSHOT_HASH_PATTERN 唯一事实源，消费方一律 require 此处）
const SNAPSHOT_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
// date 形状单源自 shared/date-contract.mjs（seq208：全库唯一载体，前端/checker 同引；node≥22 require(esm)）
const DATE_PATTERN = require("../../shared/date-contract.mjs").DATE_PATTERN;
const VERSION_STATUSES = new Set(["draft", "released", "deprecated"]);

const { createErrorWithDetails: contractError, createError } = require("./error-factory.cjs");

// PR-153：版本串形态错属输入校验错（400 族）——此前经 createErrorWithDetails 不带 status，路由兜底成 500，
// 再被响应契约执法按「未登记 500 码」拦成 INTERNAL_ERROR，真实拒因（版本格式）被掩蔽。补挂显式 400。
function normalizeVersion(value) {
  if (typeof value !== "string") {
    throw createError("INVALID_VERSION_TYPE", "版本必须是字符串", 400, { receivedType: Array.isArray(value) ? "array" : typeof value });
  }
  const raw = value.trim();
  if (!VERSION_PATTERN.test(raw)) {
    throw createError("INVALID_VERSION", "版本必须是 X.Y 到 X.Y.Z.W 格式的精确版本号", 400, { value: raw });
  }
  return raw.replace(/^v/i, "").split(".").map((part) => String(Number.parseInt(part, 10))).join(".");
}

function optionalVersion(value) {
  if (value === undefined || value === null || value === "") return null;
  return normalizeVersion(value);
}

function compareVersion(left, right) {
  const leftParts = normalizeVersion(left).split(".").map(Number);
  const rightParts = normalizeVersion(right).split(".").map(Number);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

function sortVersions(values) {
  if (!Array.isArray(values)) throw contractError("INVALID_VERSION_LIST", "版本列表必须是数组");
  return values.map(normalizeVersion).sort(compareVersion);
}

function isActiveAt(version, since, until) {
  const target = normalizeVersion(version);
  const start = optionalVersion(since);
  const end = optionalVersion(until);
  if (start && compareVersion(target, start) < 0) return false;
  if (end && compareVersion(target, end) >= 0) return false;
  return true;
}

function diagnostic(code, message, path, details) {
  return { severity: "error", code, message, path, details: details || null };
}

function normalizeSnapshot(value, path, diagnostics) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    diagnostics.push(diagnostic("INVALID_SNAPSHOT", "版本快照必须是对象或 null", path));
    return null;
  }
  const snapshotPath = typeof value.path === "string" ? value.path.trim() : "";
  const sha256 = typeof value.sha256 === "string" ? value.sha256.trim().toLowerCase() : "";
  const generatedAt = typeof value.generated_at === "string" ? value.generated_at.trim() : "";
  if (!snapshotPath) diagnostics.push(diagnostic("SNAPSHOT_PATH_REQUIRED", "版本快照路径不能为空", path + ".path"));
  if (!SNAPSHOT_HASH_PATTERN.test(sha256)) diagnostics.push(diagnostic("INVALID_SNAPSHOT_HASH", "版本快照必须包含 sha256 校验值", path + ".sha256"));
  if (!generatedAt || Number.isNaN(Date.parse(generatedAt))) diagnostics.push(diagnostic("INVALID_SNAPSHOT_TIME", "版本快照生成时间必须是 ISO 日期时间", path + ".generated_at"));
  return { path: snapshotPath, sha256, generated_at: generatedAt };
}

function normalizeRegistryVersion(value, path, diagnostics) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    diagnostics.push(diagnostic("INVALID_VERSION_ENTRY", "产品版本条目必须是对象", path));
    return null;
  }
  let id = "";
  try {
    id = normalizeVersion(value.id);
  } catch (error) {
    diagnostics.push(diagnostic(error.code || "INVALID_VERSION", error.message, path + ".id", error.details));
  }
  const label = typeof value.label === "string" ? value.label.trim() : "";
  if (!label) diagnostics.push(diagnostic("VERSION_LABEL_REQUIRED", "产品版本名称不能为空", path + ".label"));
  const status = typeof value.status === "string" ? value.status.trim() : "";
  if (!VERSION_STATUSES.has(status)) diagnostics.push(diagnostic("INVALID_VERSION_STATUS", "版本状态必须是 draft、released 或 deprecated", path + ".status"));
  const releaseDate = value.release_date === null || value.release_date === undefined ? null : value.release_date;
  if (releaseDate !== null && (typeof releaseDate !== "string" || !DATE_PATTERN.test(releaseDate) || Number.isNaN(Date.parse(releaseDate + "T00:00:00Z")))) {
    diagnostics.push(diagnostic("INVALID_RELEASE_DATE", "发布日期必须是 YYYY-MM-DD 或 null", path + ".release_date"));
  }
  const aliases = [];
  if (!Array.isArray(value.aliases)) {
    diagnostics.push(diagnostic("INVALID_VERSION_ALIASES", "版本别名必须是字符串数组", path + ".aliases"));
  } else {
    const localAliases = new Set();
    value.aliases.forEach((alias, index) => {
      if (typeof alias !== "string" || !alias.trim()) {
        diagnostics.push(diagnostic("INVALID_VERSION_ALIAS", "版本别名不能为空", path + ".aliases[" + index + "]"));
        return;
      }
      const normalizedAlias = alias.trim();
      const key = normalizedAlias.toLocaleLowerCase("en-US");
      if (localAliases.has(key)) diagnostics.push(diagnostic("DUPLICATE_VERSION_ALIAS", "同一版本中存在重复别名", path + ".aliases[" + index + "]"));
      else {
        localAliases.add(key);
        aliases.push(normalizedAlias);
      }
    });
  }
  const snapshot = normalizeSnapshot(value.snapshot, path + ".snapshot", diagnostics);
  if (status === "released" && !snapshot) diagnostics.push(diagnostic("RELEASED_SNAPSHOT_REQUIRED", "已发布版本必须绑定不可变快照", path + ".snapshot"));
  return { id, label, status, release_date: releaseDate, aliases, snapshot };
}

function validateVersionRegistry(value) {
  const diagnostics = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, diagnostics: [diagnostic("INVALID_VERSION_REGISTRY", "版本注册表必须是对象", "$")], registry: null };
  }
  if (value.schema_version !== 1) diagnostics.push(diagnostic("UNSUPPORTED_SCHEMA_VERSION", "versions.yaml schema_version 必须为 1", "$.schema_version"));
  if (!value.products || typeof value.products !== "object" || Array.isArray(value.products)) {
    diagnostics.push(diagnostic("INVALID_PRODUCTS", "products 必须是对象", "$.products"));
    return { valid: false, diagnostics, registry: { schema_version: 1, products: Object.create(null) } };
  }
  // WP-050 D1：重建产物 null 原型——内容键（文章 product）直取原型命中不可表达
  const products = Object.create(null);
  for (const [product, definition] of Object.entries(value.products)) {
    const productPath = "$.products." + product;
    if (!product.trim()) diagnostics.push(diagnostic("PRODUCT_ID_REQUIRED", "产品 ID 不能为空", productPath));
    if (!definition || typeof definition !== "object" || Array.isArray(definition) || !Array.isArray(definition.versions)) {
      diagnostics.push(diagnostic("INVALID_PRODUCT_VERSIONS", "产品版本必须是数组", productPath + ".versions"));
      products[product] = { versions: [] };
      continue;
    }
    const seenIds = new Map();
    const seenAliases = new Map();
    const versions = definition.versions.map((entry, index) => normalizeRegistryVersion(entry, productPath + ".versions[" + index + "]", diagnostics)).filter(Boolean);
    versions.forEach((entry, index) => {
      if (entry.id) {
        if (seenIds.has(entry.id)) diagnostics.push(diagnostic("DUPLICATE_VERSION", "产品版本 ID 归一化后重复", productPath + ".versions[" + index + "].id", { firstIndex: seenIds.get(entry.id) }));
        else seenIds.set(entry.id, index);
      }
      for (const alias of entry.aliases) {
        const key = alias.toLocaleLowerCase("en-US");
        if (seenAliases.has(key)) diagnostics.push(diagnostic("DUPLICATE_VERSION_ALIAS", "产品版本别名重复", productPath + ".versions[" + index + "].aliases", { firstIndex: seenAliases.get(key) }));
        else seenAliases.set(key, index);
      }
    });
    for (const [id, index] of seenIds) {
      const aliasOwner = seenAliases.get(id.toLocaleLowerCase("en-US"));
      if (aliasOwner !== undefined) diagnostics.push(diagnostic("VERSION_ALIAS_COLLIDES_WITH_ID", "版本别名不能与产品版本 ID 相同", productPath + ".versions[" + aliasOwner + "].aliases", { versionIndex: index }));
    }
    versions.sort((left, right) => left.id && right.id ? compareVersion(left.id, right.id) : left.id ? -1 : 1);
    products[product] = { versions };
  }
  return { valid: diagnostics.length === 0, diagnostics, registry: { schema_version: 1, products } };
}

module.exports = {
  VERSION_PATTERN,
  SNAPSHOT_HASH_PATTERN,
  DATE_PATTERN,
  compareVersion,
  isActiveAt,
  normalizeVersion,
  optionalVersion,
  sortVersions,
  validateVersionRegistry,
};
