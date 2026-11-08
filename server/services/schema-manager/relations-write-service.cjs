// Component: Relations-Write-Service
// @responsible: EDGE-RELATION-GOV-001 对象本体批（ADR-012 D1 裁决落地，Master 2026-10-24）——
//   人工/治理关系实例账 relations.yaml 的唯一写网关：三要件（repoWrite 原子写＋git 历史快照＋
//   revision 乐观锁）＋两项对账（端点＝字典 canonical_name 在册；type∈ontology relation_types 注册表）。
// @inputs: data/theschema/relations.yaml、对象字典、ontology relation_types
// @outputs: readRelationsFile/listRelations/writeRelations/listSnapshots/rollbackSnapshot → data/raw/revision
// @context: Schema-Manager（形态样板＝enums-write-service；身份＝source|target|type 幂等覆盖）
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const YAML = require("yaml");
const vaultPaths = require("../../vault-paths.cjs");
const { createError: serviceError } = require("../../shared/error-factory.cjs");
const { listGitSnapshots, readGitSnapshot } = require("../../shared/repo-schema-io.cjs"); // 读面留此，写面改走咽喉
const { replaceTheSchemaFile } = require("../../shared/theschema-write.cjs"); // WP-079 唯一门：TheSchema 写通道由咽喉按落点选，服务侧禁自判

const { validateDocumentStrict } = require("../../shared/theschema-loader.cjs");
const { assertRevisionGiven } = require("../../shared/schema-write-guards.cjs");
const ROOT = require("node:path").resolve(__dirname, "..", "..", "..");
const repoRel = (absPath) => require("node:path").relative(ROOT, absPath).split(require("node:path").sep).join("/");

function revision(raw) {
  return "sha256:" + crypto.createHash("sha256").update(raw).digest("hex");
}

function readRelationsFile(vaultPath) {
  const filePath = vaultPaths.getRelationsFilePath(vaultPath);
  const raw = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "relations: []\n";
  let doc;
  try {
    doc = YAML.parseDocument(raw);
    if (doc.errors && doc.errors.length) throw doc.errors[0];
  } catch (error) {
    throw serviceError("YAML_PARSE_FAILED", error.message, 500);
  }
  return { filePath, raw, revision: revision(raw), data: doc.toJSON() || {} };
}

/** 端点在册对账：canonical_name 集（对象字典）。 */
function dictionaryNames() {
  const dict = JSON.parse(fs.readFileSync(require("node:path").join(ROOT, "contracts", "object-dictionary.json"), "utf8"));
  return new Set((dict.core_objects || []).map((c) => c.canonical_name));
}

/** 类型在册对账：relation_types 注册表键集（ontology.yaml，经 TheSchema 解析链）。 */
function relationTypeNames(vaultPath) {
  // WP-049 余量批：经词表装载端口（data＝同一 normalizeDocument 收口）
  const { loadVocabBundle } = require("../../shared/vocab-load-port.cjs");
  const file = loadVocabBundle(vaultPath, { files: ["ontology"] }).files.ontology;
  if (!file || file.state !== "present") return new Set();
  return new Set(Object.keys((file.data && file.data.relation_types) || {}));
}

function validateRelationsPayload(data, vaultPath, listGraphNodeIds) {
  // 形态（严格，不 coerce——写侧对自己写出的要严格）
  const shapeErrors = validateDocumentStrict("relations", data);
  if (shapeErrors.length) {
    throw serviceError("RELATIONS_INVALID", "写入结果不符合 relations 形态契约，未落盘：" + shapeErrors.join("; "), 400, { errors: shapeErrors });
  }
  const names = dictionaryNames();
  const types = relationTypeNames(vaultPath);
  // SPEC-027 C11：图域校验变体——endpoint_domain=graph 行端点对照图谱节点 id（实测在册率 0%，字典校验必拒）；
  // 未接线即 fail-closed（装配缺陷大声失败，不静默放行）
  let graphNodeIds = null;
  const rows = data.relations || [];
  if (rows.some((row) => row.endpoint_domain === "graph")) {
    if (typeof listGraphNodeIds !== "function") {
      throw serviceError("RELATIONS_INVALID", "endpoint_domain=graph 行存在但图域校验未接线（listGraphNodeIds 装配缺失）——fail-closed 拒写", 500);
    }
    graphNodeIds = new Set(listGraphNodeIds());
  }
  const seen = new Set();
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const graphRow = row.endpoint_domain === "graph";
    for (const endpoint of ["source", "target"]) {
      if (graphRow) {
        if (!graphNodeIds.has(row[endpoint])) {
          throw serviceError("RELATIONS_INVALID", `relations[${i}].${endpoint}「${row[endpoint]}」不在图谱节点集（图域悬空拒写，endpoint_domain=graph）`, 400, { index: i, field: endpoint, domain: "graph" });
        }
      } else if (!names.has(row[endpoint])) {
        throw serviceError("RELATIONS_INVALID", `relations[${i}].${endpoint}「${row[endpoint]}」不在对象字典在册名集（悬空引用拒写）`, 400, { index: i, field: endpoint });
      }
    }
    if (row.confidence_band !== undefined && !graphRow) {
      throw serviceError("RELATIONS_INVALID", `relations[${i}].confidence_band 仅 endpoint_domain=graph 行可用（治理载荷不带档位）`, 400, { index: i });
    }
    if (!types.has(row.type)) {
      throw serviceError("RELATIONS_INVALID", `relations[${i}].type「${row.type}」不在 relation_types 注册表（ ontology.yaml）`, 400, { index: i, field: "type" });
    }
    // WP-051 I-B（P2 反向址）：身份经身份入口（长度前缀编码）——含 | 的 source/target
    // 不再与其它行撞键误报「身份重复」假红 400；真同参仍正确去重报红
    const identity = require("../../shared/identity-port.cjs").makeId("rel", [row.source, row.target, row.type]);
    if (seen.has(identity)) {
      throw serviceError("RELATIONS_INVALID", `身份重复：${row.source}→${row.target}（${row.type}）（同身份只存一条）`, 400, { index: i });
    }
    seen.add(identity);
  }
}

