// @responsible: 编排文章上传、候选检索、标准化及草稿校验提升流程。
const crypto = require("crypto");
const articleLifecycle = require("../../shared/article-lifecycle-paths.cjs");
const fs = require("fs");
const path = require("path");
// WP-116 批2（SPEC-083 §二.3）：装载/补丁经文档装载端口出口（loadDocument＝宿主 parseEntityDocument
// 同底座委托，null 原型不变；patchFrontmatter 纯转发）——消费面禁直 require 宿主。
const { loadDocument, patchFrontmatter } = require("../../shared/document-load-port.cjs");
// WP-138 R5b：frontmatter 派生键名经文档键源单点（本文件零手抄字段名清单）
const DK = require("../../shared/document-keys.cjs");
const { countUploadStatuses, normalizeDraftSourcePath, syncUploadTasks } = require("./article-upload-status.cjs");
const { checkAdmissionBlockers, checkStandardizationFindings } = require("./article-admission-policy.cjs");
const { loadArticleRuleSet } = require("../schema-manager/compliance-rule-set-service.cjs");
const { validateCategoryPath } = require("../../shared/enums-loader.cjs");
const { createArticleDraftWorkflow } = require("./article-draft-workflow.cjs");
const { candidateId, computeStandardVersion, readWorkflowState, readWorkflowStateWithRevision, safeArticleDirectory, writeWorkflowState } = require("./article-workflow-store.cjs");
const { unwrapReference } = require("../../shared/frontmatter-normalize.cjs");

// seq209：字段中文名唯一事实源 = shared/field-labels.mjs 的文章域字典
// （node≥22 require(esm) 直吃，照抄 server/shared/version-contract.cjs:11 的 shared 引用写法）。
// 中文名之所以不放 contracts/：contracts 目录下的配置前端读不到（全仓检索：src/ 下只有测试用 readRepo 读它，
// 生产代码不读），当不了前后端共用一份的落点。
const ARTICLE_LABELS = require("../../../shared/field-labels.mjs").FIELD_LABELS.article;

// 补齐表单的**表单形状**唯一事实源 = contracts/entity-readiness-rules.json 的 article.fields：
// control/required/optionsKey/键序都是表单形状（不是中文名），继续由契约提供。
// 契约缺失/不可读时 fail-closed 返回空清单，由调用方枚举校验兜底。
function readArticleFieldMeta() {
  try {
    const rules = require("../../../contracts/entity-readiness-rules.json");
    return ((rules.article || {}).fields) || {};
  } catch (_e) {
    return {};
  }
}

function articleFieldMetaList() {
  const fields = readArticleFieldMeta();
  return Object.entries(fields)
    .filter(([field, meta]) => field !== "$comment" && meta && typeof meta === "object" && meta.control)
    .map(([field, meta]) => ({
      field,
      label: ARTICLE_LABELS[field] || field,
      control: meta.control,
      required: meta.required === true,
      optionsKey: meta.optionsKey,
    }));
}

// 契约 article.enumFields（字段→注册表面键回落映射；红队高-2 回落纪律的映射面）
function readArticleEnumFields() {
  try { return (((require("../../../contracts/entity-readiness-rules.json").article) || {}).enumFields) || {}; }
  catch (_e) { return {}; }
}

// 字典闭包取数（PR-151 续·根治）：解析物配方值优先（SPEC-020 单源），空/缺失回落契约
// enumFields→ruleSet 注册表面；两侧皆空＝无配置事实，调用方跳过执法（product 同款语义）。
// 与执法/选项/标准化 A11-* 同一取数——补齐链的字段值域从此一处解释。
function articleFieldClosure(ruleSet, field) {
  const fallbackKey = readArticleEnumFields()[field] || "";
  const fallback = fallbackKey ? (ruleSet[fallbackKey] || []) : [];
  if (Array.isArray(ruleSet.resolvedDomains)) {
    const record = ruleSet.resolvedDomains.find((entry) => entry.name === field && (entry.scope || []).includes("article"));
    if (Array.isArray(record && record.values) && record.values.length > 0) return record.values;
  }
  return fallback;
}

// 候选字段补齐白名单（PR-151 续·根治）：从契约表单形状派生（article.fields 声明 control 的键），
// 字典↔契约对账由 check-fields-registry 门禁锁死——字典新增必填只需登记契约一处（＋文章域中文名），
// 白名单/选项包/表单/值域校验四处自动生效。策略排除：title——标题编辑走修复抽屉与投稿源，
// 补齐表单只管元数据缺口。
const COMPLETION_POLICY_EXCLUSIONS = new Set(["title"]);
const FIELD_COMPLETION_WHITELIST = new Set(
  articleFieldMetaList().filter((meta) => !COMPLETION_POLICY_EXCLUSIONS.has(meta.field)).map((meta) => meta.field),
);

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
// WP-138 R5c：上传扩展名值域单源（ADR-016 §三「命令入口入参值域」）——shared/ ESM 载体（seq209
// 形态，node≥22 require(esm)）；前端 ArticleUploadDock 同源消费，字面量副本退役（P6 判据归零）。
const { ARTICLE_UPLOAD_EXTENSIONS } = require("../../../shared/article-upload-extensions.mjs");
const ACCEPTED_EXTENSIONS = new Set(ARTICLE_UPLOAD_EXTENSIONS);

const { bindErrorFactory } = require("../../shared/error-factory.cjs");
const { writeVault, writeVaultExclusive, readVault, contentRevision } = require("../../shared/vault-io.cjs"); // PR-057：vault 唯一写通道（原子写＋归属取证日志）；PR-083：读签发凭据；PR-151：contentRevision 供标准化重章写凭据
const { restampCandidateContent } = require("./validation-stamp-service.cjs"); // PR-151 修复③：随写重算校验章
const { getRuntimeStateStore } = require("../../shared/persistence/runtime-state-store.cjs");
const { formOptionAvailability } = require("../../shared/availability-view.cjs"); // WP-070 §3.3（表单类）：空态指引经契约单源投影
const workflowError = bindErrorFactory({ status: 400 });
// no-usable-Release 容错码族（#1140 回归面单源）：current 指针不可用 → 工作树快照兜底，编程错误照抛
const NO_USABLE_RELEASE_CODES = new Set(["NO_CURRENT_RELEASE", "CURRENT_POINTER_INVALID", "CURRENT_RELEASE_INVALID", "CURRENT_POINTER_MISMATCH"]);

