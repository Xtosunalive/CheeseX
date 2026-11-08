// @responsible: 校验和提升草稿，并归档原始来源及补全确定性元数据。
const fs = require("fs");
const articleLifecycle = require("../../shared/article-lifecycle-paths.cjs");
const path = require("path");
const crypto = require("crypto");
const { execVaultRuntimeScript } = require("../../shared/vault-runtime-spawn.cjs"); // WP-069 §3.1：唯一拉起点
const lifecycleTransitions = require("../../shared/article-lifecycle-transitions.cjs"); // WP-069 S4：决定面单源
const yaml = require("yaml");
// WP-116 批2（SPEC-083 §二.3）：装载/补丁经文档装载端口出口（loadDocument＝宿主 parseEntityDocument
// 同底座委托，null 原型不变；patchFrontmatter 纯转发）——消费面禁直 require 宿主。
const { loadDocument, patchFrontmatter } = require("../../shared/document-load-port.cjs");
// WP-138 R5b：frontmatter 派生键名经文档键源单点（本文件零手抄字段名清单）
const DK = require("../../shared/document-keys.cjs");
const { unwrapPathReference } = require("../../shared/frontmatter-normalize.cjs");
const { subdomainEntryId } = require("../../shared/enums-loader.cjs");
const { loadArticleRuleSet } = require("../schema-manager/compliance-rule-set-service.cjs");
// PR-016 方案甲：运行时脚本路径解析单点（仓内 scripts/vault-runtime 优先，vault 旧位回退）。
const { resolveVaultRuntimeScript } = require("../../shared/vault-runtime-resolver.cjs");
const { writeVault, writeVaultExclusive, readVault, contentRevision, ABSENT_REVISION } = require("../../shared/vault-io.cjs"); // PR-057：vault 唯一写通道（原子写＋归属取证日志；noLedger=记账归属维持现状）；PR-083：凭据制

// B13：草稿枚举加载消重——原 loadEnumsForDraft 手写解析 enums.yaml 只取 5 键，且缺 statuses。
// 改为复用 loadArticleRuleSet（读 enums.yaml + buildRuleSet 单源），消除「同一事实多份来源」。
// 注意语义差异：buildRuleSet.domains 是对象（非原副本的数组）、subdomains 是对象，消费处需 Object.keys()。

