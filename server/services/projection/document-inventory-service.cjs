// @responsible: 扫描索引文档、绑定图节点并提供检索、分面和详情查询。
const { createNodeIdResolver } = require("./node-id-resolver.cjs");
const { normalizeSourcePath } = require("./document-identity.cjs");
const { normalizeText, normalizeStringList, scanDocumentSources, searchableText, tokenize } = require("./document-source-scanner.cjs");

const MULTI_FACETS = ["arch_status", "arch_category", "arch_layer", "arch_subdomain", "tags", "relationType", "documentKind", "graphStatus"];
const ALL_FACETS = ["arch_status", "status", "arch_category", "arch_layer", "arch_subdomain", "module", "tags", "wikilinkTarget", "relationType", "documentKind", "graphStatus", "product", "version", "articleType", "docType"];
const BINDING_EDGE_TYPES = new Set(["DOCUMENTS", "APPLIES_TO"]);

const { createError: typedError } = require("../../shared/error-factory.cjs");
const { buildPathMap, toLogicalPath } = require("../../shared/readable-path-mapper.cjs");

function graphNodeIdentity(node) {
  const properties = node && node.properties && typeof node.properties === "object" && !Array.isArray(node.properties) ? node.properties : {};
  return {
    id: node && typeof node.id === "string" ? node.id : "",
    articleId: typeof (properties.article_id || properties.articleId) === "string" ? (properties.article_id || properties.articleId).trim() : "",
    sourcePaths: [properties.source_vault_path, properties.sourcePath, properties.source_path, properties.file_path]
      .filter((value) => typeof value === "string" && value.trim()).map((value) => normalizeSourcePath(value.trim())),
  };
}

function bindGraphNodes(documents, graph) {
  if (!graph || !Array.isArray(graph.nodes)) return documents;
  const identities = graph.nodes.map(graphNodeIdentity).filter((item) => item.id);
  const adjacent = new Map();
  for (const connection of Array.isArray(graph.connections) ? graph.connections : []) {
    const type = connection.relationType || connection.type;
    if (!BINDING_EDGE_TYPES.has(type)) continue;
    const source = connection.from || connection.source;
    const target = connection.to || connection.target;
    if (typeof source !== "string" || typeof target !== "string") continue;
    if (!adjacent.has(source)) adjacent.set(source, new Set());
    if (!adjacent.has(target)) adjacent.set(target, new Set());
    adjacent.get(source).add(target);
    adjacent.get(target).add(source);
  }
  return documents.map((document) => {
    const matches = new Set();
    for (const identity of identities) {
      if (document.architectureNodeId && identity.id === document.architectureNodeId) matches.add(identity.id);
      if (document.articleId && identity.articleId === document.articleId) matches.add(identity.id);
      if (identity.sourcePaths.some((sourcePath) => sourcePath === document.sourcePath || sourcePath.endsWith(`/${document.sourcePath}`))) matches.add(identity.id);
    }
    for (const nodeId of [...matches]) for (const relatedId of adjacent.get(nodeId) || []) matches.add(relatedId);
    const graphNodeIds = [...matches].sort();
    return { ...document, graphNodeIds, graphStatus: graphNodeIds.length ? "indexed" : "pending-extraction" };
  });
}

function buildSnapshotFromDocuments(documents, invalid = [], generatedAt = new Date().toISOString()) {
  const pathMap = buildPathMap(documents);
  const documentsWithReadablePath = documents.map((doc) => ({
    ...doc,
    readablePath: toLogicalPath(doc.sourcePath, pathMap)
  }));
  const invertedIndex = new Map();
  documentsWithReadablePath.forEach((document, documentIndex) => {
    for (const token of tokenize(document.searchText)) {
      if (!invertedIndex.has(token)) invertedIndex.set(token, new Set());
      invertedIndex.get(token).add(documentIndex);
    }
  });
  return { documents: documentsWithReadablePath, invalid, invertedIndex, generatedAt, pathMap };
}

function buildSnapshot(vaultPath, getGraph) {
  const scanned = scanDocumentSources({ vaultPath });
  const documents = bindGraphNodes(scanned.documents, typeof getGraph === "function" ? getGraph() : null);
  return buildSnapshotFromDocuments(documents, scanned.invalid);
}

function keywordCandidates(snapshot, keyword) {
  if (!keyword) return snapshot.documents;
  const postings = tokenize(keyword).map((token) => snapshot.invertedIndex.get(token) || new Set());
  if (!postings.length || postings.some((posting) => posting.size === 0)) return [];
  postings.sort((left, right) => left.size - right.size);
  return [...postings[0]].filter((index) => postings.slice(1).every((posting) => posting.has(index))).map((index) => snapshot.documents[index]);
}

