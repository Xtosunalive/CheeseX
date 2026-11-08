// @contract ReviewStatus: "approved" | "pending" | "rejected"
// @see contracts/http-api.openapi.json#/components/schemas/ReviewStatus
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createReleaseBuilderService } = require("../release-builder-service.cjs");
const { createReleasePublisherService } = require("../release-publisher-service.cjs");
const { createReleaseReaderService } = require("../release-reader-service.cjs");
const { createFormalKnowledgeConsumerService } = require("../formal-knowledge-consumer-service.cjs");

function json(value) { return `${JSON.stringify(value)}\n`; }

function artifacts(label) {
  const relation = {
    edgeId: `edge-${label}`, from: "a", to: "b", relationType: "DEPENDS_ON",
    reviewStatus: "approved", freshness: "fresh", sourceKind: "typed_wikilink",
    producer: "extract_graph.entity_typed_wikilink", sourceRevision: `sha256:${label}`,
    sourcePath: "知识库/wiki/entities/a.md", lineNumber: 3, targetIdentity: "b",
    // K-P0-4（2026-09-10）：reviewed 决策模式下 approved 需人类归属（机器自盖 approved 不放行）。
    // 此处表达 K-P1-2 终态形态（图边携带 assertedBy）；真实链路的账本→边身份传播缺口另行登记。
    assertedBy: { actorId: "local-architect", actorType: "human" },
  };
  return {
    ".ledger/master_graph.json": json({ nodes: [{ id: "a", label }, { id: "b", label: "B" }], connections: [relation] }),
    "schema/ontology-capabilities.json": json({
      inferenceRules: [{ id: "transitive_dependency", pattern: "A->B->C", output: "A->C", scope: "reasoning", description: "" }],
      relations: [{
        type: "DEPENDS_ON", semanticRole: "architecture_skeleton", impactPropagation: "reverse",
        inImpactSet: true,
        direction: "A -> B", weight: 1, bidirectional: false, registeredForInference: true,
        assertionPolicies: [{ sourceKind: "typed_wikilink", producer: "extract_graph.entity_typed_wikilink", decisionMode: "reviewed", requiredEvidence: ["source_revision", "source_coordinate", "target_identity"], workingProjection: "approved_only", formalConsumers: ["topology", "relation_search", "impact_analysis"] }],
      }],
    }),
    "schema/version-registry.json": json({ schemaVersion: "1", revision: `sha256:${label}`, products: { Product: { versions: [{ id: "1.0.0", label: "1.0.0", status: "released", snapshot: { path: "snapshots/1.json", sha256: `sha256:${label}` } }] } } }),
    "snapshots/1.json": json({ product: "Product", version: "1.0.0", components: [], dependencies: [] }),
    "indexes/document-search.json": json({ documents: [{ documentId: `doc-${label}`, documentKind: "entity", title: label, sourcePath: "知识库/wiki/entities/a.md", sourceHash: `sha256:${label}`, body: label, searchText: label.toLowerCase(), tokens: [label.toLowerCase()], graphNodeIds: ["a"], relations: [{ target: "candidate", type: "REFERENCES" }], nodeId: "a", nodeLabel: label, graphStatus: "indexed", tags: [] }] }),
    "indexes/article-manifests.json": json([]),
    "indexes/provenance.json": json({ inputs: [{ sourcePath: ".ledger/master_graph.json", hash: `sha256:${label}` }], relations: [{ edgeId: `edge-${label}`, sourcePath: "知识库/wiki/entities/a.md", sourceHash: `sha256:${label}` }] }),
    "indexes/entity-containment.json": json({ entities: [{ entityId: "a", parentId: null, crossCutting: false }], crossCuttingEntityIds: [] }),
    "知识库/TheSchema/enums.yaml": "architecture_projection:\n  product: Product\n  version: 1.0.0\n",
    "知识库/architecture/Product/1.0.0/semantic_architecture.json": json({
      product: "Product", version: "1.0.0", components: [{ id: "a", label }],
      dependencies: [{ from: "a", to: "b", relationType: "DEPENDS_ON", reviewStatus: "pending", freshness: "fresh", sourceKind: "typed_wikilink", producer: "extract_graph.entity_typed_wikilink", sourceRevision: "sha256:pending", sourcePath: "a.md", lineNumber: 1, targetIdentity: "b" }],
    }),
  };
}

