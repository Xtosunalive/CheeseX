// Component: Entity-Repair-Service
// @responsible: Entity frontmatter preview/apply、乐观锁、备份与原子写回。
// @inputs: Vault sourceKey、sourceRevision、白名单 changes 或 previewId
// @outputs: 修复 diff、backupPath、新 revision 与 postCheck
// @context: Vault

const crypto = require("crypto");
const articleLifecycle = require("../../shared/article-lifecycle-paths.cjs");
const fs = require("fs");
const { validateCategoryPath } = require("../../shared/enums-loader.cjs"); // PR-063：A08 结构化校验
const path = require("path");
const yaml = require("yaml");
const compliance = require("./entity-compliance-service.cjs");
// WP-138 R2（PR-250）：字段白名单单点化——写门两 view（实体域/文章域）由 field-policy 派生，
// 原 :25/:39 两张手写字面量表退役；本条即原 :35 注释自认的「白名单归属另案」那一案。
const fieldPolicy = require("../../shared/field-policy.cjs");
const { buildWriteGatePolicy } = require("../../shared/write-gate-policy.cjs");
// 写入门标识（ADR054 D1）：check-write-gate-binding 以此常量与 entity-readiness-rules.json gates 声明双向对账
const WRITE_GATE_ID_APPLY_CREATE = "entity-repair.apply-create";
const WRITE_GATE_ID_PREVIEW_EDIT = "entity-repair.preview-edit";
const { checkArticleCompliance } = require("../article-workflow/article-compliance-service.cjs");
const { restampCandidateContent } = require("../article-workflow/validation-stamp-service.cjs"); // PR-151 修复③：文章修复写随写重算校验章
// WP-116 批1（八址键直取收敛）：注册表键直取改宿主类型化访问（SPEC-045 D2/D3；端口消费先例同 registryRevisionOf 的 vocab-load-port）
// WP-116 批2（SPEC-083 §二.3）：装载/补丁并经同一端口出口（loadDocument＝宿主 parseEntityDocument 同底座委托，
// null 原型不变；patchFrontmatter 纯转发）——消费面禁直 require 宿主。
const { docField, loadDocument, patchFrontmatter } = require("../../shared/document-load-port.cjs");
// WP-138 R5b：frontmatter 派生键名经文档键源单点（本文件零手抄字段名清单；
// 白名单面归 field-policy（R2 已收）， immutable 判据归 field-rule-declarations——本条只收键名来源）
const DK = require("../../shared/document-keys.cjs");

// 写门 view·实体域（PR-250 单点化）：field-policy 派生（＝诊断 view ∪ 别名写通道，15 项）——
// 「写门接受 aliases、诊断侧 EDITABLE_FIELDS 不含它」的语义差在 field-policy 原样声明（复核 C2 的错位面已收口）。
const EDITABLE_FIELDS = fieldPolicy.ENTITY_WRITE_FIELDS;
// 写门 view·文章域（PR-250 单点化）：field-policy 派生（＝契约 article.fields 键 − 正文，11 项）。
// PR-151 修复② 的语义保持：arch_layer/arch_category 在契约 article.fields 段有登记，经派生自然入集
// （枚举/必填执法经契约 article.enumFields/required 自动生效，与本集合只管「允许提交哪些键」的分工一致；
// 「哪些键的值不许改」归 ARTICLE_GATE_RULES 声明表，两者不是一回事，见 immutableFields/articleImmutableRules）。
const ARTICLE_EDITABLE_FIELDS = fieldPolicy.ARTICLE_WRITE_FIELDS;
// P0-1 方案乙：文章域「必填清单」与「字段→枚举键映射」唯一事实源 = rules.json article 段。
// 写路径的必填 8 项（:69-70）与枚举映射 5 对（:73-74）从此派生，与诊断侧 article-compliance-service 共享同一元信息。
let ARTICLE_META = { required: [], enumFields: {} };
try { ARTICLE_META = require("../../../contracts/entity-readiness-rules.json").article || ARTICLE_META; }
catch (_e) { /* 契约缺失回退空集；枚举 fail-closed 由下方 allowed.length 兜底 */ }
const ARTICLE_REQUIRED_FIELDS = ARTICLE_META.required || [];
const ARTICLE_ENUM_FIELDS = ARTICLE_META.enumFields || {};
// B9（裁决 #9 选 B）：空值统一「保留键、值为空串」，不再删键。
// 原 arch_subdomain 清空即删键的行为取消（空串是合法状态，删键会丢失字段存在性语义）。
const DELETE_WHEN_EMPTY_FIELDS = new Set([]);

// 声明驱动的不可修改字段集（单一来源＝F 族声明表；前端只读面读的是同一条规则的 editable）
function immutableFields() {
  const { FIELD_RULES } = require("../../shared/field-rule-declarations.cjs");
  return FIELD_RULES.filter((rule) => rule.immutable === true).map((rule) => rule.field);
}
// D-1b（WP-110）：文章族同一条纪律——判据来自 ARTICLE_GATE_RULES 声明表，不再点名字符串。
// 消费方与本函数共源的还有 article-compliance-service.cjs 的能力位（editable）。
function articleImmutableRules() {
  const { ARTICLE_GATE_RULES = [] } = require("../../shared/field-rule-declarations.cjs");
  return ARTICLE_GATE_RULES.filter((rule) => rule.immutable === true);
}
// 2026-10-08 字段托管：status 审批状态机（契约 statusMachine 段单源——四受控值+迁移表）
let STATUS_MACHINE = { values: ["灰度", "在线", "退役", "已驳回"], default: "灰度", transitions: {} };
try { STATUS_MACHINE = require("../../../contracts/entity-readiness-rules.json").statusMachine || STATUS_MACHINE; } catch (_e) { /* 契约缺失回退内置缺省 */ }
const STATUS_MACHINE_DEFAULT = STATUS_MACHINE.default || "灰度";
const { buildAliasIndex } = require("./entity-alias-index.cjs");
// 2026-10-08 字段托管：status 审批状态机迁移守卫（非法迁移拒绝落盘）
const { assertTransition } = require("../../shared/status-transition-guard.cjs");
// 存量值域 → 四值映射：单源＝TheSchema lifecycle.legacy_status_map（经 status-domain／装载端口——
// WP-049 余量批收敛 P6「手抄份数最多的一族」；对账语义：制定中→灰度 / 有效→在线 / 已归档→退役）
const { normalizeStatus: normalizeStatusFromVocab } = require("../../shared/status-domain.cjs");
const { buildRelationPatch } = require("./entity-relation-patch-service.cjs");
// WP-113 M2：新建实体身份的唯一取号点（形状常量住铸造模块内，本服务只调不复制）。
const { mintEntityId } = require("../../shared/entity-identity-mint.cjs");