function relationValues(document, key) {
  if (key === "wikilinkTarget") return document.relations.map((item) => item.target);
  if (key === "relationType") return document.relations.map((item) => item.type);
  const value = document[key];
  return Array.isArray(value) ? value : value === "" || value === null || value === undefined ? [] : [value];
}

function matches(document, params, omitFacet) {
  if (params.keyword && !document.searchText.includes(searchableText(params.keyword))) return false;
  if (params.nodeId && document.nodeId !== params.nodeId && !document.graphNodeIds.includes(params.nodeId)) return false;
  if (params.documentId && document.documentId !== params.documentId) return false;
  if (omitFacet !== "arch_component" && params.arch_component !== undefined && document.arch_component !== params.arch_component) return false;
  for (const key of ALL_FACETS) {
    if (key === omitFacet || params[key] === undefined || params[key] === "" || (Array.isArray(params[key]) && params[key].length === 0)) continue;
    const selected = Array.isArray(params[key]) ? params[key] : [params[key]];
    if (!selected.some((value) => relationValues(document, key).includes(value))) return false;
  }
  return true;
}

function facetOptions(documents, params, key) {
  const counts = new Map();
  for (const document of documents.filter((item) => matches(item, params, key))) {
    for (const value of new Set(relationValues(document, key))) counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
}

function validateParams(raw = {}) {
  const params = { ...raw };
  const limit = params.limit === undefined ? 50 : Number(params.limit);
  const offset = params.offset === undefined ? 0 : Number(params.offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0) throw typedError("INVALID_QUERY", "limit must be 1..200 and offset must be >= 0");
  params.limit = limit;
  params.offset = offset;
  for (const key of MULTI_FACETS) if (typeof params[key] === "string") params[key] = params[key].split(",").filter(Boolean);
  return params;
}

function canonicalDocument(document) {
  const { searchText: _searchText, nodeId: _nodeId, nodeLabel: _nodeLabel, architectureNodeId: _architectureNodeId, identitySource: _identitySource, ...dto } = document;
  return dto;
}

function toLegacyResult(document, allEntityDocuments, includeDocuments = true, includeRelations = true) {
  const relatedByNodes = [];
  for (const source of allEntityDocuments) {
    for (const relation of source.relations) {
      // WP-107 D2（SPEC-046 I2）：身份回挂只用整串等值，不再双边小写折叠——
      // 折叠会把「仅大小写不同」的两个身份当成同一个，且这条边是猜的却零痕迹。
      // 名称命中（Obsidian 按标题链接）仍承认，但带 resolvedBy 标记供上游显示这根线怎么来的。
      const resolvedBy = relation.target === document.nodeId
        ? "id"
        : (document.nodeLabel && relation.target.toLowerCase() === String(document.nodeLabel).trim().toLowerCase() ? "label" : null);
      if (resolvedBy) relatedByNodes.push({ ...relation, target: source.nodeId, resolvedBy });
    }
  }
  return {
    nodeId: document.nodeId, nodeLabel: document.nodeLabel, arch_component: document.arch_component, arch_status: document.arch_status,
    status: document.status, arch_layer: document.arch_layer, arch_category: document.arch_category, arch_subdomain: document.arch_subdomain,
    module: document.module, tags: document.tags,
    documents: includeDocuments ? [{ title: document.title, relativePath: document.readablePath, arch_component: document.arch_component, arch_status: document.arch_status, status: document.status, arch_layer: document.arch_layer, arch_category: document.arch_category, arch_subdomain: document.arch_subdomain, module: document.module, tags: document.tags, relations: includeRelations ? document.relations : [] }] : [],
    relatedNodes: includeRelations ? document.relations : [], relatedByNodes: includeRelations ? relatedByNodes : [],
  };
}

function createDocumentInventoryService({ vaultPath, getGraph, releaseSnapshot = null } = {}) {
  let snapshot = releaseSnapshot
    ? buildSnapshotFromDocuments(releaseSnapshot.documents || [], releaseSnapshot.invalid || [], releaseSnapshot.generatedAt || new Date().toISOString())
    : null;
  let rebuilding = false;

  async function rebuild() {
    if (releaseSnapshot) throw typedError("RELEASE_INDEX_IMMUTABLE", "Release document index cannot be rebuilt in place");
    if (rebuilding) throw typedError("INDEX_REBUILD_IN_PROGRESS", "Document index rebuild is already running");
    rebuilding = true;
    try {
      const candidate = buildSnapshot(vaultPath, getGraph);
      snapshot = candidate;
      return { totalDocuments: candidate.documents.length, invalidDocuments: candidate.invalid.length, generatedAt: candidate.generatedAt };
    } finally { rebuilding = false; }
  }

  function rebuildSync() {
    if (releaseSnapshot) throw typedError("RELEASE_INDEX_IMMUTABLE", "Release document index cannot be rebuilt in place");
    if (rebuilding) throw typedError("INDEX_REBUILD_IN_PROGRESS", "Document index rebuild is already running");
    rebuilding = true;
    try {
      const candidate = buildSnapshot(vaultPath, getGraph);
      snapshot = candidate;
      return { totalDocuments: candidate.documents.length, invalidDocuments: candidate.invalid.length, generatedAt: candidate.generatedAt };
    } finally { rebuilding = false; }
  }

  function requireSnapshot() {
    if (!snapshot) throw typedError("DOCUMENT_INDEX_UNAVAILABLE", "Document index is not initialized");
    return snapshot;
  }

  function searchDocuments(rawParams = {}) {
    const current = requireSnapshot();
    const params = validateParams(rawParams);
    // 2026-11-01 Master「直接默认全部正式文档」：清单页无筛选词时默认列出全部正式文档
    //（分页照旧）——原「无筛选=空页」检索面语义让已发布文档不可见（用户实测观感
    // 「发布了但没进去」）。检索语义不变：有关键词/筛选时照常过滤。
    const matched = keywordCandidates(current, params.keyword).filter((document) => matches(document, params));
    const page = matched.slice(params.offset, params.offset + params.limit);
    return {
      filters: params,
      summary: {
        totalResults: matched.length,
        totalDocuments: current.documents.length,
        indexedDocuments: current.documents.filter((document) => document.graphStatus === "indexed").length,
        pendingExtraction: current.documents.filter((document) => document.graphStatus === "pending-extraction").length,
      },
      availableFilters: Object.fromEntries(ALL_FACETS.map((key) => [key, facetOptions(current.documents, params, key)])),
      documents: page.map(canonicalDocument),
      limit: params.limit,
      offset: params.offset,
      generatedAt: current.generatedAt,
    };
  }

  function search(rawParams = {}) {
    const current = requireSnapshot();
    const params = validateParams(rawParams);
    const entities = current.documents.filter((document) => document.documentKind === "entity");
    const activeFilter = Object.keys(params).some((key) => !["limit", "offset", "includeRelations", "includeDocuments"].includes(key) && params[key] !== undefined && params[key] !== "");
    const matched = keywordCandidates(current, params.keyword).filter((document) => document.documentKind === "entity" && matches(document, params));
    const page = activeFilter ? matched.slice(params.offset, params.offset + params.limit) : [];
    return {
      filters: params,
      summary: { totalResults: matched.length, totalNodes: entities.length, totalDocuments: entities.length, nodesWithDocuments: entities.length, nodesWithoutDocuments: 0 },
      availableFilters: Object.fromEntries(ALL_FACETS.slice(0, 9).map((key) => [key, facetOptions(entities, params, key)])),
      results: page.map((document) => toLegacyResult(document, entities, params.includeDocuments !== false, params.includeRelations !== false)),
      limit: params.limit, offset: params.offset, generatedAt: current.generatedAt,
    };
  }

  function getDocument(documentId) {
    const current = requireSnapshot();
    const document = current.documents.find((item) => item.documentId === documentId);
    if (!document) throw typedError("DOCUMENT_NOT_FOUND", `Document not found: ${documentId}`);
    return { document: canonicalDocument(document), generatedAt: current.generatedAt };
  }

  function getDocumentsByGraphNodeIds(nodeIds) {
    const selected = new Set(Array.isArray(nodeIds) ? nodeIds : []);
    return requireSnapshot().documents.filter((document) => document.graphNodeIds.some((nodeId) => selected.has(nodeId))).map(canonicalDocument);
  }

  function getNodeDocuments(nodeId) {
    const current = requireSnapshot();
    const entities = current.documents.filter((document) => document.documentKind === "entity");
    const resolver = createNodeIdResolver(entities.map((document) => ({ id: document.nodeId, label: document.nodeLabel, properties: {} })), []);
    const resolved = resolver.resolveNodeId(nodeId);
    const document = entities.find((item) => item.nodeId === resolved);
    if (!document) throw typedError("NODE_NOT_FOUND", `Node not found: ${nodeId}`);
    return { result: toLegacyResult(document, entities), generatedAt: current.generatedAt };
  }

  return { initialize: rebuild, rebuild, rebuildSync, search, searchDocuments, getDocument, getDocumentsByGraphNodeIds, getNodeDocuments, getStatus: () => ({ ready: Boolean(snapshot), rebuilding, generatedAt: snapshot ? snapshot.generatedAt : null }) };
}

module.exports = { bindGraphNodes, buildSnapshot, buildSnapshotFromDocuments, createDocumentInventoryService, normalizeText, normalizeStringList, tokenize, MULTI_FACETS };