function environment() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "formal-consumer-"));
  const builderService = createReleaseBuilderService({ releasesDir: root });
  const readerService = createReleaseReaderService({ builderService, releasesDir: root });
  const publisherService = createReleasePublisherService({ builderService, readerService, releasesDir: root });
  const service = createFormalKnowledgeConsumerService({ releaseReader: readerService });
  return { root, builderService, readerService, publisherService, service };
}

function cleanup(root) {
  if (!fs.existsSync(root)) return;
  try { fs.chmodSync(root, 0o700); } catch {}
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    try { fs.chmodSync(target, entry.isDirectory() ? 0o700 : 0o600); } catch {}
    if (entry.isDirectory()) cleanup(target);
  }
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

// E5：publisherService.publish 已退役（生产零调用死代码），测试 setup 不再借它造 release。
// 等价构造：builderService.build 建 Release + 直接写 current.json 指针（语义与原 publish 的 build+pointer 一致）。
function publishRelease(env, input) {
  const release = env.builderService.build(input);
  const pointer = {
    releaseId: release.releaseId,
    sourceCommit: release.sourceCommit,
    manifestHash: release.manifestHash,
    previousReleaseId: env.publisherService.getCurrentReleaseId(),
    publishedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(env.root, "current.json"), `${JSON.stringify(pointer, null, 2)}\n`);
  return pointer;
}

test("one request remains pinned to Release A while current moves to B", (t) => {
  const env = environment();
  t.after(() => cleanup(env.root));
  const first = publishRelease(env, { sourceCommit: "a".repeat(40), artifacts: artifacts("A") });
  const response = env.service.withPinnedRelease((context) => {
    const before = context.readMasterGraph("topology");
    publishRelease(env, { sourceCommit: "b".repeat(40), artifacts: artifacts("B") });
    const after = context.readMasterGraph("topology");
    return { before, after, documents: context.documentInventory.searchDocuments({ keyword: "a" }) };
  });
  assert.equal(response.before.releaseId, first.releaseId);
  assert.equal(response.after.releaseId, first.releaseId);
  assert.equal(response.before.nodes[0].label, "A");
  assert.equal(response.after.nodes[0].label, "A");
  assert.equal(response.documents.sourceCommit, "a".repeat(40));
  assert.deepEqual(response.documents.documents[0].relations, []);
});

test("formal relation selection excludes pending and consumer-ineligible assertions", (t) => {
  const env = environment();
  t.after(() => cleanup(env.root));
  const releaseArtifacts = artifacts("A");
  const graph = JSON.parse(releaseArtifacts[".ledger/master_graph.json"]);
  graph.connections.push({ ...graph.connections[0], edgeId: "pending", reviewStatus: "pending" });
  releaseArtifacts[".ledger/master_graph.json"] = json(graph);
  // K-P1-1（2026-09-10）：投影 fail-closed——无账本记录的边一律 pending，
  // 图内 approved 不再直接生效，edge-A 需账本批准方可进入正式拓扑。
  // K-P1-2（2026-09-10）：账本记录携带人工身份（reviewed 模式 APPROVAL_NOT_HUMAN 校验的数据源），
  // 形态对齐 review-routes 落盘格式（assertedBy 由服务端硬编码 actorType:"human"）。
  releaseArtifacts[".ledger/review_actions.json"] = json([
    {
      edgeId: "edge-A", action: "approved", decidedAt: "2026-09-06T00:00:00.000Z", reviewer: "local-architect",
      assertedBy: { actorId: "local-architect", actorType: "human" },
    },
  ]);
  publishRelease(env, { sourceCommit: "a".repeat(40), artifacts: releaseArtifacts });
  env.service.withPinnedRelease((context) => {
    assert.deepEqual(context.readMasterGraph("topology").connections.map((edge) => edge.edgeId), ["edge-A"]);
    assert.deepEqual(context.readMasterGraph("navigation").connections, []);
  });
});