const { createError: repairError } = require("../../shared/error-factory.cjs");
const { writeVault, writeVaultExclusive, contentRevision, ABSENT_REVISION } = require("../../shared/vault-io.cjs"); // PR-057：vault 唯一写通道（原子写＋归属取证日志）；PR-083：凭据制写前拒绝
// SPEC-012 WP-A：写前备份迁 data/backups；期望边台账迁 runtime-state.db
const { writeBackup } = require("../../shared/persistence/backup-store.cjs");
const { getRuntimeStateStore } = require("../../shared/persistence/runtime-state-store.cjs");
const { resolveTheSchemaDir } = require("../../shared/theschema-root.cjs");

function revision(raw, stat) {
  return { mtimeMs: stat.mtimeMs, size: stat.size, contentHash: "sha256:" + crypto.createHash("sha256").update(raw).digest("hex") };
}

function sameRevision(expected, actual) {
  return !!expected && expected.mtimeMs === actual.mtimeMs && expected.size === actual.size && expected.contentHash === actual.contentHash;
}

function resolveSource(vaultPath, sourceKey, allowMissing) {
  if (typeof sourceKey !== "string" || !sourceKey || path.isAbsolute(sourceKey) || sourceKey.includes("\0")) throw repairError("VALIDATION_ERROR", "sourceKey 必须是 Vault 相对路径", 400);
  const isArticle = articleLifecycle.isUnderWorking(sourceKey);
  const isDraft = articleLifecycle.isUnderDraft(sourceKey);
  const articleRoot = isDraft ? "raw/drafts" : isArticle ? "raw/precleaned" : "wiki/entities";
  const root = fs.realpathSync(path.join(vaultPath, "知识库", articleRoot));
  const unresolved = path.resolve(vaultPath, sourceKey);
  let candidate;
  try { candidate = path.join(fs.realpathSync(path.dirname(unresolved)), path.basename(unresolved)); }
  catch (_error) { throw repairError("SOURCE_NOT_FOUND", "源 entity 目录不存在", 404); }
  if (!candidate.startsWith(root + path.sep) || path.extname(candidate) !== ".md") throw repairError("VALIDATION_ERROR", "sourceKey 超出受管文档写入边界", 400);
  let target;
  try { target = fs.realpathSync(candidate); } catch (_error) {
    if (allowMissing === true) return candidate;
    throw repairError("SOURCE_NOT_FOUND", "源 entity 不存在", 404);
  }
  if (!target.startsWith(root + path.sep) || path.extname(target) !== ".md") throw repairError("VALIDATION_ERROR", "sourceKey 超出受管文档写入边界", 400);
  return target;
}