function createArticleWorkflowService(options) {
  const vaultPath = path.resolve(options.vaultPath);
  const logger = options.logger || { info() {}, error() {} };
  const submissionsDir = articleLifecycle.submissionDraftsDir(vaultPath);
  const precleanedDir = articleLifecycle.workingDir(vaultPath);
  const getReleaseReader = options.getReleaseReader || (() => null);
  const emitRelationCandidates = options.emitRelationCandidates || null; // WP-170：关系候选发射器（装配件注入）
  const persistWorkflowState = options.writeWorkflowState || writeWorkflowState;

  // WP-022（PR-112 后续波次）：乐观锁 HTTP 接线——多用户并发防护进真实用户流。
  // 锁单元＝workflow_state 整文档修订（WP-018 store 原语）；expectedRevision 由前端从最近一次
  // 读/写响应携带；不匹配即 409（对齐 yaml 族 revision 样板）。缺省不传＝不锁（存量/导入重放零变化）。
  function revisionNow() {
    return readWorkflowStateWithRevision(vaultPath).revision;
  }
  function assertRevisionCurrent(expectedRevision) {
    if (typeof expectedRevision !== "number") return; // 缺省不锁
    const current = revisionNow();
    if (current !== expectedRevision) {
      const error = workflowError("WORKFLOW_REVISION_CONFLICT", "文章工作流状态在他处已变更（修订号过期）——请刷新后重试", 409);
      error.details = { currentRevision: current, expectedRevision };
      throw error;
    }
  }

  function relativeVaultPath(absolute) { return path.relative(vaultPath, absolute).split(path.sep).join("/"); }

  // SPEC-030 派②：受管域集（category-path 首段值域）——loadArticleRuleSet 单源派生
  function domainAllowList() {
    try {
      const ruleSet = loadArticleRuleSet(vaultPath);
      return Object.keys((ruleSet && ruleSet.domains) || {});
    } catch (_error) { return []; }
  }

  // SPEC-030 派①：审批账本（机①）→任务聚合的单向只读探针——异常/缺记录一律 null（按未发布）
  function approvalStatusProbe(articleId) {
    try { return (getRuntimeStateStore(vaultPath).approval.get(articleId) || {}).status || null; }
    catch (_error) { return null; }
  }

  function upload(input, options) {
    const normalized = validateUpload(input);
    assertRevisionCurrent(options && options.expectedRevision); // 入口预检：冲突在写文件前拒绝（防孤儿草稿）
    ensureDirectories([submissionsDir, path.join(vaultPath, ".ledger")]);
    const draftAbsolute = boundedChild(submissionsDir, normalized.fileName);
    if (fs.existsSync(draftAbsolute)) throw workflowError("DRAFT_ALREADY_EXISTS", "投稿目录中已存在同名文件，请先由架构师处理或重命名后再上传", 409);
    writeVaultExclusive(draftAbsolute, normalized.content, { domain: "workflow", summary: "投稿落盘" }, { flag: "wx" }); // SPEC-012 WP-I：记账归通道
    const now = new Date().toISOString();
    const task = {
      taskId: crypto.randomUUID(), originalFileName: normalized.fileName, draftPath: relativeVaultPath(draftAbsolute),
      precleanedPath: null, precleanedPaths: [], articleIds: [], candidateCount: 0,
      status: "awaiting_architect_processing", sizeBytes: normalized.content.length, createdAt: now, updatedAt: now,
    };
    const state = readWorkflowState(vaultPath);
    state.tasks.push(task);
    const revision = persistWorkflowState(vaultPath, state, { expectedRevision: options && options.expectedRevision });
    logger.info({ event: "raw-article-uploaded", taskId: task.taskId, draftPath: task.draftPath, sizeBytes: task.sizeBytes });
    return { ...task, revision };
  }

  function synchronizedState() {
    // WP-022 红队#7：收敛写带读时已知 revision 锁——入口 get 与 put 之间的 TOCTOU 窗口内他人写入
    // 会让本函数的整文档覆盖丢 task 记录（append 账本，非收敛正确值）；带锁后窗口内冲突显式 409
    // 而非静默丢账。409 时读路径降级返回读到的旧态（收敛写是自愈优化，非主链——读服务不得因它 5xx）
    const before = readWorkflowStateWithRevision(vaultPath);
    const state = before.state || readWorkflowState(vaultPath);
    const result = syncPrecleanedState(state);
    // SPEC-030 派①聚合接线：机①审批账本 → 任务状态单向读探针（probe 内部 fail-safe，异常/缺省＝未发布）
    const taskResult = syncUploadTasks(state.tasks, result.items, result.sourceByArticleId, vaultPath, approvalStatusProbe);
    if (result.changed || taskResult.changed) {
      try {
        persistWorkflowState(vaultPath, state, { expectedRevision: before.revision });
      } catch (error) {
        if (error && error.code === "WORKFLOW_REVISION_CONFLICT") {
          logger.warn({ event: "workflow-sync-conflict-degraded", expectedRevision: before.revision });
          // 降级：重读他人已写的新态原样返回（收敛放弃——result 置 changed:false 空形状，下次读时再收敛）
          const fresh = readWorkflowState(vaultPath);
          return { state: fresh, result: { changed: false, items: [] } };
        }
        throw error;
      }
    }
    // WP-063（Master「要」）：哈希变更回退 pending_standardization 后，系统自动执行标准化
    // （standardize 走 ID 路径——操作 precleaned 文章，不经 resolveDraftPath 的 drafts 守卫）。
    // 每轮收敛至多触发一次、逐篇串行；单篇失败不阻断其余（blocked 态本来就允许——重内容变更再触发）。
    if (result.changed) {
      const autoIds = state.articles
        .filter((entry) => entry.standardizationStatus === "pending_standardization")
        .map((entry) => entry.candidateId);
      for (const autoId of autoIds) {
        try { standardize(autoId, true); }
        catch (error) {
          logger.info({ event: "auto-standardize-skipped", articleId: autoId, reason: error.message });
        }
      }
    }
    return { state, result };
  }

  function getTask(taskId) {
    const { state } = synchronizedState();
    const task = state.tasks.find((item) => item.taskId === taskId);
    if (!task) throw workflowError("TASK_NOT_FOUND", "上传任务不存在", 404);
    return { ...task };
  }

  function listUploads(limit = 50) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw workflowError("VALIDATION_ERROR", "limit 必须是 1 到 100 的整数");
    const { state } = synchronizedState();
    const tasks = state.tasks.slice().reverse().sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return { items: tasks.slice(0, limit).map((task) => ({ ...task })), total: tasks.length, statusCounts: countUploadStatuses(tasks), generatedAt: new Date().toISOString(), revision: revisionNow() };
  }

  function listPrecleaned(includeStatus = false) {
    if (!fs.existsSync(precleanedDir)) return { items: [], generatedAt: new Date().toISOString() };
    const items = synchronizedState().result.items;
    if (!includeStatus) return { items, generatedAt: new Date().toISOString() }; // WP-174：缺省零变化
    try {
      const { resolveArticleStatus } = require("./article-status-resolver.cjs");
      return { items: items.map((item) => {
        try {
          const approvalStatus = (options.getApprovalStatus)?.(item.id) || "draft";
          const status = resolveArticleStatus({
            articleId: item.id,
            standardizationStatus: item.standardizationStatus,
            approvalStatus,
            currentContentHash: item.formalContentHash || null,
            approvedContentHash: null,
            complianceBlockers: [],
            hasCurrentRelease: Boolean(item.published),
            releaseContentHash: item.formalContentHash || null,
          });
          return { ...item, stage: status.stage, stale: status.stale, blockers: status.blockers };
        } catch { return item; }
      }), generatedAt: new Date().toISOString() };
    } catch {
      return { items, generatedAt: new Date().toISOString() };
    }
  }

  function getPrecleaned(id) {
    const item = listPrecleaned().items.find((candidate) => candidate.id === id);
    if (!item) throw workflowError("ARTICLE_NOT_FOUND", "precleaned 文章不存在", 404);
    const absolute = resolveVaultRelative(item.sourcePath, precleanedDir);
    const document = loadDocument(fs.readFileSync(absolute, "utf8"), absolute);
    return { ...item, metadata: normalizeMetadata(document.frontmatter), content: document.body };
  }

  function searchCandidates(raw = {}) {
    const keyword = typeof raw.keyword === "string" ? raw.keyword.trim().toLocaleLowerCase("zh-CN") : "";
    const limit = raw.limit === undefined ? 50 : Number(raw.limit);
    const offset = raw.offset === undefined ? 0 : Number(raw.offset);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0) throw workflowError("INVALID_QUERY", "limit 必须为 1..200，offset 必须为非负整数");
    // 2026-11-01 Master（「环境启动说明咋还在呢」）：本接口语义＝「工作区里还有未发布内容的
    // 候选」——已发布且未再改动的候选不在半成品区（正式版清单页默认全列已可见）；源文件再
    // 改动→哈希失配→published=false→自然重列（再标准化入口不丢）。
    const matched = listPrecleaned().items
      .filter((item) => !item.published)
      .filter((item) => !keyword || item.title.toLocaleLowerCase("zh-CN").includes(keyword));
    const workingRevision = "sha256:" + crypto.createHash("sha256").update(matched.map((item) => item.id).sort().join("\n")).digest("hex");
    return {
      items: matched.slice(offset, offset + limit).map((item) => ({ title: item.title })),
      total: matched.length, limit, offset, generatedAt: new Date().toISOString(),
      dataSource: "precleaned-worktree", workingRevision,
    };
  }

  // 标准化校验：ERROR 阻断；WARNING 进入待处理问题；正式身份只从 current Release 投影。
  function standardize(id, confirmed) {
    if (confirmed !== true) throw workflowError("CONFIRMATION_REQUIRED", "缺少显式确认，请在请求中传 confirmed: true");
    if (typeof id !== "string" || !id.trim()) throw workflowError("VALIDATION_ERROR", "文章 ID 不能为空");
    const { state, result } = synchronizedState();
    const matches = result.items.filter((item) => item.id === id);
    if (matches.length === 0) throw workflowError("ARTICLE_NOT_FOUND", "precleaned 文章不存在", 404);
    if (matches.length > 1) throw workflowError("DUPLICATE_ARTICLE_ID", "article_id 在候选目录中重复", 409, { duplicateArticleIds: [id] });
    const item = matches[0];
    const record = state.articles.find((entry) => entry.candidateId === item.id);
    if (!record) throw workflowError("ARTICLE_NOT_FOUND", "precleaned 文章不存在", 404);
    const now = new Date().toISOString();
    let raw = fs.readFileSync(resolveVaultRelative(item.sourcePath, precleanedDir), "utf8");
    const { document, blockers: standardizationBlockers } = checkStandardizationFindings(vaultPath, raw, item.sourcePath);
    // E3'c：标准化是纯文件操作（ADR043 D2'）——校验 → createStandardVersion 产正式快照 → 更新候选状态。
    // 复用（规则 1）：createStandardVersion（快照生成，0o444）+ checkStandardizationFindings（校验）——不自造第二套。
    {
      // Plan-B 纯文件标准化（旧 Article Proposal 机制已退役）
      const blockers = standardizationBlockers || [];
      if (blockers.length > 0) {
        record.standardizationStatus = "blocked";
        record.admissionBlockers = blockers;
        record.standardizationWarnings = checkStandardizationFindings(vaultPath, raw, item.sourcePath).warnings || [];
        record.updatedAt = now;
        persistWorkflowState(vaultPath, state);
        throw workflowError("ARTICLE_STANDARDIZATION_BLOCKED", "标准化校验有阻断性错误", 409, {
          articleId: document.articleId || item.id, sourcePath: item.sourcePath,
          // ADR060 §3.4 写门族形状冻结：details.blockers 归一为精确 BlockerDetail（ruleId/field/message）；
          // 超集字段（severity/passed 等）仍完整保留在 record.admissionBlockers（工作流状态），错误通道不丢语义。
          blockers: blockers.map(({ ruleId, field, message }) => ({ ruleId, field, message })),
        });
      }
      // PR-151 修复③：标准化成功路径重算校验章——发布闸门（B3）读到的章自此必为当前内容的结论；
      // 章与 revision 绑定同一字节（contentHash 取盖章后内容），旧章类问题（PR-046 残留缺口）就此消灭。
      // fail-closed：校验器不可用即拒绝标准化（不带旧章进待审）。
      try {
        const stamped = restampCandidateContent(vaultPath, resolveVaultRelative(item.sourcePath, precleanedDir), raw).content;
        writeVault(resolveVaultRelative(item.sourcePath, precleanedDir), stamped, { expectedContentHash: contentRevision(raw), domain: "workflow", summary: "标准化校验章重算" });
        raw = stamped;
      } catch (error) {
        if (error.code === "VALIDATOR_UNAVAILABLE" || error.code === "VALIDATION_STAMP_UNWRITABLE") {
          throw workflowError(error.code, error.message, error.status || 503);
        }
        if (error.code === "VAULT_REVISION_CONFLICT") throw workflowError("CONTENT_REVISION_CONFLICT", "文章内容已被并发修改，请重试标准化", 409, error.details);
        throw error;
      }
      const contentHash = crypto.createHash("sha256").update(raw).digest("hex");
      // SPEC-030 派②（PD-2）：标准化不再写正式区——纯元数据冻结（computeStandardVersion，
      // 含域段 fail-closed 校验：坏 category-path 在标准化时即拦，不活到发布）；快照物理写延至 publish。
      const admission = computeStandardVersion(vaultPath, { contentHash, sourcePath: item.sourcePath }, document, now, { allowedDomains: domainAllowList() });
      record.articleId = admission.version.articleId || item.id;
      record.identitySource = "article_id";
      record.standardizationStatus = "standardized";
      record.validatedAt = admission.version.validatedAt || now;
      record.standardizationWarnings = checkStandardizationFindings(vaultPath, raw, item.sourcePath).warnings || [];
      record.decisions.push(admission.decision);
      record.admissionBlockers = null;
      record.contentHash = contentHash;
      record.updatedAt = now;
      // WP-169：受管字段来源三态——任务快照（draft 提取时刻）×当前 frontmatter 合并：
      // 值未变→保留快照来源（auto/human）；值被改写→human；被清空→not-extracted；无快照存量→保守两态。
      // B12 延续：suggestion 只在 draft 响应附注，不在标准化报告伪造确认值。
      const provenanceTask = state.tasks.find((task) => (task.articleIds || []).includes(record.articleId) || task.precleanedPath === item.sourcePath);
      record.fieldProvenance = mergeProvenanceWithCurrent(provenanceTask && provenanceTask.fieldProvenance, document.frontmatter);
      persistWorkflowState(vaultPath, state);
      logger.info({ event: "article-standardized", articleId: record.articleId, mode: "plan-b-direct", warningCount: record.standardizationWarnings.length });
      if (typeof emitRelationCandidates === "function") {
        // WP-170：admission 的 document 只带 hasBody 布尔——正文显式取装载宿主（发射器异常自捕获降级，不阻断主链）
        emitRelationCandidates({ body: loadDocument(raw, item.sourcePath).body, articleId: record.articleId });
      }
      return articleWithWorkflow(item, record, admission.version);
    }
  }

  // 候选字段补齐（腿B，方案-promote不阻塞闭环）：白名单/选项包均从契约表单形状派生（见模块级
  // FIELD_COMPLETION_WHITELIST/articleFieldClosure——PR-151 续·根治，字典↔契约对账由门禁锁死）。
  // 行级 patchFrontmatter 保留其余键与正文字节；写后经 synchronizedState 重扫同步 contentHash。
  function getFieldCompletionOptions() {
    const ruleSet = loadArticleRuleSet(vaultPath);
    // 红队中-5 修复：选项面与执法面同源——解析物在场用配方闭包（与 updateCandidateFields 同一域），缺失回落注册表面
    const productRecord = (ruleSet.resolvedDomains || []).find((record) => record.name === "product" && (record.scope || []).includes("article"));
    const productOptions = Array.isArray(ruleSet.resolvedDomains) && Array.isArray(productRecord && productRecord.values) && productRecord.values.length > 0 ? productRecord.values : (ruleSet.products || []);
    // WP-040 裁③：选项面只列主产品名（canonicalProducts）；校验面仍用闭合集（容别名，updateCandidateFields 不变）
    const canonicalSet = new Set(ruleSet.canonicalProducts || []);
    const optionProducts = canonicalSet.size > 0 ? productOptions.filter((name) => canonicalSet.has(name)) : productOptions;
    const options = {
      // 结构特例三处（同型不同构，无法通用拍平）：products（产品→版本级联对象包）、
      // categoryPaths（复合值域闭合组合）、versions（级联伪键，选项经 products 派生，无独立包）。
      products: optionProducts.map((name) => ({ name, versions: (ruleSet.versionsByProduct || {})[name] || [] })),
      categoryPaths: ruleSet.categoryPaths || [],
    };
    // PR-151 续·根治：其余选项包按契约 optionsKey 通用派生（字典闭包＝执法面同一取数）——
    // 契约新增字段零代码供选项；对应包键须已入 ArticleFieldOptions 契约（漏登记由 check-fields-registry 红）。
    for (const meta of articleFieldMetaList()) {
      if (!meta.optionsKey || meta.optionsKey === "products" || meta.optionsKey === "versions" || meta.optionsKey === "categoryPaths") continue;
      options[meta.optionsKey] = articleFieldClosure(ruleSet, meta.field);
    }
    // WP-062（功能可用性）→ WP-070 收编：选项空态「缺什么/去哪配」经空态语义契约单源投影
    // （formOptionAvailability：事实＝各选项源空否，文案与依赖序由 contracts/empty-state-semantics.json 决定——
    // 产品身份未配时版本空态的 hint 以前置指引开头）；响应形状 {empty,hint}＋kind 兼容前端。
    const totalVersions = optionProducts.reduce((sum, name) => sum + (((ruleSet.versionsByProduct || {})[name] || []).length), 0);
    const availability = formOptionAvailability({
      products: { kind: "product-identity-unmounted", empty: optionProducts.length === 0 },
      versions: { kind: "versions-empty", empty: totalVersions === 0 },
      archCategories: { kind: "arch-categories-empty", empty: (options.archCategories || []).length === 0 },
    });
    return {
      ...options,
      availability,
      // 文章修复表单字段清单（服务端单源，切片3）：article_id 不开放——promote 自动生成且已有值禁改名；
      // 正文（A10）不开 Web 编辑——2026-09-05 架构师拍板，内容修改走 Obsidian。
      // 中文名 = shared/field-labels.mjs 文章域字典；控件/必填/选项键 = 契约 article.fields（表单形状）。
      // 渲染顺序 = 契约键序；completable＝补齐白名单判定（表单过滤用，PR-151 续）。
      articleFields: articleFieldMetaList().map((meta) => ({ ...meta, completable: FIELD_COMPLETION_WHITELIST.has(meta.field) })),
    };
  }
  function updateCandidateFields(id, fields) {
    if (typeof id !== "string" || !id.trim()) throw workflowError("VALIDATION_ERROR", "文章 ID 不能为空");
    const entries = Object.entries(fields || {});
    if (entries.length === 0) throw workflowError("VALIDATION_ERROR", "未提供任何待补齐字段");
    for (const [key, value] of entries) {
      if (!FIELD_COMPLETION_WHITELIST.has(key)) throw workflowError("FIELD_NOT_ALLOWED", `字段不在补齐白名单内: ${key}`, 400, { allowed: [...FIELD_COMPLETION_WHITELIST] });
      // tags：数组形态（A09 必填非空列表）——接受数组或逗号分隔字符串，归一为非空字符串数组后写 frontmatter
      if (key === "tags") {
        const list = (Array.isArray(value) ? value : String(value).split(",")).map((item) => String(item).trim()).filter(Boolean);
        if (list.length === 0) throw workflowError("VALIDATION_ERROR", "字段值非法: tags（须为非空列表）");
        fields[key] = list;
        continue;
      }
      if (typeof value !== "string" || !value.trim()) throw workflowError("VALIDATION_ERROR", `字段值非法: ${key}`);
    }
    const { state, result } = synchronizedState();
    const matches = result.items.filter((item) => item.id === id);
    if (matches.length === 0) throw workflowError("ARTICLE_NOT_FOUND", "precleaned 文章不存在", 404);
    if (matches.length > 1) throw workflowError("DUPLICATE_ARTICLE_ID", "article_id 在候选目录中重复", 409, { duplicateArticleIds: [id] });
    const item = matches[0];
    const record = state.articles.find((entry) => entry.candidateId === item.id);
    // PR-151：撤除「已标准化不可 Web 编辑」拦截（原 ALREADY_STANDARDIZED 409）。依据：
    // ①内容变更本就有既定回落语义（syncPrecleanedState 哈希变化→pending_standardization，Obsidian 编辑路径一直如此），
    //   Web 补齐与之同语义，不另造第二规则；②审批绑定失效由 PR-047 既有机制接住（pending 态重新标准化重绑，
    //   界面出「重新标准化」按钮）——堵死的是「标准化后发现缺必填字段」的 Web 死路（2026-10-29 AGENTS.md 实录）。
    const absolute = resolveVaultRelative(item.sourcePath, precleanedDir);
    const { content: raw, sha256: baseRevision } = readVault(absolute); // PR-083：读时签发写凭据
    const document = loadDocument(raw, absolute);
    const ruleSet = loadArticleRuleSet(vaultPath);
    // SPEC-020 波 2：product/version 值域改接解析物（fields.yaml 配方单源——三方算法收敛）；
    // 空集＝无注册事实，跳过校验（Master 裁定：遗存文章已删，激活随产品身份重注册自然生效）。
    const resolvedRecord = (name, scope) => (ruleSet.resolvedDomains || []).find((record) => record.name === name && (record.scope || []).includes(scope)) || null;
    // 红队高-2 修复：解析物缺失（resolvedDomains=null）→ 回落注册表面（旧行为），不留校验真空；
    // 解析物在场 → 域切配方闭包（空集跳过语义不变）。
    const artifactMissing = !Array.isArray(ruleSet.resolvedDomains);
    const productDomain = resolvedRecord(DK.ARTICLE.product, "article");
    const productValues = artifactMissing
      ? (ruleSet.products || [])
      : Array.isArray(productDomain && productDomain.values) ? productDomain.values : [];
    const versionValues = artifactMissing
      ? Object.values(ruleSet.versionsByProduct || {}).flat()
      : (() => {
          const record = resolvedRecord(DK.ARTICLE.version, "article");
          return Array.isArray(record && record.values) ? record.values : [];
        })();
    const versionsByProduct = ruleSet.versionsByProduct || {};
    const productName = typeof fields[DK.ARTICLE.product] === "string" && fields[DK.ARTICLE.product].trim() ? fields[DK.ARTICLE.product] : (typeof document.frontmatter[DK.ARTICLE.product] === "string" ? document.frontmatter[DK.ARTICLE.product] : "");
    // module 输入归一（SPEC-020 波 2 兑现声明性 wikilink_strip）：[[主模块]]→主模块，正式值=modules 键
    const moduleRecord = resolvedRecord(DK.ARTICLE.module, "article");
    const stripWikilink = (raw) => (typeof raw === "string" ? raw.replace(/\[\[([^\]]+)\]\]/g, "$1").trim() : raw);
    if (moduleRecord && moduleRecord.wikilinkStrip && typeof fields[DK.ARTICLE.module] === "string") fields[DK.ARTICLE.module] = stripWikilink(fields[DK.ARTICLE.module]);
    const invalid = [];
    // 值域执法（PR-151 续·根治）：白名单字段一律按字典闭包通用执法（articleFieldClosure——解析物优先、
    // 注册表面回落；空集＝无配置事实跳过）。结构特例仅三处，同型不同构无法闭包拍平：
    //   product（产品身份闭合集＋占位门 placeholderBlockers 已另行）、version（按产品收窄级联）、
    //   category-path（复合两段结构化校验）；tags 形态归一已在入口完成。
    for (const [key, value] of Object.entries(fields)) {
      if (key === DK.ARTICLE.product || key === DK.ARTICLE.version || key === DK.ARTICLE.categoryPath || key === DK.ARTICLE.tags) continue;
      const allowed = articleFieldClosure(ruleSet, key);
      if (allowed.length > 0 && !allowed.includes(value)) invalid.push({ field: key, value, reason: `${key} 不在字段字典合法值（fields.yaml 值域闭包）` });
    }
    if (fields[DK.ARTICLE.product] !== undefined && productValues.length > 0 && !productValues.includes(fields[DK.ARTICLE.product])) {
      invalid.push({ field: DK.ARTICLE.product, value: fields[DK.ARTICLE.product], reason: "product 不在产品身份闭合集（A03：projection.product＋product_aliases＋reserved）" });
    }
    if (fields[DK.ARTICLE.version] !== undefined) {
      if (versionValues.length > 0 && !versionValues.includes(fields[DK.ARTICLE.version])) {
        invalid.push({ field: DK.ARTICLE.version, value: fields[DK.ARTICLE.version], reason: "version 不在产品版本注册表可用值（G1+G5）" });
      }
      // 红队中-1 修复：恢复按产品收窄——产品已注册且其版本清单非空时，须命中该产品清单（全局集只作下限）
      if (productName) {
        const forProduct = versionsByProduct[productName];
        if (Array.isArray(forProduct) && forProduct.length > 0 && !forProduct.includes(fields[DK.ARTICLE.version])) {
          invalid.push({ field: DK.ARTICLE.version, value: fields[DK.ARTICLE.version], reason: `version 不在产品 ${productName} 的版本可用值` });
        }
      }
    }
    if (fields[DK.ARTICLE.categoryPath] !== undefined) {
      // PR-046：两段式结构化校验，校验器单实现 shared/enums-loader.validateCategoryPath——
      // 与标准化 A08 / article-validator-lib 同一语义（SPEC-022 单源），杜绝「补齐通过、发布被闸门拒」的双口径死锁。
      const categoryError = validateCategoryPath(fields[DK.ARTICLE.categoryPath], ruleSet);
      if (categoryError) invalid.push({ field: DK.ARTICLE.categoryPath, value: fields[DK.ARTICLE.categoryPath], reason: categoryError });
    }
    if (invalid.length > 0) throw workflowError("FIELD_VALUE_INVALID", `字段值未通过录入规则校验: ${invalid.map((entry) => entry.field).join("、")}`, 400, { invalid });
    // PR-151 修复③：随写重算校验章——补字段与章同一笔写落盘（单次写；validate-before-write，
    // 校验器不可用即整笔拒绝，不留「字段已改、旧章残留」的半程态——PR-046 残留缺口根治）。
    let nextRaw;
    try {
      nextRaw = restampCandidateContent(vaultPath, absolute, patchFrontmatter(raw, fields)).content;
    } catch (error) {
      if (error.code === "VALIDATOR_UNAVAILABLE" || error.code === "VALIDATION_STAMP_UNWRITABLE") throw workflowError(error.code, error.message, error.status || 503);
      throw error;
    }
    try {
      writeVault(absolute, nextRaw, { expectedContentHash: baseRevision, domain: "workflow", summary: "候选字段更新（含校验章重算）" }); // SPEC-012 WP-I＋PR-083：读改写带凭据
    } catch (error) {
      // PR-083：并发修改写前拒绝（非事后取证）——前端沿既有 409 轴提示刷新重试
      if (error.code === "VAULT_REVISION_CONFLICT") throw workflowError("CONTENT_REVISION_CONFLICT", "文章内容已被并发修改，请刷新后重试", 409, error.details);
      throw error;
    }
    synchronizedState();
    return getPrecleaned(id);
  }

  function syncPrecleanedState(state) {
    let changed = false;
    const sourceByArticleId = new Map();
    // 发布识别单次装载＋双键查找（2026-11-01 半成品区过滤批）：id 漂移是真实形态——审批机落
    // 正式路径用的是审批流自产 id（article-46f4… 实录），与候选 frontmatter article_id 可以不同；
    // 内容哈希才是「这段内容已发布」的诚实身份（正式快照文件名即内容哈希，B2/D2 不变式）。
    // 先按 id（快路径），哈希兜底（漂移容错）。no-usable-Release 容错码族与 currentStandardVersion
    // 同款（#1140 回归面：标准化是纯文件操作，不得被 current 指针 fail-closed 卡住）。
    let formalVersions = [];
    try { formalVersions = listCurrentStandardVersions(); }
    catch (error) {
      if (!(error && NO_USABLE_RELEASE_CODES.has(error.code))) throw error;
    }
    const formalById = new Map(formalVersions.map((version) => [version.articleId, version]));
    const formalByHash = new Map(formalVersions.map((version) => [version.contentHash, version]));
    const items = collectMarkdownFiles(precleanedDir).map((absolute) => {
      const sourcePath = relativeVaultPath(absolute);
      const rawContent = fs.readFileSync(absolute, "utf8");
      const contentHash = crypto.createHash("sha256").update(rawContent).digest("hex");
      const document = loadDocument(rawContent, absolute);
      const articleId = textValue(document.frontmatter[DK.ARTICLE.articleId], "");
      const id = candidateId(articleId, sourcePath);
      sourceByArticleId.set(id, normalizeDraftSourcePath(document.frontmatter[DK.ARTICLE.sourceFile]));
      let record = state.articles.find((candidate) => candidate.candidateId === id);
      if (!record) record = state.articles.find((candidate) => candidate.sourcePath === sourcePath);
      if (!record) {
        record = {
          candidateId: id, articleId, identitySource: articleId ? "article_id" : "sourcePath", sourcePath, contentHash,
          admissionBlockers: null, decisions: [], standardizationStatus: "pending_standardization",
          standardizationWarnings: [], lastStandardizationCheck: null, updatedAt: new Date().toISOString(),
        };
        state.articles.push(record); changed = true;
      } else {
        const duplicateRecords = state.articles.filter((candidate) => candidate !== record && candidate.sourcePath === sourcePath);
        if (duplicateRecords.length > 0) {
          const decisions = [...record.decisions, ...duplicateRecords.flatMap((candidate) => candidate.decisions || [])];
          record.decisions = decisions.filter((decision, index) => decisions.findIndex((candidate) => candidate.decisionId === decision.decisionId) === index);
          state.articles = state.articles.filter((candidate) => !duplicateRecords.includes(candidate));
          changed = true;
        }
        if (record.candidateId !== id || record.articleId !== articleId) {
          record.candidateId = id; record.articleId = articleId; record.identitySource = articleId ? "article_id" : "sourcePath";
          changed = true;
        }
        if (record.sourcePath !== sourcePath) { record.sourcePath = sourcePath; changed = true; }
        if (record.contentHash !== contentHash) {
          record.contentHash = contentHash;
          record.standardizationStatus = "pending_standardization";
          record.standardizationWarnings = [];
          record.updatedAt = new Date().toISOString(); changed = true;
        }
      }
      let formalVersion = formalById.get(articleId) || formalByHash.get(contentHash) || null;
      // SPEC-030 派②（PD-2）：工作树快照识别分支退役——快照不再于标准化时落正式区，
      // standardized 身份由 standardize 动作持久写入 record（内容变更由上方哈希比对回落）。
      if (!formalVersion || formalVersion.contentHash !== contentHash) {
        // SPEC-030 机②：standardized 是 standardize 动作的持久事实——blockers 重估块只服务
        // 未标准化候选的现算（内容变更回落由上方 contentHash 块独占），无权推翻已标准化身份。
        if (record.standardizationStatus === "standardized") {
          // 未发布（无 Release 识别）不降级；保持 standardized
        } else {
        try {
          const { blockers } = checkAdmissionBlockers(vaultPath, rawContent, sourcePath);
          const newStatus = blockers.length > 0 ? "blocked" : "pending_standardization";
          const nextBlockers = blockers.length > 0 ? blockers : null;
          if (record.standardizationStatus !== newStatus || JSON.stringify(record.admissionBlockers || null) !== JSON.stringify(nextBlockers)) {
            record.standardizationStatus = newStatus;
            record.admissionBlockers = nextBlockers;
            record.updatedAt = new Date().toISOString();
            changed = true;
          }
        } catch (_) {
          // Blocker check infra failure — preserve current status, don't crash sync
        }
        }
      }
      const stat = fs.statSync(absolute);
      return articleWithWorkflow({
        id, fileName: path.basename(absolute), title: textValue(document.frontmatter[DK.ARTICLE.title], path.basename(absolute, ".md")),
        product: wikilinkText(document.frontmatter[DK.ARTICLE.product]), module: wikilinkText(document.frontmatter[DK.ARTICLE.module]),
        articleType: textValue(document.frontmatter[DK.ARTICLE.articleType], ""), version: textValue(document.frontmatter[DK.ARTICLE.version], ""),
        sourcePath, updatedAt: stat.mtime.toISOString(),
      }, record, formalVersion);
    });
    items.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return { items, sourceByArticleId, changed };
  }

  function ensureUploadTask(draftRelativePath, options) {
    assertRevisionCurrent(options && options.expectedRevision); // 入口预检
    const state = readWorkflowState(vaultPath);
    if (state.tasks.some((task) => task.draftPath === draftRelativePath)) return;
    const absolute = resolveVaultRelative(draftRelativePath, articleLifecycle.draftsDir(vaultPath));
    const stat = fs.statSync(absolute);
    const now = new Date().toISOString();
    state.tasks.push({
      taskId: crypto.randomUUID(), originalFileName: path.basename(draftRelativePath), draftPath: draftRelativePath,
      precleanedPath: null, precleanedPaths: [], articleIds: [], candidateCount: 0,
      status: "awaiting_architect_processing", sizeBytes: stat.size, createdAt: now, updatedAt: now,
    });
    persistWorkflowState(vaultPath, state);
  }

  // WP-169：受管字段来源三态合并（标准化时刻报告）
  const { mergeProvenanceWithCurrent, carryForwardMachineAuthorship } = require("./article-field-provenance.cjs");
  // WP-169：来源快照落任务记录（状态单写者在本服务；.ledger workflow state 既有家，无新表）
  function saveDraftProvenance(draftRelativePath, freshProvenance) {
    let merged = freshProvenance;
    try {
      const state = readWorkflowState(vaultPath);
      const task = state.tasks.find((item) => item.draftPath === draftRelativePath);
      if (task) {
        // 红队P1-2：与既有快照合并——上轮机器写入且值未变的字段携带回 auto（重复校验不冒认 human）
        merged = carryForwardMachineAuthorship(task.fieldProvenance, freshProvenance);
        task.fieldProvenance = merged;
        task.updatedAt = new Date().toISOString();
        persistWorkflowState(vaultPath, state);
      } // 缺任务＝非正常序（validateDraft 已 ensureUploadTask），不越权补建；返回原值供响应
    } catch (error) {
      logger.warn({ event: "draft-provenance-save-failed", draftPath: draftRelativePath, error: error && error.message,
        consequence: "三态将退化为保守两态（机器auto值报human）——快照为增强面，不阻断校验主链" }); // 红队记档1：后果语义显式化
    }
    return merged; // 回传合并视图：校验响应与快照同源（漂移语义一致）
  }
  const draftWorkflow = createArticleDraftWorkflow({ vaultPath, logger, workflowError, ensureUploadTask, relativeVaultPath, saveDraftProvenance });
  // S124收敛/数据流闭环：promote 完成后显式触发状态同步，使 .ledger task 状态立即跟进
  // （promote 前由 validateDraft 的 ensureUploadTask 建初态；promote 后这里同步到 precleaned/ 状态）
  // 这样 Single-Writer=系统写 .ledger，Vault 脚本无需直写（移除 sync_upload_tasks_json）
  async function promoteDraftWithSync(filePath, confirmed, options) { // PR-056：随 promoteDraft 异步化
    assertRevisionCurrent(options && options.expectedRevision); // WP-022 入口预检：冲突在文件搬移前拒绝
    const result = await draftWorkflow.promoteDraft(filePath, confirmed);
    synchronizedState(); // 触发 syncUploadTasks：更新匹配 task 的 precleanedPath/status
    return result;
  }
  // 方案 2（2026-10-15 Master 裁）：退役消化——文章退役后其投稿任务置 digested 终态
  // （退出追踪、保留台账；真正审计走 vault git 提交史，此面板不再当第二审计面）。
  function digestUploadTasks(basename, options) {
    const key = String(basename || "").replace(/\.md$/, "");
    if (!key) return 0;
    assertRevisionCurrent(options && options.expectedRevision); // 入口预检
    const state = readWorkflowState(vaultPath);
    const now = new Date().toISOString();
    let digested = 0;
    for (const task of state.tasks) {
      const taskKey = path.basename(String(task.draftPath || "")).replace(/\.md$/, "");
      if (task.status === "digested" || taskKey !== key) continue;
      task.status = "digested";
      task.updatedAt = now;
      digested += 1;
    }
    if (digested > 0) persistWorkflowState(vaultPath, state);
    return digested;
  }

  return {
    upload, getTask, listUploads, listPrecleaned, getPrecleaned,
    searchCandidates, standardize, updateCandidateFields, getFieldCompletionOptions,
    readPublishedContent(articleId) {
      const version = currentStandardVersion(articleId);
      const reader = getReleaseReader();
      return version && reader ? reader.withPinnedRelease(() => reader.readArtifact(version.snapshotPath)) : null;
    },
    publishedArticleIdForPath(relativePath) {
      try { return listCurrentStandardVersions().find((version) => version.snapshotPath === relativePath)?.articleId || null; }
      catch (error) {
        if (error && NO_USABLE_RELEASE_CODES.has(error.code)) return null;
        throw error;
      }
    },
    listPublishedVersions: listCurrentStandardVersions,
    validateDraft: (filePath, options) => draftWorkflow.validateDraft(filePath, options), promoteDraft: promoteDraftWithSync,
    digestUploadTasks,
  };

  function resolveVaultRelative(relativePath, allowedRoot) {
    const candidate = path.resolve(vaultPath, ...relativePath.split("/"));
    const root = path.resolve(allowedRoot);
    if (!candidate.startsWith(root + path.sep)) throw workflowError("PATH_OUTSIDE_ALLOWED_ROOT", "源路径越界");
    return candidate;
  }

  function currentStandardVersion(articleId) {
    if (!articleId) return null;
    const releaseReaderService = getReleaseReader();
    if (!releaseReaderService) return null;
    try {
      return listCurrentStandardVersions().find((version) => version.articleId === articleId) || null;
    } catch (error) {
      // 标准化是纯文件操作（ADR043 D2'），不应被 current 指针 fail-closed 卡住（#1077）。
      // 无可用 Release（指针缺失/非法/不匹配/校验失败）→ 返回 null 让工作树快照兜底接住；
      // 编程错误（RELEASE_ID_LOCKED / NOT_IN_PINNED_CONTEXT）仍 rethrow，不吞。
      if (error && NO_USABLE_RELEASE_CODES.has(error.code)) return null;
      throw error;
    }
  }

  // E3'c：标准版本发现改为新链路单源（current Release 产物），去 git-proposal（#1056 新链路 + 去旧链路）。
  function listCurrentStandardVersions() {
    const releaseReaderService = getReleaseReader();
    if (!releaseReaderService) return [];
    const byArticle = new Map();
    releaseReaderService.withPinnedRelease((releaseId) => {
      const manifest = releaseReaderService.readRelease(releaseId);
      for (const artifact of manifest.artifacts || []) {
        if (!artifact.name.startsWith(`${articleLifecycle.FORMAL_ROOT}/`) || !artifact.name.endsWith(".md")) continue;
        const raw = releaseReaderService.readArtifact(artifact.name);
        const doc = loadDocument(raw, artifact.name);
        const id = typeof doc.frontmatter?.[DK.ARTICLE.articleId] === "string" ? doc.frontmatter[DK.ARTICLE.articleId].trim() : "";
        if (!id) continue;
        if (byArticle.has(id)) throw workflowError("ARTICLE_FORMAL_IDENTITY_AMBIGUOUS", "Current Release contains more than one active version for an article", 500, { articleId: id });
        const title = doc.frontmatter[DK.ARTICLE.title] || id;
        byArticle.set(id, { articleId: id, contentHash: crypto.createHash("sha256").update(raw).digest("hex"), snapshotPath: artifact.name, title, releaseId });
      }
    });
    return [...byArticle.values()].sort((left, right) => left.articleId.localeCompare(right.articleId));
  }
}

