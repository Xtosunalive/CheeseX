// Component: Enums-Write-Service
// @responsible: 为 enums.yaml 提供 revision 校验、CST 保留和原子写入。
// @inputs: enums.yaml、Document mutate/validate 回调、expectedRevision
// @outputs: 写后 data/raw/revision
// @context: Schema-Manager

const crypto = require("crypto");
const { displayTheSchemaPath } = require("../../shared/theschema-root.cjs");
const fs = require("fs");
const path = require("path");
const YAML = require("yaml");
const vaultPaths = require("../../vault-paths.cjs");
// PR-052：形态单一事实源（contracts/enums.schema.json）——写侧落盘前严格校验 + 落盘后读回自校验。
// 读侧（shared/enums-loader.cjs）宽容接住标量；写侧对自己写出的要严格（不 coerce），序列化笔误当场暴露。
const { validateEnumsStrict, normalizeEnums } = require("../../shared/enums-loader.cjs");
const { logger: defaultLogger } = require("../../shared/json-logger.cjs");

function revision(raw) {
  return "sha256:" + crypto.createHash("sha256").update(raw).digest("hex");
}

const { createError: serviceError } = require("../../shared/error-factory.cjs");
// SPEC-023 波 3：TheSchema 仓内主源——写经 repo-schema-io（git 即账）；快照三件套换 git 历史适配器（fs 快照仪式退役）
const { listGitSnapshots, readGitSnapshot } = require("../../shared/repo-schema-io.cjs"); // 读面（git 历史适配器）留此，写面改走咽喉
const { replaceTheSchemaFile } = require("../../shared/theschema-write.cjs"); // WP-079 唯一门：TheSchema 写通道由咽喉按落点选，服务侧禁自判

const { assertRevisionGiven } = require("../../shared/schema-write-guards.cjs");
const ROOT = require("node:path").resolve(__dirname, "..", "..", "..");
const repoRel = (absPath) => require("node:path").relative(ROOT, absPath).split(require("node:path").sep).join("/");

// PR-052 health 痕迹：形态偏差与写侧非规范自校验的落地位置（宽容不静默、可粘贴复核）。
// SPEC-012 WP-B：痕迹迁 telemetry.db（消费面走 API；vault 不再有 health 落盘）。
function writeNormalizationHealth(vaultPath, record) {
  try {
    const { getTelemetryStore, TRACE_KINDS } = require("../../shared/persistence/telemetry-store.cjs");
    getTelemetryStore(vaultPath).recordTrace(TRACE_KINDS.ENUMS_NORMALIZATION, record);
  } catch (_e) { /* 痕迹写不进去不得阻断读路径——痕迹是增强信息，非执法项 */ }
}

function readEnums(vaultPath) {
  const filePath = vaultPaths.getEnumsFilePath(vaultPath);
  const raw = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  let doc;
  try {
    doc = raw ? YAML.parseDocument(raw) : new YAML.Document();
    if (doc.errors && doc.errors.length) throw doc.errors[0];
  } catch (error) {
    throw serviceError("YAML_PARSE_FAILED", error.message, 500);
  }
  return { filePath, raw, revision: revision(raw), doc, data: doc.toJSON() || {} };
}

function historyDir(vaultPath) {
  return path.join(path.dirname(vaultPaths.getEnumsFilePath(vaultPath)), "history", "enums");
}

function writeSnapshot(_vaultPath, _raw) {
  // 〔SPEC-023 波 3 退役〕fs 快照仪式退役——git 历史即快照（listSnapshots/rollbackSnapshot 读 git）。
  return { retired: true };
}

function listSnapshots(vaultPath) {
  return listGitSnapshots(repoRel(readEnums(vaultPath).filePath || path.join(vaultPath, "知识库", "TheSchema", "enums.yaml")));
}