function validateChanges(changes, current, ruleSet, isArticle, growth = {}) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes) || Object.keys(changes).length === 0) throw repairError("VALIDATION_ERROR", "changes 必须包含白名单字段", 400);
  const editable = isArticle ? ARTICLE_EDITABLE_FIELDS : EDITABLE_FIELDS;
  for (const field of Object.keys(changes)) if (!editable.has(field)) throw repairError("VALIDATION_ERROR", "不允许修改字段: " + field, 400, { field });
  if (isArticle) {
    // D-1b（WP-110）：原「不允许重命名已有 article_id」的点名裸 if 换成遍历声明表——
    // 错误码/状态/details 形状与文案逐字节保持（对外语义零变化），改判据来源不改判据。
    for (const gateRule of articleImmutableRules()) {
      const field = gateRule.field;
      const oldArticleId = typeof current[field] === "string" ? current[field].trim() : "";
      if (oldArticleId && Object.prototype.hasOwnProperty.call(changes, field) && changes[field] !== oldArticleId) {
        throw repairError("VALIDATION_ERROR", gateRule.message, 422, { field, rule: "immutable" });
      }
    }
    for (const field of ARTICLE_REQUIRED_FIELDS) {
      if (changes[field] !== undefined && (typeof changes[field] !== "string" || !changes[field].trim())) throw repairError("VALIDATION_ERROR", field + " 必须是非空字符串", 400, { field, rule: "required" });
    }
    if (changes[DK.ARTICLE.tags] !== undefined && (!Array.isArray(changes[DK.ARTICLE.tags]) || changes[DK.ARTICLE.tags].some((value) => typeof value !== "string"))) throw repairError("VALIDATION_ERROR", "tags 必须是非空 string[]", 400, { field: DK.ARTICLE.tags, rule: "string[]" });
    for (const [field, ruleKey] of Object.entries(ARTICLE_ENUM_FIELDS)) {
      if (changes[field] === undefined) continue;
      const allowed = ruleSet[ruleKey] || [];
      // 裁决 2A2（2026-09-27）：与实体侧同语义——空表（配置故障）与非法值（输入错）分离，fail-closed 不变。
      if (!allowed.length) throw repairError("VALIDATION_ERROR", field + " 的枚举表未配置（enums.yaml 缺 " + ruleKey + "），请先补录枚举定义", 400, { field, rule: "enum-table-empty", enumKey: ruleKey });
      if (!allowed.includes(changes[field])) throw repairError("VALIDATION_ERROR", field + " 不是录入规则中的可用值", 400, { field, rule: "enum", allowedValues: allowed });
    }
    // Master 2026-10-14 裁定（PR-063）：category-path 是聚合衍生物＋漂移检测基准，不是首次录入拦截器。
    // 修复链（待处理问题）按 A08 结构化校验：domain:subdomain 两段均 ∈ 闭合表（WP-040 两段式，topic 段退役）。
    if (changes[DK.ARTICLE.categoryPath] !== undefined) {
      const err = validateCategoryPath(changes[DK.ARTICLE.categoryPath], ruleSet);
      if (err) throw repairError("VALIDATION_ERROR", "category-path " + err, 400, { field: DK.ARTICLE.categoryPath, rule: "structured-two-part" });
    }
    if (changes[DK.ARTICLE.product] !== undefined || changes[DK.ARTICLE.version] !== undefined) {
      const product = String(changes[DK.ARTICLE.product] ?? current[DK.ARTICLE.product] ?? "").trim();
      const version = String(changes[DK.ARTICLE.version] ?? current[DK.ARTICLE.version] ?? "").trim();
      // WP-116 批1：产品→版本表键直取改宿主六态（hasOwn 语义）——product 来自写请求/现值（用户可控），
      // 保留名（constructor 族）不再命中原型面撞出函数值致下方 .includes/.length 炸（TypeError→500）；
      // 现役注册表（null 原型）与测试夹具（普通对象）同正确；非在册键统一空版本集（原 `|| []` 同语义）。
      const versionsProbe = docField(ruleSet.versionsByProduct || null, product);
      const allowedVersions = versionsProbe.state === "present" && versionsProbe.value ? versionsProbe.value : [];
      if (!allowedVersions.length) throw repairError("VALIDATION_ERROR", "产品 " + product + " 未注册任何版本（versions.yaml 缺登记）", 400, { field: DK.ARTICLE.version, rule: "enum-table-empty", enumKey: "versionsByProduct." + product });
      if (!allowedVersions.includes(version)) throw repairError("VALIDATION_ERROR", "version 不是所选产品的已注册版本", 400, { field: DK.ARTICLE.version, rule: "version-by-product", product, allowedValues: allowedVersions });
    }
    return;
  }
  // D-1（WP-108）：不可修改的判据来自规则声明的 immutable 位（field-rule-declarations.cjs），
  // 不再点名字符串——声明改了，拒写面与前端只读面同批生效（原裸 if 是「改了判定没改口径」的温床）。
  for (const field of immutableFields()) {
    const altKey = field.replace(/-/g, "_");
    const oldVal = current[field] ?? current[altKey];
    if (oldVal && Object.prototype.hasOwnProperty.call(changes, field) && changes[field] !== oldVal) {
      throw repairError("VALIDATION_ERROR", `「${field}」创建后不可修改（规则声明 immutable）`, 422, { field, rule: "immutable" });
    }
  }
  if (changes[DK.ENTITY.module] !== undefined && (!Array.isArray(changes[DK.ENTITY.module]) || changes[DK.ENTITY.module].some((v) => typeof v !== "string"))) throw repairError("VALIDATION_ERROR", "module 必须是 string[]", 400, { field: DK.ENTITY.module, rule: "string[]" });
  if (changes[DK.ENTITY.tags] !== undefined && (!Array.isArray(changes[DK.ENTITY.tags]) || changes[DK.ENTITY.tags].some((v) => typeof v !== "string"))) throw repairError("VALIDATION_ERROR", "tags 必须是 string[]", 400, { field: DK.ENTITY.tags, rule: "string[]" });
  if (changes[DK.ENTITY.archVersionOverrides] !== undefined && !Array.isArray(changes[DK.ENTITY.archVersionOverrides])) throw repairError("VALIDATION_ERROR", "arch_version_overrides 必须是数组", 400, { field: DK.ENTITY.archVersionOverrides, rule: "array" });
  if (changes[DK.ENTITY.aliases] !== undefined && (!Array.isArray(changes[DK.ENTITY.aliases]) || changes[DK.ENTITY.aliases].some((v) => typeof v !== "string" || !v.trim()))) throw repairError("VALIDATION_ERROR", "aliases 必须是非空 string[]", 400, { field: DK.ENTITY.aliases, rule: "string[]" });
  if (changes[DK.ENTITY.archComponent] !== undefined && typeof changes[DK.ENTITY.archComponent] !== "boolean") throw repairError("VALIDATION_ERROR", "arch_component 必须是 boolean", 400, { field: DK.ENTITY.archComponent, rule: "boolean" });
  // B10（裁决 #21）：字段长度上限 200 字——全系统此前零 maxLength。至少覆盖 title 与 architecture-node-id。
  // WP-138 R5b：键名经文档键源单点。
  for (const field of [DK.ENTITY.title, DK.ENTITY.architectureNodeId]) {
    if (changes[field] !== undefined && typeof changes[field] === "string" && changes[field].length > 200) throw repairError("VALIDATION_ERROR", field + " 长度不能超过 200 字", 400, { field, rule: "max-length" });
  }
  // B2：字段→枚举键映射统一——补 arch_subdomain→subdomainIds，与诊断侧 entity-compliance-service.cjs:60 allowedByField 对齐。
  // 原写路径缺 arch_subdomain，导致「写入时不校验、落盘后判 error」（P0-2 实体侧根因）。
  // WP-138 R5b：键名（对象键位）经文档键源单点——值（ruleSet 节名）非 frontmatter 键，保持字面量
  const enumFields = { [DK.ENTITY.archLayer]: "archLayers", [DK.ENTITY.archCategory]: "archCategories", [DK.ENTITY.status]: "statuses", [DK.ENTITY.module]: "moduleNames", [DK.ENTITY.archSubdomain]: "subdomainIds" };
  for (const [field, ruleKey] of Object.entries(enumFields)) {
    if (changes[field] === undefined) continue;
    const allowed = ruleSet[ruleKey] || [];
    const values = Array.isArray(changes[field]) ? changes[field] : [changes[field]];
    // B9：空串（""）先跳过——留空串是合法「未填/清空」状态（裁决 #9），与诊断侧 onEmpty:warn 一致，不参与枚举校验。
    const nonEmpty = values.filter((value) => value !== "");
    // ADR-006 修订A（Master 2026-10-29「按A」）：实体类别＝生长字段——建实体/修复时刻可直接立新类别，
    // 生长动作幂等写入该实体 arch_subdomain 行的分类矩阵（矩阵仍是唯一权威，派生单向不变）。
    // 生长前提：子域已知（决定写入哪行）；子域未选则 fail-closed 指明。
    if (field === DK.ENTITY.archCategory && typeof growth.growCategoryMatrix === "function" && nonEmpty.some((value) => !allowed.includes(value))) {
      const unseen = nonEmpty.filter((value) => !allowed.includes(value));
      const subdomain = String(changes[DK.ENTITY.archSubdomain] ?? current[DK.ENTITY.archSubdomain] ?? "").trim();
      if (!subdomain) throw repairError("VALIDATION_ERROR", "立新实体类别需先选择 arch_subdomain（决定生长进哪行分类矩阵）", 400, { field: DK.ENTITY.archCategory, rule: "growth-needs-subdomain", unseen });
      try { growth.growCategoryMatrix({ subdomain, categories: unseen }); }
      catch (error) { throw repairError("VALIDATION_ERROR", "实体类别生长失败：" + (error && error.message), 400, { field: DK.ENTITY.archCategory, rule: "growth-write-failed" }); }
      const freshAllowed = ((typeof growth.ruleSetProvider === "function" ? growth.ruleSetProvider() : null) || {}).archCategories || [];
      const stillUnseen = unseen.filter((value) => !freshAllowed.includes(value));
      if (stillUnseen.length > 0) throw repairError("VALIDATION_ERROR", "实体类别生长后派生表仍未包含：" + stillUnseen.join("、"), 500, { field: DK.ENTITY.archCategory, rule: "growth-inconsistent" });
      continue;
    }
    if (nonEmpty.length === 0) continue;
    // B1：枚举表加载失败（allowed 为空）统一 fail-closed——与文章侧 :75 同语义（PR-002 G1 空态单源）。
    // 原 fail-open（allowed.length &&）会在配置故障时静默放行非法值并落盘。
    // 裁决 2A2（2026-09-27）：空表与非法值分离为两个 rule——空表是「枚举表未配置」（配置故障，用户无错、
    // 修法=补 enums.yaml），非法值是「值不在表内」（用户输入错，修法=改值）。拒写行为不变（fail-closed），
    // 仅错误语义精确化，消除「配置故障被误报为输入错」的死锁表述。rule=enum-table-empty 零契约变更
    // （ValidationErrorDetails.rule 为自由字符串，非 enum 锁定）。
    if (!allowed.length) throw repairError("VALIDATION_ERROR", field + " 的枚举表未配置（enums.yaml 缺 " + ruleKey + "），请先补录枚举定义", 400, { field, rule: "enum-table-empty", enumKey: ruleKey });
    if (nonEmpty.some((value) => !allowed.includes(value))) throw repairError("VALIDATION_ERROR", field + " 包含非法枚举值", 400, { field, rule: "enum", allowedValues: allowed });
  }
  for (const field of [DK.ENTITY.archSince, DK.ENTITY.archUntil]) if (changes[field] !== undefined && changes[field] !== "" && !compliance.isSemverLike(changes[field])) throw repairError("VALIDATION_ERROR", field + " 必须是 semver", 400, { field, rule: "semver" });
}