function writeRelations(options) {
  const current = readRelationsFile(options.vaultPath);
  // PR-200：乐观锁基线必填——缺 expectedRevision 即拒（原真值判断＝不传直接覆盖盘上内容）。
  assertRevisionGiven(options.expectedRevision, "relations.yaml 写入");
  if (options.expectedRevision !== current.revision) {
    throw serviceError("RELATIONS_REVISION_CONFLICT", "relations.yaml changed after it was loaded", 409, {
      expectedRevision: options.expectedRevision,
      currentRevision: current.revision,
    });
  }
  if (!Array.isArray(options.relations)) {
    throw serviceError("RELATIONS_INVALID", "relations 必须是数组（全量写回语义）", 400);
  }
  const data = { relations: options.relations };
  validateRelationsPayload(data, options.vaultPath, options.listGraphNodeIds);
  const raw = YAML.stringify(data);
  fs.mkdirSync(require("node:path").dirname(current.filePath), { recursive: true });
  try {
    replaceTheSchemaFile(current.filePath, raw, { summary: "relations 原子写（EDGE-RELATION-GOV-001 对象本体）" });
  } catch (error) {
    throw serviceError("YAML_WRITE_FAILED", error.message, 500);
  }
  const written = readRelationsFile(options.vaultPath);
  return { data: written.data, raw: written.raw, revision: written.revision };
}

function listSnapshots(vaultPath) {
  return listGitSnapshots(repoRel(readRelationsFile(vaultPath).filePath));
}

function rollbackSnapshot(vaultPath, expectedRevision, snapshotId) {
  const current = readRelationsFile(vaultPath);
  // PR-194（码随 PR-200 归一到单点闸形）：缺 expectedRevision 即拒。relations 的 rollback 请求体原契约只 required
  // snapshotId，PR-194 按上游已签收契约补齐 revision（下游不得缩减上游契约），路由侧校验随之生效。
  assertRevisionGiven(expectedRevision, "relations.yaml 回滚");
  if (current.revision !== expectedRevision) throw serviceError("RELATIONS_REVISION_CONFLICT", "relations.yaml changed after it was loaded", 409);
  let raw;
  try {
    raw = readGitSnapshot(repoRel(current.filePath), snapshotId);
  } catch (e) {
    if (e.code === "INVALID_SNAPSHOT_ID") throw serviceError("INVALID_SNAPSHOT_ID", e.message, 400);
    throw serviceError("SNAPSHOT_NOT_FOUND", "Schema snapshot not found", 404);
  }
  const parsed = YAML.parseDocument(raw);
  if (parsed.errors && parsed.errors.length) throw serviceError("SNAPSHOT_INVALID", parsed.errors[0].message, 409);
  replaceTheSchemaFile(current.filePath, raw, { summary: "relations 回滚写回（git 快照）" });
  return readRelationsFile(vaultPath);
}

/** 选项集（前端编辑器下拉单源——字典在册名＋注册表类型＋档位名集，写校验同源，无第二事实源）。
 * WP-049 L4：bandOptions 从本体声明经端口派生（confidence-bands 单源）。 */
function listRelationOptions(vaultPath) {
  const { confidenceBandNames } = require("../../shared/confidence-bands.cjs");
  return { objectOptions: [...dictionaryNames()].sort(), typeOptions: [...relationTypeNames(vaultPath)].sort(), bandOptions: confidenceBandNames(vaultPath) };
}

// relationTypeNames 导出（PR-109）：relation_types 键集注册表读法单一事实源——
// 写闸门（本文件 type 对账）与投影值域对账（edge-projection 注入消费）共用，禁另抄读法
module.exports = { readRelationsFile, writeRelations, listSnapshots, rollbackSnapshot, listRelationOptions, relationTypeNames };
