// Component: Schema-Write-Service
// @responsible: 权威源 Schema 文件直接写回（ADR043：schema 治理不再走 git worktree 隔离编辑）。
// @inputs: vaultPath + 乐观锁 revision + 结构化 patch
// @outputs: 写后 data/raw/revision + 备份 + 快照
// @context: Schema-Manager
// E3'a：复用 enums-write-service（原子写回 + 快照 + 乐观锁）+ version-registry-service（registry/product-identity/freeze 直接写权威源）
//       + entity-parent-service（parent_id 直接写回），ontology/dependencies 用通用 YAML 原子写回 + 备份。

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");
const {
  readEnums,
  writeEnums,
  rollbackSnapshot,
} = require("./enums-write-service.cjs");
const { createEntityParentService } = require("../release-governance/entity-parent-service.cjs");
// G10（PR-020 批3）：ontology/dependencies 快照存档与回滚（形状复用 enums-write-service 三函数先例）
const schemaHistory = require("./schema-history-service.cjs");
// enums patch 节键 → yaml 键映射（categories→arch_categories）：与路由校验闸门同一事实源
const { SECTION_YAML_KEY_MAP, validateSection, validatePolicyReferences } = require("./schema-validators.cjs");
// PR-200：乐观锁基线必填的单点闸形（与三个写服务同闸）
const { assertRevisionGiven } = require("../../shared/schema-write-guards.cjs");
// PR-178 收口：本体生命周期迁移判定下移到落盘咽喉——PUT／统一写客户端／快照回滚同经此门（路由侧另留早报面）
const ONTOLOGY_LIFECYCLE = require("./ontology-lifecycle-transition.cjs");
// PR-183：律文表逐边附加条件与迁移边判定同位点执法（复用路由同一校验实现，不另写判据）
const ONTOLOGY_LIFECYCLE_CONDITIONS = require("./ontology-lifecycle-conditions.cjs");

const SCHEMA_FILES = {
  ontology: "知识库/TheSchema/ontology.yaml",
  enums: "知识库/TheSchema/enums.yaml",
  dependencies: "知识库/TheSchema/dependencies.yaml",
  versions: "知识库/TheSchema/versions.yaml",
};

function sha256(raw) {
  return "sha256:" + crypto.createHash("sha256").update(raw).digest("hex");
}

const { createError: serviceError } = require("../../shared/error-factory.cjs");
const { writeVault, writeVaultExclusive, contentRevision, ABSENT_REVISION } = require("../../shared/vault-io.cjs"); // PR-083：更新写凭据制（contentRevision 签发／absent 新建声明）
// SPEC-012 WP-A：写前备份迁 data/backups（backup-store）
const { writeBackup } = require("../../shared/persistence/backup-store.cjs"); // PR-057：vault 唯一写通道（原子写＋归属取证日志；noLedger=记账归属维持现状）
const { resolveTheSchemaDir, displayTheSchemaPath } = require("../../shared/theschema-root.cjs");

function readSchemaYaml(vaultPath, category) {
  const relative = SCHEMA_FILES[category];
  if (!relative) throw serviceError("INVALID_CATEGORY", `Unknown Schema category: ${category}`, 400);
  // SPEC-023 波 3：TheSchema 类目经唯一解析点（仓内主源——SCHEMA_FILES 值剥 知识库/TheSchema/ 前缀取文件名）；
  // 非 TheSchema 相对路径仍按 vault 根
  const isTheSchemaCat = category === "ontology" || category === "dependencies";
  const base = isTheSchemaCat ? resolveTheSchemaDir(vaultPath) : vaultPath;
  const rel = isTheSchemaCat ? path.basename(relative) : relative;
  const filePath = path.join(base, rel);
  if (!fs.existsSync(filePath)) throw serviceError("SCHEMA_FILE_MISSING", `Schema file not found: ${relative}`, 500);
  const raw = fs.readFileSync(filePath, "utf8");
  let doc;
  try {
    doc = YAML.parseDocument(raw);
    if (doc.errors && doc.errors.length) throw doc.errors[0];
  } catch (error) {
    throw serviceError("SCHEMA_PARSE_ERROR", `Failed to parse ${relative}: ${error.message}`, 500);
  }
  return { filePath, raw, revision: sha256(raw), doc, data: doc.toJSON() || {} };
}

function atomicWriteSchemaYaml(vaultPath, filePath, newRaw, category) {
  // 原子写回 + 备份（SPEC-012 WP-A：备份迁 data/backups/schema，wx 排他语义不变）
  let backupRel = "";
  try {
    backupRel = writeBackup({ family: "schema", basename: path.basename(filePath), raw: fs.readFileSync(filePath) }).backupRel;
  } catch (error) {
    throw serviceError("SCHEMA_BACKUP_FAILED", "Schema backup failed: " + error.message, 500);
  }
  try {
    const { replaceTheSchemaFile } = require("../../shared/theschema-write.cjs"); // WP-079 唯一门：写通道由咽喉按落点选（仓内＝git 即账／vault 侧＝vault-io），服务侧不自判
    replaceTheSchemaFile(filePath, newRaw, { summary: "原子写回（TheSchema 主源）" });
  } catch (error) {
    // writeVault 自带 tmp 清理（原子写辅助的 best-effort unlink），此处只保留原错误转译
    try { void 0; } catch { /* best-effort */ }
    throw serviceError("SCHEMA_WRITE_FAILED", `Schema ${category} atomic write failed: ${error.message}`, 500, { backupPath: backupRel });
  }
  return backupRel;
}