// frontmatterBounds/patchFrontmatter 为无状态文本变换，已迁移到 ../shared/yaml-frontmatter.cjs。
// 本服务治理策略（arch_subdomain 空值删除）通过 deleteWhenEmptyFields 显式传入。

function createEntityRepairService(options) {
  const vaultPath = options.vaultPath;
  const writeGatePolicy = options.writeGatePolicy || buildWriteGatePolicy(options.rulesPath);
  const ruleSetProvider = options.ruleSetProvider || (() => ({}));
  // ADR-006 修订A：类别生长写入源（main.cjs 注入 schemaWriteService.growCategoryMatrix；缺省不生长，行为同旧）
  const growCategoryMatrix = typeof options.growCategoryMatrix === "function" ? options.growCategoryMatrix : null;
  // WP-113 M2 测试缝（仅单元层，沿 growCategoryMatrix 注入先例）：取号器可替换以走通「64 次全占用」异常路径；
  // 生产不注入＝真 mintEntityId（唯一取号点不被第二实现顶替）。
  const mintIdentity = typeof options.mintIdentity === "function" ? options.mintIdentity : mintEntityId;
  const ttlMs = options.ttlMs || 5 * 60 * 1000;
  const previews = new Map();

  function assertAliasesUnique(sourcePath, nextAliases) {
    if (!nextAliases) return;
    const dir = path.join(vaultPath, "知识库", "wiki", "entities");
    var selectedSourceKey = "";
    const entities = fs.readdirSync(dir).filter((name) => name.endsWith(".md")).map((name) => {
      const file = path.join(dir, name); const doc = loadDocument(fs.readFileSync(file, "utf8"), file);
      doc.sourceKey = path.relative(vaultPath, file).split(path.sep).join("/");
      if (fs.existsSync(sourcePath) && fs.realpathSync(file) === sourcePath) { doc.frontmatter[DK.ENTITY.aliases] = nextAliases; selectedSourceKey = doc.sourceKey; }
      return doc;
    });
    const conflicts = buildAliasIndex(entities).conflicts;
    const hit = Object.entries(conflicts).filter(([, owners]) => owners.includes(selectedSourceKey));
    if (hit.length) throw repairError("ALIAS_AMBIGUOUS", "aliases 与其他 entity 冲突", 409, { conflicts: Object.fromEntries(hit) });
  }

  function entityDocsForGate(doc, sourcePath) {
    // 全库 entity 文档（含子目录）＋待写版本替换自身，供唯一性类规则判定。
    // 自身识别按 (dev, ino)——macOS 的 realpathSync 不校正文件名大小写，
    // 调用方 sourceKey 写成 target.md 而盘上是 Target.md 时串比对会失效（实测把自己当冲突）。
    const dir = path.join(vaultPath, "知识库", "wiki", "entities");
    if (!fs.existsSync(dir)) return [doc];
    let self = null;
    try { const st = fs.statSync(sourcePath); self = { dev: st.dev, ino: st.ino, real: fs.realpathSync(sourcePath) }; } catch (_e) { self = null; }
    const docs = [];
    const stack = [dir];
    while (stack.length) {
      const cur = stack.pop();
      let entries = [];
      try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch (_e) { continue; } // 不可读目录跳过，不整体拒写
      for (const ent of entries) {
        const file = path.join(cur, ent.name);
        if (ent.isDirectory()) { stack.push(file); continue; }
        if (!ent.name.endsWith(".md")) continue;
        try {
          const st = fs.statSync(file); // 悬空软链在此抛 ENOENT——按素材缺失跳过，不得把整篇编辑打成 500
          if (self && ((st.ino === self.ino && st.dev === self.dev) || fs.realpathSync(file) === self.real)) continue;
          docs.push(loadDocument(fs.readFileSync(file, "utf8"), file));
        } catch (_e) { /* 坏文件/悬空链接不进唯一性素材 */ }
      }
    }
    docs.push(doc);
    return docs;
  }

  function postCheck(raw, sourcePath, isArticle) {
    const doc = loadDocument(raw, sourcePath);
    if (isArticle) {
      const fm = doc.frontmatter || {};
      const result = checkArticleCompliance({
        articleId: typeof fm[DK.ARTICLE.articleId] === "string" ? fm[DK.ARTICLE.articleId].trim() : "",
        identitySource: typeof fm[DK.ARTICLE.articleId] === "string" && fm[DK.ARTICLE.articleId].trim() ? "article_id" : "source_path",
        documentId: "path:" + sourcePath, title: fm[DK.ARTICLE.title] || path.basename(sourcePath, ".md"), sourcePath,
        // PR-151 修复①：原始 frontmatter 随检查传递——字典必填派生检查（A11-*）按字段名取原始值
        frontmatter: fm,
        product: fm[DK.ARTICLE.product] || "", version: fm[DK.ARTICLE.version] || "", module: fm[DK.ARTICLE.module] || "", articleType: fm[DK.ARTICLE.articleType] || "",
        // 双拼写回落语义原样（`||` 链）——只换键名来源（WP-138 R5b 等价替换纪律）
        docType: fm[DK.ARTICLE.docType] || fm[DK.ARTICLE.docTypeLegacy] || "", categoryPath: fm[DK.ARTICLE.categoryPath] || fm[DK.ARTICLE.categoryPathLegacy] || "",
        tags: Array.isArray(fm[DK.ARTICLE.tags]) ? fm[DK.ARTICLE.tags] : [], hasBody: typeof doc.body === "string" && doc.body.trim().length > 0,
      }, ruleSetProvider());
      return { blockerCount: result.blockerCount, warningCount: result.warningCount };
    }
    // PR-232：唯一性判据须看全库——原喂 [doc] 单篇，duplicateIds 恒空，撞身份的新建/改写全部放行。
    // 待写这一篇以入参版本参与（编辑时同路径的盘上件被跳过，不会把自己算成冲突），
    // 与 assertAliasesUnique 的扫描姿势同源；entities 目录为平铺，basename 即文件身份。
    const result = compliance.checkEntityCompliance(doc, ruleSetProvider(), compliance.buildEntityIndexes(entityDocsForGate(doc, sourcePath)));
    // F5（#1415）：实体写入门禁需要规则明细（ruleId/field/message）供 apply 拒绝时回显——
    // 从 groups[].checks 提取未通过的阻断项；文章分支保持计数展示（渐进补齐 advisory）。
    const blockers = (result.groups || []).flatMap((group) => (group && group.checks) || [])
      .filter((check) => check && check.passed === false && (check.severity === "error" || check.severity === "blocker"))
      .map((check) => ({ ruleId: String(check.ruleId || ""), field: String(check.field || ""), message: String(check.message || "") }));
    return { blockerCount: result.blockerCount, warningCount: result.warningCount, blockers };
  }

  function preview(input) {
    const creating = input && input.createIfMissing === true;
    const sourcePath = resolveSource(vaultPath, input && input.sourceKey, creating);
    const isArticle = input && typeof input.sourceKey === "string" && (articleLifecycle.isUnderWorking(input.sourceKey) || articleLifecycle.isUnderDraft(input.sourceKey));
    if (isArticle && creating) throw repairError("VALIDATION_ERROR", "标准文章修复不支持创建新文件", 400);
    const exists = fs.existsSync(sourcePath);
    if (creating && exists) throw repairError("SOURCE_CHANGED", "实体文件已经存在，请重新加载", 409);
    const heading = typeof input.initialTitle === "string" && input.initialTitle.trim() ? input.initialTitle.trim().replace(/[\r\n#]/g, "") : path.basename(sourcePath, ".md");
    const raw = exists ? fs.readFileSync(sourcePath, "utf8") : `---\n---\n\n# ${heading}\n`;
    const currentRevision = exists ? revision(raw, fs.statSync(sourcePath)) : null;
    if (exists && !sameRevision(input.sourceRevision, currentRevision)) throw repairError("SOURCE_CHANGED", "源文件已变化，请重新加载", 409);
    const current = loadDocument(raw, sourcePath).frontmatter || {};
    const rules = ruleSetProvider();
    if (!!input.changes === !!input.relationPatch) throw repairError("VALIDATION_ERROR", "changes 与 relationPatch 必须且只能提供一个", 400);
    if (input.relationPatch) {
      if (isArticle) throw repairError("VALIDATION_ERROR", "标准文章不支持实体关系写回", 400);
      const relation = buildRelationPatch({ vaultPath, sourcePath, relationPatch: input.relationPatch, ruleSet: rules });
      const writeRaw = fs.readFileSync(relation.sourcePath, "utf8");
      const writeRevision = revision(writeRaw, fs.statSync(relation.sourcePath));
      const before = postCheck(writeRaw, relation.sourcePath, false);
      const after = postCheck(relation.nextRaw, relation.sourcePath, false);
      if (after.blockerCount > before.blockerCount) throw repairError("POST_CHECK_REGRESSION", "关系修复会新增 blocker", 422, { before, after });
      // Compute registry revision: hash of ontology.yaml + versions.yaml
      const registryRevision = registryRevisionOf(vaultPath);
      // Compute semantic fingerprint: hash of relation identity fields
      const fp = (input.relationPatch.relationType || "") + "|" +
        (input.relationPatch.direction || "outgoing") + "|" +
        (input.relationPatch.targetId || "") + "|" +
        ((input.relationPatch.versionRange && input.relationPatch.versionRange.since) || "") + "|" +
        ((input.relationPatch.versionRange && input.relationPatch.versionRange.until) || "");
      // WP-051 I-C：指纹原料经身份入口（含 | 参不再拼出同串→同哈希——撞键面消灭）
      const idFp = require("../../shared/identity-port.cjs").makeId("repair-fp", [fp]);
      const semanticFingerprint = "sha256:" + crypto.createHash("sha256").update(idFp).digest("hex");
      // Extract parsed version range from the relation result
      const vRange = input.relationPatch.versionRange;
      const since = (vRange && typeof vRange.since === "string") ? vRange.since.trim() : "";
      const until = (vRange && typeof vRange.until === "string") ? vRange.until.trim() : "";
      const parsedRange = (since === "" && until === "") ? { since: "", until: "" } : { since, until };
      const previewId = crypto.randomUUID(); const expiresAtMs = Date.now() + ttlMs;
      const ownerSourceKey = path.relative(vaultPath, relation.sourcePath).split(path.sep).join("/");
      const normalizedRelationPatch = relation.expectedEdge
        ? { ...input.relationPatch, direction: "outgoing", targetId: relation.expectedEdge.target }
        : input.relationPatch;
      previews.set(previewId, {
        sourcePath: relation.sourcePath, sourceKey: ownerSourceKey, expectedRevision: writeRevision,
        nextRaw: relation.nextRaw, changedFields: ["body:relation"], postCheck: after, expiresAtMs,
        expectedEdge: relation.expectedEdge, registryRevision, semanticFingerprint,
        proposalEdit: { editKind: "relation", sourcePath: ownerSourceKey, expectedRevision: writeRevision.contentHash, relationPatch: normalizedRelationPatch },
        proposalTitle: `修复关系: ${ownerSourceKey}`,
      });
      return { previewId, sourceKey: input.sourceKey, entityId: current[DK.ENTITY.architectureNodeId] || null, sourcePath: relation.sourcePath, beforeFrontmatter: "", afterFrontmatter: "", changedFields: ["body:relation"], systemManagedChanges: [], preCheck: before, postCheck: after, expiresAt: new Date(expiresAtMs).toISOString(), registryRevision, semanticFingerprint, parsedRange, ...relation };
    }
    // 2026-10-08 字段托管：托管字段在白名单校验前剥离——用户提交 date/updated/status 一律忽略（不报错不落盘），服务端另行注入。
    // 剥离后为空=纯托管字段提交（合法：等价无用户改动，preview 只含系统维护量）——跳过白名单校验。
    const userChanges = Object.assign({}, input.changes);
    delete userChanges[DK.ENTITY.date]; delete userChanges[DK.ENTITY.updated]; delete userChanges[DK.ENTITY.status];
    // WP-113 M2 来源门（新建专属）：组件身份由系统铸造，调用方自带任何值（含空串）即拒——
    // 不新增错误码（PR-206 教训：VALIDATION_ERROR 在册，只新增 rule 值 system-minted）。
    // 必须排在 validateChanges 的 immutable 循环之前：新建无「现值」，immutable 判据（F02 声明位）
    // 对新建不成立——「自带新号＝system-minted、改已有号＝immutable」是两条不混的路（编辑侧见同循环原语义）。
    if (creating && Object.prototype.hasOwnProperty.call(userChanges, DK.ENTITY.architectureNodeId)) {
      throw repairError("VALIDATION_ERROR", "组件身份（architecture-node-id）由系统在创建时铸造，不接受自带值", 400, { field: DK.ENTITY.architectureNodeId, rule: "system-minted" });
    }
    if (Object.keys(userChanges).length > 0) validateChanges(userChanges, current, rules, isArticle, { growCategoryMatrix, ruleSetProvider });
    if (!isArticle) assertAliasesUnique(sourcePath, input.changes[DK.ENTITY.aliases]);
    // 2026-10-08 字段托管（B8 升级为三字段全托管，实体+文章同规则）：
    // date/updated/status 系统托管只读——用户提交的这三个字段一律忽略；服务端注入：
    // date=首写生成后永续保留（从现有 frontmatter 读旧值，编辑不覆盖）；
    // updated=每次落盘的服务端 UTC 时间戳；status=创建注入默认「灰度」，编辑保留现值（迁移只走审批状态机）。
    const effectiveChanges = Object.assign({}, userChanges);
    delete effectiveChanges[DK.ENTITY.date]; delete effectiveChanges[DK.ENTITY.updated]; delete effectiveChanges[DK.ENTITY.status]; // 用户值一律忽略（契约 system:true）
    const today = new Date().toISOString().slice(0, 10);
    const existingDate = typeof current[DK.ENTITY.date] === "string" && current[DK.ENTITY.date].trim() ? current[DK.ENTITY.date] : "";
    if (creating) {
      effectiveChanges[DK.ENTITY.date] = existingDate || today; // 创建：无旧值才生成
      effectiveChanges[DK.ENTITY.status] = assertTransition({ from: "", to: STATUS_MACHINE_DEFAULT }); // 创建→灰度（守卫校验）
      // WP-113 M2 铸造门（新建专属）：身份在唯一取号点 mintEntityId 生成——判重素材与写门同源
      // （entityDocsForGate ＋ buildEntityIndexes 的归一化 id 索引，不另起扫描、不复制判重谓词）。
      // 取号耗尽（64 次全占用）＝异常状态：按在册冲突码报（ENTITY_COMPLIANCE_BLOCKED/422 承载 F02b
      // 唯一性冲突，本端点契约在册；零新码零契约改动），throw 发生在任何落盘动作之前，不留半成品。
      const mintIndexes = compliance.buildEntityIndexes(entityDocsForGate({ fileName: path.basename(sourcePath), sourcePath, frontmatter: {} }, sourcePath));
      const mintedId = mintIdentity({ taken: (candidate) => Boolean(mintIndexes.ids[compliance.normalizeString(candidate)]) });
      if (!mintedId) {
        throw repairError("ENTITY_COMPLIANCE_BLOCKED", "组件身份取号失败：连续 64 个候选号都已被占用（F02b 全库唯一），请重试", 422, {
          blockers: [{ ruleId: "F02b", field: DK.ENTITY.architectureNodeId, message: "取号 64 次候选全部已被其他实体占用" }],
        });
      }
      effectiveChanges[DK.ENTITY.architectureNodeId] = mintedId;
    } else {
      if (existingDate) effectiveChanges[DK.ENTITY.date] = existingDate; // 编辑：永续保留旧值（防手改漂移自愈）
      // status：保持现值优先（现值在受管表内=不动）；旧值域且新表已换（Vault 对账后）→ 归一自愈映射；
      // 显式迁移须带事件（问题状态机内部通道）——repair 用户路径只能保持现值。
      const rawStatus = typeof current[DK.ENTITY.status] === "string" ? current[DK.ENTITY.status].trim() : "";
      const allowedStatus = (rules && rules.statuses) || [];
      const keepAsIs = rawStatus && allowedStatus.includes(rawStatus);
      const currentStatus = keepAsIs ? rawStatus : normalizeStatusFromVocab(rawStatus, vaultPath);
      const event = typeof input.statusEvent === "string" ? input.statusEvent : undefined;
      effectiveChanges[DK.ENTITY.status] = assertTransition({ from: currentStatus || "", event });
      if (currentStatus && currentStatus !== (typeof current[DK.ENTITY.status] === "string" ? current[DK.ENTITY.status].trim() : "")) {
        // 旧值域自动归一落盘（对账自愈：有效→在线 等）
      }
    }
    effectiveChanges[DK.ENTITY.updated] = today;
    let nextRaw = patchFrontmatter(raw, effectiveChanges, { deleteWhenEmptyFields: DELETE_WHEN_EMPTY_FIELDS });
    // PR-151 修复③（文章分支）：修复写随写重算校验章——章与内容同一笔写（apply 落盘 item.nextRaw），
    // 发布闸门（B3）不再读到修复前的旧章；fail-closed：校验器不可用即拒绝预览，不留未盖章写。
    // 实体分支无校验章语义，不动。
    if (isArticle) {
      try {
        nextRaw = restampCandidateContent(vaultPath, sourcePath, nextRaw).content;
      } catch (error) {
        if (error.code === "VALIDATOR_UNAVAILABLE" || error.code === "VALIDATION_STAMP_UNWRITABLE") throw repairError(error.code, error.message, error.status || 503);
        throw error;
      }
    }
    const before = postCheck(raw, sourcePath, isArticle); const after = postCheck(nextRaw, sourcePath, isArticle);
    // seq171（ADR054 D1）：编辑回归守卫读 gates 声明（entity-repair.preview-edit）——
    // 只拦「受守护规则」从过变不过的增量；warning 级新增不再拦（更精确）。
    // 新建（creating）不走这条：空文档作「before」时一切判定都是「新增」，回归语义对新建无意义，
    // 且会把 #1803 那条绝对门禁的错误码盖掉（PR-232 撞身份实测踩到：应报 ENTITY_COMPLIANCE_BLOCKED）。
    if (!isArticle && !creating) {
      const guarded = writeGatePolicy.regressionRuleIds(WRITE_GATE_ID_PREVIEW_EDIT);
      const beforeIds = new Set((before.blockers || []).map((b) => b.ruleId));
      const newViolations = (after.blockers || []).filter((b) => guarded.has(b.ruleId) && !beforeIds.has(b.ruleId));
      if (newViolations.length) throw repairError("POST_CHECK_REGRESSION", "修复会新增受守护规则的阻断: " + newViolations.map((b) => b.ruleId).join(", "), 422, { before, after, newViolations });
    }
    // #1803：新建实体 preview 与 apply 同语义（绝对门禁提前）——否则用户「查看修复结果」通过后，
    // 最后一步「应用修复」才被 F16 等拦住（巡检 J9b 实录 tr_37a67daa）。同一 strict 规则集（规则 8）+ 同一错误码明细契约。
    if (creating && !isArticle) {
      const strict = writeGatePolicy.strictRuleIds(WRITE_GATE_ID_APPLY_CREATE);
      const violations = (after.blockers || []).filter((b) => strict.has(b.ruleId)).slice(0, 10);
      if (violations.length) throw repairError("ENTITY_COMPLIANCE_BLOCKED", "新建实体存在 " + violations.length + " 项合规阻断，禁止写入", 422, { blockers: violations });
    }
    const previewId = crypto.randomUUID(); const expiresAtMs = Date.now() + ttlMs;
    // 2026-10-08 字段托管：区分「用户改动」与「系统维护」——date/updated/status 服务端覆盖（实体+文章同规则），归 systemManagedChanges。
    const systemManaged = creating ? [DK.ENTITY.date, DK.ENTITY.updated, DK.ENTITY.status] : (existingDate || typeof current[DK.ENTITY.status] === "string" ? [DK.ENTITY.date, DK.ENTITY.updated, DK.ENTITY.status] : [DK.ENTITY.updated, DK.ENTITY.status]);
    previews.set(previewId, {
      sourcePath, sourceKey: input.sourceKey, expectedRevision: currentRevision, nextRaw,
      changedFields: Object.keys(userChanges), postCheck: after, expiresAtMs, creating: !exists, isArticle,
      proposalEdit: !exists
        ? { editKind: "entity-create", sourcePath: input.sourceKey, initialTitle: heading, changes: effectiveChanges }
        : { editKind: isArticle ? "article-frontmatter-repair" : "frontmatter-repair", sourcePath: input.sourceKey, expectedRevision: currentRevision.contentHash, changes: effectiveChanges },
      proposalTitle: `${!exists ? "创建实体" : "修复源文档"}: ${input.sourceKey}`,
    });
    return { previewId, sourceKey: input.sourceKey, entityId: isArticle ? current[DK.ARTICLE.articleId] || null : (creating ? effectiveChanges[DK.ENTITY.architectureNodeId] || null : current[DK.ENTITY.architectureNodeId] || current[DK.ENTITY.architectureNodeIdLegacy] || null), sourcePath, beforeFrontmatter: yaml.stringify(current).trimEnd(), afterFrontmatter: yaml.stringify(loadDocument(nextRaw, sourcePath).frontmatter).trimEnd(), changedFields: Object.keys(userChanges), systemManagedChanges: systemManaged, preCheck: before, postCheck: after, expiresAt: new Date(expiresAtMs).toISOString() };

  }

  function takeProposalPatch(input) {
    if (!input || input.confirmed !== true || typeof input.previewId !== "string") throw repairError("VALIDATION_ERROR", "Proposal patch 必须确认 previewId", 400);
    const item = previews.get(input.previewId);
    if (!item || item.expiresAtMs <= Date.now()) { previews.delete(input.previewId); throw repairError("PREVIEW_EXPIRED", "预览不存在、已过期或已消费", 409); }
    if (item.creating) {
      if (fs.existsSync(item.sourcePath)) throw repairError("SOURCE_CHANGED", "实体文件已经存在，请重新预览", 409);
    } else {
      const raw = fs.readFileSync(item.sourcePath, "utf8");
      if (!sameRevision(item.expectedRevision, revision(raw, fs.statSync(item.sourcePath)))) throw repairError("SOURCE_CHANGED", "源文件已变化，请重新预览", 409);
    }
    if (item.registryRevision) {
      const currentRegistryRevision = registryRevisionOf(vaultPath);
      if (item.registryRevision !== currentRegistryRevision) throw repairError("REGISTRY_CHANGED", "本体或版本注册表已变化，请重新预览", 409);
    }
    previews.delete(input.previewId);
    return {
      sourcePath: item.sourcePath, nextRaw: item.nextRaw, writtenFields: item.changedFields,
      postCheck: item.postCheck, expectedEdge: item.expectedEdge, creating: item.creating === true,
      proposalEdit: item.proposalEdit, proposalTitle: item.proposalTitle,
    };
  }

  function takeProposalEdit(input) {
    const patch = takeProposalPatch(input);
    if (!patch.proposalEdit) throw repairError("PROPOSAL_EDIT_NOT_AVAILABLE", "当前预览不能生成 Proposal edit", 422);
    return { title: patch.proposalTitle, edit: patch.proposalEdit };
  }

  function apply(input) {
    if (!input || input.confirmed !== true || typeof input.previewId !== "string") throw repairError("VALIDATION_ERROR", "apply 必须确认 previewId", 400);
    const item = previews.get(input.previewId);
    if (!item || item.expiresAtMs <= Date.now()) { previews.delete(input.previewId); throw repairError("PREVIEW_EXPIRED", "预览不存在、已过期或已消费", 409); }
    if (item.creating && fs.existsSync(item.sourcePath)) throw repairError("SOURCE_CHANGED", "实体文件已经存在，请重新预览", 409);
    const raw = item.creating ? "" : fs.readFileSync(item.sourcePath, "utf8");
    if (!item.creating && !sameRevision(item.expectedRevision, revision(raw, fs.statSync(item.sourcePath)))) throw repairError("SOURCE_CHANGED", "源文件已变化，请重新预览", 409);
    // Re-validate registry revision between preview and apply
    if (item.registryRevision) {
      const currentRegistryRevision = registryRevisionOf(vaultPath);
      if (item.registryRevision !== currentRegistryRevision) throw repairError("REGISTRY_CHANGED", "本体或版本注册表已变化，请重新预览", 409);
    }
    let backupRel = ""; // SPEC-012：data 相对展示路径
    // F5（#1415）实体写入门禁：新建（createIfMissing）采用绝对语义——落盘前 blockerCount>0 即拒绝。
    // 存量编辑不在此拦：preview 已有 POST_CHECK_REGRESSION 回归守卫（不允许新增 blocker），
    // 且不完整实体的渐进修复是合法流程；文章分支保持 advisory（标准化门拦终点）。
    // 背景实录：Web 新建 architecture-node-id 含大写 + tags 空 → 曾照样落盘 → 管道 Stage 0.5 才拒，
    // 且 V1 重命名保护令错误 id API 不可修（双重死状态）。
    if (item.creating && item.isArticle === false) {
      // seq171（ADR054 D1）：create 门改读 gates 声明（entity-repair.apply-create, strict）；
      // 未声明时 fail-closed 全 strict（write-gate-policy 缺省）——#1415 手写「任意 blocker」语义被声明取代。
      // 复核回件（PR-232）：不复用 preview 快照——两篇各 preview 再各 apply 时，快照里看不到对方，
      // 同身份可双双落盘（实测 TOCTOU）。落盘前按当前盘态复算。
      const strict = writeGatePolicy.strictRuleIds(WRITE_GATE_ID_APPLY_CREATE);
      const freshCheck = postCheck(item.nextRaw, item.sourcePath, false);
      const violations = (freshCheck.blockers || []).filter((b) => strict.has(b.ruleId)).slice(0, 10);
      if (violations.length) {
        throw repairError("ENTITY_COMPLIANCE_BLOCKED", "新建实体存在 " + violations.length + " 项合规阻断，禁止写入", 422, { blockers: violations });
      }
    }
    if (!item.creating) {
      // SPEC-012 WP-A：写前备份迁 data/backups（backup-store，wx 排他语义不变）
      try { backupRel = writeBackup({ family: item.isArticle ? "articles" : "entities", basename: path.basename(item.sourcePath), raw }).backupRel; }
      catch (error) { throw repairError("WRITE_FAILED", "备份失败: " + error.message, 500); }
    }
    // PR-083：通道凭据从本次读取签发（创建声明 absent）——写前冲突拒绝的纵深面；
    // 预览窗口的 OCC 由 :360 sameRevision（SOURCE_CHANGED 409）把守，两层同轴。
    const sourceCredential = item.creating ? ABSENT_REVISION : contentRevision(raw);
    try { writeVault(item.sourcePath, item.nextRaw, { expectedContentHash: sourceCredential, domain: "repair", summary: "修复原子写回" }); } // SPEC-012 WP-I＋PR-083
    catch (error) {
      if (error.code === "VAULT_REVISION_CONFLICT") throw repairError("SOURCE_CHANGED", "源文件在写回前被并发修改，请重新预览", 409, error.details);
      throw repairError("WRITE_FAILED", "原子写回失败: " + error.message, 500, { backupPath: backupRel || null });
    }
    previews.delete(input.previewId);
    const writtenRaw = fs.readFileSync(item.sourcePath, "utf8");
    if (item.expectedEdge) {
      // SPEC-012 WP-A：期望边台账迁 runtime-state store（事务追加；损坏即报错阻断语义不变）
      const expectationsStore = getRuntimeStateStore(vaultPath).expectations;
      let expectations = [];
      // fail-closed：台账存在但非数组不得静默重置 [] 后覆盖写回——丢失既有记录并让 apply 伪装成功。
      const stored = expectationsStore.get();
      if (stored !== undefined) {
        if (!Array.isArray(stored)) throw repairError("EXPECTATIONS_CORRUPT", "关系写回预期台账损坏，拒绝覆盖: 顶层必须是数组", 500);
        expectations = stored;
      }
      expectations.push({ ...item.expectedEdge, appliedAt: new Date().toISOString() });
      expectationsStore.put(expectations);
    }
    const writtenFrontmatter = loadDocument(writtenRaw, item.sourcePath).frontmatter;
    return { entityId: item.isArticle ? writtenFrontmatter[DK.ARTICLE.articleId] || null : writtenFrontmatter[DK.ENTITY.architectureNodeId] || null, writtenFields: item.changedFields, backupPath: backupRel, sourceRevision: revision(writtenRaw, fs.statSync(item.sourcePath)), postCheck: postCheck(writtenRaw, item.sourcePath, item.isArticle), expectedEdge: item.expectedEdge };
  }
  return { preview, apply, takeProposalPatch, takeProposalEdit };
}



// WP-049 余量批：注册表 revision 合成改经词表装载端口指纹（sha256 与文件字节哈希同值；
// 缺件＝空串哈希，与旧 existsSync→"" 语义一致）
function registryRevisionOf(vaultPath) {
  const { loadVocabBundle } = require("../../shared/vocab-load-port.cjs");
  const bundle = loadVocabBundle(vaultPath, { files: ["ontology", "versions"] });
  const shaOf = (name) => {
    const f = bundle.files[name];
    return f && f.state === "present" ? f.fingerprint : crypto.createHash("sha256").update("").digest("hex");
  };
  return "sha256:" + crypto.createHash("sha256")
    .update("sha256:" + shaOf("ontology"))
    .update("sha256:" + shaOf("versions"))
    .digest("hex");
}

module.exports = { createEntityRepairService, revision, sameRevision, EDITABLE_FIELDS, ARTICLE_EDITABLE_FIELDS };
