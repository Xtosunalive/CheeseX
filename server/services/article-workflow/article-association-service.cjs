// @responsible: 预览并原子写回正式文章的架构关联及审计决策。
const crypto = require("crypto");
const { displayTheSchemaPath } = require("../../shared/theschema-root.cjs");
const articleLifecycle = require("../../shared/article-lifecycle-paths.cjs");
const fs = require("fs");
const path = require("path");
const YAML = require("yaml");
const { createDecisionEvidenceService } = require("../governance/decision-evidence-service.cjs");
// WP-116 批2（SPEC-083 §二.3）：补丁经文档装载端口出口（patchFrontmatter 宿主纯转发）——消费面禁直 require 宿主。
const { patchFrontmatter } = require("../../shared/document-load-port.cjs");
// PR-053：article_associations.yaml 形态收口走 TheSchema 通用咽喉
const { normalizeDocument } = require("../../shared/theschema-loader.cjs");
// Formal article eligibility is supplied by a pinned Release catalog. This
// service never reads mutable workflow state to decide which articles are formal.

const DEFAULT_RAW = "schema_version: 1\ndecisions: []\n";

const { bindErrorFactory } = require("../../shared/error-factory.cjs");
const { writeVault, writeVaultExclusive, contentRevision, ABSENT_REVISION } = require("../../shared/vault-io.cjs"); // PR-057：vault 唯一写通道（原子写＋归属取证日志；noLedger=记账归属维持现状）；PR-083：凭据制
const { resolveTheSchemaDir } = require("../../shared/theschema-root.cjs");
const { writeTheSchemaFile } = require("../../shared/theschema-write.cjs"); // WP-075：TheSchema 写通道按落点分流咽喉
const serviceError = bindErrorFactory({ status: 400 });

function revision(raw) { return `sha256:${crypto.createHash("sha256").update(raw).digest("hex")}`; }
function stableAssociationId(articleId, association) {
  const coordinate = [articleId, association.product, association.component_id || "", association.version_since || "", association.version_until || ""].join("|");
  return "assoc-" + crypto.createHash("sha256").update(coordinate).digest("hex").slice(0, 20);
}
function uniqueStrings(value, field) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) throw serviceError("VALIDATION_ERROR", `${field} 必须是非空字符串数组`);
  return [...new Set(value.map((item) => item.trim()))].sort();
}
function versionNodeId(product, version) {
  const slug = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "");
  return product && version ? `version-${slug(product)}-${slug(version)}` : "";
}

function normalizedPath(value) {
  return typeof value === "string" ? value.trim().replace(/\\/g, "/") : "";
}

function applyAction(current, requested, action) {
  const currentSet = new Set(current); const requestedSet = new Set(requested);
  if (action === "replace") return [...requestedSet].sort();
  if (action === "add") return [...new Set([...currentSet, ...requestedSet])].sort();
  return [...currentSet].filter((item) => !requestedSet.has(item)).sort();
}