test("missing, malformed and mutated current Release fail closed", (t) => {
  const env = environment();
  t.after(() => cleanup(env.root));
  assert.throws(() => env.service.withPinnedRelease(() => null), { code: "NO_CURRENT_RELEASE" });
  fs.writeFileSync(path.join(env.root, "current.json"), "{bad");
  assert.throws(() => env.service.withPinnedRelease(() => null), { code: "CURRENT_POINTER_INVALID" });
  fs.rmSync(path.join(env.root, "current.json"));
  const current = publishRelease(env, { sourceCommit: "a".repeat(40), artifacts: artifacts("A") });
  const graphPath = path.join(env.root, current.releaseId, "artifacts", ".ledger", "master_graph.json");
  fs.chmodSync(graphPath, 0o644);
  fs.appendFileSync(graphPath, " ");
  assert.throws(() => env.service.withPinnedRelease(() => null), { code: "CURRENT_RELEASE_INVALID" });
});

test("an incomplete Release document index is rejected before any formal query", (t) => {
  const env = environment();
  t.after(() => cleanup(env.root));
  const releaseArtifacts = artifacts("A");
  releaseArtifacts["indexes/document-search.json"] = json({ documents: [{ documentId: "incomplete" }] });
  publishRelease(env, { sourceCommit: "a".repeat(40), artifacts: releaseArtifacts });
  assert.throws(() => env.service.withPinnedRelease(() => null), { code: "RELEASE_DOCUMENT_INDEX_INVALID" });
});

test("article manifest index is consumed as a Release array without Vault fallback", (t) => {
  const env = environment();
  t.after(() => cleanup(env.root));
  publishRelease(env, { sourceCommit: "a".repeat(40), artifacts: artifacts("A") });
  const response = env.service.withPinnedRelease((context) => context.queryArticleManifests({ limit: 20, offset: 0 }));
  assert.equal(response.releaseId.startsWith("release-"), true);
  assert.equal(response.sourceCommit, "a".repeat(40));
  assert.deepEqual(response.items, []);
  assert.equal(response.summary.totalManifests, 0);
});

test("formal article catalog and association audit come from the same pinned Release", (t) => {
  const env = environment();
  t.after(() => cleanup(env.root));
  const releaseArtifacts = artifacts("A");
  const index = JSON.parse(releaseArtifacts["indexes/document-search.json"]);
  index.documents.push({
    documentId: "article:ART-1", documentKind: "standard-article", articleId: "ART-1",
    title: "Guide", sourcePath: "知识库/wiki/articles/ART-1/hash.md", sourceHash: "sha256:snapshot",
    ownerSourcePath: "知识库/raw/precleaned/guide.md", ownerSourceHash: "sha256:owner",
    product: "AnyShare", version: "7.0", body: "body", searchText: "guide", tokens: ["guide"],
    graphNodeIds: [], relations: [], componentIds: ["gateway"], associations: [{ component_id: "gateway" }],
  });
  releaseArtifacts["indexes/document-search.json"] = json(index);
  releaseArtifacts["知识库/TheSchema/article_associations.yaml"] = "schema_version: 1\ndecisions: []\n";
  const first = publishRelease(env, { sourceCommit: "a".repeat(40), artifacts: releaseArtifacts });
  const response = env.service.withPinnedRelease((context) => ({
    audit: context.readArticleAssociationAudit(),
    catalog: context.listFormalArticles(),
  }));
  assert.equal(response.catalog.releaseId, first.releaseId);
  assert.equal(response.catalog.sourceCommit, "a".repeat(40));
  assert.deepEqual(response.catalog.articles, [{
    articleId: "ART-1", title: "Guide", ownerSourcePath: "知识库/raw/precleaned/guide.md",
    sourceHash: "sha256:owner", product: "AnyShare", version: "7.0", componentIds: ["gateway"],
    associations: [{ component_id: "gateway" }],
  }]);
  assert.equal(response.audit, "schema_version: 1\ndecisions: []\n");
});