function createSchemaWriteService(options) {
  const vaultPath = path.resolve(options.vaultPath);
  const logger = options.logger || { info() {}, error() {} };
  const versionRegistryServiceFactory = options.versionRegistryServiceFactory;
  // SPEC-010-W10 WP2：写后 git 落账（可选注入；缺省 no-op——测试/旧装配不破)
  const gitLedger = options.gitLedger || { scheduleLedger() {} };
  // WP-027（PR-142）：图输入写通知缝——ontology/enums/versions 写成功后回调（main.cjs 注入调度器）。
  // fail-open：回调异常只告警，绝不阻断写路径。
  const onGraphInputWrite = typeof options.onGraphInputWrite === "function" ? options.onGraphInputWrite : null;
  function notifyGraphInputWrite(category, source) {
    if (!onGraphInputWrite) return;
    try { onGraphInputWrite({ category, source: source || "service" }); }
    catch (error) { (logger.warn || logger.error).call(logger, { event: "schema-graph-input-notify-failed", category, error: String(error) }); }
  }

  function requireVersionRegistry() {
    if (typeof versionRegistryServiceFactory !== "function") {
      throw serviceError("VERSION_REGISTRY_PORT_UNAVAILABLE", "Schema version registry port is unavailable", 500);
    }
    return versionRegistryServiceFactory(vaultPath);
  }

  // ontology/dependencies：通用 YAML patch 直接写回（乐观锁 + 原子写回 + 备份）
  function writeYamlPatch(category, input) {
    if (category !== "ontology" && category !== "dependencies") {
      throw serviceError("INVALID_CATEGORY", `writeYamlPatch does not support category: ${category}`, 400);
    }
    if (!input.patch || typeof input.patch !== "object" || Array.isArray(input.patch)) {
      throw serviceError("MISSING_PATCH", "Edit must include a patch object", 400);
    }
    // PR-200：本体与依赖同闸——此前只 ontology 严、dependencies 走真值判断（同一规则两种闸形）。
    // 缺基线先拒，再读盘（拒绝不依赖文件是否已在）。
    assertRevisionGiven(input.revision, `${category}.yaml 写入`);
    const current = readSchemaYaml(vaultPath, category);
    if (input.revision !== current.revision) {
      throw serviceError("SCHEMA_REVISION_CONFLICT", `${category} revision has changed`, 409, { expected: input.revision, actual: current.revision });
    }
    const patchKeys = Object.keys(input.patch).filter((k) => !["revision", "confirmation"].includes(k));
    // 判定必须在打补丁之前取在册态——current.doc 会被就地改写，事后再读就是「同值改写」零判定（PR-178 首落实踩到的坑）
    const ontologyPrevious = category === "ontology" ? current.doc.toJS() : null;
    for (const key of patchKeys) {
      current.doc.set(key, current.doc.createNode(input.patch[key]));
    }
    const newRaw = current.doc.toString();
    const reparsed = YAML.parseDocument(newRaw);
    if (reparsed.errors && reparsed.errors.length) {
      throw serviceError("SCHEMA_CANDIDATE_INVALID", `Resulting YAML is invalid: ${reparsed.errors[0].message}`, 400);
    }
    if (category === "ontology") {
      // 咽喉判定：在册终态 vs 本次落盘终态（不经路由的写入同样过此门，PR-178）
      const nextDoc = reparsed.toJS();
      const lifecycleErrors = ONTOLOGY_LIFECYCLE.assertDocumentTransitions(ontologyPrevious, nextDoc);
      if (lifecycleErrors.length) {
        throw serviceError("VALIDATION_ERROR", lifecycleErrors[0] + (lifecycleErrors.length > 1 ? `（同类拒绝共 ${lifecycleErrors.length} 条）` : ""), 400);
      }
      const { errors: conditionErrors, anchorErrors } = ONTOLOGY_LIFECYCLE_CONDITIONS.assertTransitionConditions(ontologyPrevious, nextDoc);
      if (conditionErrors.length) {
        throw serviceError("VALIDATION_ERROR", conditionErrors[0] + (conditionErrors.length > 1 ? `（附加条件拒绝共 ${conditionErrors.length} 条）` : ""), 400);
      }
      if (anchorErrors.length) {
        throw serviceError("CAPABILITY_CONSUMER_ANCHOR_INVALID", anchorErrors[0] + (anchorErrors.length > 1 ? `（能力锚拒绝共 ${anchorErrors.length} 条）` : ""), 422, { errors: anchorErrors, fix: "新能力字段须与消费模块同笔登记（relation-capability-selector.cjs CAPABILITY_FIELD_CONSUMERS）；锚点失效须先修复消费或更新登记" });
      }
    }
    const backupPath = atomicWriteSchemaYaml(vaultPath, current.filePath, newRaw, category); // data 相对展示路径（SPEC-012）
    // G10（PR-020 批3）：ontology/dependencies 快照覆盖补齐——写成功后自动存档（对齐 enums 快照先例；.bak 保留）
    const snapshot = schemaHistory.writeSnapshot(vaultPath, category, newRaw);
    // SPEC-012 WP-I：gitLedger 旁路落账退役——主文件与快照的通道记账均已覆盖（防同域双记，沿 decisions.jsonl 归位同款）
    logger.info({ event: "schema-write-committed", category, revision: sha256(newRaw), backupPath, snapshotId: snapshot.id });
    if (category === "ontology") notifyGraphInputWrite("ontology"); // WP-027：dependencies 非图输入（PR-141 另案）
    return { category, affectedFile: displayTheSchemaPath(vaultPath, path.basename(SCHEMA_FILES[category])), revision: sha256(newRaw), backupPath, snapshotId: snapshot.id };
  }

  // enums：复用 enums-write-service（原子写回 + 快照 + 乐观锁）
  // PR-052：logger 透传给写侧自校验——落盘后读回发现非规范形态时告警（enums-write-noncanonical）
  function writeEnumsPatch(input) {
    if (!input.patch || typeof input.patch !== "object" || Array.isArray(input.patch)) {
      throw serviceError("MISSING_PATCH", "Edit must include a patch object", 400);
    }
    // Master 加固批①（enums revision 从可选升强制）的闸形随 PR-200 搬到单点执法：writeEnums 内的
    // assertRevisionGiven 覆盖「未给/空串」两态并统一报 SCHEMA_REVISION_REQUIRED——此处不再自写一份。
    // 前端唯一调用点 schema-manager-store:348 恒传 enums.revision。
    const patchKeys = Object.keys(input.patch).filter((k) => !["revision", "confirmation"].includes(k));
    const written = writeEnums({
      vaultPath,
      logger,
      expectedRevision: input.revision,
      mutate: (doc) => {
        // patch 节键为前端键（categories 等），落盘前映射为 yaml 键——与路由闸门校验口径一致，
        // 否则 categories 会写成孤儿顶层键而 arch_categories 保持旧值（读侧静默不生效）
        for (const key of patchKeys) doc.set(SECTION_YAML_KEY_MAP[key] || key, doc.createNode(input.patch[key]));
      },
      // PR-054/035 写前语义闸：触及节逐节 validateSection（subdomain_constraints 形态＋语义在写路径生效，
      // 此前仅 boot 自检③面跑——脏值落盘后才发现）＋validatePolicyReferences 全量跨段引用（矩阵依赖
      // categories/subdomains 别节状态，节级校验不覆盖）。错误含节路径与期望形态（400 VALIDATION_ERROR）。
      validate: (data) => {
        const errors = [];
        // 范围收窄（实测防假红）：仅 subdomain_constraints 节做写前全量语义（其余节的写前语义
        // 收紧会咬存量部分写形态——如 modules 冒烟写，仍由 boot 自检②面兜底）；跨段引用全量跑
        // （矩阵依赖 categories/subdomains 别节状态；存量 doc 每启动过自检，跨段恒绿不咬存量写）。
        if (patchKeys.includes("subdomain_constraints")) {
          try {
            errors.push(...validateSection("subdomain_constraints", data.subdomain_constraints, data));
          } catch (e) {
            errors.push(`subdomain_constraints: ${e.message}`);
          }
        }
        try {
          errors.push(...validatePolicyReferences(data));
        } catch (e) {
          errors.push(`cross-section: ${e.message}`);
        }
        return errors;
      },
    });
    // SPEC-010-W10 WP2：写后异步 git 落账（enums 主文件 + history/enums/ 快照目录）
    gitLedger.scheduleLedger("schema-page", "enums 写回（含快照）", [
      SCHEMA_FILES.enums,
      path.join(path.dirname(SCHEMA_FILES.enums), "history", "enums"),
    ]);
    logger.info({ event: "schema-enums-written", revision: written.revision });
    notifyGraphInputWrite("enums"); // WP-027：enums.yaml 是图输入
    // A5（数据域治理批）：arch_categories 直改回标——它是 subdomain_constraints 的派生视图（ADR-006）。
    // 本端点不区分调用页签，凡落盘触及该键即回标：矩阵未配置＝fallback（保底直改，生效）；
    // 已配置＝shadow（影子写，派生忽略、改动不生效）。页面侧展示随 schema 页面重设计兑现；
    // PR-087 若裁「禁止直改」，categories 页签只读化后本标记随之退役。
    if (patchKeys.includes("categories") || patchKeys.includes("arch_categories")) {
      const policies = written.data && written.data.subdomain_constraints;
      // shadow 判定与读侧派生规则同口径（enums-loader：allowed_categories 并集非空→派生忽略主表）——
      // 矩阵有条目但并集为空时读侧仍回退保底，本写仍生效，须标 fallback 而非 shadow。
      const unionSize = Object.values(policies && typeof policies === "object" && !Array.isArray(policies) ? policies : {})
        .reduce((n, row) => n + (row && Array.isArray(row.allowed_categories) ? row.allowed_categories.filter((c) => typeof c === "string" && c.trim()).length : 0), 0);
      const matrixConfigured = unionSize > 0;
      return {
        category: "enums",
        affectedFile: SCHEMA_FILES.enums,
        revision: written.revision,
        derivedDirectEdit: {
          segment: "arch_categories",
          mode: matrixConfigured ? "shadow" : "fallback",
          reason: matrixConfigured
            ? "派生源 subdomain_constraints 已配置——本次 arch_categories 写为影子写（派生视图忽略，改动不生效）"
            : "过渡期直改（ADR-006 保底）——退出时机见 PR-088 观察账本（check-taxonomy-growth --audit，反复组合出现即到立契时点）；subdomain_constraints 配置后本段自动转派生忽略",
        },
      };
    }
    return { category: "enums", affectedFile: SCHEMA_FILES.enums, revision: written.revision };
  }

  // discovery：写 enums.yaml 的 layers/categories/subdomains（复用 enums-write-service）
  function discoveryEdit(input) {
    const field = input.patch && (input.patch.field || input.patch.section);
    const value = typeof input.patch?.value === "string" ? input.patch.value.trim() : "";
    // ADR-007 A3（SPEC-005）：实体生长结晶——field=entity 走实体文件写回（裁定通道 R1：
    // 候选只在人点 [建实体]/[挂已有] 时写 Vault，扫描器永不写）。
    if (field === "entity") return entityGrowthEdit(input, value);
    // PR-088 接线二（Master 2026-10-21「立契应进生长架构接线」）：field=policy＝组合裁定——
    // 把反复出现的 子域×类别 组合写进 subdomain_constraints（ADR-006 立契动作），门禁零代码自动转执法。
    if (field === "policy") return policyEdit(input);
    // B1=b 执法补漏（Master 2026-10-23 裁 b 兑现，#61 批遗漏面）：arch_categories 为派生视图且
    // WP-064 修正：categories 晋升通道恢复（PR-054/035 原设计——矩阵未配置时 fallback 直改
    // arch_categories＝配置路径；矩阵已配置时影子写回标）。B1 冻结对象＝arch_categories 派生视图
    // 直改（yaml 键旁路），不含本晋升通道。
    if (field === "arch_categories") {
      throw serviceError("DERIVED_SEGMENT_READ_ONLY", "arch_categories 是派生视图：值＝subdomain_constraints 矩阵各子域 allowed_categories 并集（ADR-006）。禁止人直改（B1=b，Master 2026-10-23）——冻结期 absorb 无类别晋升通道，类别裁定走组合立契（field=policy）。", 403);
    }
    if (!["layers", "categories", "subdomains", "tags"].includes(field) || !value) {
      throw serviceError("INVALID_DISCOVERY_PATCH", "Discovery patch requires field=layers|categories|subdomains|tags|entity|policy and a non-empty value", 400);
    }
    const written = writeEnums({
      vaultPath,
      logger,
      expectedRevision: input.revision,
      mutate: (doc, data) => {
        if (field === "layers") {
          const layers = Array.isArray(data.layers) ? [...data.layers] : [];
          const ids = layers.map((item) => (typeof item === "string" ? item : item?.id)).filter(Boolean);
          // ADR008 D39：arch_layers 已退役（由 layers 派生），冲突检查只认 layers（TD-2 单源化）
          if (ids.includes(value)) throw serviceError("SCHEMA_VALUE_CONFLICT", "Value is already formal", 409);
          layers.push({ id: value, label: value, color: "#6b7280", layout: "central" });
          doc.set("layers", doc.createNode(layers));
          // TD-1：不再双写 arch_layers（T8 已删键；派生视图由 enums-loader 从 layers 实时计算）
        } else if (field === "tags") {
          // G1'：野生 tag 的人裁定晋升——assignMode=formal（升为正式标签，须指定分组 group）/ alias（归为某正式标签的别名 aliasTarget）
          const assignMode = input.patch.assignMode === "alias" ? "alias" : "formal";
          const tags = (data.tags && typeof data.tags === "object" && !Array.isArray(data.tags)) ? { ...data.tags } : {};
          const flatTags = Object.values(tags).flat();
          const aliases = (data.tag_aliases && typeof data.tag_aliases === "object" && !Array.isArray(data.tag_aliases)) ? { ...data.tag_aliases } : {};
          if (flatTags.includes(value) || Object.prototype.hasOwnProperty.call(aliases, value)) {
            throw serviceError("SCHEMA_VALUE_CONFLICT", "Value is already formal tag or alias", 409);
          }
          if (assignMode === "alias") {
            const aliasTarget = typeof input.patch.aliasTarget === "string" ? input.patch.aliasTarget.trim() : "";
            if (!aliasTarget || !flatTags.includes(aliasTarget)) throw serviceError("INVALID_ALIAS_TARGET", "Alias target must be an existing formal tag", 400);
            // PR-049：别名值必须是数组——validateStringMap（schema-validators:224）与 enums 读侧
            // （API 契约 tag_aliases.* 为 array）都按数组校验；旧写法落标量字符串直接触发
            // /api/schema/enums enforce 500（一处脏值整库枚举停摆）。写侧与校验器同契约。
            aliases[value] = [aliasTarget];
            doc.set("tag_aliases", doc.createNode(aliases));
          } else {
            const group = typeof input.patch.group === "string" ? input.patch.group.trim() : "";
            if (!group) throw serviceError("INVALID_DISCOVERY_GROUP", "Formal tag requires an existing group", 400);
            if (!Object.prototype.hasOwnProperty.call(tags, group)) throw serviceError("INVALID_DISCOVERY_GROUP", "Group must exist in tags", 400);
            tags[group] = [...(Array.isArray(tags[group]) ? tags[group] : []), value];
            doc.set("tags", doc.createNode(tags));
          }
        } else if (field === "categories") {
          // WP-064：categories 声明宿主晋升——野生类别经人裁定写入声明单（矩阵勾选框选项源）。
          // PR-054/035 原设计即此路径（B1 冻结期曾 403，WP-064 解冻恢复）。
          // WP-072 修正（基线红①）：写入键必须与 SECTION_YAML_KEY_MAP 单源一致——categories 前端键
          // 落 arch_categories yaml 键（写前语义闸、isFormalValue、GET 别名同口径），不得写孤儿独立键
          // （enums-write-service 段级守卫按 theschema-roles 注册表拒未注册顶层键，fail-closed 拦下）。
          if (data.arch_categories && !Array.isArray(data.arch_categories)) throw serviceError("INVALID_DISCOVERY_PATCH", "categories 声明单须为数组", 400);
          const declared = Array.isArray(data.arch_categories) ? [...data.arch_categories] : [];
          if (declared.includes(value)) throw serviceError("SCHEMA_VALUE_CONFLICT", "Value is already declared", 409);
          declared.push(value);
          doc.set("arch_categories", doc.createNode(declared));
        } else {
          const domain = typeof input.patch.domain === "string" ? input.patch.domain.trim() : "";
          if (!domain || !Object.prototype.hasOwnProperty.call(data.domains || {}, domain)) throw serviceError("INVALID_DISCOVERY_DOMAIN", "Subdomain discovery requires an existing domain", 400);
          // Master 2026-10-17 裁决「发现的时候就写好」（TALOS 同款：语义字段出生必填）——
          // subdomain 裁定晋升必带 label：裁定人正看野生值上下文，此刻补语义成本最低；缺 label 拒写。
          const label = typeof input.patch.label === "string" ? input.patch.label.trim() : "";
          if (!label) throw serviceError("INVALID_DISCOVERY_LABEL", "Subdomain discovery requires a non-empty label (出生即带义)", 400);
          const { subdomainEntryId } = require("../../shared/enums-loader.cjs");
          const subdomains = { ...(data.subdomains || {}) };
          const values = Array.isArray(subdomains[domain]) ? [...subdomains[domain]] : [];
          if (values.some((item) => subdomainEntryId(item) === value)) throw serviceError("SCHEMA_VALUE_CONFLICT", "Value is already formal", 409);
          subdomains[domain] = [...values, { id: value, label }];
          doc.set("subdomains", doc.createNode(subdomains));
        }
      },
    });
    // ADR-007 波5 方案B：来源血缘登记——本端点是「野生值经人裁定晋升为正式词」的唯一入口，
    // 故晋升即生长：登记 lineage（idempotent）。人工直接编辑词表不经此端点→不记（origin=blueprint 缺省）。
    // alias 模式（归为别名）不是新正式词，不登记。
    const { FIELD_TO_DIMENSION, recordGrowth } = require("../schema-profiling/vocabulary-lineage.cjs");
    const grownDimension = FIELD_TO_DIMENSION[field];
    if (grownDimension && !(field === "tags" && input.patch.assignMode === "alias")) {
      try { recordGrowth(vaultPath, { dimension: grownDimension, word: value, route: "discovery-absorb" }); }
      catch (_lineageError) { /* 血缘登记失败不阻断晋升（增强信息非执法项）——词已落盘即裁定生效 */ }
    }
    // SPEC-010-W10 WP2：discovery 写 enums——异步落账（enums-write 仍 noLedger，账走此旁路）。
    // SPEC-012 WP-I：血缘文件摘出账集——recordGrowth 摘旗后通道已记（rules-lifecycle 域），留显式引用会双记。
    gitLedger.scheduleLedger("schema-page", `discovery 晋升 ${field}=${value}`, [
      SCHEMA_FILES.enums,
      path.join(path.dirname(SCHEMA_FILES.enums), "history", "enums"),
    ]);
    notifyGraphInputWrite("enums", "discovery"); // WP-027：absorb 晋升写 enums.yaml（entity 早退路径不通知）
    return { category: "discovery", affectedFile: SCHEMA_FILES.enums, revision: written.revision };
  }

  // PR-088 接线二：组合裁定（立契动作）——subdomain_constraints[subdomain].allowed_categories += category。
  // 形式要求：双方均为正式词（野生词先走词表晋升——与候选面 matrix-candidates 同层分工）；
  // 已 allow 即 409。ADR-007 血缘不记：矩阵条目不是新词出生，组合的观察史在 taxonomy 观察账本。
  function policyEdit(input) {
    const subdomain = typeof input.patch?.subdomain === "string" ? input.patch.subdomain.trim() : "";
    const category = typeof input.patch?.category === "string" ? input.patch.category.trim() : "";
    if (!subdomain || !category) throw serviceError("INVALID_DISCOVERY_PATCH", "policy patch requires non-empty subdomain and category", 400);
    const written = writeEnums({
      vaultPath,
      logger,
      expectedRevision: input.revision,
      mutate: (doc, data) => {
        const { subdomainEntryId } = require("../../shared/enums-loader.cjs");
        let domainId = null;
        for (const [d, entries] of Object.entries(data.subdomains || {})) {
          if (Array.isArray(entries) && entries.some((item) => subdomainEntryId(item) === subdomain)) { domainId = d; break; }
        }
        if (!domainId) throw serviceError("INVALID_DISCOVERY_PATCH", `policy promotion requires a formal subdomain (${subdomain} is not in subdomains——先经词表通道晋升）`, 400);
        // 正式类别＝声明表 ∪ 矩阵并集（与候选面 matrix-candidates 同口径——立契期孤儿词可经配对收敛）
        const policiesNow = data.subdomain_constraints && typeof data.subdomain_constraints === "object" && !Array.isArray(data.subdomain_constraints) ? data.subdomain_constraints : {};
        const formalCategories = new Set([
          ...(Array.isArray(data.arch_categories) ? data.arch_categories : []),
          ...Object.values(policiesNow).flatMap((r) => (r && Array.isArray(r.allowed_categories) ? r.allowed_categories : [])),
        ]);
        if (!formalCategories.has(category)) {
          // B1=b 冻结期：arch_categories 空且 absorb 通道已 403——本 400 即 PR-093 触发条件①的信号（类别词表需要承载内容的诉求出现）。
          throw serviceError("INVALID_DISCOVERY_PATCH", `policy promotion requires a formal category (${category} is not in arch_categories——类别词表冻结期（B1=b）无晋升通道；该诉求出现即触发 PR-093 矩阵落地)`, 400);
        }
        const policies = { ...policiesNow };
        const row = policies[subdomain] && typeof policies[subdomain] === "object" && !Array.isArray(policies[subdomain]) ? { ...policies[subdomain] } : {};
        const allowed = Array.isArray(row.allowed_categories) ? [...row.allowed_categories] : [];
        if (allowed.includes(category)) throw serviceError("SCHEMA_VALUE_CONFLICT", "Combination is already allowed in subdomain_constraints", 409);
        row.domain_id = typeof row.domain_id === "string" && row.domain_id ? row.domain_id : domainId;
        row.allowed_categories = [...allowed, category];
        policies[subdomain] = row;
        doc.set("subdomain_constraints", doc.createNode(policies));
      },
    });
    gitLedger.scheduleLedger("schema-page", `discovery 立契 ${subdomain}×${category}`, [
      SCHEMA_FILES.enums,
      path.join(path.dirname(SCHEMA_FILES.enums), "history", "enums"),
    ]);
    notifyGraphInputWrite("enums", "policy"); // WP-027：policyEdit 经 discoveryEdit 早退返回，须自通知
    return { category: "discovery", affectedFile: SCHEMA_FILES.enums, revision: written.revision, policy: { subdomain, category } };
  }

  function snapshotRevert(input) {
    const snapshotId = input.patch?.snapshotId;
    // seq195：snapshotId 形状校验单源化——rollbackSnapshot（enums-write）内层同校验同错误同文案，此前置校验冗余删除（行为等价）
    const written = rollbackSnapshot(vaultPath, input.revision, snapshotId);
    // SPEC-010-W10 WP2：回滚也是写——异步落账（enums + 快照目录）
    gitLedger.scheduleLedger("schema-page", "snapshot 回滚（含新快照）", [
      SCHEMA_FILES.enums,
      path.join(path.dirname(SCHEMA_FILES.enums), "history", "enums"),
    ]);
    notifyGraphInputWrite("enums", "snapshot-revert"); // WP-027：回滚也是图输入写
    return { category: "snapshot-revert", affectedFile: SCHEMA_FILES.enums, revision: written.revision };
  }

  function writeVersions(input) {
    const registry = requireVersionRegistry();
    const result = registry.writeRegistry(input.revision, { schema_version: 1, products: input.patch?.products });
    notifyGraphInputWrite("versions"); // WP-027
    return { category: "versions", affectedFile: SCHEMA_FILES.versions, revision: result.revision };
  }

  function writeProductIdentity(input) {
    const registry = requireVersionRegistry();
    const result = registry.writeProductIdentity(input.revision, input.patch?.aliases, input.patch?.product);
    notifyGraphInputWrite("enums", "product-identity"); // WP-027：identity 住 enums.yaml（architecture_projection）
    return { category: "product-identity", affectedFile: SCHEMA_FILES.enums, revision: result.revision };
  }

  async function freezeVersion(input) { // PR-056：底层 python 投影异步化，随之上翻
    const registry = requireVersionRegistry();
    const frozen = await registry.freezeVersion(input.revision, input.product, input.version);
    const product = frozen.product || input.product;
    const version = frozen.version || input.version;
    notifyGraphInputWrite("versions", "freeze"); // WP-027
    return { category: "versions", product, version, affectedFiles: [SCHEMA_FILES.versions], revision: frozen.revision };
  }

  // ADR-006 修订A（Master 2026-10-29「按A」）：矩阵生长写入源——实体建立/修复时刻的类别生长。
  // 派生单向不变（arch_categories 仍由矩阵派生）；本函数是矩阵的第二条写入通道（首条=矩阵页手工配置）。
  // 幂等：已在本行的类别跳过；修订冲突重试一次（内部生长低竞争面）。
  // 契约修复（WP-043 首发回归，2026-10-29 实测：新行只写 allowed_categories、漏 domain_id →
  // /api/schema/enums 违反 SchemaSubdomainPolicy（required: domain_id）被 enforce 拦截 500）：
  // 行缺 domain_id 时从 subdomains 注册表回填（policyEdit 同款 subdomainEntryId 查找）；
  // 注册表查无此子域写空串（契约要求键存在；生长通道允许野生子域——WP-043 语义保持）。
  // 存量坏行随触碰自愈：重复生长已有类别也会补齐 domain_id（原实现 added 空即早退，坏行永不修复）。
  function growCategoryMatrix(input) {
    const subdomain = typeof input?.subdomain === "string" ? input.subdomain.trim() : "";
    const categories = Array.isArray(input?.categories) ? input.categories.map((v) => String(v).trim()).filter(Boolean) : [];
    if (!subdomain) throw serviceError("VALIDATION_ERROR", "category growth requires subdomain", 400);
    if (categories.length === 0) throw serviceError("VALIDATION_ERROR", "category growth requires non-empty categories", 400);
    const writeOnce = () => {
      const current = readEnums(vaultPath);
      const data = current.data || {};
      const matrix = { ...((data.subdomain_constraints) || {}) };
      const prev = matrix[subdomain] && typeof matrix[subdomain] === "object" && !Array.isArray(matrix[subdomain]) ? matrix[subdomain] : null;
      const row = prev ? { ...prev } : {};
      const list = Array.isArray(row.allowed_categories) ? row.allowed_categories.slice() : [];
      const added = categories.filter((c) => !list.includes(c));
      let domainBackfilled = false;
      if (!(typeof row.domain_id === "string" && row.domain_id)) {
        const { subdomainEntryId } = require("../../shared/enums-loader.cjs");
        let domainId = "";
        for (const [d, entries] of Object.entries(data.subdomains || {})) {
          if (Array.isArray(entries) && entries.some((item) => subdomainEntryId(item) === subdomain)) { domainId = d; break; }
        }
        row.domain_id = domainId;
        domainBackfilled = true;
      }
      if (added.length === 0 && !domainBackfilled) return { added: [], revision: current.revision };
      if (added.length > 0) row.allowed_categories = [...list, ...added];
      matrix[subdomain] = row;
      const written = writeEnums({
        vaultPath, logger, expectedRevision: current.revision,
        mutate: (doc) => { doc.set("subdomain_constraints", doc.createNode(matrix)); },
      });
      return { added, revision: written.revision };
    };
    let result;
    try { result = writeOnce(); }
    catch (error) {
      if (error && error.code === "ENUMS_REVISION_CONFLICT") result = writeOnce(); // 重读重试一次
      else throw error;
    }
    if (result.added.length > 0) {
      gitLedger.scheduleLedger("entity-growth", "实体类别生长（矩阵写入）", [
        SCHEMA_FILES.enums,
        path.join(path.dirname(SCHEMA_FILES.enums), "history", "enums"),
      ]);
      logger.info({ event: "schema-category-matrix-grown", subdomain, added: result.added });
      notifyGraphInputWrite("enums", "entity-growth");
    }
    return { ok: true, added: result.added, revision: result.revision };
  }

  function writeEntityParent(input) {
    const parentService = createEntityParentService({ vaultPath, logger });
    const result = parentService.writeParent(input.patch?.childId, input.patch?.parentId ?? null);
    return { category: "entity-parent", affectedFile: path.relative(vaultPath, result.filePath).split(path.sep).join("/") };
  }

  // ADR-007 A3（SPEC-005）：实体生长结晶——裁定通道内唯一写源动作。
  // assignMode=create → 新建 wiki/entities/<name>.md（origin: article-grown + grown_from 来源链 + first_seen）；
  // assignMode=link-existing → 候选名追加进已有实体 aliases（F02c aliases 机制承接）。
  // MVP 边界：ignore 不持久化（候选自然持续显示，SPEC-005 已记取舍）。
  function entityGrowthEdit(input, name) {
    const mode = input.patch && input.patch.assignMode;
    if (!["create", "link-existing"].includes(mode)) {
      throw serviceError("INVALID_DISCOVERY_PATCH", "entity patch requires assignMode=create|link-existing", 400);
    }
    const entitiesDir = path.join(vaultPath, "知识库", "wiki", "entities");
    const target = path.join(entitiesDir, `${name}.md`);
    const today = new Date().toISOString().slice(0, 10);
    const sources = Array.isArray(input.patch.sources) ? input.patch.sources.slice(0, 5) : [];
    if (mode === "create") {
      if (fs.existsSync(target)) throw serviceError("SCHEMA_VALUE_CONFLICT", `Entity file already exists: ${name}.md`, 409);
      // WP-107 D3（Master 2026-11-04「接」）：生长铸造的身份接同一唯一性判据。
      // 原面只查同名文件不查身份，而 slugify 把空格/下划线/连字符归一成同一串——
      // 「复核 网关」「复核-网关」「复核_网关」三种写法可铸出同一个 grown-复核-网关 并三连落盘（实测），
      // 两个实体的关系于是画进同一个节点。判定不另抄：与实体修复写门同源（scanner＋buildEntityIndexes.idOwners）。
      const grownId = slugifyNodeId(name);
      const clash = grownIdentityHolders(grownId, name);
      if (clash.length) {
        throw serviceError(
          "SCHEMA_VALUE_CONFLICT",
          `身份 ${grownId} 已被占用（持有者：${clash.join("、")}）——生长不撞键，请改用已有实体或换名`,
          409,
          { architectureNodeId: grownId, holders: clash }
        );
      }
      fs.mkdirSync(entitiesDir, { recursive: true });
      // 五件套骨架声明式化（2026-10-09 第一性修正）：结构与文案读契约表
      // （contracts/entity-readiness-rules.json → entityGrowthTemplate.sections），
      // 引擎只做渲染——改骨架不改代码（声明式四原则①）。
      const tmplSections = readGrowthTemplateSections();
      const fm = [
        "---",
        `title: ${name}`,
        `architecture-node-id: ${grownId}`,
        "origin: article-grown",
        `first_seen: ${today}`,
        "grown_from:",
        ...(sources.length ? sources.map((s) => `  - "${String(s).replace(/"/g, "'")}"`) : ["  []"]),
        `date: ${today}`,
        "status: 有效",
        "---",
        "",
        `# ${name}`,
        "",
        `（从文章提及生长——origin: article-grown，首现 ${today}。字段补齐走实体修复流。）`,
        "",
        ...tmplSections.map((sec) => [
          `## ${sec.title}`,
          "",
          ...(sec.sources
            ? (sources.length ? sources.map((s) => `- ${s}`) : ["（留空：未来由提及文章摘录回填。）"])
            : [String(sec.placeholder || "").replace(/\{name\}/g, name)]),
          "",
        ]).flat(),
      ].join("\n");
      writeVault(target, fm, { expectedContentHash: ABSENT_REVISION, domain: "entity-growth", summary: "建实体" }); // SPEC-012 WP-I＋PR-083：创建声明 absent（上游 existsSync 已拒已存在；并发新建由通道兜底拦）
      // WP-B（借镜 dictionary「新词反查旧文」）：出生即回带提及文章反查——
      // 消费扫描器既有提及数据（H2 可回溯），前端成功提示展示"这个实体已被哪些文章提及"。
      const backlinks = scanGrownBacklinks(name);
      // SPEC-012 WP-I：gitLedger 旁路落账退役——通道记账已含实体文件（防同域双记）
      return { category: "entity-growth", action: "create", entity: name, affectedFile: path.relative(vaultPath, target).split(path.sep).join("/"), backlinks };
    }
    // link-existing：候选名 → 已有实体的 aliases（需 target entity 文件）
    const targetName = input.patch && input.patch.targetEntity;
    if (!targetName || typeof targetName !== "string") throw serviceError("INVALID_DISCOVERY_PATCH", "link-existing requires targetEntity", 400);
    const dest = path.join(entitiesDir, `${targetName.trim()}.md`);
    if (!fs.existsSync(dest)) throw serviceError("INVALID_DISCOVERY_PATCH", `Target entity not found: ${targetName}.md`, 404);
    const raw = fs.readFileSync(dest, "utf8");
    const m = raw.match(/^---\n([\s\S]*?)\n---\n/);
    if (!m) throw serviceError("SCHEMA_PARSE_ERROR", `Target entity has no frontmatter: ${targetName}.md`, 500);
    let fmText = m[1];
    const aliasMatch = fmText.match(/^aliases:\n((?:  - .*\n?)*)/m);
    if (aliasMatch) {
      const existing = aliasMatch[1].split("\n").filter(Boolean).map((l) => l.replace(/^\s*-\s*/, "").trim().replace(/^["']|["']$/g, ""));
      if (!existing.includes(name)) existing.push(name);
      fmText = fmText.replace(aliasMatch[0], `aliases:\n${existing.map((a) => `  - "${a}"`).join("\n")}\n`);
    } else {
      fmText += `\naliases:\n  - "${name}"`;
    }
    writeVault(dest, `---\n${fmText}\n---\n${raw.slice(m[0].length)}`, { expectedContentHash: contentRevision(raw), domain: "entity-growth", summary: "实体别名追加" }); // SPEC-012 WP-I＋PR-083：读改写带凭据（raw 为本次 :345 读取）
    // SPEC-012 WP-I：gitLedger 旁路落账退役——通道记账已含目标实体文件（防同域双记）
    return { category: "entity-growth", action: "link-existing", alias: name, entity: targetName.trim(), affectedFile: path.relative(vaultPath, dest).split(path.sep).join("/") };
  }

  function grownIdentityHolders(candidateId, newName) {
    // 只读现算（与写门同约束）：取全库实体的身份持有者，排除"就是这一篇自己"。
    // 扫不到（空库/权限异常）按无持有者处理——生长面本就只读判撞，不因读失败而放行写之外的动作。
    try {
      const { scanEntities } = require("../entity-compliance/entity-source-scanner.cjs");
      const compliance = require("../entity-compliance/entity-compliance-service.cjs");
      const docs = scanEntities(vaultPath).map((item) => item.doc);
      const indexes = compliance.buildEntityIndexes(docs);
      const owners = (indexes.idOwners && indexes.idOwners[candidateId]) || [];
      return owners
        .filter((o) => !o || String(o.title || "").trim() !== String(newName || "").trim())
        .map((o) => (o.title || o.fileName || "未命名") + "（" + (o.fileName || "") + "）");
    } catch (error) {
      if (typeof console?.warn === "function") console.warn("grown-identity-scan-failed", error && error.message);
      return [];
    }
  }

  function slugifyNodeId(name) {
    const s = String(name).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-+|-+$/g, "");
    return `grown-${s || Date.now().toString(36)}`;
  }

  // WP-B：出生反查——复用 entity-growth 扫描器（B02/B04 同源提取器）扫全文章提及。
  // 纯只读现算（R1/R2 同约束）；产出 [{file, coordinate, snippet}]。空索引扫描：
  // 目标名保持"未解析"走候选路径，才有文件级样例（resolved 路径只有计数无坐标）。
  function scanGrownBacklinks(name) {
    try {
      const { scanEntityCandidates } = require("../entity-growth/entity-growth-scanner.cjs");
      const r = scanEntityCandidates({ vaultPath, indexes: { ids: {}, titleLookup: {}, filenameLookup: {}, aliasLookup: {} } });
      const hits = [];
      r.candidates.forEach((c) => { if (c.name === name) hits.push(...c.samples.map((s) => ({ file: s.file, coordinate: s.coordinate }))); });
      return hits;
    } catch (_e) { return []; } // 扫描器不可用时反查降级为空数组，不阻断建实体
  }

  // 五件套骨架读取（声明式单源：契约 entityGrowthTemplate.sections；缺省回落内置骨架
  // ——契约文件缺失时不阻断建实体，但正常部署下以契约为准）。
  function readGrowthTemplateSections() {
    const fallback = [
      { title: "机制", placeholder: "{name} 是从文章提及生长出的实体。（一句话定义待补。）" },
      { title: "Usage（使用实录）", sources: true },
    ];
    try {
      const rulesPath = path.join(resolveTheSchemaDir(vaultPath), "entity-readiness-rules.json");
      const file = fs.existsSync(rulesPath) ? rulesPath : path.resolve(__dirname, "../../../contracts/entity-readiness-rules.json");
      const tpl = JSON.parse(fs.readFileSync(file, "utf8")).entityGrowthTemplate;
      return Array.isArray(tpl && tpl.sections) && tpl.sections.length ? tpl.sections : fallback;
    } catch (_e) { return fallback; }
  }

  return {
    readSchemaYaml: (category) => readSchemaYaml(vaultPath, category),
    writeOntology: (input) => writeYamlPatch("ontology", input),
    writeDependencies: (input) => writeYamlPatch("dependencies", input),
    writeEnums: writeEnumsPatch,
    growCategoryMatrix,
    writeVersions,
    writeProductIdentity,
    freezeVersion,
    writeEntityParent,
    discoveryEdit,
    snapshotRevert,
    // G10：ontology/dependencies 快照列表与回滚（形状对齐 enums history|rollback 路由先例）
    listSchemaSnapshots: (category) => schemaHistory.listSnapshots(vaultPath, category),
    rollbackSchemaSnapshot: (category, revision, snapshotId) => {
      const result = schemaHistory.rollbackSnapshot(vaultPath, category, revision, snapshotId);
      // WP-027：回滚是图输入写（dependencies 非图输入不通知——PR-141 另案）
      if (category === "ontology" || category === "enums" || category === "versions") notifyGraphInputWrite(category, "snapshot-rollback");
      return result;
    },
    SCHEMA_FILES,
  };
}

module.exports = { createSchemaWriteService, SCHEMA_FILES, sha256 };
