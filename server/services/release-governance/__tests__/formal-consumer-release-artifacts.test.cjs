const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const YAML = require("yaml");

const { collectCompleteArtifacts } = require("../complete-release-artifact-service.cjs");
const { getRuntimeStateStore } = require("../../../shared/persistence/runtime-state-store.cjs");
const { getDerivedIndexStore } = require("../../../shared/persistence/derived-index-store.cjs");

function write(root, relative, value) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, value);
}

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "formal-release-artifacts-"));
  const source = path.resolve(__dirname, "../../../../test/fixtures/minimal-vault");
  fs.cpSync(source, root, { recursive: true });
  // SPEC-012 wave-2 图族：图/清单真身迁 derived-index.db、master_graph.db 字节工件住 repo 侧
  // data/——种子改种 store（scopeKey=root，测试懒建形态）＋临时 KB_DATA_DIR（env 随测试
  // 进程生命周期，requiredDataArtifactFile 经 resolveDataDir 读到）
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "formal-release-data-"));
  process.env.KB_DATA_DIR = dataDir;
  write(root, "知识库/wiki/entities/fixture-component.md", "---\ntitle: Fixture Component\narchitecture-node-id: fixture-component\narch_component: true\nmodule: [fixture-module, shared-module]\ndate: 2026-10-08\nupdated: 2026-10-08\nstatus: 灰度\ntags: [entity]\n---\n\n# Fixture Component\n");
  write(root, "知识库/wiki/entities/incomplete-component.md", "---\ntitle: Incomplete Component\narchitecture-node-id: incomplete-component\narch_component: true\ndate: 2026-10-08\nupdated: 2026-10-08\nstatus: 灰度\ntags: [entity]\n---\n\n# Incomplete Component\n");
  write(dataDir, "master_graph.db", "sqlite-fixture");
  const store = getDerivedIndexStore(root);
  store.artifacts.put("extract_manifest", '{"generatedAt":"volatile","files":{}}\n');
  const article = "---\narticle_id: formal-article\ntitle: Formal Article\nproduct: FixtureProduct\nversion: 1.0.0\nmodule: fixture-module\n---\n\nSearchable release body.\n";
  const articleHash = sha256(article);
  const articlePath = `知识库/wiki/articles/formal-article/${articleHash}.md`;
  write(root, articlePath, article);
  write(root, "知识库/raw/precleaned/formal-article.md", article);

  const snapshot = '{"product":"FixtureProduct","version":"1.0.0","components":[],"dependencies":[]}\n';
  const snapshotPath = "知识库/architecture/FixtureProduct/1.0.0/release-snapshot.json";
  write(root, snapshotPath, snapshot);
  const versionsPath = path.join(root, "知识库/TheSchema/versions.yaml");
  const versions = YAML.parse(fs.readFileSync(versionsPath, "utf8"));
  versions.products.FixtureProduct.versions[0].status = "released";
  versions.products.FixtureProduct.versions[0].snapshot = { path: snapshotPath, sha256: `sha256:${sha256(snapshot)}`, generated_at: "2026-08-10T00:00:00.000Z" };
  write(root, "知识库/TheSchema/versions.yaml", YAML.stringify(versions));

  const sharedNode = { id: "shared-service", label: "Shared Service" };
  write(root, "知识库/architecture/FixtureProduct/1.0.0/semantic_architecture.json", JSON.stringify({ generatedAt: "first", nodes: [sharedNode], connections: [] }));
  write(root, "知识库/architecture/FixtureProduct/2.0.0/semantic_architecture.json", JSON.stringify({ generatedAt: "second", nodes: [sharedNode], connections: [] }));
  write(root, "知识库/architecture/FixtureProduct/2.0.0/architecture_layout.json", JSON.stringify({ generatedAt: "second", positions: { "shared-service": { x: 1, y: 2 } } }));
  store.artifacts.put("master_graph", JSON.stringify({
    generatedAt: "volatile",
    nodes: [sharedNode],
    connections: [{ edgeId: "edge-1", from: "shared-service", to: "target", relationType: "DEPENDS_ON", sourceFile: "知识库/wiki/entities/fixture-component.md", sourceHash: "sha256:source", lineNumber: 8, evidenceHash: "sha256:evidence" }],
  }));
  return { articleHash, articlePath, root, snapshotPath, store, dataDir };
}