test("semantic projection follows Release configuration instead of filename order", (t) => {
  const env = environment();
  t.after(() => cleanup(env.root));
  const releaseArtifacts = artifacts("A");
  releaseArtifacts["知识库/architecture/Product/0.1.0/semantic_architecture.json"] = json({ product: "Product", version: "0.1.0", components: [{ id: "wrong" }] });
  publishRelease(env, { sourceCommit: "a".repeat(40), artifacts: releaseArtifacts });
  const selected = env.service.withPinnedRelease((context) => context.readSemanticArchitecture());
  assert.equal(selected.version, "1.0.0");
  assert.equal(selected.components[0].id, "a");
  assert.deepEqual(selected.dependencies, []);
});

test("formal inference is built from Release capabilities without mutable decision stores", (t) => {
  const env = environment();
  t.after(() => cleanup(env.root));
  const releaseArtifacts = artifacts("A");
  const graph = JSON.parse(releaseArtifacts[".ledger/master_graph.json"]);
  graph.nodes.push({ id: "c", label: "C" });
  graph.connections.push({
    ...graph.connections[0], edgeId: "edge-b-c", from: "b", to: "c",
    sourceRevision: "sha256:b", sourcePath: "知识库/wiki/entities/b.md", lineNumber: 4, targetIdentity: "c",
  });
  releaseArtifacts[".ledger/master_graph.json"] = json(graph);
  // K-P1-1：两条参与推断的边都需账本批准（无账本记录 → pending → 进不了正式拓扑）。
  // K-P1-2：记录携带人工身份（新账本落盘格式，reviewed 模式必需）。
  releaseArtifacts[".ledger/review_actions.json"] = json([
    {
      edgeId: "edge-A", action: "approved", decidedAt: "2026-09-06T00:00:00.000Z", reviewer: "local-architect",
      assertedBy: { actorId: "local-architect", actorType: "human" },
    },
    {
      edgeId: "edge-b-c", action: "approved", decidedAt: "2026-09-06T00:00:00.000Z", reviewer: "local-architect",
      assertedBy: { actorId: "local-architect", actorType: "human" },
    },
  ]);
  publishRelease(env, { sourceCommit: "a".repeat(40), artifacts: releaseArtifacts });
  const result = env.service.withPinnedRelease((context) => context.inferenceEngine.infer({
    graph: context.readMasterGraph("impact_analysis"), seedNodeIds: ["a"], maxInferenceDepth: 2,
  }));
  assert.ok(result.inferredEdges.some((edge) => edge.source === "a" && edge.target === "c" && edge.type === "DEPENDS_ON"));
  assert.equal(result.meta.decisionStatus, null);
  assert.equal(result.meta.writeAllowed, null);
});

test("missing Release projection identity fails closed", (t) => {
  const env = environment();
  t.after(() => cleanup(env.root));
  const releaseArtifacts = artifacts("A");
  delete releaseArtifacts["知识库/TheSchema/enums.yaml"];
  publishRelease(env, { sourceCommit: "a".repeat(40), artifacts: releaseArtifacts });
  assert.throws(() => env.service.withPinnedRelease(() => null), { code: "RELEASE_ARTIFACT_MISSING" });
});

