const assert = require("assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const propertyRoutes = require("../property-routes.cjs");
const { createRouteHarness, setupActionRuntime } = require("./helpers/route-harness.cjs"); // WP-048 W1-C：refresh 已动作化
const fs0 = require("node:fs"); const os0 = require("node:os"); const path0 = require("node:path");
setupActionRuntime({ vaultPath: fs0.mkdtempSync(path0.join(os0.tmpdir(), "property-actions-")) });

async function run() {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "property-working-revisions-"));
  const schemaPath = path.join(vaultPath, "知识库", "TheSchema");
  const entityPath = path.join(vaultPath, "知识库", "wiki", "entities", "fixture.md");
  fs.mkdirSync(schemaPath, { recursive: true });
  fs.mkdirSync(path.dirname(entityPath), { recursive: true });
  fs.writeFileSync(entityPath, "---\narchitecture-node-id: fixture-component\n---\n", "utf8");
  fs.writeFileSync(path.join(schemaPath, "enums.yaml"), "architecture_projection:\n  product: FixtureProduct\n  version: main\nmodules: []\n", "utf8");
  // PR-082：SA 派生通用槽种 store（旧 vault 产品段路径退役）
  const { getDerivedIndexStore } = require("../../shared/persistence/derived-index-store.cjs");
  getDerivedIndexStore(vaultPath).artifacts.put("sa", JSON.stringify({
    components: [{ id: "fixture-component", name: "Fixture Component", sourcePath: entityPath }],
  }));
  const h = createRouteHarness();
  try {
    // PR-084：组件集经读侧唯一咽喉的 SA 视图注入（与 main.cjs 装配同形）
    const sas = require("../../services/projection/semantic-architecture-service.cjs");
    sas.setVaultPath(vaultPath);
    propertyRoutes.register(h.registerRoute, { vaultPath, readSemanticArchitecture: sas.readSemanticArchitecture });
    assert(h.routes.has("GET /api/property/check"), "check route registered");

    const response = await h.call("GET /api/property/check", "/api/property/check?filter=all");
    assert.strictEqual(response.statusCode, 200, JSON.stringify(response.body));
    assert.strictEqual(response.body.success, true);
    assert.strictEqual(response.body.data.total, 1);
    assert.strictEqual(response.body.data.items[0].componentId, "fixture-component");
    assert.strictEqual(response.body.data.items[0].sourcePath, "知识库/wiki/entities/fixture.md");
    assert.match(response.body.data.items[0].sourceRevision.contentHash, /^sha256:[a-f0-9]{64}$/);
    assert.strictEqual(response.body.data.items[0].sourceRevision.size, fs.statSync(entityPath).size);
    assert.match(response.body.data.workingRevisions.enums, /^sha256:[a-f0-9]{64}$/);
    assert.match(response.body.data.workingRevisions.semanticArchitecture, /^sha256:[a-f0-9]{64}$/);
    assert.strictEqual(response.body.data.workingRevisions.masterGraph, null);
    assert.strictEqual(response.body.data.workingRevisions.extractManifest, null);
    console.log("Property empty-graph route tests passed: 11 passed, 0 failed");
  } finally {
    await h.close();
    fs.rmSync(vaultPath, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
