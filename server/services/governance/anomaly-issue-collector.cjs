// @responsible: 汇集实体、文章、推理和标准化检查结果为治理异常问题。
const crypto = require("node:crypto");
const articleLifecycle = require("../../shared/article-lifecycle-paths.cjs");
const { readMasterGraphArtifact } = require("../../shared/working-artifact-snapshot.cjs");
const { normalizeRelationCandidate } = require("./relation-candidate-contract.cjs");
const { collectStandardizationWarningIssues } = require("../admission/standardization-warning-issues.cjs");
const { checkDocumentModuleEntity } = require("../entity-compliance/property-governance-service.cjs");
const { readEnums } = require("../../shared/schema-config.cjs");
const { buildRuleSet } = require("../../shared/enums-loader.cjs");
// WP-116 批1（八址键直取收敛）：文档装载统一走 document-load-port（SPEC-045 D2——消费方不再各自手写解析后裸取键）
// WP-116 批2（SPEC-083 §二.3）：parseEntityDocument 直 require 收口——同一端口出口 loadDocument（同底座委托，null 原型不变）
const { loadDocument, docField } = require("../../shared/document-load-port.cjs");
// WP-138 R5b：frontmatter 派生键名经文档键源单点（本文件零手抄字段名清单）
const DK = require("../../shared/document-keys.cjs");
const fs = require("node:fs");
const path = require("node:path");

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value)).digest("hex")}`;
}

function evidence(input) {
  return {
    sourceKind: input.sourceKind,
    producer: input.producer,
    coordinate: input.coordinate,
    sourcePath: input.sourcePath || null,
    snippet: input.snippet || null,
    contentHash: input.contentHash || sha256(input.snippet || input.coordinate),
    sourceRevision: input.sourceRevision || input.contentHash || sha256(input.sourcePath || input.coordinate),
    ruleRevision: input.ruleRevision || null,
    modelRevision: input.modelRevision || null,
    policyRevision: input.policyRevision || null,
  };
}

function candidateIssue({ issueId, title, sourceNodeId, targetNodeId, links, sourcePath, sourceRevision, ruleRevision, ruleSet, knownNodeIds = new Set(), relationRegistry }) {
  // WP-116 批1（八址键直取收敛）：连线前缀键（link.type 作标签表键）改显式 own 分支——
  // 表本体是 WP-050 D1 null 原型标签表（enums-loader buildWikilinkTypeLabels），但测试夹具/旁路
  // 构造的普通对象仍可命中 Object.prototype（constructor 族 → 误判 known／塞函数原文）。
  // hasOwn 语义 = 表键闭集（在册前缀→known＋取规范类型）；闭集外回落 link.type/unknown，
  // 消费语义与原 `labels?.[type] || link.type` 逐字对齐（含 type=null → UNKNOWN_RELATION）。
  const wikilinkLabels = ruleSet.wikilinkTypeLabels;
  const labelOf = (type) => (wikilinkLabels && Object.hasOwn(wikilinkLabels, type) && wikilinkLabels[type]) || null;
  const grouped = new Map();
  for (const link of links) {
    const canonical = labelOf(link.type) || link.type || "UNKNOWN_RELATION";
    const key = `${canonical}\0${link.target}`;
    grouped.set(key, [...(grouped.get(key) || []), link]);
  }
  const triples = [...grouped.entries()].map(([key, occurrences]) => {
    const [relationType, target] = key.split("\0");
    return {
      sourceNodeId, relationType, targetNodeId: target || targetNodeId,
      direction: "outgoing",
      relationTypeStatus: labelOf(occurrences[0].type) ? "known" : "unknown",
      sourceEndpointStatus: sourceNodeId ? "known" : "unknown",
      targetEndpointStatus: knownNodeIds.has(target || targetNodeId) ? "known" : "unknown",
      evidence: occurrences.map((link) => evidence({
        sourceKind: "typed_wikilink",
        producer: "extract_graph.entity_typed_wikilink",
        coordinate: link.coordinate || `target:${link.target}`,
        sourcePath,
        snippet: link.snippet || `${link.type}::[[${link.target}]]`,
        sourceRevision,
        ruleRevision,
        policyRevision: "assertion-policy-registry",
      })),
    };
  });
  return {
    issueId,
    issueKind: "relation_conflict",
    title,
    evidence: triples.flatMap((triple) => triple.evidence),
    expectedRevisions: { sourceRevision, ruleRevision },
    blockedActions: ["publish_graph"],
    proposedAction: { type: "relation-candidate-review", sourceKey: sourcePath },
    relationCandidate: normalizeRelationCandidate({ triples }, { registry: relationRegistry }),
  };
}

function entityFindingIssues(entity, group, finding, deps, ruleSet, knownNodeIds) {
  // 2026-10-08 裁决 4（键名对齐）：B02/B04 违规 → relation_conflict 轨道恢复。
  // 载荷契约（与引擎 runBodyDiagnostics 对齐）：
  //   B02 产 unresolvedTargets（字符串数组——目标不可解析，无类型信息，合成最小 link 形态）
  //   B04 产 unknownRelations（完整 link 载荷 {type,target,coordinate,snippet}——未知关系类型）
  // 旧键在引擎侧无生产者（夹具自造掩蔽错配），据此清理。
  let links = [];
  if (finding.ruleId === "B02" && Array.isArray(finding.unresolvedTargets)) {
    links = finding.unresolvedTargets.map((target) => ({ type: null, target, coordinate: null, snippet: `[[${target}]]` }));
  } else if (Array.isArray(finding.unknownRelations) && finding.unknownRelations.length) {
    links = finding.unknownRelations;
  }
  if (links.length) {
    const byTarget = new Map();
    for (const link of links) byTarget.set(link.target, [...(byTarget.get(link.target) || []), link]);
    return [...byTarget.entries()].map(([target, targetLinks]) => candidateIssue({
      issueId: `relation-candidate-${sha256(`${entity.sourceKey}\0${finding.ruleId}\0${target}`).slice(7, 27)}`,
      title: finding.message || `${entity.title || entity.entityId || entity.sourceKey} 存在关系候选`,
      sourceNodeId: entity.entityId || entity.sourceKey,
      targetNodeId: target,
      links: targetLinks,
      sourcePath: entity.sourceKey,
      sourceRevision: entity.sourceRevision || sha256(entity.sourceKey),
      ruleRevision: finding.ruleId || "entity-compliance",
      ruleSet,
      knownNodeIds,
      relationRegistry: deps.relationRegistry,
    }));
  }
  const issueKind = [DK.ENTITY.archSince, DK.ENTITY.archUntil, DK.ENTITY.archVersionOverrides].includes(finding.field)
    ? "version_scope" : finding.field || /^F\d/.test(finding.ruleId || "") ? "missing_field" : "unrecognized_entity";
  const relationIssue = issueKind === "unrecognized_entity";
  return [{
    issueId: `entity-${entity.sourceKey}-${finding.ruleId || finding.field || "finding"}`,
    issueKind,
    title: finding.message || `${entity.title || entity.entityId || entity.sourceKey} 存在待处理问题`,
    evidence: [{ kind: "entity-compliance", path: entity.sourceKey, lineNumber: null, ruleId: finding.ruleId || "entity-compliance" }],
    expectedRevisions: { sourceRevision: entity.sourceRevision || null, ruleRevision: finding.ruleId || null },
    proposedAction: relationIssue ? {
      type: "entity-relation-repair", sourceKey: entity.sourceKey,
      currentValue: finding.value === undefined ? null : finding.value,
      unresolvedTargets: finding.unresolvedTargets || [],
      unmanagedCandidates: deps.findUnmanagedEntityCandidates(deps.vaultPath, finding.unresolvedTargets || []),
      governedEntityDirectory: "知识库/wiki/entities/",
      relationTargetOptions: deps.listRelationTargetOptions(deps.vaultPath, entity.entityId),
      hint: finding.hint || null, group: group.label || null,
    } : {
      type: "entity-repair", sourceKey: entity.sourceKey, field: finding.field || null,
      currentValue: finding.value === undefined ? null : finding.value,
      expected: finding.expected === undefined ? null : finding.expected,
      hint: finding.hint || null, allowedValues: finding.allowedValues || [], group: group.label || null,
    },
  }];
}

function articleCandidateIssue(article, associationData, relationRegistry, scopedVersionOptions) {
  // #1797：scopedVersionOptions 可选注入（article-association-service.scopedVersionOptions）——
  // 提供时 proposedAction.versionOptions 按文章 product 收窄（通用/未注册兜底全量）；
  // 缺省保持全量池（向后兼容旧调用与测试夹具）。
  const sourceRevision = article.sourceHash || sha256(article.sourcePath);
  const raw = normalizeRelationCandidate({ triples: [{
    sourceNodeId: article.articleId,
    relationType: "DOCUMENTS",
    targetNodeId: `unassigned-architecture-target:${article.articleId}`,
    direction: "outgoing",
    relationTypeStatus: "known",
    sourceEndpointStatus: "known",
    targetEndpointStatus: "unknown",
    evidence: [evidence({
      sourceKind: "article_association", producer: "article-association-service.candidate",
      coordinate: `article:${article.articleId}`, sourcePath: article.sourcePath,
      contentHash: article.sourceHash || sha256(article.sourcePath), sourceRevision,
      ruleRevision: associationData.revision, policyRevision: "assertion-policy-registry",
    })],
  }] }, { registry: relationRegistry });
  return {
    issueId: `article-association-missing-${article.articleId}`,
    issueKind: "article_association",
    title: `文章尚未关联架构组件：${article.title}`,
    evidence: raw.triples.flatMap((triple) => triple.evidence),
    expectedRevisions: { sourceHash: article.sourceHash, factRevision: associationData.revision },
    proposedAction: { type: "article-association", articleId: article.articleId, articleTitle: article.title, componentOptions: associationData.componentOptions || [], versionOptions: typeof scopedVersionOptions === "function" ? scopedVersionOptions(article) : (associationData.versionOptions || []) },
    relationCandidate: raw,
  };
}

function inferenceCandidateIssue(conflict, relationRegistry) {
  const sourceRevision = conflict.sourceRevision || sha256(conflict.conflictId);
  const targetNodeId = `inference-conclusion:${conflict.conclusionKey}`;
  const triples = (conflict.conclusions || []).map((item) => ({
    sourceNodeId: conflict.subjectNodeId,
    relationType: `${item.conclusionKey || conflict.conclusionKey}:${item.effect}`,
    targetNodeId,
    direction: "outgoing",
    relationTypeStatus: "known",
    sourceEndpointStatus: "known",
    targetEndpointStatus: "unknown",
    evidence: ((item.evidence && item.evidence.length) ? item.evidence : [`rule:${item.ruleId}; effect:${item.effect}`]).map((value, index) => evidence({
      sourceKind: "derived", producer: "extract_graph.derived_mentions",
      coordinate: `rule:${item.ruleId}:evidence:${index}`, snippet: value,
      contentHash: sha256(value), sourceRevision, ruleRevision: item.ruleId,
      modelRevision: conflict.modelRevision || null, policyRevision: conflict.policyRevision || null,
    })),
  }));
  const relationCandidate = normalizeRelationCandidate({ triples }, { registry: relationRegistry });
  return {
    issueId: `relation-conflict-${conflict.conflictId}`,
    issueKind: "relation_conflict",
    title: `关系规则存在未裁决冲突：${conflict.subjectNodeId}`,
    evidence: relationCandidate.triples.flatMap((triple) => triple.evidence),
    expectedRevisions: { conflictId: conflict.conflictId, sourceRevision },
    proposedAction: { type: "inference-review", conflictId: conflict.conflictId, conclusions: conflict.conclusions || [] },
    relationCandidate,
  };
}

function createAnomalyIssueCollector(deps) {
  return function collectIssues() {
    const issues = [];
    let graphSnapshot = { data: null, revision: null, exists: false };
    try {
      graphSnapshot = typeof deps.readMasterGraphSnapshot === "function"
        ? deps.readMasterGraphSnapshot()
        : readMasterGraphArtifact(deps.vaultPath);
      if (!graphSnapshot.exists && typeof deps.readMasterGraph === "function") {
        graphSnapshot = { data: deps.readMasterGraph(), revision: null, exists: false };
      }
    } catch (error) {
      deps.logger.warn({ event: "anomaly-master-graph-source-unavailable", error: error.message });
    }
    const graph = graphSnapshot.data && typeof graphSnapshot.data === "object"
      ? graphSnapshot.data
      : { nodes: [], connections: [] };
    try {
      const compliance = deps.scanAndCheck(deps.vaultPath, graph, deps.scanDraftSources);
      const relationRuleSet = deps.relationRuleSet || deps.relationRuleSetProvider();
      const knownNodeIds = new Set((graph.nodes || []).map((node) => node.id));
      for (const entity of compliance.results || []) {
        // 2026-10-15 Master 裁收敛（TALOS「一个根因一条信号」同构）：缺失实体模板（sourceExists=false，
        // missingEntityResults 产出的 CREATE 字段级合成结果）不在 workbench 炸字段条目——
        // 「文章引用已删/缺失实体」语义由下方 missing_entity 轨道承载（F2 #1418 直读权威源，每文章一条）。
        // 去重实证：同一缺失实体曾同时产 1 条 missing_entity ＋ 15 条 CREATE 字段告警。
        if (entity.sourceExists === false) continue;
        for (const group of entity.groups || []) for (const finding of group.checks || []) {
          if (deps.isWorkbenchIssueFinding(finding)) issues.push(...entityFindingIssues(entity, group, finding, deps, relationRuleSet, knownNodeIds));
        }
      }
    } catch (error) { deps.logger.warn({ event: "anomaly-compliance-source-unavailable", error: error.message }); }
    try {
      const data = deps.articleAssociationService.list();
      const decisions = new Map((data.decisions || []).map((item) => [item.articleId, item]));
      for (const decision of data.decisions || []) if (decision.stale) issues.push({
        issueId: `article-association-${decision.articleId}`, issueKind: "stale_source",
        title: `文章关联来源已变化：${decision.articleId}`,
        evidence: [decision.lineage?.source || { kind: "vault-document", path: decision.candidateSourcePath, coordinate: `article:${decision.articleId}` }],
        expectedRevisions: { sourceHash: decision.candidateSourceHash, factRevision: data.revision },
        proposedAction: { type: "article-association-reload", articleId: decision.articleId, action: decision.action, componentIds: decision.componentIds || [], versionIds: decision.versionIds || [] },
      });
      // ADR063 #1746 源投影对账：正式 catalog 来自冻结 Release 快照（不可变，by design），
      // 但其 sourcePath 指向的活源文件已删时不得再产出检出——活源为准，残留交账本读时关闭。
      for (const article of data.articles || []) {
        if ((article.componentIds || []).length > 0 || decisions.has(article.articleId)) continue;
        if (article.sourcePath && !fs.existsSync(path.join(deps.vaultPath, article.sourcePath))) continue;
        const scoped = deps.articleAssociationService && typeof deps.articleAssociationService.scopedVersionOptions === "function"
          ? function (a) { return deps.articleAssociationService.scopedVersionOptions(a); }
          : undefined;
        issues.push(articleCandidateIssue(article, data, deps.relationRegistry, scoped));
      }
    } catch (error) { deps.logger.warn({ event: "anomaly-association-source-unavailable", error: error.message }); }
    issues.push(...collectStandardizationWarningIssues(deps.vaultPath));
    try {
      const validModules = buildRuleSet(readEnums(deps.vaultPath)).moduleNames;
      // F2（#1418）直读权威源：missing_entity 的规则输入 = 文章 frontmatter（module 声明）× 实体库（wiki/entities），
      // 不再经 master_graph 批量快照——冷启动可派生、源变更即时生效（图快照缺席/陈旧不再弄瞎本族校验，D2 控制面自立）。
      // 判定逻辑单源复用 checkDocumentModuleEntity（property-governance 读图的图 QA 语义不动，D7/D8）。
      const articleNodes = [];
      const entityNodes = [];
      // 文章侧 = 正式文章快照（wiki/articles/<域>/<dir>/<hash>.md——SPEC-030 派②两层，publish 落位）；
      // raw/precleaned 候选有意排除（inspectFormalDocumentNode admission 语义保持，规则主体不变）
      const articlesDir = articleLifecycle.formalArticlesDir(deps.vaultPath);
      if (fs.existsSync(articlesDir)) {
        for (const domainEntry of fs.readdirSync(articlesDir, { withFileTypes: true })) {
          if (!domainEntry.isDirectory()) continue;
        for (const entry of fs.readdirSync(path.join(articlesDir, domainEntry.name), { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const articleDir = path.join(articlesDir, domainEntry.name, entry.name);
          for (const fileName of fs.readdirSync(articleDir)) {
            if (!fileName.endsWith(".md")) continue;
            const sourcePath = articleLifecycle.formalSourcePath(domainEntry.name, entry.name, fileName);
            const parsed = loadDocument(fs.readFileSync(path.join(articleDir, fileName), "utf8"), sourcePath);
            const fm = parsed.frontmatter || {};
            if (!fm[DK.ARTICLE.articleId] || !String(fm[DK.ARTICLE.module] || "").trim()) continue;
            // 整改6（粒度=文章×问题类型）：同 article_id 多版本快照（文件名=内容 hash）只保留
            // 最新一份——字典序最大 hash = 最新内容，去重后 missing_entity 每文章一条，
            // 消除「同文章两条 missing_entity」的多实例行。
            const existing = articleNodes.find((node) => node.id === `doc-article-${fm[DK.ARTICLE.articleId]}`);
            const candidate = { id: `doc-article-${fm[DK.ARTICLE.articleId]}`, label: fm[DK.ARTICLE.title] || fileName, labels: ["Document"], properties: { [DK.ARTICLE.title]: fm[DK.ARTICLE.title] || fileName, [DK.ARTICLE.module]: String(fm[DK.ARTICLE.module]).trim(), file_path: sourcePath } };
            if (!existing) articleNodes.push(candidate);
            else if (fileName > path.basename(existing.properties.file_path)) articleNodes[articleNodes.indexOf(existing)] = candidate;
          }
        }
        }
      }
      const entitiesDir = path.join(deps.vaultPath, "知识库", "wiki", "entities");
      if (fs.existsSync(entitiesDir)) {
        for (const fileName of fs.readdirSync(entitiesDir)) {
          if (!fileName.endsWith(".md")) continue;
          const sourcePath = `知识库/wiki/entities/${fileName}`;
          const parsed = loadDocument(fs.readFileSync(path.join(entitiesDir, fileName), "utf8"), sourcePath);
          const fm = parsed.frontmatter || {};
          if (fm[DK.ENTITY.archComponent] !== true) continue;
          const modules = Array.isArray(fm[DK.ENTITY.module]) ? fm[DK.ENTITY.module].map(String) : fm[DK.ENTITY.module] ? [String(fm[DK.ENTITY.module])] : [];
          entityNodes.push({ id: fm[DK.ENTITY.architectureNodeId] || fileName.replace(/\.md$/, ""), label: fm[DK.ENTITY.title] || fileName.replace(/\.md$/, ""), labels: ["Module", "ArchitectureComponent"], properties: { ...Object.fromEntries(modules.map((name) => [name, name])), [DK.ENTITY.module]: modules[0] || "" } });
        }
      }
      for (const document of articleNodes) {
        const result = checkDocumentModuleEntity(document, entityNodes, validModules).document_module_entity;
        if (!result.passed && result.moduleName) issues.push({
          issueId: `missing-entity-${document.id}`, issueKind: "missing_entity", title: `文章 "${result.docTitle}" 模块 "${result.moduleName}" 缺少知识实体`,
          evidence: [{ kind: "vault-document", path: result.docFilePath, ruleId: "document-module-entity" }], expectedRevisions: { sourceRevision: result.moduleName },
          proposedAction: { type: "entity-repair", entityId: document.id, sourceKey: `知识库/wiki/entities/${result.moduleName}.md`, field: "module_entity", currentValue: result.moduleName, expected: result.moduleName, hint: `${result.reason}。请在 Obsidian 中创建实体页后重新运行管道。`, allowedValues: [] },
        });
      }
    } catch (error) { deps.logger.warn({ event: "anomaly-document-module-entity-source-unavailable", error: error.message }); }
    for (const conflict of deps.conflictStore ? deps.conflictStore.list().filter((item) => item.status === "unresolved") : []) issues.push(inferenceCandidateIssue(conflict, deps.relationRegistry));
    // G1'（#1840）：野生标签注册进问题工作台——与其他问题同款（实时扫描、零派生存储）。
    // 判定与 discovery 待沉淀同源：tags 不在受控集（正式标签∪tag_aliases 键）→ 一值一 issue。
    // proposedAction=handoff 跳配置页（待沉淀标签），处理=人在配置页裁定分配；issue 随下次扫描自然消解。
    try {
      const rules = buildRuleSet(readEnums(deps.vaultPath));
      const controlledTags = new Set(rules.formalTags || []);
      for (const aliasKey of Object.keys(rules.tagAliases || {})) controlledTags.add(aliasKey);
      const wildBuckets = new Map();
      const collectTagList = (list, sourcePath) => {
        for (const raw of list) {
          const value = String(raw || "").trim().replace(/^['"]|['"]$/g, "");
          if (!value || controlledTags.has(value)) continue;
          const current = wildBuckets.get(value) || { value, count: 0, files: [] };
          current.count += 1;
          if (!current.files.includes(sourcePath)) current.files.push(sourcePath);
          wildBuckets.set(value, current);
        }
      };
      // 实体侧 + 文章侧（precleaned/drafts）——与 schema-discovery-routes.scanArticleTags 同源语义
      const entitiesDir = path.join(deps.vaultPath, "知识库", "wiki", "entities");
      if (fs.existsSync(entitiesDir)) {
        for (const fileName of fs.readdirSync(entitiesDir)) {
          if (!fileName.endsWith(".md")) continue;
          const sourcePath = `知识库/wiki/entities/${fileName}`;
          const parsed = loadDocument(fs.readFileSync(path.join(entitiesDir, fileName), "utf8"), sourcePath);
          const fm = parsed.frontmatter || {};
          collectTagList(Array.isArray(fm[DK.ENTITY.tags]) ? fm[DK.ENTITY.tags] : (typeof fm[DK.ENTITY.tags] === "string" ? fm[DK.ENTITY.tags].split(",") : []), sourcePath);
        }
      }
      for (const sub of ["raw/precleaned", "raw/drafts"]) {
        const dir = path.join(deps.vaultPath, "知识库", sub);
        if (!fs.existsSync(dir)) continue;
        for (const fileName of fs.readdirSync(dir)) {
          if (!fileName.endsWith(".md")) continue;
          const raw = fs.readFileSync(path.join(dir, fileName), "utf8");
          // WP-116 批1（八址键直取收敛）：手写 `---` 正则解析退役，tags 经文档装载端口统一装载。
          // 行为对齐（原三分支正则 → 六态）：无 frontmatter/无 tags/tags 空值 → 不产出采集（原解析
          // tags=null 同语义）；present(数组) 原样采集；present(标量) 按原标量分支逗号拆分。
          // 坏 YAML 整块弃用（装载端口空 frontmatter）——不再像旧正则那样从坏块里捞行；解析产出
          // 逐字比对由 anomaly-issue-collector.test.cjs 的旧新对账用例钉住。
          const parsed = loadDocument(raw, `知识库/${sub}/${fileName}`);
          const tagsField = docField(parsed, DK.ARTICLE.tags);
          let tags = null;
          if (tagsField.state === "present") {
            tags = Array.isArray(tagsField.value)
              ? tagsField.value.map((item) => String(item))
              : String(tagsField.value).split(",");
          }
          if (tags) collectTagList(tags, `知识库/${sub}/${fileName}`);
        }
      }
      for (const wild of wildBuckets.values()) {
        issues.push({
          issueId: `wild-tag-${sha256(wild.value).slice(7, 27)}`,
          issueKind: "wild_tag",
          title: `野生标签待裁定：${wild.value}（${wild.count} 处引用）`,
          evidence: wild.files.map((p) => ({ kind: "wild-tag", path: p, lineNumber: null, ruleId: "wild-tag-discovery" })),
          expectedRevisions: { tagValue: wild.value },
          proposedAction: { type: "schema-tag-adjudicate", value: wild.value, count: wild.count, files: wild.files, hint: "在配置页「待沉淀标签」裁定：升为正式标签或归为别名" },
        });
      }
    } catch (error) { deps.logger.warn({ event: "anomaly-wild-tag-source-unavailable", error: error.message }); }
    try {
      const graphHash = graphSnapshot.revision;
      for (const finding of deps.graphProvenanceService.collectMissingRelationLineage(graph || {})) {
        const fingerprint = crypto.createHash("sha256").update(finding.edgeId).digest("hex").slice(0, 20);
        // WP-060：fallback path 标注真实来源（derived-index 库）——原文件时代遗留路径；指纹＝sha256(edgeId) 不含 path，issue ID 零churn
        issues.push({ issueId: `relation-lineage-${fingerprint}`, issueKind: "missing_lineage", title: `已通过关系缺少可信来源链：${finding.edgeId}`, evidence: [{ kind: finding.lineageKind === "source" ? "vault-document" : "derived-graph-diagnostic", path: finding.sourcePath || "derived-index:master_graph", coordinate: `relation:${finding.edgeId}`, missingFields: finding.missingFields }], expectedRevisions: { graphHash, edgeId: finding.edgeId }, blockedActions: ["publish_graph"], proposedAction: { type: "derived-graph-repair" } });
      }
    } catch (error) { deps.logger.warn({ event: "anomaly-relation-lineage-source-unavailable", error: error.message }); }
    return { issues, workingRevisions: { masterGraph: graphSnapshot.revision || null } };
  };
}

module.exports = { createAnomalyIssueCollector, candidateIssue, articleCandidateIssue, inferenceCandidateIssue };
