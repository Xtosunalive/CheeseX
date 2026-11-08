// @contract ReviewStatus: "approved" | "pending" | "rejected"
// @see contracts/http-api.openapi.json#/components/schemas/ReviewStatus
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");

const { createArchitectureVersionService } = require("../architecture-version-service.cjs");

function sha256(raw) {
  return `sha256:${crypto.createHash("sha256").update(raw).digest("hex")}`;
}

function fixture() {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "architecture-version-"));
  const relativePath = "知识库/architecture/AnyShare/7.0/architecture-version.snapshot.json";
  const absolutePath = path.join(vaultPath, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const snapshot = {
    schema_version: 1, product: "AnyShare", version: "7.0", source_mode: "frozen",
    components: [
      { id: "gateway", label: "Gateway", layer: "gateway", category: "服务", arch_role: "entry" },
      { id: "storage", label: "Storage", layer: "data", category: "存储" },
    ],
    dependencies: [{ from: "gateway", to: "storage", relationType: "DEPENDS_ON" }],
    documents: [{ documentId: "article:ART-001", articleId: "ART-001", title: "Guide", sourcePath: "知识库/raw/precleaned/guide.md" }],
  };
  const raw = JSON.stringify(snapshot, null, 2) + "\n";
  fs.writeFileSync(absolutePath, raw, "utf8");
  const registry = {
    products: {
      AnyShare: { versions: [
        { id: "7.0", label: "AnyShare 7.0", status: "released", snapshot: { path: relativePath, sha256: sha256(raw), generated_at: "2026-07-01T00:00:00.000Z" } },
        { id: "7.1", label: "AnyShare 7.1", status: "draft", snapshot: null },
      ] },
    },
  };
  return { vaultPath, registry, absolutePath };
}

function createService(data, extra = {}) {
  return createArchitectureVersionService({
    vaultPath: data.vaultPath,
    getRegistry: () => data.registry,
    projectVersion: (_product, version) => ({
      product: "AnyShare", _generated_for_version: version,
      components: [
        { id: "gateway", label: "Gateway", layer: "edge", category: "服务", arch_role: "entry" },
        { id: "audit", label: "Audit", layer: "service", category: "服务" },
      ],
      dependencies: [{ source: "gateway", target: "audit", type: "DEPENDS_ON" }],
    }),
    searchDocuments: ({ version }) => ({ documents: version === "7.1" ? [{ documentId: "article:ART-002", articleId: "ART-002", title: "Audit Guide", sourcePath: "知识库/raw/precleaned/audit.md" }] : [] }),
    ...extra,
  });
}

test("lists registered product versions with snapshot or live source", (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.vaultPath, { recursive: true, force: true }));
  assert.deepStrictEqual(createService(data).listVersions().items.map((item) => [item.version, item.sourceMode]), [["7.0", "snapshot"], ["7.1", "live"]]);
});

test("reads released snapshots and projects draft versions live", (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.vaultPath, { recursive: true, force: true }));
  const service = createService(data);
  const released = service.getVersion("AnyShare", "7.0");
  const draft = service.getVersion("AnyShare", "7.1");
  assert.strictEqual(released.sourceMode, "snapshot");
  assert.strictEqual(released.lineage.source.kind, "version-snapshot");
  assert.strictEqual(released.lineage.freshness.status, "fresh");
  assert.strictEqual(released.components[0].role, "entry");
  assert.strictEqual(released.documents[0].articleId, "ART-001");
  assert.strictEqual(draft.sourceMode, "live");
  assert.strictEqual(draft.lineage.source.kind, "live-projection");
  assert.strictEqual(draft.lineage.source.contentHash, null);
  assert.strictEqual(draft.lineage.freshness.status, "unknown");
  assert.strictEqual(draft.documents[0].articleId, "ART-002");
});

test("compares components, relations, and documents by stable keys", (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.vaultPath, { recursive: true, force: true }));
  const result = createService(data).compare("AnyShare", "7.0", "7.1");
  assert.deepStrictEqual(result.components.added.map((item) => item.id), ["audit"]);
  assert.deepStrictEqual(result.components.removed.map((item) => item.id), ["storage"]);
  assert.deepStrictEqual(result.components.changed[0].changes.map((item) => item.field), ["layer"]);
  assert.strictEqual(result.relations.added[0].key, "dep:7:gateway|10:DEPENDS_ON|5:audit"); // WP-051：身份入口长度前缀编码（React key/等值语义不变）
  assert.strictEqual(result.relations.added[0].sourceLabel, "Gateway");
  assert.strictEqual(result.relations.added[0].targetLabel, "Audit");
  assert.strictEqual(result.relations.removed[0].key, "dep:7:gateway|10:DEPENDS_ON|7:storage");
  assert.strictEqual(result.relations.removed[0].targetLabel, "Storage");
  assert.deepStrictEqual(result.documents.added.map((item) => item.articleId), ["ART-002"]);
  assert.deepStrictEqual(result.documents.removed.map((item) => item.articleId), ["ART-001"]);
  assert.strictEqual(result.lineage.source.kind, "version-state-comparison");
  assert.strictEqual(result.lineage.source.contentHash, null);
  assert.strictEqual(result.lineage.freshness.status, "unknown");
});

test("rejects a released snapshot whose bytes no longer match the registry hash", (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.vaultPath, { recursive: true, force: true }));
  fs.appendFileSync(data.absolutePath, " ", "utf8");
  assert.throws(() => createService(data).getVersion("AnyShare", "7.0"), { code: "STALE_VERSION_SNAPSHOT" });
});

test("marks an existing released snapshot without a registry hash as unknown", (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.vaultPath, { recursive: true, force: true }));
  delete data.registry.products.AnyShare.versions[0].snapshot.sha256;
  const released = createService(data).getVersion("AnyShare", "7.0");
  assert.strictEqual(released.lineage.source.contentHash, null);
  assert.strictEqual(released.lineage.freshness.status, "unknown");
});

test("applies the formal relation policy to released snapshots and live projections", (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.vaultPath, { recursive: true, force: true }));
  const seen = [];
  const service = createService(data, {
    filterRelations(relations) {
      seen.push(relations);
      return relations.filter((relation) => relation.reviewStatus === "approved");
    },
  });
  assert.deepStrictEqual(service.getVersion("AnyShare", "7.0").relations, []);
  assert.deepStrictEqual(service.getVersion("AnyShare", "7.1").relations, []);
  assert.strictEqual(seen.length, 2);
});