function rollbackSnapshot(vaultPath, expectedRevision, snapshotId) {  // 红队中-2 修复：回滚也是 enums.yaml 写点——解析物联动不可漏（fire-and-forget＋门禁兜底）
  try {
    const { regenerateResolvedDomainsBestEffort } = require("../../shared/regenerate-derived-projections.cjs");
    void regenerateResolvedDomainsBestEffort(vaultPath, null, "enums-rollback").catch(() => {});
  } catch {
    // 联动注入失败不阻塞回滚本体（best-effort；漂移由门禁与下次写入收敛）
  }

  // eslint-disable-next-line no-restricted-syntax -- 单源定义处（seq195 立法：snapshotId 形状校验唯一事实源）
  if (!/^[A-Za-z0-9-]+$/.test(snapshotId || "")) throw serviceError("INVALID_SNAPSHOT_ID", "Invalid snapshot id", 400);
  const current = readEnums(vaultPath);
  // PR-194（码随 PR-200 归一到单点闸形）：缺 expectedRevision 即拒——回滚也是写，乐观锁不短路。
  assertRevisionGiven(expectedRevision, "enums.yaml 回滚");
  if (current.revision !== expectedRevision) throw serviceError("ENUMS_REVISION_CONFLICT", "enums.yaml changed after it was loaded", 409);
  // SPEC-023 波 3：快照源＝git 历史（fs 快照退役）
  let raw;
  try {
    raw = readGitSnapshot(repoRel(current.filePath), snapshotId);
  } catch (e) {
    if (e.code === "INVALID_SNAPSHOT_ID") throw serviceError("INVALID_SNAPSHOT_ID", e.message, 400);
    throw serviceError("SNAPSHOT_NOT_FOUND", "Schema snapshot not found", 404);
  }
  const parsed = YAML.parseDocument(raw);
  if (parsed.errors && parsed.errors.length) throw serviceError("SNAPSHOT_INVALID", parsed.errors[0].message, 409);
  replaceTheSchemaFile(current.filePath, raw, { summary: "enums 回滚写回（git 快照）" });
  return readEnums(vaultPath);
}

function writeEnums(options) {
  const current = readEnums(options.vaultPath);
  // PR-200：乐观锁基线必填——缺 expectedRevision 即拒（原真值判断把「没传」当成「不用比」直接落盘，
  // 同族 ontology 严闸的不对称面在此闭合）。出口：先读当前 revision 再提交（读侧对缺席文件仍算基线）。
  assertRevisionGiven(options.expectedRevision, "enums.yaml 写入");
  if (options.expectedRevision !== current.revision) {
    throw serviceError("ENUMS_REVISION_CONFLICT", "enums.yaml changed after it was loaded", 409, {
      expectedRevision: options.expectedRevision,
      currentRevision: current.revision,
    });
  }
  options.mutate(current.doc, current.data);
  // PR-156 刀二：派生段随写重算——arch_categories 是矩阵 allowed_categories 并集（ADR-006 派生视图）。
  // 此前所有矩阵写路径（页面编辑/实体生长）只写矩阵不重算本段，派生段过期后启动自检报跨段悬空引用、
  // 无关保存（模块/版本）被 schema-validators 拒——「写源不派生」结构性缺口在此单点闭合：
  // 任何写路径过本事务即重算，跨段引用恒成立于构造上。矩阵取 mutate 后的文档形态（mutate 改 doc，
  // 不回写 data 引用）。
  let data = current.doc.toJSON() || {};
  const writtenMatrix = data && typeof data.subdomain_constraints === "object" && !Array.isArray(data.subdomain_constraints)
    ? data.subdomain_constraints
    : null;
  if (writtenMatrix) {
    const union = [...new Set(Object.values(writtenMatrix).flatMap((row) => (row && typeof row === "object" && Array.isArray(row.allowed_categories) ? row.allowed_categories : [])))]
      .filter((value) => typeof value === "string" && value.trim())
      .sort((left, right) => left.localeCompare(right));
    // 并集为空＝矩阵未配置（读侧同口径，schema-write-service 4c 退化角）——此时 arch_categories
    // 走 fallback 直改语义，派生不介入（否则会把 fallback 写清成空）。
    if (union.length > 0) {
      current.doc.set("arch_categories", current.doc.createNode(union));
      data = current.doc.toJSON() || {};
    }
  }
  if (options.validate) {
    const errors = options.validate(data) || [];
    if (errors.length) throw serviceError("VALIDATION_ERROR", errors.join("; "), 400, { errors });
  }
  // PR-052 落盘前严格形态校验：同一 Ajv 实例 strict 模式（不 coerce）——对自己写出的要严格。
  // 序列化笔误（如 PR-049 的 aliases[value]=aliasTarget 标量）在此当场被拒，不落盘。
  const shapeErrors = validateEnumsStrict(data);
  if (shapeErrors.length) {
    throw serviceError("ENUMS_SHAPE_INVALID", "写入结果不符合 enums 形态契约，未落盘：" + shapeErrors.join("; "), 400, { errors: shapeErrors });
  }
  // SPEC-023 波 4（写时吃扫描）：顶层键必须全部在册——新键未登记 theschema-roles 段即拒（CI 面⑥降为兜底）
  const { enumsSegmentViolations } = require("../../shared/schema-write-guards.cjs");
  const unregistered = enumsSegmentViolations(current.doc);
  if (unregistered.length) {
    throw serviceError("ENUMS_SEGMENT_UNREGISTERED", `写入将产生未注册顶层键 [${unregistered.join("、")}]——先在 contracts/theschema-roles.json 的 enums 行登记段（页面不可编辑段 edited_by_tab:null）`, 400, { errors: unregistered });
  }
  const raw = current.doc.toString();
  const dir = path.dirname(current.filePath);
  fs.mkdirSync(dir, { recursive: true });
  try {
    replaceTheSchemaFile(current.filePath, raw, { summary: "enums 原子写" });
  } catch (error) {
    // writeVault 自带 tmp 清理（原子写辅助的 best-effort unlink），此处只转译错误码
    throw serviceError("YAML_WRITE_FAILED", error.message, 500);
  }
  const written = readEnums(options.vaultPath);
  assertCanonicalWrite(options.vaultPath, written, options.logger || defaultLogger);
  writeSnapshot(options.vaultPath, written.raw);
  // SPEC-020 波 2：解析物联动（fire-and-forget——同步写函数不改签名；漂移兜底＝第 32 号门禁）
  const { regenerateResolvedDomainsBestEffort } = require("../../shared/regenerate-derived-projections.cjs");
  void regenerateResolvedDomainsBestEffort(options.vaultPath, options.logger || defaultLogger, "enums-written").catch(() => {});
  return { data: written.data, raw: written.raw, revision: written.revision };
}

