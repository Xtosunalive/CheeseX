const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const YAML = require("yaml");
const service = require("../dependencies-write-service.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "dependencies-service-"));
const schemaDir = path.join(root, "知识库", "TheSchema");
const anyshareDir = path.join(root, ".ledger");

function writeFixture() {
  fs.mkdirSync(schemaDir, { recursive: true });
  fs.mkdirSync(anyshareDir, { recursive: true });
  fs.writeFileSync(path.join(schemaDir, "enums.yaml"), YAML.stringify({
    architecture_projection: {},
  }));
  fs.writeFileSync(path.join(schemaDir, "ontology.yaml"), YAML.stringify({
    relation_types: {
      DEPENDS_ON: { label_cn: "依赖", versionable: true },
      STORES_IN: { label_cn: "存储于", versionable: true },
    },
  }));
  // SPEC-012 wave-2 图族：主图真身迁 derived-index.db——种子种 store 原文行（scopeKey=root）
  const { getDerivedIndexStore } = require("../../../shared/persistence/derived-index-store.cjs");
  getDerivedIndexStore(root).artifacts.put("sa", JSON.stringify({
    components: [{ id: "client", name: "客户端" }, { id: "gateway", name: "网关" }],
  }));
  getDerivedIndexStore(root).artifacts.put("master_graph", JSON.stringify({
    nodes: [{ id: "db", label: "数据库" }],
    connections: [
      { from: "client", to: "gateway", relationType: "DEPENDS_ON" },
      { from: "client", to: "db", relationType: "STORES_IN" },
    ],
  }));
  fs.writeFileSync(path.join(schemaDir, "dependencies.yaml"), YAML.stringify({
    dependencies: [{ source: "client", target: "gateway", type: "DEPENDS_ON", since: "v1.0", until: "v2.0" }],
  }));
}

async function run() {
  let passed = 0;
  let failed = 0;
  function test(name, fn) {
    try {
      fn();
      passed++;
    } catch (error) {
      failed++;
      console.error("FAIL " + name + ": " + error.message);
    }
  }

  writeFixture();

  test("lists rules with revision, options, and clean diagnostics", function () {
    const result = service.listDependencies(root);
    assert.strictEqual(result.items.length, 1);
    assert.strictEqual(result.items[0].source, "client");
    assert.strictEqual(result.items[0].target, "gateway");
    assert.strictEqual(result.items[0].type, "DEPENDS_ON");
    assert.strictEqual(result.summary.errors, 0);
    assert(result.revision.startsWith("sha256:"));
    assert(result.entityOptions.some((item) => item.id === "client" && item.scope === "architecture-component"));
    assert(result.entityOptions.some((item) => item.id === "db" && item.scope === "graph-entity"));
    assert(result.relationTypeOptions.some((item) => item.id === "STORES_IN"));
  });

  test("validate reports structural errors and prose-like versions", function () {
    const result = service.validateDependencyPayload(root, [
      { source: "client", target: "client", type: "NOPE", since: "长期" },
    ]);
    assert(result.diagnostics.some((item) => item.code === "SELF_DEPENDENCY"));
    assert(result.diagnostics.some((item) => item.code === "UNKNOWN_RELATION_TYPE"));
    assert(result.diagnostics.some((item) => item.code === "INVALID_SINCE_VERSION"));
    assert(result.summary.errors >= 3);
  });

  test("rules without a typed-wikilink topology edge are rejected", function () {
    const result = service.validateDependencyPayload(root, [
      { source: "future-service", target: "gateway", type: "DEPENDS_ON", since: "v2.0" },
    ]);
    assert.strictEqual(result.summary.errors, 1);
    assert.strictEqual(result.summary.warnings, 1);
    assert(result.diagnostics.some((item) => item.code === "UNKNOWN_SOURCE_ENTITY"));
    assert(result.diagnostics.some((item) => item.code === "MISSING_TOPOLOGY_EDGE"));
  });

  fs.rmSync(root, { recursive: true, force: true });
  console.log("dependencies-write-service tests: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

run().catch(function (error) {
  console.error(error);
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(1);
});
