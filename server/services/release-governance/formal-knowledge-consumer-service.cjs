// @contract ReviewStatus: "approved" | "pending" | "rejected"
// @see contracts/http-api.openapi.json#/components/schemas/ReviewStatus
// Component: Formal-Knowledge-Consumer-Service
// @responsible: Read every formal knowledge view from one validated, request-pinned Release.

const { createDocumentInventoryService } = require("../projection/document-inventory-service.cjs");
const { createInferenceEngine } = require("../inference/inference-engine.cjs");
const { selectFormalRelations } = require("../../shared/formal-relation-selector.cjs");
const { mergeReviewStatus } = require("../../shared/review-status-projection.cjs");
const YAML = require("yaml");

const { bindErrorFactory, createError } = require("../../shared/error-factory.cjs");
const consumerError = bindErrorFactory({ status: 500 });

// ADR-009 D5（Master 2026-10-25「A」，PR-103）：「无挂载主体」是合法空态——元层 architecture_projection 的
// product/version 双空（AnyShare 2026-10-17 退役归档后的默认态，也是开源新库的默认态）不再是配置错误；
// 消费端上下文照常建立，词表/文档/关系等不依赖产品身份的读面照常；只有依赖产品身份的读面（语义架构投影）
// 以定义过的 409 空态引导拒绝，而不是 500。半身份（只填其一）仍是配置错误，保持 fail-closed。
// WP-070 §3.3（消费类）：指引文案经空态语义契约单源组装（guidanceFor）——不再内联第二文案源；
// 机制备注随契约 absence_kinds.product-identity-unmounted.note 走（subjects 挂载路径／D2 方向 B 未落地）。
const { guidanceFor, noteFor } = require("../../shared/availability-view.cjs");
const UNMOUNTED_GUIDANCE = [guidanceFor("product-identity-unmounted"), noteFor("product-identity-unmounted")].filter(Boolean).join("｜");
function parseJson(reader, name) {
  let value;
  try { value = JSON.parse(reader.readArtifact(name)); }
  catch (error) { throw consumerError("RELEASE_ARTIFACT_INVALID", `Invalid Release artifact ${name}: ${error.message}`, 500); }
  if (value === null || typeof value !== "object") throw consumerError("RELEASE_ARTIFACT_INVALID", `Release artifact ${name} must be JSON`, 500);
  return value;
}

function parseJsonArray(reader, name) {
  let value;
  try { value = JSON.parse(reader.readArtifact(name)); }
  catch (error) { throw consumerError("RELEASE_ARTIFACT_INVALID", `Invalid Release artifact ${name}: ${error.message}`, 500); }
  if (!Array.isArray(value)) {
    throw consumerError("RELEASE_ARTIFACT_INVALID", `Release artifact ${name} must be an array`, 500);
  }
  return value;
}

function manifestArtifactNames(manifest) {
  return new Set((Array.isArray(manifest?.artifacts) ? manifest.artifacts : []).map((item) => item?.name).filter(Boolean));
}

function requiredArtifact(names, name) {
  if (!names.has(name)) throw consumerError("RELEASE_ARTIFACT_MISSING", `Release artifact is missing: ${name}`, 500);
  return name;
}

function registryFromArtifact(value) {
  if (!Array.isArray(value.relations) || value.relations.length === 0) {
    throw consumerError("RELEASE_ARTIFACT_INVALID", "Release ontology capability registry is empty", 500);
  }
  const relations = new Map();
  for (const entry of value.relations) {
    if (!entry?.type || relations.has(entry.type) || !Array.isArray(entry.assertionPolicies)) {
      throw consumerError("RELEASE_ARTIFACT_INVALID", "Release ontology capability registry is malformed", 500);
    }
    relations.set(entry.type, entry);
  }
  // WP-006 单源化：骨架成员资格唯一源＝活选择器派生的 inImpactSet（工件序列化携带）；
  // 消费侧不再内联比 semanticRole（同源双判收敛）。缺标志＝畸形工件，fail-closed 拒收。
  for (const entry of relations.values()) {
    if (typeof entry.inImpactSet !== "boolean") {
      throw consumerError("RELEASE_ARTIFACT_INVALID", `Release ontology capability registry entry ${entry.type} lacks inImpactSet`, 500);
    }
  }
  const impactEdgeTypes = new Set([...relations.values()]
    .filter((entry) => entry.inImpactSet)
    .map((entry) => entry.type));
  return { mode: "capability", meta: value.meta || {}, relations, impactEdgeTypes };
}