// PR-052 落盘后自校验：读回 → 过读侧 normalize → normalizationTrail 非空 = 写路径产出了非规范形态。
// 正常写路径不该触发（落盘前已严格拦过）；触发即说明有绕过写侧闸门的写源或序列化笔误，当场告警留痕。
function assertCanonicalWrite(vaultPath, written, logger) {
  const { normalizationTrail, degradedNodes, entryNormalization } = normalizeEnums(written.data);
  if (normalizationTrail.length === 0 && degradedNodes.length === 0) return;
  const record = {
    timestamp: new Date().toISOString(),
    file: displayTheSchemaPath(vaultPath, "enums.yaml"),
    revision: written.revision,
    normalizationTrail,
    degradedNodes,
  };
  writeNormalizationHealth(vaultPath, record);
  const log = logger || { warn() {} };
  if (normalizationTrail.length) {
    log.warn({ event: "enums-write-noncanonical", revision: written.revision, fields: normalizationTrail.map((t) => t.path), reason: "写路径产出了非规范形态（读侧需 coerce 才合法）" });
  }
  if (degradedNodes.length) {
    log.warn({ event: "enums-write-degraded", revision: written.revision, nodes: degradedNodes.map((n) => n.path), reason: "写路径产出了读侧需降级的节点" });
  }
  // ADR-008 D1 迁移态可观测（info 级，非防线）：legacy 标量子域词条仍在库——棘轮补 label 时顺手对象化。
  if (entryNormalization && entryNormalization.length && typeof log.info === "function") {
    log.info({ event: "enums-write-entry-normalized", revision: written.revision, fields: entryNormalization.map((t) => t.path), reason: "写路径仍含 legacy 标量子域词条（ADR-008 D1 迁移态，合法）" });
  }
}

// Narrow publication-owned write command for the architecture_projection identity fields.
// Encapsulates the specific mutate so analysis consumers get a scoped command instead of the
// general writeEnums(mutate) power over enums.yaml.
// PR-152：增 version 可选参——身份是「product+version 成对」的（ADR-009 消费端两者都要有或都无），
// 原命令只写 product 不写 version，注册过产品的库必然铸出半身份 Release（消费端 fail-closed）；
// freezeVersion 冻结时刻成对补齐。undefined＝不动该键（产品身份口维持原语义）。
function writeArchitectureProjectionIdentity({ vaultPath, expectedRevision, product, version, aliases = [] }) {
  return writeEnums({
    vaultPath,
    expectedRevision,
    mutate: (doc, currentData) => {
      const projection = currentData.architecture_projection && typeof currentData.architecture_projection === "object" && !Array.isArray(currentData.architecture_projection)
        ? { ...currentData.architecture_projection }
        : {};
      projection.product = product;
      if (version !== undefined) projection.version = version;
      projection.product_aliases = Object.fromEntries(aliases.map((alias) => [alias, product]));
      doc.set("architecture_projection", doc.createNode(projection));
    },
  });
}

module.exports = { readEnums, writeEnums, writeArchitectureProjectionIdentity, writeSnapshot, listSnapshots, rollbackSnapshot, revision, assertCanonicalWrite, writeNormalizationHealth };
