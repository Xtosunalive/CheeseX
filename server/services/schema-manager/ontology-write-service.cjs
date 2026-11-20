// Component: Ontology-Write-Service
// @responsible: 为 ontology.yaml 提供 revision 校验、CST 保留和原子写入。
// @inputs: ontology.yaml、Document mutate/validate 回调、expectedRevision
// @outputs: 写后 data/raw/revision
// @context: Schema-Manager
// Mirrors enums-write-service.cjs pattern.

const crypto = require("crypto");
const fs = require("fs");
const YAML = require("yaml");
const vaultPaths = require("../../vault-paths.cjs");
// PR-053：ontology.yaml 形态收口走 TheSchema 通用咽喉（contracts/theschema.ontology.schema.json 唯一形态源）
const { normalizeDocument } = require("../../shared/theschema-loader.cjs");

function revision(raw) {
  return "sha256:" + crypto.createHash("sha256").update(raw).digest("hex");
}

const { createError: serviceError } = require("../../shared/error-factory.cjs");

// WP-185 走查尾巴（跨重启自动回滚）：解析段从文件读取中拆出——git 历史回滚源拿到的是 raw 文本，
// 需要与工作副本同款解析形态（parse→normalize→degradedNodes），不得另写第二套解析。
function parseOntologyRaw(raw, vaultPath) {
  var doc;
  try {
    doc = raw ? YAML.parseDocument(raw) : new YAML.Document();
    if (doc.errors && doc.errors.length) throw doc.errors[0];
  } catch (error) {
    throw serviceError("YAML_PARSE_FAILED", error.message, 500);
  }
  // PR-053：形态收口（宽容→严格→局部降级）。CST doc 保留原样供写侧 CST 写回；data 为规范化视图。
  var normalized = normalizeDocument("ontology", doc.toJSON() || {});
  return {
    filePath: vaultPath ? vaultPaths.getOntologyFilePath(vaultPath) : undefined,
    raw: raw,
    revision: revision(raw),
    doc: doc,
    data: normalized.data,
    normalizationTrail: normalized.normalizationTrail,
    degradedNodes: normalized.degradedNodes,
  };
}

function readOntology(vaultPath) {
  var filePath = vaultPaths.getOntologyFilePath(vaultPath);
  var raw = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  return { ...parseOntologyRaw(raw, vaultPath), filePath: filePath };
}

// Phase 8 snapshot helpers（C3-A2 删除后零消费者：writeSnapshot 唯一消费者是已删的
// schema-change-set-service；listSnapshots 无路由使用——enums-routes 用的是 enums-write-service 版本）
module.exports = { readOntology, parseOntologyRaw, revision };
