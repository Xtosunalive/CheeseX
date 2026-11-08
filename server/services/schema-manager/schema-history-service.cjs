// Component: Schema-History-Service
// @responsible: ontology/dependencies 的历史列表与回滚（G10·PR-020 批3 建；SPEC-023 波 3 改向 git 历史适配器）
// @inputs: vaultPath + category（ontology|dependencies）+ expectedRevision + snapshotId
// @outputs: 快照列表 / 回滚后 revision
// @context: fs 快照仪式已退役——git 历史即快照（listSnapshots=git log，rollback=git show＋repoWrite）。

const path = require("node:path");
const YAML = require("yaml");
const { resolveTheSchemaDir } = require("../../shared/theschema-root.cjs");
const { repoWrite, listGitSnapshots, readGitSnapshot } = require("../../shared/repo-schema-io.cjs");
const { createError: serviceError } = require("../../shared/error-factory.cjs");
const { assertRevisionGiven } = require("../../shared/schema-write-guards.cjs");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SCHEMA_FILES = {
  ontology: "ontology.yaml",
  dependencies: "dependencies.yaml",
};

function revision(raw) {
  return "sha256:" + require("node:crypto").createHash("sha256").update(raw).digest("hex");
}

function schemaFilePath(vaultPath, category) {
  return path.join(resolveTheSchemaDir(vaultPath), SCHEMA_FILES[category]);
}

function repoRel(absPath) {
  return path.relative(ROOT, absPath).split(path.sep).join("/");
}

// 〔退役〕写点不再自动存 fs 快照（保留签名供 schema-write-service 既有调用——no-op）
function writeSnapshot(_vaultPath, _category, _raw) {
  return { retired: true };
}

function listSnapshots(vaultPath, category) {
  return listGitSnapshots(repoRel(schemaFilePath(vaultPath, category)));
}

function rollbackSnapshot(vaultPath, category, expectedRevision, snapshotId, io) {
  // io 注入面（回归承载用）：默认走真实 git 历史与 repoWrite。存在的理由不是「生产要换实现」，
  // 而是本体件的可测性——resolver 在 vault 无 知识库/TheSchema/enums.yaml 时回落**仓内** data/theschema
  // （theschema-root.cjs:30-32），夹具若走真实 io 绿例就会改写仓内真件（PR-177 同族污染）；
  // 生产调用方（schema-write-service 两处）不传 io，行为逐字节不变。
  const readSnapshot = (io && io.readGitSnapshot) || readGitSnapshot;
  const write = (io && io.repoWrite) || repoWrite;
  if (!/^[0-9a-f]{7,40}$/.test(snapshotId || "")) throw serviceError("INVALID_SNAPSHOT_ID", "Invalid snapshot id", 400);
  const filePath = schemaFilePath(vaultPath, category);
  // WP-049 余量批：当前原文经词表装载端口（text＝同字节；缺件→"" 保持）
  const { loadVocabBundle } = require("../../shared/vocab-load-port.cjs");
  const hfile = loadVocabBundle(vaultPath, { files: [category] }).files[category];
  const currentRaw = hfile && hfile.state === "present" ? hfile.text : "";
  // PR-194（闸形与码随 PR-200 归一到单点执法）：回滚也是写，乐观锁是强制要件（SPEC-009 W9）——
  // 缺 expectedRevision 即拒，不得短路跳过比对。缺席文件也给出基线（currentRaw=""→sha256 恒可算）。
  assertRevisionGiven(expectedRevision, `${category} 回滚`);
  if (revision(currentRaw) !== expectedRevision) {
    throw serviceError("SCHEMA_REVISION_CONFLICT", `${category} changed after it was loaded`, 409);
  }
  let raw;
  try {
    raw = readSnapshot(repoRel(filePath), snapshotId);
  } catch (e) {
    if (e.code === "INVALID_SNAPSHOT_ID") throw serviceError("INVALID_SNAPSHOT_ID", e.message, 400);
    throw serviceError("SNAPSHOT_NOT_FOUND", "Schema snapshot not found", 404);
  }
  const parsed = YAML.parseDocument(raw);
  if (parsed.errors && parsed.errors.length) throw serviceError("SNAPSHOT_INVALID", parsed.errors[0].message, 409);
  if (category === "ontology") {
    // PR-178 收口：回滚也是写——旧快照把 retired 元素复位成现役即原地复活，与 PUT 同经迁移判定
    const { assertDocumentTransitions } = require("./ontology-lifecycle-transition.cjs");
    const { assertTransitionConditions } = require("./ontology-lifecycle-conditions.cjs");
    const previousDoc = currentRaw ? YAML.parse(currentRaw) : {};
    const nextDoc = parsed.toJS();
    const lifecycleErrors = assertDocumentTransitions(previousDoc, nextDoc);
    if (lifecycleErrors.length) {
      throw serviceError("VALIDATION_ERROR", lifecycleErrors[0] + (lifecycleErrors.length > 1 ? `（同类拒绝共 ${lifecycleErrors.length} 条）` : ""), 400);
    }
    const { errors: conditionErrors, anchorErrors } = assertTransitionConditions(previousDoc, nextDoc);
    if (conditionErrors.length) {
      throw serviceError("VALIDATION_ERROR", conditionErrors[0] + (conditionErrors.length > 1 ? `（附加条件拒绝共 ${conditionErrors.length} 条）` : ""), 400);
    }
    if (anchorErrors.length) {
      throw serviceError("CAPABILITY_CONSUMER_ANCHOR_INVALID", anchorErrors[0], 422, { errors: anchorErrors });
    }
  }
  write(filePath, raw, { summary: `${category} 回滚写回（git 快照）` });
  return { category, revision: revision(raw) };
}

module.exports = { writeSnapshot, listSnapshots, rollbackSnapshot };