// ── seq175（ADR057）：发布链账本合并点——账本随发布物打包，正式消费读取端经唯一合并出口
// mergeReviewStatus 合并（账本优先，图内状态仅作回退）。F3 后图字节不含裁决，未合并时已裁决边
// 结构性进不了正式拓扑（Lane B 实录：topology consumed 0 formal edges）。

function ledgerArtifacts(releaseArtifacts, decisions) {
  const graph = JSON.parse(releaseArtifacts[".ledger/master_graph.json"]);
  // K-P1-2 已落地（2026-09-10）：ledger-edge 不得残留夹具浅拷贝继承的身份——
  // 人工身份唯一来源是账本记录（review-routes 落盘 assertedBy → 投影传播到边顶层），
  // 本用例群因此才是真正的端到端证明（账本→投影→闸门）。
  const ledgerEdge = { ...graph.connections[0], edgeId: "ledger-edge", reviewStatus: "pending" };
  delete ledgerEdge.assertedBy;
  graph.connections.push(ledgerEdge);
  releaseArtifacts[".ledger/master_graph.json"] = json(graph);
  releaseArtifacts[".ledger/review_actions.json"] = json(decisions);
  return releaseArtifacts;
}

test("ledger-approved decision enters formal consumption from the Release ledger artifact", (t) => {
  const env = environment();
  t.after(() => cleanup(env.root));
  const releaseArtifacts = ledgerArtifacts(artifacts("A"), [
    {
      edgeId: "ledger-edge", action: "approved", decidedAt: "2026-09-06T00:00:00.000Z", reviewer: "local-architect",
      // K-P1-2：新账本落盘格式——人工身份由服务端硬编码（review-routes），经投影传播到边顶层。
      assertedBy: { actorId: "local-architect", actorType: "human" },
    },
  ]);
  publishRelease(env, { sourceCommit: "a".repeat(40), artifacts: releaseArtifacts });
  env.service.withPinnedRelease((context) => {
    const edges = context.readMasterGraph("topology").connections.map((edge) => edge.edgeId);
    assert.ok(edges.includes("ledger-edge"), `账本 approved 边必须进入正式拓扑: ${JSON.stringify(edges)}`);
    // K-P1-1 fail-closed：edge-A 无账本裁决 → pending → 不得进入正式拓扑（图内 approved 不再兜底）。
    assert.equal(edges.includes("edge-A"), false, `无账本裁决的边不得进入正式拓扑: ${JSON.stringify(edges)}`);
  });
});

// K-P1-2 已落地（2026-09-10）：本用例由「缺口登记负例」按验收开关约定**反转为正例**——
// 原 gap（账本记录无 assertedBy、投影不传播身份 → reviewed 边无人能批准的 fail-always 中间态）
// 由两处改动闭合：① review-routes 落盘 assertedBy（服务端硬编码 actorType:"human"）；
// ② review-status-projection 将账本身份传播到边顶层。账本→投影→闸门全链打通后，
// 人工 approved 的 reviewed 边理应进入正式拓扑。
test("ledger-approved decision with human identity enters formal consumption (K-P1-2 closed)", (t) => {
  const env = environment();
  t.after(() => cleanup(env.root));
  const releaseArtifacts = ledgerArtifacts(artifacts("A"), [
    {
      edgeId: "ledger-edge", action: "approved", decidedAt: "2026-09-06T00:00:00.000Z", reviewer: "local-architect",
      // 对齐 review-routes 真实落盘格式：身份由服务端写入账本，投影传播到边顶层供闸门读取。
      assertedBy: { actorId: "local-architect", actorType: "human" },
    },
  ]);
  publishRelease(env, { sourceCommit: "a".repeat(40), artifacts: releaseArtifacts });
  env.service.withPinnedRelease((context) => {
    const edges = context.readMasterGraph("topology").connections.map((edge) => edge.edgeId);
    assert.equal(
      edges.includes("ledger-edge"), true,
      `K-P1-2：账本人工 approved（含身份）的 reviewed 边必须进入正式拓扑: ${JSON.stringify(edges)}`,
    );
  });
});

