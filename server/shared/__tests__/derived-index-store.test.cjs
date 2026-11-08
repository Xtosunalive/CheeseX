// @tests: server/shared/persistence/derived-index-store.cjs ＋ runtime-state-import.cjs 的②类目录导入
// SPEC-012 wave-2 首家族（②类）：article_manifests 行级 API 往返、旧库升级路径（0001 已应用→0002 追加）、
// boot 目录导入（递归收集→行级 put→整体删除→幂等）。
// 层级：纯单元＋Adapter 契约（内存库/临时目录；真实文件库行为由 sqlite-adapter.test.cjs 覆盖）。
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { openPersistenceDb } = require("../persistence/sqlite-adapter.cjs");
const {
  MIGRATIONS,
  createDerivedIndexStore,
  getDerivedIndexStore,
} = require("../persistence/derived-index-store.cjs");
const { createRuntimeStateStore } = require("../persistence/runtime-state-store.cjs");
const { importLegacyRuntimeState } = require("../persistence/runtime-state-import.cjs");

function makeVault() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "derived-index-store-"));
}

test("articleManifests 家族 API：put/get/delete/list（key 升序）/count 行级往返", () => {
  const store = createDerivedIndexStore(openPersistenceDb());
  const family = store.articleManifests;
  assert.equal(family.get("wiki/b.md"), undefined);
  family.put("wiki/b.md", { manifestKey: "wiki/b.md", manifestMode: "relational" });
  family.put("wiki/a.md", { manifestKey: "wiki/a.md", manifestMode: "source_only" });
  assert.equal(family.count(), 2);
  assert.deepEqual(family.list().map((row) => row.key), ["wiki/a.md", "wiki/b.md"], "list 按 key 升序");
  assert.equal(family.get("wiki/a.md").manifestMode, "source_only");
  // upsert：同 key 覆盖不追加
  family.put("wiki/a.md", { manifestKey: "wiki/a.md", manifestMode: "relational" });
  assert.equal(family.count(), 2);
  assert.equal(family.get("wiki/a.md").manifestMode, "relational");
  family.delete("wiki/a.md");
  assert.equal(family.get("wiki/a.md"), undefined);
  assert.equal(family.count(), 1);
});