function validateUpload(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw workflowError("VALIDATION_ERROR", "请求体必须为 JSON 对象");
  const fileName = requiredText(input.fileName, "fileName");
  if (fileName !== path.basename(fileName) || /[\\/\0]/.test(fileName)) throw workflowError("INVALID_FILE_NAME", "文件名不能包含路径");
  const extension = path.extname(fileName).toLowerCase();
  if (!ACCEPTED_EXTENSIONS.has(extension)) throw workflowError("UNSUPPORTED_FILE_TYPE", "文件类型不在架构师摄取 Skill 支持范围内", 415, { acceptedExtensions: [...ACCEPTED_EXTENSIONS] });
  return { fileName, content: decodeBase64(input.contentBase64) };
}

function decodeBase64(value) {
  if (typeof value !== "string" || !value || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) throw workflowError("VALIDATION_ERROR", "contentBase64 不是合法 Base64");
  const content = Buffer.from(value, "base64");
  if (content.length > MAX_UPLOAD_BYTES) throw workflowError("UPLOAD_TOO_LARGE", "文件超过 10 MiB", 413);
  if (!content.length) throw workflowError("VALIDATION_ERROR", "上传文件不能为空");
  return content;
}

function collectMarkdownFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
      if (entry.name.startsWith(".")) return;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) files.push(absolute);
    });
  }
  return files;
}