// 对照负例（fail-closed 保持，2026-09-10）：账本记录缺 assertedBy（旧格式/异常记录）时，
// 投影不向边提供身份（且清除残留），reviewed 边仍被 APPROVAL_NOT_HUMAN 拒绝——
// 身份传播不弱化机器拦截：只有「真人工身份」放行，无身份一律挡在正式面外。
test("ledger-approved record without assertedBy still stays out of formal consumption", (t) => {
  const env = environment();
  t.after(() => cleanup(env.root));
  const releaseArtifacts = ledgerArtifacts(artifacts("A"), [
    { edgeId: "ledger-edge", action: "approved", decidedAt: "2026-09-06T00:00:00.000Z", reviewer: "local-architect" },
  ]);
  publishRelease(env, { sourceCommit: "a".repeat(40), artifacts: releaseArtifacts });
  env.service.withPinnedRelease((context) => {
    const edges = context.readMasterGraph("topology").connections.map((edge) => edge.edgeId);
    assert.equal(
      edges.includes("ledger-edge"), false,
      `账本 approved 但记录无人身身份 → 不得进入正式拓扑（fail-closed 保持）: ${JSON.stringify(edges)}`,
    );
  });
});

test("rejected ledger decision keeps the edge out of formal consumption", (t) => {
  const env = environment();
  t.after(() => cleanup(env.root));
  const releaseArtifacts = ledgerArtifacts(artifacts("A"), [
    { edgeId: "ledger-edge", action: "rejected", decidedAt: "2026-09-06T00:00:00.000Z", reviewer: "local-architect" },
  ]);
  publishRelease(env, { sourceCommit: "a".repeat(40), artifacts: releaseArtifacts });
  env.service.withPinnedRelease((context) => {
    const edges = context.readMasterGraph("topology").connections.map((edge) => edge.edgeId);
    assert.equal(edges.includes("ledger-edge"), false, "账本 rejected 边不得进入正式拓扑");
  });
});

// 负例（K-P1-1 fail-closed 语义，2026-09-10）：seq175 前发布的存量 Release 无账本工件
// → 视为空账本 → 投影全部回退 pending → 正式拓扑清空。图内 approved 不再兜底
// （原「approved 留、pending 剔」的迁移平滑回退已由 ADR057 第 3 点修订移除）。
test("pre-ledger Release without the ledger artifact fails closed: no edge enters formal consumption", (t) => {
  const env = environment();
  t.after(() => cleanup(env.root));
  const releaseArtifacts = ledgerArtifacts(artifacts("A"), []);
  delete releaseArtifacts[".ledger/review_actions.json"];
  publishRelease(env, { sourceCommit: "a".repeat(40), artifacts: releaseArtifacts });
  env.service.withPinnedRelease((context) => {
    const edges = context.readMasterGraph("topology").connections.map((edge) => edge.edgeId);
    assert.deepEqual(edges, []);
  });
});

test("malformed ledger artifact is treated as an empty ledger and fails closed instead of crashing formal consumption", (t) => {
  const env = environment();
  t.after(() => cleanup(env.root));
  const releaseArtifacts = ledgerArtifacts(artifacts("A"), [
    { edgeId: "ledger-edge", action: "approved", decidedAt: "2026-09-06T00:00:00.000Z" },
  ]);
  releaseArtifacts[".ledger/review_actions.json"] = "{corrupt\n"; // 非 JSON
  publishRelease(env, { sourceCommit: "a".repeat(40), artifacts: releaseArtifacts });
  env.service.withPinnedRelease((context) => {
    const edges = context.readMasterGraph("topology").connections.map((edge) => edge.edgeId);
    // K-P1-1：账本损坏 → 视为空账本 → 投影全 pending → fail-closed 清空（不崩溃、不放行）。
    assert.deepEqual(edges, []);
  });
});