function inferenceOntologyFromArtifact(value) {
  if (!Array.isArray(value?.inferenceRules)) {
    throw consumerError("RELEASE_ARTIFACT_INVALID", "Release ontology capability registry has no inference rules", 500);
  }
  const relations = new Map();
  for (const entry of value.relations || []) {
    if (!entry?.type || typeof entry.weight !== "number" || typeof entry.registeredForInference !== "boolean") {
      throw consumerError("RELEASE_ARTIFACT_INVALID", "Release inference capability entry is incomplete", 500);
    }
    relations.set(entry.type, {
      bidirectional: entry.bidirectional,
      candidateEnabled: entry.candidateEnabled,
      direction: entry.direction,
      impactPropagation: entry.impactPropagation,
      legacy: entry.legacyPolicy === "delete",
      mode: null,
      registeredForInference: entry.registeredForInference,
      requiresReview: Array.isArray(entry.assertionPolicies) && entry.assertionPolicies.some((policy) => policy.decisionMode === "reviewed"),
      semanticRole: entry.semanticRole,
      type: entry.type,
      weight: entry.weight,
    });
  }
  return { relations, rules: value.inferenceRules, meta: value.meta || {} };
}

function validateDocuments(value) {
  if (!Array.isArray(value.documents)) throw consumerError("RELEASE_DOCUMENT_INDEX_INVALID", "Release document index is missing documents", 500);
  const required = ["documentId", "documentKind", "title", "sourcePath", "sourceHash", "body", "searchText", "tokens", "graphNodeIds"];
  for (const document of value.documents) {
    const missing = required.filter((field) => document?.[field] === undefined);
    if (missing.length || !Array.isArray(document.tokens) || !Array.isArray(document.graphNodeIds)) {
      throw consumerError("RELEASE_DOCUMENT_INDEX_INVALID", "Release document index contains an incomplete document", 500, { documentId: document?.documentId || null, missing });
    }
    if (document.documentKind === "standard-article"
      && (!document.articleId || !document.ownerSourcePath || !document.ownerSourceHash || !Array.isArray(document.associations))) {
      throw consumerError("RELEASE_DOCUMENT_INDEX_INVALID", "Release standard article has no complete owner-source identity", 500, { documentId: document.documentId });
    }
  }
  return { ...value, documents: value.documents.map((document) => ({ ...document, relations: [] })) };
}

function addIdentity(value, identity) {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...value, ...identity } : value;
}

function projectionIdentity(reader, names) {
  const name = requiredArtifact(names, "知识库/TheSchema/enums.yaml");
  let enums;
  try { enums = YAML.parse(reader.readArtifact(name)) || {}; }
  catch (error) { throw consumerError("RELEASE_ARTIFACT_INVALID", `Invalid Release projection configuration: ${error.message}`, 500); }
  const projection = enums.architecture_projection || {};
  const product = typeof (projection.product || projection.product_name) === "string" ? (projection.product || projection.product_name).trim() : "";
  const version = typeof (projection.version || projection.branch) === "string" ? (projection.version || projection.branch).trim() : "";
  if (!product && !version) return { product: null, version: null, mounted: false }; // 合法空态（ADR-009 D5）
  if (!product || !version) {
    throw consumerError("RELEASE_PROJECTION_IDENTITY_INVALID", "Release architecture_projection product and version are required", 500);
  }
  return { product, version, mounted: true };
}

