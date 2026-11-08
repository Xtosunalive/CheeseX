// @responsible: 语义架构工件的消费方视图（PR-084：读侧唯一咽喉 frozen-artifact-reader 的 SA 槽适配层）。
// PR-082（Master 2026-10-20 批）：SA 是②类派生投影——读 derived-index.db artifacts 通用槽。
// PR-084（Master 2026-10-20 开工）：读取与空态语义收口到注册制咽喉（contracts/frozen-artifacts.registry.json
// 的 sa 槽）；本模块只保留 SA 专属视图（组件标识归一/新鲜度），不再自带存储读与判空——
// 「无数据零值渲染」在咽喉实现一次，本层 present=false 映射为各视图的空输出。
const { readFrozenArtifactState } = require("../../shared/frozen-artifact-reader.cjs");

/** Registry expectedFormatVersion（sa 槽）——契约测试口径锚点，事实源在注册表 "1.0"。 */
const EXPECTED_FORMAT_VERSION = "1.0";

let _vaultPath = null;
function setVaultPath(p) { _vaultPath = p; }

/** 咽喉状态视图：{ present, reason, data }——需区分空态的消费方用这个。 */
function readSemanticArchitectureState() {
  if (!_vaultPath) throw new Error("vaultPath not configured");
  return readFrozenArtifactState(_vaultPath, "sa");
}

/** 文档视图：直接返回 SA 文档（无数据＝注册表零值形状，可直接渲染）——形状消费方用这个。 */
function readSemanticArchitecture() {
  return readSemanticArchitectureState().data;
}

// Rule 9: normalizeComponentId — explicit normalization, no bare type casts
function normalizeComponentId(id) {
  if (typeof id === "string") return id.trim();
  if (typeof id === "number") return String(id);
  if (Array.isArray(id)) return id.length > 0 ? normalizeComponentId(id[0]) : "";
  if (id && typeof id === "object" && id.id) return normalizeComponentId(id.id);
  return "";
}

function getComponentIds() {
  const { present, data } = readSemanticArchitectureState();
  if (!present) return [];
  const components = Array.isArray(data.components) ? data.components : [];
  return [...new Set(components.map(c => normalizeComponentId(c.id || c)).filter(Boolean))];
}

// Rule 11: data freshness check
// PR-081 回归口径：无数据 reason 恒为 "file_not_found"（absent/store_unreadable/corrupt 统一——
// 前端与测试只关心「没有可用数据」，存储层细分原因留在咽喉事件日志）。
function validateFreshness(maxAgeHours = 24) {
  const { present, data } = readSemanticArchitectureState();
  if (!present) return { fresh: false, reason: "file_not_found" };
  const updatedAt = data._generated_at || data.generatedAt || data.generated_at || data.updatedAt || data.updated_at;
  if (!updatedAt) return { fresh: false, reason: "no_timestamp" };
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  return { fresh: ageHours <= maxAgeHours, ageHours: Math.round(ageHours * 10) / 10, updatedAt, version: data.version || "unknown" };
}

module.exports = { setVaultPath, readSemanticArchitecture, readSemanticArchitectureState, normalizeComponentId, getComponentIds, validateFreshness, EXPECTED_FORMAT_VERSION };
