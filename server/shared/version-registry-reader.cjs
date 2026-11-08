// Component: Version-Registry-Reader
// @responsible: 只读读取并规范化 TheSchema/versions.yaml 产品版本注册表。
// @inputs: versions.yaml、schema-config 权威产品名
// @outputs: 规范化后的 { schema_version, products, diagnostics, revision, sourceFile, summary }
// @context: Canvas
//
// 只读查询契约：供 analysis(version-registry-service) 与 admission(compliance-rule-set) 共同消费，
// 因此落在 shared，避免 admission 直接依赖 analysis 服务。写命令仍留在 version-registry-service。

const crypto = require("crypto");
const fs = require("fs");
const YAML = require("yaml");
const vaultPaths = require("../vault-paths.cjs");
const { resolveArchitectureProduct } = require("./schema-config.cjs");
const { validateVersionRegistry } = require("./version-contract.cjs");
// PR-053：versions.yaml 形态收口走 TheSchema 通用咽喉（contracts/theschema.versions.schema.json 唯一形态源）
const { normalizeDocument } = require("./theschema-loader.cjs");

const DEFAULT_RAW = "schema_version: 1\nproducts: {}\n";

function revision(raw) {
  return "sha256:" + crypto.createHash("sha256").update(raw).digest("hex");
}

const { createError: readerError } = require("./error-factory.cjs");

function readRegistryFile(vaultPath) {
  // WP-049 余量批：原文经词表装载端口（CST 解析/revision 照旧；缺件→DEFAULT_RAW 保持）；
  // filePath 保留原解析（展示/返回面——与端口阶梯同源）
  const filePath = vaultPaths.getVersionsFilePath(vaultPath);
  const { loadVocabBundle } = require("./vocab-load-port.cjs");
  const vfile = loadVocabBundle(vaultPath, { files: ["versions"] }).files.versions;
  const raw = vfile && vfile.state === "present" ? vfile.text : DEFAULT_RAW;
  let doc;
  try {
    doc = YAML.parseDocument(raw);
    if (doc.errors && doc.errors.length) throw doc.errors[0];
  } catch (error) {
    throw readerError("YAML_PARSE_FAILED", error.message, 500);
  }
  // PR-053：形态收口（宽容→严格→局部降级）。CST doc 保留原样供写侧 CST 写回；data 供语义校验与消费。
  const normalized = normalizeDocument("versions", doc.toJSON() || {});
  return {
    filePath,
    raw,
    revision: revision(raw),
    doc,
    data: normalized.data,
    normalizationTrail: normalized.normalizationTrail,
    degradedNodes: normalized.degradedNodes,
  };
}

function summary(registry, diagnostics) {
  const entries = Object.values(registry.products || {}).flatMap((definition) => Array.isArray(definition.versions) ? definition.versions : []);
  return {
    totalProducts: Object.keys(registry.products || {}).length,
    totalVersions: entries.length,
    draft: entries.filter((item) => item.status === "draft").length,
    released: entries.filter((item) => item.status === "released").length,
    deprecated: entries.filter((item) => item.status === "deprecated").length,
    errors: diagnostics.length,
  };
}

function buildRegistryResponse(current, validation) {
  const registry = validation.registry || { schema_version: 1, products: {} };
  return {
    schema_version: registry.schema_version,
    products: registry.products,
    diagnostics: validation.diagnostics,
    revision: current.revision,
    sourceFile: current.filePath, // 验收批：报告真实解析路径（SPEC-023 迁仓后=data/theschema/…；钉扎态如实报告钉扎位）
    summary: summary(registry, validation.diagnostics),
  };
}

function registryInput(payload) {
  return {
    schema_version: payload && payload.schema_version,
    products: payload && payload.products,
  };
}

function canonicalizeRegistryProducts(vaultPath, payload) {
  const input = registryInput(payload);
  if (!input.products || typeof input.products !== "object" || Array.isArray(input.products)) return input;
  const products = {};
  for (const [product, definition] of Object.entries(input.products)) {
    const canonical = resolveArchitectureProduct(vaultPath, product);
    if (!products[canonical]) {
      products[canonical] = definition;
      continue;
    }
    const existingVersions = Array.isArray(products[canonical]?.versions) ? products[canonical].versions : [];
    const incomingVersions = Array.isArray(definition?.versions) ? definition.versions : [];
    products[canonical] = { versions: [...existingVersions, ...incomingVersions] };
  }
  return { ...input, products };
}

// Read-only registry projection identical to the version-registry service's getRegistry().
function readVersionRegistry(vaultPath) {
  const current = readRegistryFile(vaultPath);
  return buildRegistryResponse(current, validateVersionRegistry(canonicalizeRegistryProducts(vaultPath, current.data)));
}

module.exports = { buildRegistryResponse, canonicalizeRegistryProducts, readRegistryFile, readVersionRegistry, revision };