test("complete artifacts contain deterministic formal search, schema, version and projection indexes", (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.root, { recursive: true, force: true }));

  const first = collectCompleteArtifacts(data.root);
  const second = collectCompleteArtifacts(data.root);
  assert.deepEqual(Object.keys(first).sort(), Object.keys(second).sort());
  for (const name of Object.keys(first)) assert.equal(first[name].equals(second[name]), true, name);
  assert.equal(
    first["知识库/TheSchema/article_associations.yaml"].toString("utf8"),
    "schema_version: 1\ndecisions: []\n",
  );

  const search = JSON.parse(first["indexes/document-search.json"]);
  const standard = search.documents.find((document) => document.articleId === "formal-article");
  assert.equal(standard.body, "Searchable release body.");
  assert.equal(standard.ownerSourcePath, "知识库/raw/precleaned/formal-article.md");
  assert.equal(standard.ownerSourceHash, `sha256:${data.articleHash}`);
  assert.ok(standard.tokens.includes("searchable"));
  assert.equal(standard.module, "fixture-module");
  const entity = search.documents.find((document) => document.architectureNodeId === "fixture-component");
  assert.deepEqual(entity.module, ["fixture-module", "shared-module"]);

  const capabilities = JSON.parse(first["schema/ontology-capabilities.json"]);
  assert.equal(capabilities.relations.length, 16);
  assert.ok(capabilities.relations.every((relation) => relation.assertionPolicies.length > 0));
  assert.ok(capabilities.relations.every((relation) => typeof relation.registeredForInference === "boolean"));
  assert.ok(Array.isArray(capabilities.inferenceRules));
  const versions = JSON.parse(first["schema/version-registry.json"]);
  assert.equal(versions.products.FixtureProduct.versions[0].status, "released");
  assert.equal(first[data.snapshotPath].toString("utf8"), fs.readFileSync(path.join(data.root, data.snapshotPath), "utf8"));

  const semantic = JSON.parse(first["indexes/semantic-projections.json"]);
  assert.equal(semantic.entities.filter((entity) => entity.entityId === "shared-service").length, 1);
  assert.equal(semantic.entities.find((entity) => entity.entityId === "shared-service").projectionPaths.length, 2);
  const provenance = JSON.parse(first["indexes/provenance.json"]);
  assert.equal(provenance.relations[0].sourcePath, "知识库/wiki/entities/fixture-component.md");
});

test("实体缺项可留在库内，但不能进入正式 Release；补齐后可重试", (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.root, { recursive: true, force: true }));
  const source = "知识库/wiki/entities/fixture-component.md";
  const original = fs.readFileSync(path.join(data.root, source), "utf8");
  write(data.root, source, original.replace("tags: [entity]\n", ""));
  assert.throws(() => collectCompleteArtifacts(data.root), (error) => error.code === "ENTITY_COMPLIANCE_BLOCKED"
    && error.details.pending.some((item) => item.sourcePath === source && item.rules.some((rule) => rule.ruleId === "F16")));
  write(data.root, source, original);
  assert.ok(collectCompleteArtifacts(data.root)["indexes/document-search.json"]);
});

test("version snapshot hash mismatch blocks the Release artifact set", (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.root, { recursive: true, force: true }));
  fs.appendFileSync(path.join(data.root, data.snapshotPath), " ");
  assert.throws(() => collectCompleteArtifacts(data.root), { code: "RELEASE_ARTIFACT_HASH_MISMATCH" });
});

// 投影身份成对护栏（ADR-009 消费端契约的上游执法）：源词表「已设产品、版本待冻结」是合法中间态，
// 但打包是半填态进入 Release 的唯一通道——半填 Release 出生即非法（消费端 fail-closed，全站 formal 页面 500），
// 必须在铸版时刻拦下（2026-11-01 验收实测：product=测试产品/version="" 铸版成功后全站 formal 页 500）。
function seedProjection(data, projection) {
  const enumsPath = path.join(data.root, "知识库/TheSchema/enums.yaml");
  const enums = YAML.parse(fs.readFileSync(enumsPath, "utf8"));
  enums.architecture_projection = projection;
  fs.writeFileSync(enumsPath, YAML.stringify(enums));
}

test("product-without-version projection identity blocks packing with actionable guidance", (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.root, { recursive: true, force: true }));
  seedProjection(data, { product: "FixtureProduct", version: "" });
  assert.throws(() => collectCompleteArtifacts(data.root), (error) => {
    assert.equal(error.code, "RELEASE_PROJECTION_IDENTITY_INVALID");
    assert.equal(error.details.product, "FixtureProduct");
    assert.equal(error.details.version, null);
    assert.match(error.message, /版本注册表/);
    return true;
  });
});