function articleWithWorkflow(item, record, currentStandardVersion = null) {
  const isCurrent = currentStandardVersion?.contentHash === record.contentHash;
  // 2026-11-01 Master（「环境启动说明咋还在呢」半成品区过滤批）：published＝正式版在 current
  // Release 且哈希与工作区一致——发布识别断言（searchCandidates 据此把已发布且未再改动的
  // 候选从半成品区移除；源文件再改动→哈希失配→published=false→重列，保留再标准化入口）。
  const published = Boolean(currentStandardVersion && isCurrent);
  // 契约投影清洗（seq196 enforce 观测轮 #1592）：currentStandardVersion 分支 B 中 releaseId/sourceCommit
  // 为 string 类型——本地快照兜底产的 null 键在响应投影层省略（缺省合法、null 违例），逻辑判定用原对象。
  const projectedVersion = currentStandardVersion && typeof currentStandardVersion === "object"
    ? Object.fromEntries(Object.entries(currentStandardVersion).filter(([, v]) => v !== null))
    : currentStandardVersion;
  // L41 金路径残余红修复（#1786）：listCurrentStandardVersions 的 Release 链路投影只产
  // {articleId, contentHash, snapshotPath, title, releaseId}，缺契约 required 的 validatedAt——
  // 发布过的文章（进 current Release）必触发 enforce 500（oneOf 失配），前端 candidates 空、
  // 审批徽标恒「草稿」（browser 步 /已发布/ 60s 超时根因）。validatedAt 语义 =「当前已验证版本的
  // 标准化校验通过时间」，单源取 record.validatedAt（standardize 成功时写入），updatedAt 兜底。
  if (projectedVersion && typeof projectedVersion === "object" && projectedVersion.validatedAt === undefined) {
    projectedVersion.validatedAt = record.validatedAt || record.updatedAt;
  }
  // SPEC-030 派②收尾（PD-2 一致性）：标准化不再落盘快照（物理写延至 publish）——正式内容哈希与
  // 校验通过时间在无 Release 版本时由机② record 补位，否则审批机探针（standardize 前置要求
  // formalContentHash 非空）对一切未发布标准化文章恒拒——draft→pending 死锁（2026-10-29 实录）。
  const recordBased = record.standardizationStatus === "standardized";
  return {
    ...item,
    formalContentHash: recordBased ? record.contentHash : (isCurrent ? currentStandardVersion?.contentHash : null),
    // SPEC-030 机②（PD-2）：standardized 身份由 standardize 动作持久写入 record（存储层事实）；
    // Release 判定（isCurrent）只升级不降级——发布识别缺席不得推翻已标准化身份（否则快照延后落位
    // 会让重载后一切标准化文章回退 pending）。
    standardizationStatus: (isCurrent || record.standardizationStatus === "standardized") ? "standardized" : record.standardizationStatus === "blocked" ? "blocked" : "pending_standardization",
    currentStandardVersion: projectedVersion,
    published,
    validatedAt: currentStandardVersion?.validatedAt || (recordBased ? record.validatedAt || null : null),
    standardizationWarningCount: Array.isArray(record.standardizationWarnings) ? record.standardizationWarnings.length : 0,
    // WP-169（SPEC-095 §3.1）：受管字段来源三态（auto/human/not-extracted）——存量无记录不添键（增量兼容）
    ...(record.fieldProvenance ? { fieldProvenance: record.fieldProvenance } : {}),
  };
}