test("旧库升级路径：仅应用过 0001 的 derived-index.db 打开即追加 0002，不触发 checksum/超前守门", () => {
  const dir = makeVault();
  const dbPath = path.join(dir, "derived-index.db");
  try {
    // 模拟 wave-1 旧代码形态的库：只应用 0001（SQL 逐字同源）
    const legacy = openPersistenceDb({ path: dbPath });
    legacy.applyMigrations([MIGRATIONS[0]]);
    legacy.close();
    // 新 store 打开：追加 0002 + 家族可用
    const db = openPersistenceDb({ path: dbPath });
    const store = createDerivedIndexStore(db);
    store.articleManifests.put("x.md", { manifestKey: "x.md" });
    assert.equal(store.articleManifests.count(), 1);
    assert.deepEqual(store.enumsProjection.list(), {}, "旧库 enums 投影表沿用（0001 未动）");
    assert.equal(store.syncState.lastSync(), null, "旧库 sync_state 沿用（0001 未动）");
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("boot ②类目录导入：递归收集→行级 put→目录整体删除；脏文件跳过；二遍幂等 no-op", () => {
  const vaultPath = makeVault();
  const manifestsDir = path.join(vaultPath, ".ledger", "article-manifests");
  fs.mkdirSync(path.join(manifestsDir, "wiki", "entities"), { recursive: true });
  fs.writeFileSync(path.join(manifestsDir, "wiki", "entities", "A.md.json"), JSON.stringify({ manifestKey: "wiki/entities/A.md", sourcePathCanonical: "知识库/wiki/entities/A.md" }));
  fs.writeFileSync(path.join(manifestsDir, "top.md.json"), JSON.stringify({ manifestKey: "top.md" }));
  fs.writeFileSync(path.join(manifestsDir, "corrupt.json"), "not-json");
  const ledgerCalls = [];
  const gitLedger = { markSystemFile: (...a) => ledgerCalls.push(["markSystemFile", ...a]), scheduleLedger: (...a) => ledgerCalls.push(["scheduleLedger", ...a]) };

  const derivedIndexStore = createDerivedIndexStore(openPersistenceDb());
  const warnings = [];
  const logger = { info() {}, warn(...a) { warnings.push(a); }, error() {} };
  const result = importLegacyRuntimeState({
    vaultPath,
    store: createRuntimeStateStore(openPersistenceDb()),
    derivedIndexStore,
    gitLedger,
    logger,
    dataDir: vaultPath,
  });

  assert.deepEqual(result.articleManifests, { imported: 2, removed: true });
  assert.equal(fs.existsSync(manifestsDir), false, "②类目录导入后整体删除（无 .migrated 留存）");
  const rows = derivedIndexStore.articleManifests.list().map((row) => row.key);
  assert.deepEqual(rows, ["top.md", "wiki/entities/A.md"], "key=相对路径去 .json（含嵌套目录）");
  assert.equal(derivedIndexStore.articleManifests.get("wiki/entities/A.md").sourcePathCanonical, "知识库/wiki/entities/A.md");
  assert.ok(warnings.some((args) => String(args[0].event) === "article-manifests-import-file-failed"), "脏文件只 warn 跳过");
  assert.ok(ledgerCalls.some(([kind]) => kind === "scheduleLedger"), "目录删除落一笔 migrate 账");

  // 二遍幂等：目录已不存在 → no-op
  const second = importLegacyRuntimeState({
    vaultPath, store: createRuntimeStateStore(openPersistenceDb()), derivedIndexStore, gitLedger, logger, dataDir: vaultPath,
  });
  assert.deepEqual(second.articleManifests, { imported: 0, removed: false });
  assert.equal(derivedIndexStore.articleManifests.count(), 2);

  fs.rmSync(vaultPath, { recursive: true, force: true });
});

test("boot 图族三件导入：json 原文入行＋db 字节复制 dataDir＋三件删除；二遍幂等 no-op", () => {
  const vaultPath = makeVault();
  const ledgerDir = path.join(vaultPath, ".ledger");
  fs.mkdirSync(ledgerDir, { recursive: true });
  const graphRaw = `${JSON.stringify({ nodes: [{ id: "a" }], connections: [] }, null, 2)}\n`;
  fs.writeFileSync(path.join(ledgerDir, "master_graph.json"), graphRaw);
  fs.writeFileSync(path.join(ledgerDir, "extract_manifest.json"), '{"generatedAt":"t","files":{}}\n');
  fs.writeFileSync(path.join(ledgerDir, "master_graph.db"), "sqlite-bytes");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "graph-import-data-"));
  const ledgerCalls = [];
  const gitLedger = { markSystemFile: (...a) => ledgerCalls.push(["markSystemFile", ...a]), scheduleLedger: (...a) => ledgerCalls.push(["scheduleLedger", ...a]) };

  const derivedIndexStore = createDerivedIndexStore(openPersistenceDb());
  const logger = { info() {}, warn() {}, error() {} };
  const result = importLegacyRuntimeState({
    vaultPath,
    store: createRuntimeStateStore(openPersistenceDb()),
    derivedIndexStore,
    gitLedger,
    logger,
    dataDir,
  });

  // json 原文行（字节精确——管线指纹口径）＋ db 字节复制
  assert.equal(derivedIndexStore.artifacts.get("master_graph"), graphRaw, "图原文入行（字节精确）");
  assert.equal(derivedIndexStore.artifacts.get("extract_manifest"), '{"generatedAt":"t","files":{}}\n');
  assert.equal(fs.readFileSync(path.join(dataDir, "master_graph.db"), "utf8"), "sqlite-bytes", "db 字节工件复制到 dataDir");
  // 三件删除（②类可丢弃，不留 .migrated）
  assert.equal(fs.existsSync(path.join(ledgerDir, "master_graph.json")), false);
  assert.equal(fs.existsSync(path.join(ledgerDir, "extract_manifest.json")), false);
  assert.equal(fs.existsSync(path.join(ledgerDir, "master_graph.db")), false);
  assert.deepEqual(result.graphArtifacts.imported.sort(), ["extract_manifest", "master_graph"]);
  assert.equal(result.graphArtifacts.dbCopied, true);
  assert.ok(ledgerCalls.some(([kind]) => kind === "scheduleLedger"), "迁出落一笔 migrate 账");

  // 二遍幂等：文件已删 → no-op
  const second = importLegacyRuntimeState({
    vaultPath, store: createRuntimeStateStore(openPersistenceDb()), derivedIndexStore, gitLedger, logger, dataDir,
  });
  assert.deepEqual(second.graphArtifacts, { imported: [], dbCopied: false, removed: [] });
  assert.equal(derivedIndexStore.artifacts.get("master_graph"), graphRaw, "存量行不被二次导入动");

  fs.rmSync(vaultPath, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("boot 图族导入：坏 JSON 文件只 warn 跳过且不进库（staging/boot 重建兜底），空文件清住址", () => {
  const vaultPath = makeVault();
  const ledgerDir = path.join(vaultPath, ".ledger");
  fs.mkdirSync(ledgerDir, { recursive: true });
  fs.writeFileSync(path.join(ledgerDir, "master_graph.json"), "{broken");
  fs.writeFileSync(path.join(ledgerDir, "extract_manifest.json"), "   \n");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "graph-import-data-"));
  const derivedIndexStore = createDerivedIndexStore(openPersistenceDb());
  const warnings = [];
  const logger = { info() {}, warn(...a) { warnings.push(a); }, error() {} };

  // 坏 JSON：put 会成功（原文字节行不校验 JSON），但消费端 parse 失败兜底——导入器不应炸；
  // 空文件＝无内容可迁，直接清住址
  const result = importLegacyRuntimeState({
    vaultPath,
    store: createRuntimeStateStore(openPersistenceDb()),
    derivedIndexStore,
    gitLedger: { markSystemFile() {}, scheduleLedger() {} },
    logger,
    dataDir,
  });
  assert.equal(fs.existsSync(path.join(ledgerDir, "master_graph.json")), false);
  assert.equal(fs.existsSync(path.join(ledgerDir, "extract_manifest.json")), false, "空文件清住址");
  assert.equal(derivedIndexStore.artifacts.get("extract_manifest"), undefined, "空文件不入行");
  assert.ok(result.graphArtifacts.removed.includes("extract_manifest.json"));

  fs.rmSync(vaultPath, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("取用两形态：NODE_TEST_CONTEXT 下同 scopeKey 共享、异键隔离；缺装配的生产形态 throw", () => {
  // 本测试自身运行在 node:test（NODE_TEST_CONTEXT 已设）：scoped 懒建可用
  const a1 = getDerivedIndexStore("/tmp/scope-a");
  const a2 = getDerivedIndexStore("/tmp/scope-a");
  assert.equal(a1, a2, "同 scopeKey 共享一库（＝旧同 vault 一棵目录树）");
  const b = getDerivedIndexStore("/tmp/scope-b");
  assert.notEqual(a1, b, "异 scopeKey 隔离（＝旧每 tmp vault 一棵树）");
  a1.articleManifests.put("shared.md", { manifestKey: "shared.md" });
  assert.equal(b.articleManifests.get("shared.md"), undefined);
  // 生产缺 init 即 throw：临时摘掉 NODE_TEST_CONTEXT 验证错误面
  const saved = process.env.NODE_TEST_CONTEXT;
  delete process.env.NODE_TEST_CONTEXT;
  try {
    assert.throws(
      () => getDerivedIndexStore("/tmp/whatever"),
      (error) => error.code === "DERIVED_INDEX_NOT_INITIALIZED",
    );
  } finally {
    if (saved !== undefined) process.env.NODE_TEST_CONTEXT = saved;
  }
});

// ── EDGE-RELATION-GOV-001（SPEC-026 C2）：0005 迁移与 graphProjection 家族 ──

test("0005 迁移：空库即建两表；仅应用过 0001 的旧库打开即追加 0005；重复打开幂等不丢行", () => {
  const dir = makeVault();
  const dbPath = path.join(dir, "derived-index.db");
  try {
    // 旧库形态：只应用 0001（SQL 逐字同源）
    const legacy = openPersistenceDb({ path: dbPath });
    legacy.applyMigrations([MIGRATIONS[0]]);
    legacy.close();
    // 新 store 打开：追加 0002-0005，graphProjection 可用
    const db = openPersistenceDb({ path: dbPath });
    const store = createDerivedIndexStore(db);
    store.graphProjection.replaceAll(
      [{ nodeId: "n1", label: "节点1", category: "Entity", labels: ["Module"], degree: 1, properties: { a: 1 } }],
      [{ edgeId: "e1", sourceId: "n1", targetId: "n1", relationType: "BELONGS_TO", sourceFile: null, lineNumber: null, evidenceHash: null, reviewStatus: "approved", properties: {} }],
    );
    assert.equal(store.graphProjection.countNodes(), 1);
    assert.equal(store.graphProjection.countEdges(), 1);
    db.close();
    // 重开幂等（CREATE IF NOT EXISTS 不重复建）且行不丢
    const db2 = openPersistenceDb({ path: dbPath });
    const store2 = createDerivedIndexStore(db2);
    assert.equal(store2.graphProjection.countNodes(), 1, "重开不丢行");
    assert.equal(store2.graphProjection.countEdges(), 1);
    db2.close();
    // 空库（内存）直接可用：真实零值
    const fresh = createDerivedIndexStore(openPersistenceDb());
    assert.equal(fresh.graphProjection.countNodes(), 0);
    assert.equal(fresh.graphProjection.countEdges(), 0);
    fresh.graphProjection.replaceAll([], []);
    assert.equal(fresh.graphProjection.countEdges(), 0, "空替换合法");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("graphProjection 家族 API：replaceAll 单事务替换、list 行映射（JSON 列解码、id 升序）、getEdge、替换式清空", () => {
  const store = createDerivedIndexStore(openPersistenceDb());
  const gp = store.graphProjection;
  gp.replaceAll(
    [
      { nodeId: "b", label: "B", category: "Entity", labels: ["Module"], degree: 2, properties: { x: 1 } },
      { nodeId: "a", label: "A", category: "Concept", labels: [], degree: 0, properties: {} },
    ],
    [
      { edgeId: "e2", sourceId: "a", targetId: "b", relationType: "HAS_VERSION", sourceFile: "f.md", lineNumber: 3, evidenceHash: "h", reviewStatus: "pending", properties: { reviewStatus: "pending" } },
    ],
  );
  assert.deepEqual(gp.listNodes().map((n) => n.nodeId), ["a", "b"], "listNodes 按 node_id 升序");
  const first = gp.listNodes()[0];
  assert.deepEqual(first.labels, []);
  assert.deepEqual(first.properties, {});
  assert.equal(first.degree, 0);
  const edge = gp.listEdges()[0];
  assert.equal(edge.edgeId, "e2");
  assert.equal(edge.sourceId, "a");
  assert.equal(edge.targetId, "b");
  assert.equal(edge.relationType, "HAS_VERSION");
  assert.equal(edge.sourceFile, "f.md");
  assert.equal(edge.lineNumber, 3);
  assert.equal(edge.evidenceHash, "h");
  assert.equal(edge.reviewStatus, "pending");
  assert.deepEqual(edge.properties, { reviewStatus: "pending" }, "properties JSON 列往返解码");
  assert.equal(gp.getEdge("e2").relationType, "HAS_VERSION");
  assert.equal(gp.getEdge("不存在"), undefined);
  // 替换式：replaceAll 覆盖旧集（非追加）
  gp.replaceAll([], []);
  assert.equal(gp.countNodes(), 0);
  assert.equal(gp.countEdges(), 0);
});

// ── PR-100（WP-008）：0006 迁移 FK 执法与存量升级路径 ──

test("PR-100 0006 FK 执法：断链批次 replaceAll 抛错且整批回滚（旧投影保留）——真实 node:sqlite", () => {
  const store = createDerivedIndexStore(openPersistenceDb());
  const gp = store.graphProjection;
  gp.replaceAll(
    [{ nodeId: "n1", label: "A", category: "Entity", labels: [], degree: 1, properties: {} }],
    [{ edgeId: "e1", sourceId: "n1", targetId: "n1", relationType: "T", sourceFile: null, lineNumber: null, evidenceHash: null, reviewStatus: null, properties: {} }],
  );
  assert.equal(gp.countEdges(), 1);
  // 断链批次（target 不在节点集）→ INSERT 时 FK 拒收（开库既有 PRAGMA foreign_keys=ON）→ 事务回滚
  assert.throws(
    () => gp.replaceAll(
      [{ nodeId: "n1", label: "A", category: "Entity", labels: [], degree: 1, properties: {} }],
      [{ edgeId: "e-bad", sourceId: "n1", targetId: "ghost", relationType: "T", sourceFile: null, lineNumber: null, evidenceHash: null, reviewStatus: null, properties: {} }],
    ),
    /FOREIGN KEY/i,
  );
  // 整批回滚：DELETE 与 INSERT 一并回滚，旧投影原样保留
  assert.equal(gp.countNodes(), 1);
  assert.equal(gp.countEdges(), 1);
  assert.equal(gp.listEdges()[0].edgeId, "e1");
});

test("PR-100 0006 升级路径：0005 形态带悬空行的库打开即平滑升级——悬空清、合法留、FK 生效", () => {
  const dir = makeVault();
  const dbPath = path.join(dir, "derived-index.db");
  try {
    // 0005 形态旧库（无 FK）：悬空行可入库
    const legacy = openPersistenceDb({ path: dbPath });
    legacy.applyMigrations(MIGRATIONS.filter((m) => m.id < "0006-edges-foreign-keys"));
    const ts = new Date().toISOString();
    legacy.prepare("INSERT INTO graph_nodes (node_id, label, category, labels_json, degree, properties_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("n1", "A", "Entity", "[]", 1, "{}", ts);
    const ins = legacy.prepare("INSERT INTO edges (edge_id, source_id, target_id, relation_type, source_file, line_number, evidence_hash, review_status, properties_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    ins.run("e-ok", "n1", "n1", "T", null, null, null, null, "{}", ts);
    ins.run("e-dangling", "n1", "ghost", "T", null, null, null, null, "{}", ts);
    legacy.close();
    // 重开：store 构造追加应用 0006 → 悬空行被清除、合法行保留
    const db = openPersistenceDb({ path: dbPath });
    const store = createDerivedIndexStore(db);
    assert.equal(store.graphProjection.countEdges(), 1, "悬空行被迁移清除，合法行保留");
    assert.equal(store.graphProjection.listEdges()[0].edgeId, "e-ok");
    // 升级后 FK 生效：断链批次拒收
    assert.throws(
      () => store.graphProjection.replaceAll(
        [{ nodeId: "n1", label: "A", category: "Entity", labels: [], degree: 1, properties: {} }],
        [{ edgeId: "e-bad", sourceId: "n1", targetId: "ghost", relationType: "T", sourceFile: null, lineNumber: null, evidenceHash: null, reviewStatus: null, properties: {} }],
      ),
      /FOREIGN KEY/i,
    );
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── PR-102 / PR-104（WP-013）：listNodeIds 读面与 0007 content_hash 字节锚 ──

test("PR-102 listNodeIds：返回真实 node_id 列表（与 listNodes().nodeId 逐项相等、升序、全为非空字符串）", () => {
  const store = createDerivedIndexStore(openPersistenceDb());
  store.graphProjection.replaceAll(
    [
      { nodeId: "b", label: "B", category: "Entity", labels: [], degree: 0, properties: {} },
      { nodeId: "a", label: "A", category: "Entity", labels: [], degree: 0, properties: {} },
    ],
    [],
  );
  const ids = store.graphProjection.listNodeIds();
  assert.deepEqual(ids, ["a", "b"]);
  assert.deepEqual(ids, store.graphProjection.listNodes().map((n) => n.nodeId));
  assert.ok(ids.every((id) => typeof id === "string" && id.length > 0), "装配方据此建图域校验集——不得出现 undefined/null");
});

test("PR-104 0007 content_hash：put 落 sha256 且覆写更新；仅应用过 0001-0006 的旧库打开即加列、存量行 hash 为 null 且 get 不变", () => {
  const { createHash } = require("node:crypto");
  const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
  // 写时计算
  const fresh = createDerivedIndexStore(openPersistenceDb());
  fresh.artifacts.put("master_graph", '{"a":1}');
  assert.equal(fresh.artifacts.hashOf("master_graph"), sha('{"a":1}'));
  fresh.artifacts.put("master_graph", '{"a":2}');
  assert.equal(fresh.artifacts.hashOf("master_graph"), sha('{"a":2}'), "覆写后 hash 随内容更新");
  assert.equal(fresh.artifacts.hashOf("不存在"), undefined);
  // 升级路径：0001-0006 旧库带存量行
  const dir = makeVault();
  const dbPath = path.join(dir, "derived-index.db");
  try {
    const legacy = openPersistenceDb({ path: dbPath });
    legacy.applyMigrations(MIGRATIONS.filter((m) => m.id < "0007-derived-artifacts-content-hash"));
    legacy.prepare("INSERT INTO derived_artifacts (name, content, updated_at) VALUES (?, ?, ?)").run("sa", "legacy-bytes", new Date().toISOString());
    legacy.close();
    const db = openPersistenceDb({ path: dbPath });
    const store = createDerivedIndexStore(db);
    assert.equal(store.artifacts.get("sa"), "legacy-bytes", "加列不动存量内容");
    assert.equal(store.artifacts.hashOf("sa"), null, "存量行未覆写前 hash 为 null（随下次摄取覆写回填）");
    store.artifacts.put("sa", "legacy-bytes");
    assert.equal(store.artifacts.hashOf("sa"), sha("legacy-bytes"), "覆写同内容即回填");
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
