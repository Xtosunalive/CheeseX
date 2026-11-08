const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const YAML = require("yaml");
const { createDependencyImpactPreviewService } = require("../dependency-impact-preview-service.cjs");
const { listDependencies, validateDependencyPayload } = require("../dependencies-write-service.cjs");

function sha(raw) { return crypto.createHash("sha256").update(raw).digest("hex"); }

function fixture() {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "dependency-preview-"));
  const schema = path.join(vaultPath, "知识库", "TheSchema");
  const architecture = path.join(vaultPath, "知识库", "architecture", "AnyShare", "master");
  const anyshare = path.join(vaultPath, ".ledger");
  fs.mkdirSync(schema, { recursive: true });
  fs.mkdirSync(architecture, { recursive: true });
  fs.mkdirSync(anyshare, { recursive: true });
  fs.writeFileSync(path.join(schema, "ontology.yaml"), YAML.stringify({ relation_types: { DEPENDS_ON: { label_cn: "依赖", versionable: true } } }));
  fs.writeFileSync(path.join(schema, "enums.yaml"), YAML.stringify({ architecture_projection: { product: "AnyShare", version: "master" } }));
  fs.writeFileSync(path.join(schema, "dependencies.yaml"), YAML.stringify({ dependencies: [{ source: "client", target: "gateway", type: "DEPENDS_ON", since: "1.0", until: "2.0" }] }));
  fs.writeFileSync(path.join(architecture, "semantic_architecture.json"), JSON.stringify({ components: [{ id: "client" }, { id: "gateway" }] }));
  // SPEC-012 wave-2 图族：主图真身迁 derived-index.db——种子种 store（scopeKey=vaultPath）
  const { getDerivedIndexStore } = require("../../../shared/persistence/derived-index-store.cjs");
  getDerivedIndexStore(vaultPath).artifacts.put("master_graph", JSON.stringify({ nodes: [{ id: "client" }, { id: "gateway" }], connections: [{ from: "client", to: "gateway", relationType: "DEPENDS_ON" }] }));
  return { vaultPath, filePath: path.join(schema, "dependencies.yaml") };
}

test("previews version, path, and document impact without writing dependencies", (t) => {
  const data = fixture(); t.after(() => fs.rmSync(data.vaultPath, { recursive: true, force: true }));
  const before = fs.readFileSync(data.filePath, "utf8");
  const evaluated = [];
  const service = createDependencyImpactPreviewService({
    vaultPath: data.vaultPath,
    getRegistry: () => ({ products: { AnyShare: { versions: [{ id: "1.0", status: "released" }, { id: "2.0", status: "draft" }] } } }),
    analyzeImpact: () => ({ downstream: { byHop: [{ hop: 1, nodes: [{ paths: [{ nodeIds: ["client", "gateway"], edges: [] }] }] }], documentRefs: [{ documentId: "article:1", title: "Guide" }] }, upstream: { byHop: [], documentRefs: [] } }),
    changeDispositionService: { evaluate: (input) => { evaluated.push(input); return { status: "change_required", writeAllowed: true, candidates: [] }; }, assertWriteAllowed: () => {} },
    listDependencies, validateDependencyPayload,
  });
  const result = service.preview([{ source: "client", target: "gateway", type: "DEPENDS_ON", since: "2.0", until: null }]);
  assert.deepStrictEqual(result.affectedVersions.map((item) => item.version), ["1.0", "2.0"]);
  assert.strictEqual(result.summary.paths, 2);
  assert.strictEqual(result.summary.documents, 1);
  assert.strictEqual(result.reasoning.status, "change_required");
  assert.strictEqual(evaluated[0].affectedVersions.length, 2);
  assert.strictEqual(sha(fs.readFileSync(data.filePath, "utf8")), sha(before));
});

test("re-evaluates the same preview before a dependency write", (t) => {
  const data = fixture(); t.after(() => fs.rmSync(data.vaultPath, { recursive: true, force: true }));
  let asserted = null;
  const service = createDependencyImpactPreviewService({
    vaultPath: data.vaultPath,
    getRegistry: () => ({ products: { AnyShare: { versions: [{ id: "1.0", status: "released" }] } } }),
    analyzeImpact: () => ({ downstream: { byHop: [], documentRefs: [] }, upstream: { byHop: [], documentRefs: [] } }),
    changeDispositionService: { evaluate: () => ({ status: "waived", writeAllowed: true }), assertWriteAllowed: (value) => { asserted = value; } },
    listDependencies, validateDependencyPayload,
  });
  const result = service.assertWriteAllowed([{ source: "client", target: "gateway", type: "DEPENDS_ON", since: "2.0" }]);
  assert.strictEqual(result.reasoning.status, "waived");
  assert.strictEqual(asserted.status, "waived");
});

test("rejects a draft rule without a typed topology edge", (t) => {
  const data = fixture(); t.after(() => fs.rmSync(data.vaultPath, { recursive: true, force: true }));
  const service = createDependencyImpactPreviewService({ vaultPath: data.vaultPath, getRegistry: () => ({ products: {} }), listDependencies, validateDependencyPayload });
  assert.throws(() => service.preview([{ source: "gateway", target: "client", type: "DEPENDS_ON", since: "1.0" }]), (error) => error.code === "VALIDATION_ERROR" && error.details.diagnostics.some((item) => item.code === "MISSING_TOPOLOGY_EDGE"));
});