function createArticleAssociationService(options) {
  const vaultPath = path.resolve(options.vaultPath);
  const filePath = path.join(resolveTheSchemaDir(vaultPath), "article_associations.yaml");
  const getGraph = options.getGraph;
  const getRegistry = options.getRegistry;
  const now = options.now || (() => new Date());
  const operatorContext = options.operatorContext || { getOperatorId: () => "local-architect" };
  const changeDispositionService = options.changeDispositionService || null;
  const listFormalArticles = options.listFormalArticles;
  const readAuditRaw = options.readAuditRaw || function () {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
  };
  const writeAuditRaw = options.writeAuditRaw || function (raw, expectedContentHash) {
    // WP-075/P2-8 通道归一：账本住址由 resolver 决定（SPEC-023 三级阶梯），写通道随住处分流——
    // 仓内主源走 repo-schema-io，vault 侧走 vault-io；此前恒走 vault 通道，主源翻回仓内即被
    // SPEC-012 F1 目的地执法拒写（tr_504310b2 生产 500）。
    // PR-204 裁定「与其他域一致」：账本写按落点通道记账——仓内主源走 repo-schema-io（git 即账），
    // 无账车语义，故摘掉 noLedger 死参数；vault 侧形态（钉扎／迁移窗口）照常交账车。
    try { writeTheSchemaFile(filePath, raw, { expectedContentHash, summary: "关联决策账本写回" }); }
    catch (error) { throw channelConflict(error) || serviceError("ARTICLE_ASSOCIATIONS_WRITE_FAILED", error.message, 500); }
  };
  if (typeof listFormalArticles !== "function") {
    throw new Error("createArticleAssociationService requires injected listFormalArticles port");
  }
  const evidenceService = options.decisionEvidenceService || createDecisionEvidenceService({ now, operatorId: operatorContext.getOperatorId() });

  function resolveActiveArticlePath(sourcePath) {
    const root = articleLifecycle.workingDir(vaultPath);
    const resolved = path.resolve(vaultPath, normalizedPath(sourcePath));
    if (!resolved.startsWith(root + path.sep) || path.extname(resolved) !== ".md") {
      throw serviceError("ARTICLE_SOURCE_OUTSIDE_ACTIVE_ROOT", "文章关联只能写入已批准文章的活动源文件", 422, { sourcePath });
    }
    return resolved;
  }
  /**
   * 通道写前冲突（vault 分支 VAULT_REVISION_CONFLICT／仓内分支 SCHEMA_REVISION_CONFLICT）一律重包为
   * 域码 409——与服务层 revision 乐观锁同轴，此为写前最后防线（PR-083）。非冲突返回 null，
   * 由各写点以自己的字面量码定性出口：码经参数位传递会使 check:error-codes 看不见真抛点
   * （tr_504310b2 的 500 因契约无码被 enforce 掩埋，即此盲区的后果）。
   */
  function channelConflict(error) {
    if (error.code !== "VAULT_REVISION_CONFLICT" && error.code !== "SCHEMA_REVISION_CONFLICT") return null;
    return serviceError("ARTICLE_REVISION_CONFLICT", "文件已被并发修改，请重新读取", 409, error.details);
  }
  function writeArticleSource(targetPath, raw, expectedContentHash) {
    // PR-204：内容写搭 vault-git-ledger 账车——与 entity-repair／approval 等域同口径（原 noLedger 例外无在册理由）
    try { writeVault(targetPath, raw, { expectedContentHash, domain: "workflow", summary: "文章源文件写回" }); }
    catch (error) { throw channelConflict(error) || serviceError("ARTICLE_WRITE_FAILED", error.message, 500); }
  }

  function readFile() {
    const suppliedRaw = readAuditRaw();
    if (suppliedRaw != null && typeof suppliedRaw !== "string") {
      throw serviceError("FORMAL_AUDIT_ARTIFACT_INVALID", "正式 Release 文章关联审计工件格式无效", 500);
    }
    const exists = typeof suppliedRaw === "string";
    const raw = exists ? suppliedRaw : DEFAULT_RAW;
    let data;
    try { data = YAML.parse(raw) || {}; }
    catch (error) { return { raw, revision: revision(raw), decisions: [], auditStatus: "corrupt", auditError: error.message }; }
    // PR-053：形态收口走 TheSchema 通用咽喉（contracts/theschema.article_associations.schema.json）——
    // 脏 decision 局部降级（数组位留 null，过滤后不流入消费方），不升级 500；账本历史语义不变。
    const normalized = normalizeDocument("article_associations", data);
    const decisions = Array.isArray(normalized.data.decisions) ? normalized.data.decisions.filter(Boolean) : [];
    return { raw, revision: revision(raw), decisions, normalizationTrail: normalized.normalizationTrail, degradedNodes: normalized.degradedNodes, auditStatus: exists ? "valid" : "missing", auditError: exists ? null : "article_associations.yaml 不存在" };
  }
  function nextArticleRaw(sourcePath, associations) {
    const resolved = resolveActiveArticlePath(sourcePath);
    const raw = fs.readFileSync(resolved, "utf8");
    return { resolved, raw, nextRaw: patchFrontmatter(raw, { architecture_associations: associations }, {}) };
  }
  function articles() {
    const result = listFormalArticles();
    const catalog = Array.isArray(result) ? result : result?.articles;
    if (!Array.isArray(catalog)) throw serviceError("FORMAL_ARTICLE_CATALOG_INVALID", "正式 Release 文章目录格式无效", 500);
    return catalog
      .filter((item) => {
        // ADR063 活锚（#1776）：所有者源文件已删除的目录条目是幽灵行——Release 冻结目录落后于 Vault 删除时，
        // 保存路径本就以 ARTICLE_SOURCE_NOT_FOUND 拒绝它们（:247 一带），列表投影同样按活文件系统收口；
        // 审计历史（decisions）不经过本函数，不受影响。
        const live = normalizedPath(item.ownerSourcePath);
        return !!(live && fs.existsSync(path.join(vaultPath, live)));
      })
      .map((item) => {
      const sourcePath = normalizedPath(item.ownerSourcePath);
      if (!item.articleId || !sourcePath || !item.sourceHash) {
        throw serviceError("FORMAL_ARTICLE_IDENTITY_INVALID", "正式文章缺少 articleId、ownerSourcePath 或 sourceHash", 500);
      }
      return {
        articleId: item.articleId, title: item.title,
        sourcePath, sourceHash: item.sourceHash,
        product: item.product, version: item.version, componentIds: item.componentIds || [],
        associations: Array.isArray(item.associations) ? item.associations.filter((association) => association && typeof association === "object") : [],
      };
      });
  }
  function formalArticleAliases(articleList) {
    const aliases = new Map();
    for (const article of articleList) {
      const normalized = normalizedPath(article.sourcePath);
      if (normalized) aliases.set(normalized, article.articleId);
    }
    return aliases;
  }
  function decisionArticleId(item, articleMap, aliases) {
    if (articleMap.has(item.articleId)) return item.articleId;
    const approvedArticleId = aliases.get(normalizedPath(item.candidateSourcePath));
    return approvedArticleId && articleMap.has(approvedArticleId) ? approvedArticleId : item.articleId;
  }
  function optionsData() {
    const graph = typeof getGraph === "function" ? getGraph() : { nodes: [] };
    // 整改3：候选剔除非架构组件域身份（Document/BusinessDomain/Subdomain/Team 等显式标签），
    // 剔除测试垃圾名（test\d*/ticketing/sandbox 类）。无 labels 节点保持（旧图/裸 id 兼容——
    // 测试夹具与轻量图不带 labels，误剔会断候选链）。组件身份分组取 properties.group。
    const NON_COMPONENT_LABELS = new Set(["Document", "BusinessDomain", "Subdomain", "Team"]);
    const JUNK_ID = /^(test\d*|ticketing|sandbox|demo|tmp([-_].*)?)$/i;
    return (graph && Array.isArray(graph.nodes) ? graph.nodes : [])
      .filter((node) => node && node.id && !JUNK_ID.test(node.id))
      .filter((node) => !Array.isArray(node.labels) || !node.labels.some((label) => NON_COMPONENT_LABELS.has(label)))
      .map((node) => ({ id: node.id, label: node.label || node.properties?.title || node.properties?.name || node.id, group: typeof node.properties?.group === "string" ? node.properties.group : "" }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
  function versionOptionsData() {
    const registry = typeof getRegistry === "function" ? getRegistry() : { products: {} };
    const options = [];
    for (const [product, definition] of Object.entries(registry.products || {})) {
      for (const entry of definition.versions || []) {
        options.push({ id: versionNodeId(product, entry.id), label: entry.label, product, version: entry.id, status: entry.status });
      }
    }
    return options.sort((left, right) => left.id.localeCompare(right.id));
  }
  // #1797（用户拍板 2026-09-11）：版本选项按文章 product 过滤——具体产品文章只看该产品版本；
  // product=通用/缺省/未在注册表（过滤后为空）时兜底显示全部（现状行为，零回归）。
  // 单源：前端表单（collector 透传）与 save/preview 校验（associationsForTargets）共用本函数；
  // currentTargets 回显有意保持全量——已关联坐标（含历史跨产品/RAW 键）必须继续回显勾选。
  function scopedVersionOptions(article) {
    const options = versionOptionsData();
    const product = typeof (article && article.product) === "string" ? article.product.trim() : "";
    if (!product || product === "通用") return options;
    const scoped = options.filter((item) => item.product === product);
    return scoped.length > 0 ? scoped : options;
  }
  function currentTargets(article) {
    const associations = article.associations;
    const optionsByCoordinate = new Map(versionOptionsData().map((item) => [item.product + "\0" + item.version, item.id]));
    return {
      componentIds: [...new Set(associations.map((item) => item.component_id).filter(Boolean))].sort(),
      versionIds: [...new Set(associations.map((item) => optionsByCoordinate.get(item.product + "\0" + item.version_since)).filter(Boolean))].sort(),
    };
  }
  function associationsForTargets(article, componentIds, versionIds, decisionId) {
    const componentOptionIds = new Set(optionsData().map((item) => item.id));
    const unknownComponents = componentIds.filter((id) => !componentOptionIds.has(id));
    if (unknownComponents.length) throw serviceError("COMPONENT_NOT_REGISTERED", "关联组件未在当前图谱中登记", 422, { componentIds: unknownComponents });
    const options = scopedVersionOptions(article);
    const byId = new Map(options.map((item) => [item.id, item]));
    const selected = versionIds.map((id) => {
      const option = byId.get(id);
      if (!option) throw serviceError("VERSION_NOT_REGISTERED", "关联版本未在产品版本注册表中登记", 422, { versionId: id });
      return option;
    });
    const registry = typeof getRegistry === "function" ? getRegistry() : { products: {} };
    const scopes = selected.length ? selected.map((option) => {
      const registered = registry.products?.[option.product]?.versions || [];
      const index = registered.findIndex((item) => item.id === option.version);
      return { product: option.product, version_since: option.version, version_until: registered[index + 1]?.id || "" };
    }) : [{ product: article.product, version_since: "", version_until: "" }];
    const targets = componentIds.length ? componentIds : [null];
    if (!componentIds.length && !versionIds.length) return [];
    return scopes.flatMap((scope) => targets.map((componentId) => {
      const association = { ...scope, decision_id: decisionId };
      if (componentId) association.component_id = componentId;
      association.association_id = stableAssociationId(article.articleId, association);
      return association;
    }));
  }
  function list() {
    const currentDecisions = readFile(); const articleList = articles(); const articleMap = new Map(articleList.map((item) => [item.articleId, item]));
    const aliases = formalArticleAliases(articleList);
    // Current associations are projected from the request-pinned formal catalog.
    const currentAssociations = articleList.flatMap((article) => {
      return article.associations.map((item) => ({
        ...item,
        articleId: article.articleId,
        articleTitle: article.title,
        sourcePath: article.sourcePath,
        sourceHash: article.sourceHash,
      }));
    });
    // Audit records from YAML (historical log only)
    // 显示收敛（2026-10-15 Master 裁「失效数据直接不显示」）：幽灵行（解析不到活文章——源已删/
    // 正式目录已无该行）不进投影——与 articles() 活锚过滤（#1776）同哲学：审计数据保留在 YAML
    // （append-only），读路径只投活行。可见的 stale 行=文章在但内容变了（可重新指定）。
    const auditRecords = currentDecisions.decisions.map((item) => {
      const articleId = decisionArticleId(item, articleMap, aliases);
      const normalizedItem = articleId === item.articleId ? item : { ...item, articleId };
      const article = articleMap.get(articleId);
      if (!article) return null; // 幽灵行：不显示（治理清理由退役沿链/移除 API 承接）
      const stale = article.sourceHash !== item.candidateSourceHash;
      return {
        ...normalizedItem,
        operatorId: item.operatorId || "legacy-reviewer",
        stale,
        lineage: evidenceService.build({
          source: { kind: "vault-document", path: item.candidateSourcePath, contentHash: item.candidateSourceHash, coordinate: "article:" + articleId },
          rule: { ruleId: "article-association.manual-override", ruleRevision: currentDecisions.revision, reasonCode: "MANUAL_ASSOCIATION_OVERRIDE" },
          scope: { product: article?.product || "unknown-product", version: article?.version || "unknown-version" },
          decision: { decisionId: item.decisionId, operatorId: item.operatorId || "legacy-reviewer", kind: "manual", decidedAt: item.decidedAt },
          freshness: { status: stale ? "stale" : "fresh", checkedAt: now().toISOString(), changedFields: stale ? ["sourceHash"] : [] },
        }),
      };
    }).filter(Boolean);
    return {
      schema_version: 1,
      revision: currentDecisions.revision,
      sourceFile: displayTheSchemaPath(vaultPath, "article_associations.yaml"),
      auditStatus: currentDecisions.auditStatus,
      auditError: currentDecisions.auditError,
      articles: articleList,
      componentOptions: optionsData(),
      versionOptions: versionOptionsData(),
      currentAssociations,
      auditRecords,
      decisions: auditRecords, // backward compat
    };
  }
  function preview(payload) {
    const action = payload && payload.action;
    if (!["add", "remove", "replace"].includes(action)) throw serviceError("VALIDATION_ERROR", "action 必须是 add、remove 或 replace");
    const articleId = typeof payload.articleId === "string" ? payload.articleId.trim() : "";
    const article = articles().find((item) => item.articleId === articleId);
    if (!article) throw serviceError("ARTICLE_NOT_FOUND", "标准文章不存在", 404, { articleId });
    const componentIds = uniqueStrings(payload.componentIds || [], "componentIds");
    const versionIds = uniqueStrings(payload.versionIds || [], "versionIds");
    const currentTargetsValue = currentTargets(article);
    const currentComponents = currentTargetsValue.componentIds;
    const currentVersions = currentTargetsValue.versionIds;
    const nextComponents = applyAction(currentComponents, componentIds, action);
    const nextVersions = applyAction(currentVersions, versionIds, action);
    associationsForTargets(article, nextComponents, nextVersions, "preview");
    return {
      article,
      action,
      fileRevision: article.sourceHash,
      current: { componentIds: currentComponents, versionIds: currentVersions },
      next: { componentIds: nextComponents, versionIds: nextVersions },
      added: { componentIds: nextComponents.filter((item) => !currentComponents.includes(item)), versionIds: nextVersions.filter((item) => !currentVersions.includes(item)) },
      removed: { componentIds: currentComponents.filter((item) => !nextComponents.includes(item)), versionIds: currentVersions.filter((item) => !nextVersions.includes(item)) },
    };
  }
  function save(expectedRevision, payload) {
    const current = readFile();
    if (current.auditStatus === "corrupt") throw serviceError("ARTICLE_ASSOCIATION_AUDIT_CORRUPT", "文章关联审计日志损坏，拒绝覆盖历史", 503, { message: current.auditError });
    const result = preview(payload);
    if (expectedRevision !== result.fileRevision) throw serviceError("ARTICLE_REVISION_CONFLICT", "文章源文件已变化，请重新预览", 409, { expectedRevision, currentRevision: result.fileRevision });
    const articleFile = resolveActiveArticlePath(result.article.sourcePath);
    if (!fs.existsSync(articleFile)) throw serviceError("ARTICLE_SOURCE_NOT_FOUND", "正式文章的所有者源文件不存在", 404);
    const actualRevision = revision(fs.readFileSync(articleFile, "utf8"));
    if (actualRevision !== result.fileRevision) throw serviceError("ARTICLE_REVISION_CONFLICT", "文章源文件已变化，请重新预览", 409, { expectedRevision, currentRevision: actualRevision });
    if (changeDispositionService && typeof changeDispositionService.evaluate === "function") {
      const versionById = new Map(versionOptionsData().map((item) => [item.id, item]));
      const targetVersions = result.next.versionIds.length ? result.next.versionIds : [versionNodeId(result.article.product, result.article.version)].filter(Boolean);
      const affectedVersions = targetVersions.flatMap((versionId) => {
        const option = versionById.get(versionId);
        if (!option) return [];
        return [{
          product: option.product,
          version: option.version,
          status: option.status,
          componentIds: result.next.componentIds,
          removed: [],
          paths: [],
          documents: [{ articleId: result.article.articleId, sourceHash: result.article.sourceHash, sourcePath: result.article.sourcePath }],
        }];
      });
      const reasoning = changeDispositionService.evaluate({ affectedVersions });
      changeDispositionService.assertWriteAllowed(reasoning);
    }
    const decisionId = payload.decisionId || crypto.randomUUID();
    const nextAssociations = associationsForTargets(result.article, result.next.componentIds, result.next.versionIds, decisionId);
    const articleWrite = nextArticleRaw(result.article.sourcePath, nextAssociations);
    const resultingSourceHash = revision(articleWrite.nextRaw);
    const decision = {
      decisionId, articleId: result.article.articleId, action: result.action,
      componentIds: uniqueStrings(payload.componentIds || [], "componentIds"), versionIds: uniqueStrings(payload.versionIds || [], "versionIds"),
      candidateSourcePath: result.article.sourcePath, candidateSourceHash: resultingSourceHash,
      decidedAt: now().toISOString(),
      operatorId: operatorContext.getOperatorId(),
    };
    decision.lineage = evidenceService.build({
      source: { kind: "vault-document", path: decision.candidateSourcePath, contentHash: decision.candidateSourceHash, coordinate: "article:" + decision.articleId },
      rule: { ruleId: "article-association.manual-override", ruleRevision: current.revision, reasonCode: "MANUAL_ASSOCIATION_OVERRIDE" },
      scope: { product: result.article.product || "unknown-product", version: result.article.version || "unknown-version" },
      decision: { decisionId: decision.decisionId, operatorId: decision.operatorId, kind: "manual", decidedAt: decision.decidedAt },
      freshness: { status: "fresh", checkedAt: decision.decidedAt, changedFields: [] },
    });
    const currentArticles = articles();
    const currentArticleMap = new Map(currentArticles.map((item) => [item.articleId, item]));
    const aliases = formalArticleAliases(currentArticles);
    const currentDecisions = readFile();
    const decisions = currentDecisions.decisions
      .map((item) => ({ ...item, articleId: decisionArticleId(item, currentArticleMap, aliases) }))
      .concat(decision)
      .sort((a, b) => a.articleId.localeCompare(b.articleId) || String(a.decidedAt || "").localeCompare(String(b.decidedAt || "")));
    const raw = YAML.stringify({ schema_version: 1, decisions });
    writeArticleSource(articleWrite.resolved, articleWrite.nextRaw, contentRevision(articleWrite.raw)); // PR-083：文章读改写凭据
    try { writeAuditRaw(raw, currentDecisions.auditStatus === "missing" ? ABSENT_REVISION : contentRevision(currentDecisions.raw)); }
    catch (error) {
      // 回滚基线＝失败写后的盘面；回滚本身失败一律定性为提交不一致 500（不另立出口码——此路错误只作为 details 呈现）
      // PR-204：回滚写同样搭账车（回滚也是内容状态变化，不留无痕回滚）
      try { writeVault(articleWrite.resolved, articleWrite.raw, { expectedContentHash: contentRevision(articleWrite.nextRaw), domain: "workflow", summary: "文章源文件回滚" }); }
      catch (rollbackError) { throw serviceError("ARTICLE_ASSOCIATION_COMMIT_INCONSISTENT", "审计写入失败且文章回滚失败", 500, { auditError: error.message, rollbackError: rollbackError.message }); }
      throw error;
    }
    return { ...list(), preview: result };
  }

  /**
   * 移除决策行（2026-10-15 Master 批准「引用随源流转」工作包）——stale 行的处置出口：
   * 源文章已退役/删除时，审计决策行不再有「重新指定」对象，移除即收口。幂等（行不存在同结果）。
   * 与 save 同锁语义：revision 乐观锁防并发覆盖。
   */
  function removeDecision(expectedRevision, decisionId) {
    const current = readFile();
    if (current.auditStatus === "corrupt") throw serviceError("ARTICLE_ASSOCIATION_AUDIT_CORRUPT", "文章关联审计日志损坏，拒绝覆盖历史", 503, { message: current.auditError });
    if (expectedRevision !== current.revision) throw serviceError("ARTICLE_REVISION_CONFLICT", "决策文件已变化，请重新读取", 409, { expectedRevision, currentRevision: current.revision });
    const before = current.decisions.length;
    const decisions = current.decisions.filter((item) => item.decisionId !== decisionId);
    if (decisions.length === before) return { ...list(), removed: 0 };
    writeAuditRaw(YAML.stringify({ schema_version: 1, decisions }), current.auditStatus === "missing" ? ABSENT_REVISION : contentRevision(current.raw)); // PR-083：读改写凭据
    return { ...list(), removed: before - decisions.length };
  }

  /** 退役沿链清行（retireArticle 调用）：删除该文章名对应的全部决策行（源已不存在，行成幽灵）。 */
  function removeDecisionsForArticle(basename) {
    const current = readFile();
    const key = String(basename || "").replace(/\.md$/, "");
    const decisions = current.decisions.filter((item) => {
      const base = String(item.candidateSourcePath || "").split("/").pop() || "";
      return base.replace(/\.md$/, "") !== key;
    });
    if (decisions.length !== current.decisions.length) writeAuditRaw(YAML.stringify({ schema_version: 1, decisions }), current.auditStatus === "missing" ? ABSENT_REVISION : contentRevision(current.raw)); // PR-083：读改写凭据
    return current.decisions.length - decisions.length;
  }

  return { list, preview, save, scopedVersionOptions, removeDecision, removeDecisionsForArticle };
}

module.exports = { createArticleAssociationService, applyAction };
