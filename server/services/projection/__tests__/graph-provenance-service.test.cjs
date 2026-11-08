// @contract ReviewStatus: "approved" | "pending" | "rejected"
// @see contracts/http-api.openapi.json#/components/schemas/ReviewStatus
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createGraphProvenanceService } = require("../graph-provenance-service.cjs");

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function createVault() {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "graph-provenance-"));
  const sourcePath = "知识库/wiki/entities/gateway.md";
  const absoluteSourcePath = path.join(vaultPath, sourcePath);
  fs.mkdirSync(path.dirname(absoluteSourcePath), { recursive: true });
  fs.writeFileSync(absoluteSourcePath, "# Gateway\n\n依赖::[[Auth]]\n");

  const sourceStat = fs.statSync(absoluteSourcePath, { bigint: true });
  // SPEC-012 wave-2 图族：图/清单真身迁 derived-index.db——种子种 store 原文行（scopeKey=vault，
  // 测试懒建形态；字节与旧文件种子同构，hash 断言口径不变）
  const { getDerivedIndexStore } = require("../../../shared/persistence/derived-index-store.cjs");
  const store = getDerivedIndexStore(vaultPath);
  store.artifacts.put("extract_manifest", `${JSON.stringify({
    version: 1,
    generatedAt: "2026-07-19T08:00:00.000Z",
    files: {
      [sourcePath]: {
        mtime_ns: Number(sourceStat.mtimeNs),
        size: Number(sourceStat.size),
      },
    },
  }, null, 2)}\n`);

  const graph = {
    _format_version: "1.0",
    _vault_extract_applied_at: "2026-07-19T08:00:00.000Z",
    nodes: [],
    connections: [],
  };
  const graphRaw = `${JSON.stringify(graph, null, 2)}\n`;
  store.artifacts.put("master_graph", graphRaw);
  // SPEC-012：pipeline_version 种子改经 runtime-state store（读侧已迁库）
  const { getRuntimeStateStore } = require("../../../shared/persistence/runtime-state-store.cjs");
  getRuntimeStateStore(vaultPath).pipeline.versionPut({
    pipeline_run_id: "run-1",
    master_graph_sha256: sha256(graphRaw).replace(/^sha256:/, ""),
    generated_at: "2026-07-19T08:00:01.000Z",
  });

  return { vaultPath, sourcePath, absoluteSourcePath, store };
}

test("reports graph and tracked source as fresh when pipeline fingerprints match", () => {
  const fixture = createVault();
  const service = createGraphProvenanceService({ vaultPath: fixture.vaultPath });
  const source = service.inspectSource(fixture.sourcePath);
  const graph = service.inspectGraph([fixture.sourcePath]);

  assert.match(source.contentHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(service.inspectSource("wiki/entities/gateway.md").sourcePath, fixture.sourcePath);
  assert.equal(source.freshness.status, "fresh");
  assert.match(graph.contentHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(graph.freshness.status, "fresh");
});

test("marks the relation source stale after the tracked file changes", () => {
  const fixture = createVault();
  const service = createGraphProvenanceService({ vaultPath: fixture.vaultPath });
  const expectedHash = service.inspectSource(fixture.sourcePath).contentHash;
  fs.appendFileSync(fixture.absoluteSourcePath, "连接::[[Audit]]\n");

  const source = service.inspectSource(fixture.sourcePath, expectedHash);
  const graph = service.inspectGraph([fixture.sourcePath]);

  assert.equal(source.freshness.status, "stale");
  assert.deepEqual(source.freshness.changedFields, ["sourceHash", "sourceRevision"]);
  assert.equal(graph.freshness.status, "stale");
  assert.deepEqual(graph.freshness.changedFields, [`sourceRevision:${fixture.sourcePath}`]);
});

test("marks the graph stale when its bytes differ from pipeline_version", () => {
  const fixture = createVault();
  // SPEC-012 wave-2：图真身在 store——字节变更是改库内原文行（追加空格，与旧改文件字节同构）
  const raw = fixture.store.artifacts.get("master_graph");
  fixture.store.artifacts.put("master_graph", `${raw} `);
  const graph = createGraphProvenanceService({ vaultPath: fixture.vaultPath }).inspectGraph([]);

  assert.equal(graph.freshness.status, "stale");
  assert.deepEqual(graph.freshness.changedFields, ["sourceHash"]);
});

test("requires complete source or derived lineage for approved relations", () => {
  const fixture = createVault();
  const service = createGraphProvenanceService({ vaultPath: fixture.vaultPath });
  const graph = {
    connections: [
      { edgeId: "source-complete", from: "a", to: "b", reviewStatus: "approved", sourceFile: fixture.sourcePath, sourceHash: "sha256:source", lineNumber: 3, evidenceHash: "evidence" },
      { edgeId: "source-missing", from: "a", to: "c", reviewStatus: "approved", sourceFile: fixture.sourcePath },
      { edgeId: "derived-complete", from: "b", to: "c", reviewStatus: "approved", properties: { ruleId: "rule-1", ruleRevision: "revision-1", inputCoordinates: ["relation:source-complete"] } },
      { edgeId: "derived-missing", from: "c", to: "d", reviewStatus: "approved", properties: { source: "auto-discovered" } },
      { edgeId: "untrusted", from: "d", to: "e", reviewStatus: "rejected" },
    ],
  };

  assert.deepEqual(service.collectMissingRelationLineage(graph), [
    { edgeId: "source-missing", trusted: true, valid: false, lineageKind: "source", sourcePath: fixture.sourcePath, missingFields: ["sourceHash", "lineNumber", "evidenceHash"] },
    { edgeId: "derived-missing", trusted: true, valid: false, lineageKind: "derived", sourcePath: "", missingFields: ["ruleId", "ruleRevision", "inputCoordinates"] },
  ]);
});