function standardizationCheckFindings(proposalId, checks) {
  const identity = {
    proposalId,
    proposalCommit: checks.commit,
    checksId: checks.checksId,
    blocking: checks.blocking === true,
  };
  const project = (finding, check) => ({
    code: finding.ruleId || check.ruleId || "article.standardization",
    message: finding.message || check.message || "标准化校验发现问题",
    ruleId: finding.ruleId || check.ruleId || "article.standardization",
    proposalId,
    proposalCommit: checks.commit,
    checksId: checks.checksId,
    sourceCoordinate: finding.sourcePath || check.sourceCoordinate || null,
  });
  const errors = [];
  const warnings = [];
  for (const check of checks.results || []) {
    for (const finding of check.details?.errors || []) errors.push(project(finding, check));
    for (const finding of check.details?.warnings || []) warnings.push(project(finding, check));
  }
  return { errors, warnings, identity };
}

function boundedChild(root, fileName) {
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, fileName);
  if (candidate === resolvedRoot || !candidate.startsWith(resolvedRoot + path.sep)) throw workflowError("PATH_OUTSIDE_ALLOWED_ROOT", "目标路径越界");
  return candidate;
}

function normalizeMetadata(frontmatter) {
  return Object.fromEntries(Object.entries(frontmatter && typeof frontmatter === "object" && !Array.isArray(frontmatter) ? frontmatter : {})
    .filter(([, value]) => typeof value === "string" || typeof value === "number" || typeof value === "boolean" || Array.isArray(value)));
}

function requiredText(value, field) { if (typeof value !== "string" || !value.trim()) throw workflowError("VALIDATION_ERROR", `${field} 不能为空`); return value.trim(); }
// 复用 shared/frontmatter-normalize.unwrapReference（N1 SSOT）；textValue 先取首元素+trim
function wikilinkText(value) { return unwrapReference(textValue(Array.isArray(value) ? value[0] : value, "")); }
function textValue(value, fallback) { return typeof value === "string" && value.trim() ? value.trim() : fallback; }
function ensureDirectories(directories) { directories.forEach((directory) => fs.mkdirSync(directory, { recursive: true })); }

module.exports = { createArticleWorkflowService };
