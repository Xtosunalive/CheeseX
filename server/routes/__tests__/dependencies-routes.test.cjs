const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const YAML = require("yaml");
const routes = require("../dependencies-routes.cjs");
const { createRouteHarness, mergeW1aActionTypes, setupActionRuntime, teardownActionRuntime } = require("./helpers/route-harness.cjs");


(async function run() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "dependencies-routes-"));
  const h = createRouteHarness();
  try {
    const schemaDir = path.join(vault, "知识库", "TheSchema");
    fs.mkdirSync(schemaDir, { recursive: true });
    fs.writeFileSync(path.join(schemaDir, "enums.yaml"), YAML.stringify({ architecture_projection: {} }));
    fs.writeFileSync(path.join(schemaDir, "ontology.yaml"), YAML.stringify({ relation_types: { DEPENDS_ON: { label_cn: "依赖", versionable: true } } }));
    // PR-082：SA 派生通用槽种 store（旧 vault 产品段路径退役；元层无身份合法）
    const { getDerivedIndexStore } = require("../../shared/persistence/derived-index-store.cjs");
    getDerivedIndexStore(vault).artifacts.put("sa", JSON.stringify({ components: [{ id: "client" }, { id: "gateway" }] }));
    mergeW1aActionTypes(path.join(schemaDir, "ontology.yaml")); // WP-048 W1-A：PUT/rollback 已动作化
    setupActionRuntime({ vaultPath: vault });
    const dependenciesPath = path.join(schemaDir, "dependencies.yaml");
    fs.writeFileSync(dependenciesPath, YAML.stringify({ dependencies: [{ source: "client", target: "gateway", type: "DEPENDS_ON", since: "v1.0" }] }));
    let writeGateCalls = 0;
    let writeDependenciesCalls = 0;
    routes.register(h.registerRoute, {
      vaultPath: vault,
      impactPreviewService: {
        preview: (items) => ({ affectedVersions: [], diagnostics: [], revision: "sha256:test", reasoning: { status: "clear", writeAllowed: true }, summary: { versions: 0, relationsAdded: items.length, relationsRemoved: 0, components: 0, paths: 0, documents: 0 } }),
        assertWriteAllowed() { writeGateCalls++; throw new Error("legacy writer gate must not run"); },
      },
      schemaWriteService: { writeDependencies: (input) => { writeDependenciesCalls += 1; return { category: "dependencies", revision: "sha256:" + "b".repeat(64), affectedFile: "知识库/TheSchema/dependencies.yaml" }; } },
    });
    const read = await h.call("GET /api/schema/dependencies", "/api/schema/dependencies");
    assert.equal(read.statusCode, 200); assert.equal(read.body.data.items[0].source, "client");
    const invalid = await h.call("POST /api/schema/dependencies/validate", "/api/schema/dependencies/validate", { items: [{ id: "dep-1", origin: "manual", source: "client", target: "client", type: "DEPENDS_ON", since: "长期" }] });
    assert.equal(invalid.statusCode, 200); assert.equal(invalid.body.data.summary.errors, 2);
    const preview = await h.call("POST /api/schema/dependencies/preview", "/api/schema/dependencies/preview", { items: [{ id: "dep-2", origin: "manual", source: "client", target: "gateway", type: "DEPENDS_ON", since: "v2.0" }] });
    assert.equal(preview.statusCode, 200); assert.equal(preview.body.data.summary.relationsAdded, 1);
    const before = fs.readFileSync(dependenciesPath);
    const written = await h.call("PUT /api/schema/dependencies", "/api/schema/dependencies", { revision: read.body.data.revision, patch: { dependencies: [] } });
    assert.equal(written.statusCode, 200); assert.equal(writeGateCalls, 0); assert.equal(writeDependenciesCalls, 1);
  } finally { await h.close(); fs.rmSync(vault, { recursive: true, force: true }); }
  console.log("dependencies-routes tests passed");
})().catch((error) => { console.error(error); process.exit(1); });