test("version-without-product projection identity blocks packing symmetrically", (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.root, { recursive: true, force: true }));
  seedProjection(data, { product: "", version: "1.0.0" });
  assert.throws(() => collectCompleteArtifacts(data.root), (error) => {
    assert.equal(error.code, "RELEASE_PROJECTION_IDENTITY_INVALID");
    assert.equal(error.details.product, null);
    assert.equal(error.details.version, "1.0.0");
    return true;
  });
});

test("paired projection identity keeps packing (mounted path unaffected)", (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.root, { recursive: true, force: true }));
  seedProjection(data, { product: "FixtureProduct", version: "1.0.0" });
  const artifacts = collectCompleteArtifacts(data.root);
  assert.ok(artifacts["indexes/document-search.json"], "成对态必须照常铸版");
});

test("invalid governed document blocks the complete Release instead of disappearing", (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.root, { recursive: true, force: true }));
  write(data.root, "知识库/wiki/entities/invalid.md", "---\nlabels: [unterminated\n---\n");
  assert.throws(() => collectCompleteArtifacts(data.root), { code: "RELEASE_DOCUMENT_INDEX_INVALID" });
});

test("formal article membership comes from the Git tree and ignores workflow JSON", (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.root, { recursive: true, force: true }));
  write(data.root, ".ledger/article-upload-tasks.json", "not-json\n");
  const search = JSON.parse(collectCompleteArtifacts(data.root)["indexes/document-search.json"]);
  assert.ok(search.documents.some((document) => document.articleId === "formal-article"));
});

test("ambiguous formal article versions in one Git tree fail closed", (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.root, { recursive: true, force: true }));
  write(data.root, "知识库/wiki/articles/formal-article/second.md", "---\narticle_id: formal-article\ntitle: Second\n---\n\nSecond body.\n");
  assert.throws(() => collectCompleteArtifacts(data.root), { code: "DUPLICATE_DOCUMENT_ID" });
});

test("unknown relation type edge blocks the complete Release instead of entering artifacts", (t) => {
  const data = fixture();
  t.after(() => { fs.rmSync(data.root, { recursive: true, force: true }); fs.rmSync(data.dataDir, { recursive: true, force: true }); });
  // 红灯（S6）：FLIES_TO 未在 ontology relation_types 注册，构建期必须阻断，不得进入 Release 产物
  //（SPEC-012 wave-2：图真身在 store——改库内原文行）
  const masterGraph = JSON.parse(data.store.artifacts.get("master_graph"));
  masterGraph.connections.push({
    edgeId: "edge-unknown-type", from: "shared-service", to: "target",
    relationType: "FLIES_TO", sourceFile: "知识库/wiki/entities/fixture-component.md",
    sourceHash: "sha256:source", lineNumber: 9, evidenceHash: "sha256:evidence",
  });
  data.store.artifacts.put("master_graph", JSON.stringify(masterGraph));
  assert.throws(() => collectCompleteArtifacts(data.root), (error) => {
    assert.equal(error.code, "RELATION_TYPE_UNREGISTERED");
    assert.ok(Array.isArray(error.details?.unknownEdges), "details.unknownEdges 应列出未注册边");
    assert.equal(error.details.unknownEdges[0].relationType, "FLIES_TO");
    return true;
  });
});

// seq175（ADR057）：裁决账本随发布物打包——SPEC-012 WP-A 后账本住 runtime-state store，
// 构建期由 store 物化为工件内 .ledger/review_actions.json（与 review-action-store 写侧、
// review-status-projection 读侧对齐），并进入 provenance inputs。
test("review actions ledger ships in the Release artifact set and provenance inputs", (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.root, { recursive: true, force: true }));
  getRuntimeStateStore(data.root).review.append(
    { edgeId: "edge-1", source: "shared-service", target: "target-node", action: "approved", decidedAt: "2026-09-06T00:00:00.000Z", reviewer: "local-architect" },
    "2026-09-06T00:00:00.000Z",
  );
  const artifacts = collectCompleteArtifacts(data.root);
  const ledger = JSON.parse(artifacts[".ledger/review_actions.json"]);
  assert.equal(Array.isArray(ledger), true);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].edgeId, "edge-1");
  assert.equal(ledger[0].decidedAt, "2026-09-06T00:00:00.000Z");
  const provenance = JSON.parse(artifacts["indexes/provenance.json"]);
  const ledgerInput = provenance.inputs.find((input) => input.sourcePath === ".ledger/review_actions.json");
  assert.ok(ledgerInput, "provenance inputs 必须包含 review_actions 账本");
  assert.match(ledgerInput.hash, /^sha256:[0-9a-f]{64}$/);
});

