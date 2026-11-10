// @responsible: 从指定 Git 提交构建完整图事实预览与正式 Release 工件。
// Builds complete graph-fact Preview and formal Release artifacts from one Git commit.
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const YAML = require("yaml");
const { parseMarkdown, scanFormalArticleCatalog, scanFormalReleaseSources, tokenize } = require("../projection/document-source-scanner.cjs");
const { bindGraphNodes } = require("../projection/document-inventory-service.cjs");
const { buildCapabilityRegistry } = require("../../shared/relation-capability-selector.cjs");
const { buildInferenceOntology } = require("../inference/inference-ontology.cjs");
const { buildRegistryResponse, readRegistryFile } = require("../../shared/version-registry-reader.cjs");
const { validateVersionRegistry } = require("../../shared/version-contract.cjs");

const { bindErrorFactory } = require("../../shared/error-factory.cjs");
const { getRuntimeStateStore } = require("../../shared/persistence/runtime-state-store.cjs"); // SPEC-012 WP-A：人裁账本物化进 Release 工件
const { getDerivedIndexStore } = require("../../shared/persistence/derived-index-store.cjs"); // SPEC-012 wave-2：manifest 行级投影物化进 Release 工件
const { readGraphArtifactText, readExtractManifestText } = require("../../shared/persistence/graph-artifact-ingest.cjs"); // SPEC-012 wave-2 图族：图/清单原文物化进 Release 工件
const { resolveDataDir } = require("../../shared/persistence/data-dir.cjs"); // SPEC-012 wave-2 图族：master_graph.db 字节工件住 repo 侧 data/
const { resolveTheSchemaDir } = require("../../shared/theschema-root.cjs"); // PR-101：TheSchema 唯一解析点（SPEC-023）
const { readFrozenArtifactSnapshot } = require("../../shared/frozen-artifact-reader.cjs"); // PR-101：SA/layout 冻结槽读侧唯一咽喉（PR-082/084）
const { readEnums } = require("../../shared/schema-config.cjs"); // PR-101：architecture_projection（槽物化落点寻址）
const articleLifecycle = require("../../shared/article-lifecycle-paths.cjs"); // 正式文章快照家族寻址（FORMAL_ROOT 单源）
const { scanEntities } = require("../entity-compliance/entity-source-scanner.cjs");
const { checkAllEntities } = require("../entity-compliance/entity-compliance-service.cjs");
const { loadRuleSetForVault } = require("../schema-manager/compliance-rule-set-service.cjs");
const artifactError = bindErrorFactory({ status: 400 });

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function jsonBytes(value) { return `${JSON.stringify(canonical(value))}\n`; }
function sha256(value) { return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`; }

// 打包扫描禁区：库内治理目录不入产物面——.git/.ledger-backups 是装配层既有过滤（publishArticle/
// publishCurrent 的 IGNORED_ARTIFACT_PREFIXES），.releases 是发布物住址（WP-023）：文件族遍历把它
// 一并扫描曾致「Release 套 Release」嵌套产物（4c19ed37 实录 30 条嵌套垃圾件），在此源头掐断。
const COLLECTION_SKIP_DIRS = new Set([".git", ".ledger-backups", ".releases"]);

function filesUnder(root, relative = "") {
  const target = path.join(root, relative);
  if (!fs.existsSync(target)) return [];
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    const child = relative ? path.posix.join(relative, entry.name) : entry.name;
    return entry.isDirectory() ? (COLLECTION_SKIP_DIRS.has(entry.name) ? [] : filesUnder(root, child)) : [child];
  }).sort();
}

const VOLATILE_KEYS = new Set(["generatedAt", "generated_at", "run_ts", "timestamp", "duration_ms"]);
function stableDerivedJson(value) {
  if (Array.isArray(value)) return value.map(stableDerivedJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !VOLATILE_KEYS.has(key))
      .map(([key, nested]) => [key, stableDerivedJson(nested)]));
  }
  return value;
}

function readStableArtifact(root, relative) {
  const bytes = fs.readFileSync(path.join(root, relative));
  if (!relative.endsWith(".json")) return bytes;
  try { return Buffer.from(jsonBytes(stableDerivedJson(JSON.parse(bytes.toString("utf8"))))); }
  catch { throw artifactError("INVALID_RELEASE_ARTIFACT", `Invalid JSON artifact: ${relative}`, 500); }
}

function requiredFile(root, relative) {
  const target = path.join(root, relative);
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw artifactError("RELEASE_ARTIFACT_MISSING", `Required Release artifact is missing: ${relative}`, 500);
  }
  return readStableArtifact(root, relative);
}

function requiredRawFile(root, relative) {
  const target = path.join(root, relative);
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw artifactError("RELEASE_ARTIFACT_MISSING", `Required Release artifact is missing: ${relative}`, 500);
  }
  return fs.readFileSync(target);
}

// SPEC-012 wave-2 图族：Release 工件的三处图族物化（bundle 内布局不变，消费端零改动）——
// master_graph.json/extract_manifest.json 从 derived-index.db 原文行物化（与旧盘读产物字节一致：
// 同款 stableDerivedJson＋canonical 稳定化变换）；master_graph.db 是字节工件（不进库），
// 从 repo 侧 data/ 读原始字节。三者缺失/非法均按旧 requiredFile 语义 fail-closed。
function stableJsonFromStoreText(text, relative) {
  if (text === null) {
    throw artifactError("RELEASE_ARTIFACT_MISSING", `Required Release artifact is missing: ${relative}`, 500);
  }
  try {
    return Buffer.from(jsonBytes(stableDerivedJson(JSON.parse(text))));
  } catch (_error) {
    throw artifactError("INVALID_RELEASE_ARTIFACT", `Invalid JSON artifact: ${relative}`, 500);
  }
}

function requiredDataArtifactFile(relative) {
  const target = path.join(resolveDataDir(), relative);
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw artifactError("RELEASE_ARTIFACT_MISSING", `Required Release artifact is missing: ${relative}`, 500);
  }
  return fs.readFileSync(target);
}

function normalizedDocuments(root, masterGraph) {
  const scanned = scanFormalReleaseSources({ vaultPath: root });
  if (scanned.invalid.length > 0) {
    throw artifactError("RELEASE_DOCUMENT_INDEX_INVALID", "Governed documents contain invalid source files", 500, { invalid: scanned.invalid });
  }
  const catalog = scanFormalArticleCatalog({ vaultPath: root });
  if (catalog.invalid.length > 0) {
    throw artifactError("RELEASE_DOCUMENT_INDEX_INVALID", "Formal articles do not have a complete owner-source catalog", 500, { invalid: catalog.invalid });
  }
  const articleById = new Map(catalog.articles.map((article) => [article.articleId, article]));
  return bindGraphNodes(scanned.documents, masterGraph).map((document) => {
    const parsed = parseMarkdown(document._raw, document.sourcePath);
    const { _mtimeMs, _raw, _size, ...governed } = document;
    const formalArticle = document.documentKind === "standard-article" ? articleById.get(document.articleId) : null;
    return {
      ...governed,
      body: parsed.body,
      ...(formalArticle ? {
        associations: formalArticle.associations,
        componentIds: formalArticle.componentIds,
        ownerSourcePath: formalArticle.ownerSourcePath,
        ownerSourceHash: formalArticle.sourceHash,
      } : {}),
      parentId: typeof parsed.frontmatter.parent_id === "string" ? parsed.frontmatter.parent_id.trim() : null,
      // Scanner wikilinks are discovery candidates, not governed graph facts.
      relations: [],
      tokens: tokenize(document.searchText).sort(),
    };
  }).sort((left, right) => left.documentId.localeCompare(right.documentId));
}

// PR-101：TheSchema 取料经唯一解析点（SPEC-023 波 1 读路径单源）——打包器此前以 Vault 根字面相对路径直读，
// 迁仓后真库零发布。包内布局保持 知识库/TheSchema/<name>（消费端 formal-knowledge-consumer 按此名取件，零改动）。
const THESCHEMA_BUNDLE_PREFIX = "知识库/TheSchema/";

function theSchemaDir(root) {
  return resolveTheSchemaDir(root);
}

// 解析目录下全部 yaml（含子目录，沿旧 Vault 侧 ^知识库/TheSchema/.*\.ya?ml$ 的递归口径）→ 包内同名
function theSchemaArtifacts(root) {
  const dir = theSchemaDir(root);
  const out = {};
  for (const relative of filesUnder(dir).filter((name) => /\.ya?ml$/.test(name))) {
    out[`${THESCHEMA_BUNDLE_PREFIX}${relative}`] = readStableArtifact(dir, relative);
  }
  return out;
}

function readOntology(root) {
  const dir = theSchemaDir(root);
  try {
    // PR-053：release 打包读侧同走 TheSchema 通用咽喉——脏形态局部降级后进能力/推理派生，
    // 保证 Release 工件与运行时读侧同源（不因打包路径绕过咽喉而产生第二形态口径）。
    const { normalizeDocument } = require("../../shared/theschema-loader.cjs");
    return normalizeDocument("ontology", YAML.parse(requiredFile(dir, "ontology.yaml").toString("utf8")) || {}).data;
  }
  catch (error) { throw artifactError("INVALID_RELEASE_ARTIFACT", `Invalid ontology: ${error.message}`, 500); }
}

// 投影身份（architecture_projection）成对护栏：身份是「product+version 成对」契约（ADR-009 消费端
// 两者都要有或都无）——源词表允许「已设产品、版本待冻结」的中间态（产品版本注册表冻结时成对补齐），
// 但 Release 产物只认成对态：半填身份的 Release 出生即非法（消费端 fail-closed，全站 formal 页面 500）。
// 打包是半填态进入产物的唯一通道——在此拦下并给可操作指引，错误码与消费端同名便于两端互查。
function assertProjectionIdentityPaired(root) {
  const projection = (readEnums(root) || {}).architecture_projection || {};
  const product = String(projection.product || "").trim();
  const version = String(projection.version || "").trim();
  if (Boolean(product) === Boolean(version)) return;
  throw artifactError("RELEASE_PROJECTION_IDENTITY_INVALID",
    product
      ? `架构投影身份只填了一半：已设产品「${product}」但版本为空——请先在架构组件页的版本注册表冻结一个版本（冻结会成对补齐版本），再发布`
      : "架构投影身份只填了一半：已设版本但产品为空——请补设产品身份或清空版本后再发布",
    409, { product: product || null, version: version || null });
}

// PR-101：SA/layout 真身（PR-082 起）住 derived-index 冻结槽 sa / sa_layout（经读侧唯一咽喉）；Vault 树内
// 存量按版本落位的投影文件照收（旧世界多版本）。槽物化落点沿消费端寻址口径
// 知识库/architecture/<product>/<version>/…（enums architecture_projection；两者皆空时落 知识库/architecture/
// 根——不编造段名）。路径与 Vault 文件重合时以槽为准（槽是管线当前产物，Vault 文件是迁仓前落位）。
function projectionArtifactsFromStore(root, artifacts, semantic, layouts) {
  const projection = (readEnums(root) || {}).architecture_projection || {};
  const product = String(projection.product || "").trim();
  const version = String(projection.version || "").trim();
  const base = product && version ? `知识库/architecture/${product}/${version}` : "知识库/architecture";
  for (const [slot, file, list] of [["sa", "semantic_architecture.json", semantic], ["sa_layout", "architecture_layout.json", layouts]]) {
    let snapshot;
    try { snapshot = readFrozenArtifactSnapshot(root, slot); }
    catch (error) {
      // 咽喉的 FORMAT_VERSION_MISMATCH / WORKING_JSON_INVALID 统一收口为打包器既有错误码（fail-closed 口径不变，调用方只认一族码）
      throw artifactError("INVALID_RELEASE_ARTIFACT", `Invalid frozen projection artifact ${slot}: ${error.message}`, 500, { slot, cause: error.code || null });
    }
    if (!snapshot.exists) continue;
    const relative = `${base}/${file}`;
    artifacts[relative] = Buffer.from(jsonBytes(stableDerivedJson(snapshot.data)));
    if (!list.includes(relative)) list.push(relative);
  }
  semantic.sort();
  layouts.sort();
}

function normalizedCapabilities(root) {
  const ontology = readOntology(root);
  const registry = buildCapabilityRegistry(ontology);
  const inferenceOntology = buildInferenceOntology(ontology);
  const relations = [...registry.relations.values()].map((entry) => ({
    assertionPolicies: entry.assertionPolicies,
    bidirectional: entry.bidirectional,
    candidateEnabled: entry.candidateEnabled,
    direction: entry.direction,
    factEncoding: entry.factEncoding,
    impactPropagation: entry.impactPropagation,
    inImpactSet: entry.inImpactSet,
    legacyPolicy: entry.legacyPolicy,
    projected: entry.projected,
    registeredForInference: entry.registeredForInference,
    semanticRole: entry.semanticRole,
    type: entry.type,
    versionable: entry.versionable,
    weight: entry.weight,
  })).sort((left, right) => left.type.localeCompare(right.type));
  return { inferenceRules: inferenceOntology.rules, meta: registry.meta, relations };
}

function versionArtifacts(root, artifacts) {
  const current = readRegistryFile(root);
  const registry = buildRegistryResponse(current, validateVersionRegistry(current.data));
  if (registry.diagnostics.length > 0) {
    throw artifactError("INVALID_RELEASE_ARTIFACT", "Version registry is invalid", 500, { diagnostics: registry.diagnostics });
  }
  const snapshots = [];
  for (const [product, definition] of Object.entries(registry.products).sort(([left], [right]) => left.localeCompare(right))) {
    for (const version of [...definition.versions].sort((left, right) => left.id.localeCompare(right.id))) {
      if (!version.snapshot?.path) continue;
      const bytes = requiredRawFile(root, version.snapshot.path);
      const actualHash = sha256(bytes);
      const expectedHash = String(version.snapshot.sha256 || "").replace(/^sha256:/, "");
      if (expectedHash && actualHash !== `sha256:${expectedHash}`) {
        throw artifactError("RELEASE_ARTIFACT_HASH_MISMATCH", `Version snapshot hash mismatch: ${version.snapshot.path}`, 500);
      }
      artifacts[version.snapshot.path] = bytes;
      snapshots.push({ path: version.snapshot.path, product, sha256: actualHash, version: version.id });
    }
  }
  return {
    registry: {
      products: registry.products,
      revision: registry.revision,
      schemaVersion: registry.schema_version,
      sourceFile: registry.sourceFile,
      summary: registry.summary,
    },
    snapshots,
  };
}

function projectionIndexes(root, artifacts, semanticPaths, layoutPaths) {
  const identities = new Map();
  const crossCuttingEntityIds = new Set();
  const semantic = semanticPaths.map((sourcePath) => {
    const value = JSON.parse(artifacts[sourcePath].toString("utf8"));
    const nodes = [...(Array.isArray(value.nodes) ? value.nodes : []), ...(Array.isArray(value.components) ? value.components : []), ...(Array.isArray(value.crosscutting) ? value.crosscutting : [])];
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      const entityId = String(node.id || node["architecture-node-id"] || "");
      if (!entityId) continue;
      const current = identities.get(entityId) || { entityId, label: String(node.label || node.title || entityId), projectionPaths: [] };
      if (!current.projectionPaths.includes(sourcePath)) current.projectionPaths.push(sourcePath);
      identities.set(entityId, current);
    }
    for (const node of Array.isArray(value.crosscutting) ? value.crosscutting : []) {
      const entityId = String(node?.id || node?.["architecture-node-id"] || "");
      if (entityId) crossCuttingEntityIds.add(entityId);
    }
    const connections = [...(Array.isArray(value.connections) ? value.connections : []), ...(Array.isArray(value.dependencies) ? value.dependencies : [])];
    return { connectionCount: connections.length, hash: sha256(artifacts[sourcePath]), nodeCount: nodes.length, sourcePath };
  });
  const layouts = layoutPaths.map((sourcePath) => ({ hash: sha256(artifacts[sourcePath]), sourcePath }));
  return {
    crossCuttingEntityIds: [...crossCuttingEntityIds].sort(),
    entities: [...identities.values()].sort((a, b) => a.entityId.localeCompare(b.entityId)),
    layouts,
    semantic,
  };
}

function containmentIndex(documents, crossCuttingEntityIds) {
  const crossCutting = new Set(crossCuttingEntityIds);
  const entities = documents
    .filter((document) => document.documentKind === "entity" && document.architectureNodeId)
    .map((document) => ({
      entityId: document.architectureNodeId,
      parentId: document.parentId || null,
      crossCutting: crossCutting.has(document.architectureNodeId),
    }))
    .sort((left, right) => left.entityId.localeCompare(right.entityId));
  return { crossCuttingEntityIds: [...crossCutting].sort(), entities };
}

function provenanceIndex(artifacts, masterGraph) {
  const relations = (Array.isArray(masterGraph.connections) ? masterGraph.connections : []).map((edge, index) => ({
    edgeId: String(edge.edgeId || edge.id || `edge-${index}`),
    evidenceHash: edge.evidenceHash || edge.evidence_hash || edge.properties?.evidenceHash || null,
    from: String(edge.from || edge.source || ""),
    lineNumber: edge.lineNumber || edge.line_number || edge.properties?.lineNumber || null,
    relationType: String(edge.relationType || edge.type || ""),
    sourceHash: edge.sourceHash || edge.source_hash || edge.properties?.sourceHash || null,
    sourcePath: edge.sourceFile || edge.sourcePath || edge.properties?.sourcePath || null,
    to: String(edge.to || edge.target || ""),
  })).sort((left, right) => left.edgeId.localeCompare(right.edgeId));
  const inputs = [".ledger/master_graph.json", ".ledger/pipeline_version.json", ".ledger/extract_manifest.json", ".ledger/review_actions.json"]
    .map((sourcePath) => ({ hash: sha256(artifacts[sourcePath]), sourcePath }));
  return { inputs, relations };
}

// S6（场景⑨⑩）：master_graph 中未注册的关系类型不得进入不可变 Release 产物——构建期阻断。
// 消费端 formal-relation-selector 的 ASSERTION_POLICY_UNRESOLVED 过滤发生在 Release 冻结之后，
// 未知类型边会进入 master_graph.json artifact + provenance.json（消费期才被过滤）；
// 按场景⑩「不完整或陈旧的 Schema 定义不得发布」在收集期拦截，注册关系类型后才能发布。
function assertRegisteredRelationTypes(root, masterGraph) {
  const registry = buildCapabilityRegistry(readOntology(root));
  const registered = new Set([...registry.relations.keys()]);
  const unknownEdges = (Array.isArray(masterGraph.connections) ? masterGraph.connections : [])
    .map((edge) => ({
      edge: edge && typeof edge === "object" ? edge : {},
      relationType: String((edge && (edge.relationType || edge.type || edge.relation_type)) || "").trim(),
    }))
    .filter(({ relationType }) => !registered.has(relationType))
    .map(({ edge, relationType }) => ({
      edgeId: String(edge.edgeId || edge.id || ""),
      from: String(edge.from || edge.source || ""),
      relationType,
      to: String(edge.to || edge.target || ""),
    }));
  if (unknownEdges.length > 0) {
    throw artifactError(
      "RELATION_TYPE_UNREGISTERED",
      "master_graph 包含未在 ontology relation_types 注册的关系类型，禁止发布",
      500,
      { unknownEdges },
    );
  }
}

function collectCompleteArtifacts(root) {
  // 半填投影身份不得铸版（护栏本体见 assertProjectionIdentityPaired）
  assertProjectionIdentityPaired(root);
  // SPEC-012 wave-2 图族：图/清单原文从 derived-index.db 取（scopeKey=root——生产装配后恒全局
  // 实例，测试懒建按 vault 隔离，与上批 manifests 物化同款取用形态）
  const graphStore = getDerivedIndexStore(root);
  const artifacts = {
    // 物化字节=stableDerivedJson(JSON.parse(库原文))——与旧 requiredFile 盘读产物逐字节一致
    ".ledger/master_graph.json": stableJsonFromStoreText(readGraphArtifactText(graphStore), ".ledger/master_graph.json"),
    ".ledger/master_graph.db": requiredDataArtifactFile("master_graph.db"),
    // SPEC-012 WP-A：pipeline_version 真身迁 runtime-state.db——打包时从库物化进 bundle（布局不变）
    ".ledger/pipeline_version.json": Buffer.from(jsonBytes(getRuntimeStateStore(root).pipeline.versionGet() ?? {})),
    ".ledger/extract_manifest.json": stableJsonFromStoreText(readExtractManifestText(graphStore), ".ledger/extract_manifest.json"),
  };
  // seq175（ADR057）：裁决账本随发布物打包——工件内路径 .ledger/review_actions.json 与写侧/读侧
  // 对齐，不新造路径；并进入 provenance inputs。SPEC-012 WP-A：账本真身迁 runtime-state.db——
  // 打包时从 store 物化进 Release 工件（bundle 内布局不变，消费端 formal-knowledge-consumer 零改动）；
  // 零裁决时 store.list() 即 []，账本输入无条件存在的语义保持。
  artifacts[".ledger/review_actions.json"] = Buffer.from(jsonBytes(getRuntimeStateStore(root).review.list()));
  const allFiles = filesUnder(root);
  // SA/layout 两源合流：Vault 树内存量投影文件（旧世界多版本）＋ derived-index 冻结槽（PR-082 起的真身）
  const semantic = allFiles.filter((name) => /(?:^|\/)semantic_architecture\.json$/.test(name));
  const layouts = allFiles.filter((name) => /(?:^|\/)architecture_layout\.json$/.test(name));
  for (const relative of [...semantic, ...layouts]) artifacts[relative] = readStableArtifact(root, relative);
  projectionArtifactsFromStore(root, artifacts, semantic, layouts);
  if (semantic.length === 0 || layouts.length === 0) {
    throw artifactError("RELEASE_ARTIFACT_MISSING", "Semantic architecture and architecture layout are required", 500, { semantic, layouts });
  }

  // TheSchema 经 resolver 取料（PR-101）——不再扫 Vault 树
  Object.assign(artifacts, theSchemaArtifacts(root));
  // 正式文章快照家族（2026-11-01 半成品区过滤批根因修复）：FORMAL_ROOT/**/*.md 原始字节随
  // 发布物打包——此前该家族只在文章发布链经 publishArticle 显式注入（artifacts[snapshotPath]），
  // 人工铸版链（publishCurrent/WP-017）结构上带不上，致 listCurrentStandardVersions 在 manifest
  // 找不到 FORMAL_ROOT 文件→发布识别恒 false（用户实测：已发布文章仍列半成品区）。两链同源。
  const articleSnapshotPrefix = `${articleLifecycle.FORMAL_ROOT}/`;
  for (const relative of allFiles.filter((name) => name.startsWith(articleSnapshotPrefix) && name.endsWith(".md"))) {
    artifacts[relative] = Buffer.from(fs.readFileSync(path.join(root, relative)));
  }
  const associationAudit = `${THESCHEMA_BUNDLE_PREFIX}article_associations.yaml`;
  if (!artifacts[associationAudit]) {
    artifacts[associationAudit] = Buffer.from("schema_version: 1\ndecisions: []\n");
  }

  // SPEC-012 wave-2：article-manifests 真身迁 derived-index.db——打包从 store 行集物化进 bundle
  //（工件内路径 .ledger/article-manifests/<key>.json 布局不变，消费端零改动；字节口径沿
  // readStableArtifact 同款 stableDerivedJson＋canonical 变换，与旧盘读产物等价）
  const manifestRows = getDerivedIndexStore(root).articleManifests.list();
  const manifests = manifestRows.map((row) => `.ledger/article-manifests/${row.key}.json`);
  for (const row of manifestRows) {
    artifacts[`.ledger/article-manifests/${row.key}.json`] = Buffer.from(jsonBytes(stableDerivedJson(row.manifest)));
  }
  const mappings = allFiles.filter((name) => /^\.ledger\/.*article.*(?:mapping|association).*\.json$/i.test(name));
  for (const relative of mappings) artifacts[relative] = readStableArtifact(root, relative);
  // B2（#1795）打包交叉验证：manifest 的源必须随发布快照在场——孤儿 manifest 冻进正式发布
  // 就是 formal 消费端幽灵条目的源头（ADR063「重建即对账」打包层守卫，fail-closed）。
  assertNoOrphanManifests(root, manifestRows);

  const manifestIndex = manifests.map((name) => ({ name, hash: sha256(artifacts[name]) }));
  const mappingIndex = mappings.map((name) => ({ name, hash: sha256(artifacts[name]) }));
  artifacts["indexes/article-manifests.json"] = Buffer.from(jsonBytes(manifestIndex));
  artifacts["indexes/article-mappings.json"] = Buffer.from(jsonBytes(mappingIndex));

  const masterGraph = JSON.parse(artifacts[".ledger/master_graph.json"].toString("utf8"));
  assertRegisteredRelationTypes(root, masterGraph);
  const documents = normalizedDocuments(root, masterGraph);
  // 创建时允许缺项；铸版前按现行规则重新扫描原始实体文件，缺项仍在就拒绝。
  const entitySources = scanEntities(root);
  if (entitySources.length) {
    const checks = checkAllEntities(entitySources.map((item) => item.doc), loadRuleSetForVault(root));
    const pending = checks.flatMap((result, index) => result.blockerCount > 0
      ? [{ sourcePath: path.relative(root, entitySources[index].file).split(path.sep).join("/"), blockerCount: result.blockerCount,
        rules: (result.groups || []).flatMap((group) => group.checks || []).filter((check) => check.passed === false && check.severity === "error").slice(0, 10).map((check) => ({ ruleId: check.ruleId, field: check.field, message: check.message })) }]
      : []);
    if (pending.length) throw artifactError("ENTITY_COMPLIANCE_BLOCKED", "实体缺项或不合规，发布前须处理", 422, { pending: pending.slice(0, 20) });
  }
  artifacts["indexes/document-search.json"] = Buffer.from(jsonBytes({ documents }));
  artifacts["schema/ontology-capabilities.json"] = Buffer.from(jsonBytes(normalizedCapabilities(root)));
  const versions = versionArtifacts(root, artifacts);
  artifacts["schema/version-registry.json"] = Buffer.from(jsonBytes(versions.registry));
  artifacts["indexes/version-snapshots.json"] = Buffer.from(jsonBytes({ snapshots: versions.snapshots }));
  const projections = projectionIndexes(root, artifacts, semantic, layouts);
  artifacts["indexes/semantic-projections.json"] = Buffer.from(jsonBytes({ entities: projections.entities, projections: projections.semantic }));
  artifacts["indexes/architecture-layouts.json"] = Buffer.from(jsonBytes({ layouts: projections.layouts }));
  artifacts["indexes/entity-containment.json"] = Buffer.from(jsonBytes(containmentIndex(documents, projections.crossCuttingEntityIds)));
  artifacts["indexes/provenance.json"] = Buffer.from(jsonBytes(provenanceIndex(artifacts, masterGraph)));
  artifacts["statistics/graph-statistics.json"] = Buffer.from(jsonBytes({
    articleManifestCount: manifests.length,
    connectionCount: Array.isArray(masterGraph.connections) ? masterGraph.connections.length : 0,
    documentCount: documents.length,
    nodeCount: Array.isArray(masterGraph.nodes) ? masterGraph.nodes.length : 0,
  }));
  return artifacts;
}

// B2（#1795）：打包交叉验证（可独立单测）——store 行集内每份 manifest 的 sourcePathCanonical
// 必须存在于发布快照 root；缺失/不可解析即孤儿，fail-closed 拒绝打包（读 manifest 对象字段，
// SPEC-012 wave-2 起不再扫盘——行集即打包行集，校验与物化同一份数据）。
function assertNoOrphanManifests(root, manifestRows) {
  const orphanManifests = [];
  for (const row of manifestRows) {
    const sourcePath = String((row.manifest && (row.manifest.sourcePathCanonical || row.manifest.sourcePath)) || "");
    if (!sourcePath || !fs.existsSync(path.join(root, sourcePath))) {
      orphanManifests.push({ manifest: `.ledger/article-manifests/${row.key}.json`, sourcePath });
    }
  }
  if (orphanManifests.length > 0) {
    throw artifactError(
      "RELEASE_MANIFEST_ORPHAN",
      "article manifest 的源文件不在发布快照中（孤儿），禁止打包——先执行 manifest 重建对账",
      500,
      { orphanManifests },
    );
  }
}

module.exports = { collectCompleteArtifacts, assertNoOrphanManifests };