function createFormalKnowledgeConsumerService({ releaseReader }) {
  if (!releaseReader || typeof releaseReader.withPinnedRelease !== "function") {
    throw consumerError("RELEASE_READER_REQUIRED", "ReleaseReader is required");
  }

  function createContext(releaseId) {
    const manifest = releaseReader.readRelease();
    if (manifest.releaseId !== releaseId || !/^[0-9a-f]{40}$/.test(manifest.sourceCommit || "")) {
      throw consumerError("RELEASE_IDENTITY_INVALID", "Pinned Release identity is inconsistent", 500);
    }
    const identity = { releaseId, sourceCommit: manifest.sourceCommit };
    const names = manifestArtifactNames(manifest);
    const configuredProjection = projectionIdentity(releaseReader, names);
    const json = (name) => parseJson(releaseReader, requiredArtifact(names, name));
    const jsonArray = (name) => parseJsonArray(releaseReader, requiredArtifact(names, name));
    const ontologyCapabilities = json("schema/ontology-capabilities.json");
    const capabilityRegistry = registryFromArtifact(ontologyCapabilities);
    const inferenceEngine = createInferenceEngine({ ontology: inferenceOntologyFromArtifact(ontologyCapabilities) });
    const documentIndex = validateDocuments(json("indexes/document-search.json"));
    const inventory = createDocumentInventoryService({
      releaseSnapshot: { documents: documentIndex.documents, invalid: documentIndex.invalid || [], generatedAt: manifest.createdAt || null },
    });
    const formalArticles = documentIndex.documents
      .filter((document) => document.documentKind === "standard-article")
      .map((document) => ({
        articleId: document.articleId,
        title: document.title,
        ownerSourcePath: document.ownerSourcePath,
        sourceHash: document.ownerSourceHash,
        product: document.product,
        version: document.version,
        componentIds: document.componentIds || [],
        associations: document.associations,
      }));

    // seq175（ADR057）：账本随发布物打包，正式消费读取端经唯一合并出口 mergeReviewStatus 合并——
    // 账本状态优先，图内存量 reviewStatus 仅作回退（不复制合并逻辑，与工作树读侧 master-graph-service 同源）。
    // 回退语义（显式，按既有代码风格选定）：旧 Release 无账本工件、账本损坏或非 JSON 数组 → 视为空账本、
    // 图内状态生效，不 fail-closed（与 master-graph-service 读侧 try/catch 回退及 readReviewActionsFile
    // 的 [] 语义一致，不拦截 seq175 前存量 Release 消费）；账本 rejected 裁决照常阻断该边（fail-closed 保持）。
    function readLedgerActions() {
      if (!names.has(".ledger/review_actions.json")) return [];
      try {
        const parsed = JSON.parse(releaseReader.readArtifact(".ledger/review_actions.json"));
        return Array.isArray(parsed) ? parsed : [];
      } catch (_error) { return []; }
    }

    function readMasterGraph(consumer = "topology") {
      const merged = mergeReviewStatus(json(".ledger/master_graph.json"), readLedgerActions());
      const connections = selectFormalRelations(capabilityRegistry, Array.isArray(merged.connections) ? merged.connections : [], consumer);
      return addIdentity({ ...merged, connections }, identity);
    }

    function readSemanticArchitecture(selection = {}) {
      const candidates = [...names].filter((name) => /(?:^|\/)semantic_architecture\.json$/.test(name)).sort();
      if (candidates.length === 0) throw consumerError("RELEASE_ARTIFACT_MISSING", "Release has no semantic architecture", 500);
      let selected = null;
      const product = typeof selection.product === "string" && selection.product.trim() ? selection.product.trim() : (configuredProjection.product || "");
      const version = typeof selection.version === "string" && selection.version.trim() ? selection.version.trim() : (configuredProjection.version || "");
      // 无主体态且调用方未显式选择产品/版本：不拿包内无主的投影（知识库/architecture/ 根落点）冒充产品投影——定义过的空态引导
      if (!product && !version) {
    // EG-1b 收敛尾笔：unmountedError 本地工厂内联为共享工厂直抛（唯一调用点，零语义变化——
    // details 形状与 409 状态逐字段一致；selectionHint 在本调用点恒为真值字符串）
    throw createError("PROJECTION_IDENTITY_UNMOUNTED", UNMOUNTED_GUIDANCE, 409, {
      state: "unmounted",
      guidance: UNMOUNTED_GUIDANCE,
      subjectsRegistry: "data/theschema/subjects.yaml",
      decision: "ADR-009 D5（Master 2026-10-25「A」，PR-103）",
      selectionHint: "可在查询参数显式给出 product 与 version 选择包内某个投影",
    });
  }
      if (product || version) {
        if (!product || !version) throw consumerError("SEMANTIC_PROJECTION_SELECTION_REQUIRED", "Both product and version are required", 400);
        const suffix = `/architecture/${product}/${version}/semantic_architecture.json`;
        selected = candidates.find((name) => name.endsWith(suffix)) || null;
        if (!selected) throw consumerError("SEMANTIC_PROJECTION_NOT_FOUND", `Release projection not found for ${product}@${version}`, 404);
      }
      const projection = json(selected);
      const consumer = typeof selection.consumer === "string" && selection.consumer.trim() ? selection.consumer.trim() : "topology";
      // seq175（ADR057）：投影 connections/dependencies 同样经唯一合并出口合并账本（账本优先，图内回退）。
      const ledger = readLedgerActions();
      const mergedConnections = mergeReviewStatus({ connections: Array.isArray(projection.connections) ? projection.connections : [] }, ledger).connections;
      const mergedDependencies = mergeReviewStatus({ connections: Array.isArray(projection.dependencies) ? projection.dependencies : [] }, ledger).connections;
      return addIdentity({
        ...projection,
        connections: selectFormalRelations(capabilityRegistry, mergedConnections, consumer),
        dependencies: selectFormalRelations(capabilityRegistry, mergedDependencies, consumer),
      }, identity);
    }

    function readArchitectureProjection(product, version) {
      const suffix = `/architecture/${product}/${version}/semantic_architecture.json`;
      const selected = [...names].find((name) => name.endsWith(suffix));
      if (!selected) throw consumerError("VERSION_PROJECTION_MISSING", "Release version projection is missing", 409, { product, version });
      return json(selected);
    }

    function readVersionSnapshot(relativePath) {
      requiredArtifact(names, relativePath);
      return releaseReader.readArtifact(relativePath);
    }

    function provenanceService() {
      const provenance = json("indexes/provenance.json");
      const byPath = new Map((provenance.relations || []).filter((item) => item.sourcePath).map((item) => [item.sourcePath, item]));
      const checkedAt = new Date().toISOString();
      return {
        inspectGraph: () => ({ contentHash: provenance.inputs?.find((item) => item.sourcePath === ".ledger/master_graph.json")?.hash || null, freshness: { status: "fresh", checkedAt, changedFields: [] } }),
        inspectSource: (sourcePath, expectedHash) => {
          const entry = byPath.get(sourcePath);
          const matches = entry && (!expectedHash || entry.sourceHash === expectedHash);
          return { sourcePath, contentHash: entry?.sourceHash || null, freshness: { status: matches ? "fresh" : "unknown", checkedAt, changedFields: [] } };
        },
      };
    }

    function queryArticleManifests(options = {}) {
      const index = jsonArray("indexes/article-manifests.json");
      const q = String(options.q || "").trim().toLowerCase();
      const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200);
      const offset = Math.max(Number(options.offset) || 0, 0);
      const manifests = index.map((entry) => ({ entry, value: json(entry.name) }));
      const items = manifests.map(({ entry, value }) => ({
        sourcePath: value.sourcePathCanonical || value.sourcePath || "",
        normalizedSourcePath: value.sourcePathNormalized || value.sourcePathCanonical || "",
        title: value.article?.title || value.title || value.manifestKey || entry.name,
        kind: value.article?.articleKind || "article",
        nodeEvidenceCount: value.evidence?.nodeEvidenceCount || 0,
        directRelationCount: value.extraction?.directRelationCount || 0,
        manifest: { exists: true, fresh: true, status: "fresh", relativePath: entry.name, reason: "immutable Release artifact" },
        manifestMode: value.manifestMode || "source_only",
        excluded: false,
        exclusionReason: null,
        eligible: true,
      })).filter((item) => !q || item.title.toLowerCase().includes(q) || item.sourcePath.toLowerCase().includes(q));
      return addIdentity({ summary: { totalSources: items.length, totalManifests: items.length, fresh: items.length, missing: 0, stale: 0, unknown: 0 }, items: items.slice(offset, offset + limit) }, identity);
    }

    return {
      ...identity,
      capabilityRegistry,
      inferenceEngine,
      listFormalArticles: () => ({ articles: formalArticles.map((article) => ({ ...article })), ...identity }),
      documentInventory: {
        search: (params) => addIdentity(inventory.search(params), identity),
        searchDocuments: (params) => addIdentity(inventory.searchDocuments(params), identity),
        getDocument: (documentId) => addIdentity(inventory.getDocument(documentId), identity),
        getDocumentsByGraphNodeIds: inventory.getDocumentsByGraphNodeIds,
        getNodeDocuments: (nodeId) => addIdentity(inventory.getNodeDocuments(nodeId), identity),
      },
      provenanceService: provenanceService(),
      queryArticleManifests,
      readArticleAssociationAudit: () => releaseReader.readArtifact(requiredArtifact(names, "知识库/TheSchema/article_associations.yaml")),
      readArchitectureProjection,
      projectionIdentity: configuredProjection,
      readMasterGraph,
      readOntologySource: () => releaseReader.readArtifact(requiredArtifact(names, "知识库/TheSchema/ontology.yaml")),
      readSemanticArchitecture,
      readVersionRegistry: () => addIdentity(json("schema/version-registry.json"), identity),
      readVersionSnapshot,
      selectRelations: (relations, consumer) => selectFormalRelations(capabilityRegistry, relations, consumer),
    };
  }

  function withPinnedRelease(callback) {
    return releaseReader.withPinnedRelease((releaseId) => callback(createContext(releaseId)));
  }

  return { withPinnedRelease };
}

module.exports = { createFormalKnowledgeConsumerService, inferenceOntologyFromArtifact, registryFromArtifact, validateDocuments };