// seq175（ADR057）：零裁决 Vault 无账本文件——按 article_associations.yaml 先例合成显式空账本，
// 保证账本作为发布物输入无条件存在（消费端回退语义据此可区分「无账本」与「空账本」）。
test("vault without review decisions ships an explicit empty ledger in the Release", (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.root, { recursive: true, force: true }));
  assert.equal(fs.existsSync(path.join(data.root, ".ledger", "review_actions.json")), false);
  const artifacts = collectCompleteArtifacts(data.root);
  assert.deepEqual(JSON.parse(artifacts[".ledger/review_actions.json"]), []);
  const provenance = JSON.parse(artifacts["indexes/provenance.json"]);
  assert.ok(provenance.inputs.some((input) => input.sourcePath === ".ledger/review_actions.json"));
});

// SPEC-012 wave-2：article-manifests 真身迁 derived-index.db——打包从 store 行集物化进 bundle
//（工件内路径 .ledger/article-manifests/<key>.json 布局不变，抖动键剥离沿旧盘读口径）。
test("article manifests materialize from the derived-index store into Release artifacts and indexes", (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.root, { recursive: true, force: true }));
  getDerivedIndexStore(data.root).articleManifests.put("wiki/entities/fixture-component.md", {
    generatedAt: "volatile",
    manifestKey: "wiki/entities/fixture-component.md",
    sourcePathCanonical: "知识库/wiki/entities/fixture-component.md",
    manifestMode: "source_only",
  });
  const artifacts = collectCompleteArtifacts(data.root);
  const name = ".ledger/article-manifests/wiki/entities/fixture-component.md.json";
  const materialized = JSON.parse(artifacts[name]);
  assert.equal(materialized.sourcePathCanonical, "知识库/wiki/entities/fixture-component.md");
  assert.equal(materialized.generatedAt, undefined, "抖动键（generatedAt）必须剥离——发布物确定性口径");
  const index = JSON.parse(artifacts["indexes/article-manifests.json"]);
  assert.equal(index.length, 1);
  assert.equal(index[0].name, name);
  assert.equal(index[0].hash, `sha256:${crypto.createHash("sha256").update(artifacts[name]).digest("hex")}`);
  const statistics = JSON.parse(artifacts["statistics/graph-statistics.json"]);
  assert.equal(statistics.articleManifestCount, 1);
});

// 2026-11-01 半成品区过滤批根因修复（「环境启动说明咋还在呢」）：
//   ①正式文章快照家族（FORMAL_ROOT/**/*.md）随发布物打包——此前只在文章发布链显式注入，
//     人工铸版链（publishCurrent/WP-017）结构上带不上 → listCurrentStandardVersions 找不到
//     FORMAL_ROOT 文件 → 发布识别恒 false；
//   ②filesUnder 禁扫库内 .releases/（发布物住址）——「Release 套 Release」嵌套垃圾件源头掐断
//    （4c19ed37 实录 30 条嵌套件）。
test("formal article snapshots ship in the artifact set from the git tree", (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.root, { recursive: true, force: true }));
  const artifacts = collectCompleteArtifacts(data.root);
  assert.ok(artifacts[data.articlePath], "FORMAL_ROOT 下快照必须入产物集（原始字节）");
  assert.equal(
    artifacts[data.articlePath].toString("utf8"),
    fs.readFileSync(path.join(data.root, data.articlePath), "utf8"),
    "字节口径＝盘上原文件（与 publishArticle 显式注入同源）",
  );
});

test("vault-side .releases directory never enters the artifact set", (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(data.root, ".releases", "release-old", "artifacts", "知识库", "wiki", "articles"), { recursive: true });
  fs.writeFileSync(path.join(data.root, ".releases", "release-old", "artifacts", "知识库", "wiki", "articles", "ghost.md"), "ghost");
  const artifacts = collectCompleteArtifacts(data.root);
  assert.equal(Object.keys(artifacts).some((name) => name.startsWith(".releases/")), false, ".releases 不入产物面");
  assert.equal(artifacts[data.articlePath] !== undefined, true, "顶层真身照常收集");
});
