"use strict";

// Component: Type-Contract 装载口（WP-228）——三源现编译（ADR-015 写时算：本体写后即变，
// 不静默读旧值）。boot/装载期各调一次；失败大声记日志并返回 error——个体写动作据此 fail-closed
// （SPEC-101 §3.4-1：契约取不到＝拒绝写入），读面允许降级。
const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");
const { compileTypeCatalog } = require("./compile-type-catalog.cjs");

function loadTypeCatalog(rootDir) {
  const read = (p) => fs.readFileSync(path.join(rootDir, p), "utf8");
  try {
    const catalog = compileTypeCatalog({
      ontology: YAML.parse(read("data/theschema/ontology.yaml")),
      fields: YAML.parse(read("data/theschema/fields.yaml")),
      dictionary: JSON.parse(read("contracts/object-dictionary.json")),
      enums: YAML.parse(read("data/theschema/enums.yaml")),
    });
    return { catalog, error: null };
  } catch (error) {
    return { catalog: null, error: String(error.message) };
  }
}

// 服务端写执法口径（§3.4-1）：个体通道只对 storage.kind=markdown-individual 且非 system_projection
// 且 renderer 非 custom:* 的种类放行；契约缺位＝拒绝（fail-closed）。
function individualWriteAllowed(catalog, classId) {
  if (!catalog) return { allowed: false, reason: "TYPE_CATALOG_UNAVAILABLE" };
  const entry = (catalog.entries || []).find((e) => e.type_id === classId);
  if (!entry) return { allowed: false, reason: "TYPE_NOT_IN_CATALOG" };
  if (entry.system_projection) return { allowed: false, reason: "TYPE_SYSTEM_PROJECTION" };
  if (entry.storage.kind !== "markdown-individual") return { allowed: false, reason: "TYPE_STORAGE_NOT_INDIVIDUAL" };
  if (entry.screen && String(entry.screen.renderer || "").startsWith("custom:")) return { allowed: false, reason: "TYPE_RENDERER_CUSTOM" };
  return { allowed: true, reason: null };
}

module.exports = { loadTypeCatalog, individualWriteAllowed };