function createArticleDraftWorkflow({ vaultPath, logger, workflowError, ensureUploadTask, relativeVaultPath }) {
  function resolveVaultRelative(relativePath, allowedRoot) {
    const candidate = path.resolve(vaultPath, ...relativePath.split("/"));
    const root = path.resolve(allowedRoot);
    if (!candidate.startsWith(root + path.sep)) throw workflowError("PATH_OUTSIDE_ALLOWED_ROOT", "源路径越界");
    return candidate;
  }

  function resolveDraftPath(filePath) {
    if (typeof filePath !== "string" || !filePath.trim()) throw workflowError("VALIDATION_ERROR", "filePath 不能为空");
    const normalized = filePath.replace(/\\/g, "/");
    if (!articleLifecycle.isUnderDraft(normalized) || !normalized.endsWith(".md")) throw workflowError("INVALID_DRAFT_PATH", "仅允许 raw/drafts/ 下的 .md 文件");
    const absolute = path.resolve(vaultPath, ...normalized.split("/"));
    const allowedRoot = articleLifecycle.draftsDir(vaultPath);
    if (!absolute.startsWith(allowedRoot + path.sep)) throw workflowError("DRAFT_PATH_ESCAPE", "草稿路径越界");
    if (!fs.existsSync(absolute)) throw workflowError("DRAFT_NOT_FOUND", "草稿文件不存在", 404);
    // WP-066（SPEC-059 T1）＋WP-069 S4：存在但状态≠边起点 → 409 状态错误；expected 经
    // requiredFrom("promote") 由 transitions 边表单源给出（调用点不再写起点字面量）
    articleLifecycle.assertTransitionState(normalized, lifecycleTransitions.requiredFrom("promote"));
    return absolute;
  }

  function archiveDraftSource(draftRelativePath) {
    const absolute = resolveVaultRelative(draftRelativePath, articleLifecycle.draftsDir(vaultPath));
    const rawContent = fs.readFileSync(absolute, "utf8");
    const doc = loadDocument(rawContent, absolute);
    const existingSource = typeof doc.frontmatter[DK.ARTICLE.sourceFile] === "string" ? doc.frontmatter[DK.ARTICLE.sourceFile].replace(/\\/g, "/") : "";
    if (articleLifecycle.isUnderArchive(existingSource)) {
      const archived = resolveVaultRelative(existingSource, articleLifecycle.archiveDir(vaultPath));
      if (!fs.existsSync(archived)) throw workflowError("SOURCE_ARCHIVE_MISSING", "原始来源归档不存在，已保留草稿并拒绝提升", 409);
      return { changed: false, archivePath: existingSource };
    }

    let sourceAbsolute = absolute;
    if (existingSource && existingSource !== draftRelativePath) {
      const unwrapped = unwrapPathReference(existingSource); // N1 SSOT：路径型 wikilink 剥离归口（#875）
      if (path.isAbsolute(unwrapped)) throw workflowError("SOURCE_PATH_OUTSIDE_VAULT", "原始来源必须位于当前 Vault 内", 409);
      const candidate = path.resolve(vaultPath, ...unwrapped.split("/"));
      if (!candidate.startsWith(vaultPath + path.sep)) throw workflowError("SOURCE_PATH_OUTSIDE_VAULT", "原始来源路径越界", 409);
      sourceAbsolute = fs.existsSync(candidate) ? candidate : findSourceByName(path.basename(unwrapped));
      if (!sourceAbsolute) throw workflowError("SOURCE_FILE_NOT_FOUND", "原始来源文件不存在，已保留草稿并拒绝提升", 409);
    }

    const sourceKind = articleLifecycle.isSubmissionDraft(draftRelativePath) ? "投稿" : "本地草稿";
    const sourceContent = fs.readFileSync(sourceAbsolute);
    const digest = crypto.createHash("sha256").update(sourceContent).digest("hex");
    const archiveDir = articleLifecycle.archiveDir(vaultPath, sourceKind);
    const archiveAbsolute = path.join(archiveDir, `${digest}-${path.basename(sourceAbsolute)}`);
    // 红队 P1 自愈（P3 批放宽：匹配「属主无写位」而非恰好 0o555——0o500/0o555 等一切不可写遗留态都愈）：lane 为共享写工作区，写前确保可写
    try { if ((fs.statSync(archiveDir).mode & 0o200) === 0) fs.chmodSync(archiveDir, 0o755); } catch { /* 目录不存在由 mkdir 建 */ }
    fs.mkdirSync(archiveDir, { recursive: true });
    if (!fs.existsSync(archiveAbsolute)) writeVaultExclusive(archiveAbsolute, sourceContent, { domain: "workflow", summary: "原始来源归档" }, { flag: "wx", mode: 0o444 }); // SPEC-012 WP-I：记账归通道；SPEC-028：source-archive=read-only-evidence（vault-io 执法同款，显式声明双保险）
    if (!fs.readFileSync(archiveAbsolute).equals(sourceContent)) {
      throw workflowError("SOURCE_ARCHIVE_MISMATCH", "原始来源归档内容校验失败，已保留草稿并拒绝提升", 409);
    }
    const archivePath = relativeVaultPath(archiveAbsolute);
    const fm = Object.assign({}, doc.frontmatter, { [DK.ARTICLE.sourceFile]: archivePath });
    writeVault(absolute, `---\n${yaml.stringify(fm).trim()}\n---\n${doc.body.trimStart()}`, { expectedContentHash: contentRevision(rawContent), domain: "workflow", summary: "草稿来源归档回写" }); // SPEC-012 WP-I＋PR-083：读改写带凭据（rawContent 为函数入口读取）
    logger.info({ event: "draft-source-archived", filePath: draftRelativePath, archivePath, sourceHash: digest });
    return { changed: true, archivePath };
  }

  function findSourceByName(fileName) {
    const wanted = path.parse(fileName).name;
    const roots = [articleLifecycle.archiveDir(vaultPath), path.join(vaultPath, "知识库", "raw", "imported")];
    for (const root of roots) {
      if (!fs.existsSync(root)) continue;
      const pending = [root];
      while (pending.length) {
        const current = pending.pop();
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          const candidate = path.join(current, entry.name);
          if (entry.isDirectory()) pending.push(candidate);
          else if (entry.name === fileName || path.parse(entry.name).name === wanted) return candidate;
        }
      }
    }
    return null;
  }

  function autoFillDraftFrontmatter(absolutePath) {
    const raw = fs.readFileSync(absolutePath, "utf8");
    const doc = loadDocument(raw, absolutePath);
    const fm = doc.frontmatter || {};
    const enums = loadArticleRuleSet(vaultPath);
    const changes = {};
    const filled = [];
    const suggested = {};
    const empty = (value) => value === null || value === undefined || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && value.length === 0);
    const fill = (field, value) => { if (value !== undefined) { changes[field] = value; filled.push(field); } };
    const suggest = (field, value) => { if (value !== undefined) { suggested[field] = value; } };

    // Mechanical normalizations — deterministic, safe to persist
    if (empty(fm[DK.ARTICLE.title])) fill(DK.ARTICLE.title, path.basename(absolutePath, ".md"));
    const today = new Date().toISOString().slice(0, 10);
    if (empty(fm[DK.ARTICLE.date])) fill(DK.ARTICLE.date, today);
    if (empty(fm[DK.ARTICLE.updated])) fill(DK.ARTICLE.updated, today);
    // B12：删除 tags←标题 自动填充（无依据占位，违反「推测只能建议」）；tags 由用户显式填写，F16 负责拦空。
    // status：保留自动填充（新建默认有效是合理业务默认值），默认值从 Vault 读而非硬编码中文（原则 7）。
    if (empty(fm[DK.ARTICLE.status])) {
      const defaultStatus = (enums && enums.defaultStatus) || (enums && enums.statuses && enums.statuses[0]);
      if (defaultStatus) fill(DK.ARTICLE.status, defaultStatus);
    }

    // Speculative classifications — only suggest, never write as confirmed facts
    if (empty(fm[DK.ARTICLE.module]) && enums && enums.moduleNames.length) {
      const bodyLower = (doc.body || "").toLowerCase();
      suggest(DK.ARTICLE.module, enums.moduleNames.find((name) => bodyLower.includes(name.toLowerCase())));
    }
    if (empty(fm[DK.ARTICLE.articleType]) && enums && enums.articleTypes.length) suggest(DK.ARTICLE.articleType, enums.articleTypes[0]);
    // 双拼写回落语义原样（empty 双查）——只换键名来源（WP-138 R5b 等价替换纪律）
    if (empty(fm[DK.ARTICLE.docType]) && empty(fm[DK.ARTICLE.docTypeLegacy]) && enums && enums.docTypes.length) suggest(DK.ARTICLE.docType, enums.docTypes[0]);
    if (empty(fm[DK.ARTICLE.categoryPath]) && empty(fm[DK.ARTICLE.categoryPathLegacy]) && enums) {
      // WP-040（Master 2026-10-29「2A」）：两段式契约 domain:subdomain——topic 段退役（推测性建议，不落盘写入，由用户裁定）。
      const domains = Object.keys(enums.domains || {});
      const domain = domains.includes("ops") ? "ops" : domains[0];
      // ADR-008 D1：词条双形态取 id（裸标量 legacy｜{id,...} 对象）。
      const subdomain = subdomainEntryId(((enums.subdomains || {})[domain] || [])[0]);
      if (subdomain) suggest(DK.ARTICLE.categoryPath, `${domain}:${subdomain}`);
    }

    if (!filled.length) return { changed: false, filled: [], suggested };
    writeVault(absolutePath, patchFrontmatter(raw, changes), { expectedContentHash: contentRevision(raw), domain: "workflow", summary: "草稿元数据自动补全" }); // SPEC-012 WP-I＋PR-083：读改写带凭据（raw 为函数入口读取）
    logger.info({ event: "draft-frontmatter-auto-filled", filePath: relativeVaultPath(absolutePath), filled, suggested: Object.keys(suggested) });
    return { changed: true, filled, suggested };
  }

  async function validateDraft(filePath, options) { // PR-056：python 校验异步化；WP-021 options＝乐观锁透传
    const absolute = resolveDraftPath(filePath);
    const relativePath = relativeVaultPath(absolute);
    ensureUploadTask(relativePath, options);
    archiveDraftSource(relativePath);
    const autoFillResult = autoFillDraftFrontmatter(absolute);
    // SPEC-022 波 B：校验器切统一客户端 validate-article 操作面（Node 唯一语义；Python 侧随波 C 退役）。
    // KB_VAULT 注入保留（桩测试契约＋子进程兜底观测）；客户端自身走显式 --vault（写路径无回落纪律）。
    const validatorPath = resolveVaultRuntimeScript("schema-write-client.mjs", { vaultPath });
    if (!fs.existsSync(validatorPath)) throw workflowError("VALIDATOR_NOT_FOUND", "schema-write-client.mjs 不存在", 503);
    // WP-069 §3.1：经唯一拉起模块（interpreter=node；KB_VAULT 由构造器注入——桩测试契约＋子进程兜底观测）
    const result = await execVaultRuntimeScript(
      "schema-write-client.mjs",
      ["validate-article", "--file", absolute, "--stamp", "--vault", vaultPath],
      { vaultPath, interpreter: "node", vocabEnvelope: false, timeout: 30_000 },
    );
    if (result.error) throw workflowError("VALIDATION_SPAWN_FAILED", result.error.message, 500);
    let payload;
    try { payload = JSON.parse(result.stdout || "{}"); }
    catch (_error) { throw workflowError("VALIDATION_OUTPUT_INVALID", "校验脚本输出非法 JSON", 500); }
    const passed = result.status === 0;
    return {
      valid: passed,
      status: passed ? "passed" : payload.errors && payload.errors.length ? "failed" : "warnings",
      errors: payload.errors || [], warnings: payload.warnings || [], summary: payload.summary || "",
      reportable: payload.reportable || [],
      autoFilled: autoFillResult.changed ? autoFillResult.filled : [],
      suggested: autoFillResult.suggested || {},
    };
  }

  async function promoteDraft(filePath, confirmed) { // PR-056：python 提升异步化（60s 超时不再冻结事件循环）
    if (confirmed !== true) throw workflowError("CONFIRMATION_REQUIRED", "提升操作必须显式确认", 400);
    const absolute = resolveDraftPath(filePath);
    const archive = archiveDraftSource(relativeVaultPath(absolute));
    const promoterPath = resolveVaultRuntimeScript("promote-article.py", { vaultPath });
    if (!fs.existsSync(promoterPath)) throw workflowError("PROMOTER_NOT_FOUND", "promote-article.py 脚本不存在", 503);
    // WP-069 S4：「promote 后落到哪」由决定面单源回答（nextState→dirFor），服务不再直调
    // workingDir 隐式决定目标态——决定是纯函数，提交（promote-article.py 搬迁）归拉起链
    const promotedState = lifecycleTransitions.nextState(articleLifecycle.stateOf(relativeVaultPath(absolute)), "promote");
    if (!promotedState) throw workflowError("LIFECYCLE_TRANSITION_INVALID", "当前状态无 promote 转移边", 409, { state: articleLifecycle.stateOf(relativeVaultPath(absolute)), action: "promote" });
    const precleaned = path.join(lifecycleTransitions.dirFor(promotedState, vaultPath), path.basename(absolute));
    const candidateExisted = fs.existsSync(precleaned);
    const draftBeforePromote = fs.readFileSync(absolute);
    // WP-069 §3.1：词表信封随拉起物化（vocabEnvelope 语义选项）——promote-article.py 零词表文件读取
    const result = await execVaultRuntimeScript(
      "promote-article.py",
      [absolute],
      { vaultPath, vocabEnvelope: true, timeout: 60_000 },
    );
    if (result.error) throw workflowError("PROMOTE_SPAWN_FAILED", result.error.message, 500);
    if (result.status !== 0) {
      if (!candidateExisted && fs.existsSync(precleaned)) fs.rmSync(precleaned);
      if (!fs.existsSync(absolute)) writeVault(absolute, draftBeforePromote, { expectedContentHash: ABSENT_REVISION, domain: "workflow", summary: "promote 失败恢复草稿" }); // SPEC-012 WP-I＋PR-083：恢复创建声明 absent
      throw workflowError("PROMOTE_FAILED", (result.stderr || result.stdout || "提升失败").trim().split("\n").pop(), 500);
    }
    if (!fs.existsSync(precleaned) || !fs.existsSync(path.join(vaultPath, ...archive.archivePath.split("/")))) {
      if (!fs.existsSync(absolute)) writeVault(absolute, draftBeforePromote, { expectedContentHash: ABSENT_REVISION, domain: "workflow", summary: "promote 后置失败恢复草稿" }); // PR-083：恢复创建声明 absent
      throw workflowError("PROMOTE_POSTCONDITION_FAILED", "提升后候选或原始归档缺失，已恢复草稿", 500);
    }
    logger.info({ event: "draft-promoted", draftPath: filePath, precleanedPath: relativeVaultPath(precleaned) });
    return { precleanedPath: relativeVaultPath(precleaned), message: result.stdout.trim() };
  }

  return { validateDraft, promoteDraft };
}

module.exports = { createArticleDraftWorkflow };
