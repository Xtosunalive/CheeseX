const test = require("node:test");
const assert = require("node:assert/strict");
const routes = require("../version-registry-routes.cjs");
const { createRouteHarness, mergeW1aActionTypes, setupActionRuntime, teardownActionRuntime } = require("./helpers/route-harness.cjs");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function responseData() {
  return { schema_version: 1, products: {}, diagnostics: [], revision: "sha256:abc", sourceFile: "知识库/TheSchema/versions.yaml", summary: { totalProducts: 0, totalVersions: 0, draft: 0, released: 0, deprecated: 0, errors: 0 } };
}

const actionVault = fs.mkdtempSync(path.join(os.tmpdir(), "version-registry-actions-"));
setupActionRuntime({ vaultPath: actionVault }); // WP-048 W1-A：三写端点已动作化（工厂审计落临时库）

function register(overrides = {}) {
  const h = createRouteHarness();
  const service = {
    getRegistry: () => responseData(),
    getProductIdentity: () => ({ canonicalProduct: "AnyShare", aliases: ["AS"], revision: "sha256:enums", sourceFile: "知识库/TheSchema/enums.yaml", renameSupported: false }),
    validateRegistryPayload: () => responseData(),
    ...overrides,
  };
  const schemaWriteService = {
    writeProductIdentity: () => ({ category: "product-identity", revision: "sha256:pi" }),
    writeVersions: () => ({ category: "versions", revision: "sha256:vs" }),
    freezeVersion: () => ({ category: "versions", product: "AnyShare", version: "7.0", revision: "sha256:fz" }),
  };
  routes.register(h.registerRoute, { versionRegistryService: service, schemaWriteService });
  return h;
}

test("keeps Schema reads and validation while writes go direct to schema-write-service", async () => {
  const h = register();
  assert.equal((await h.call("GET /api/schema/versions")).status, 200);
  assert.equal((await h.call("GET /api/schema/product-identity")).status, 200);
  const identityWrite = await h.call("PUT /api/schema/product-identity", undefined, { revision: "sha256:enums", patch: { aliases: ["AS"] } });
  assert.equal(identityWrite.status, 200, JSON.stringify(identityWrite.body));
  assert.equal(identityWrite.body.data.category, "product-identity");
  assert.equal((await h.call("POST /api/schema/versions/validate", undefined, { revision: "sha256:abc", schema_version: 1, products: {} })).status, 200); // 契约 requestBody 必填 revision（VersionRegistryWritePayload 同源）
  const registryWrite = await h.call("PUT /api/schema/versions", undefined, { revision: "sha256:abc", patch: { products: {} } });
  assert.equal(registryWrite.status, 200, JSON.stringify(registryWrite.body));
  assert.equal(registryWrite.body.data.category, "versions");
  const freeze = await h.call("POST /api/schema/versions/freeze", undefined, { revision: "sha256:abc", product: "AnyShare", version: "7.0" });
  assert.equal(freeze.status, 200, JSON.stringify(freeze.body));
  assert.equal(freeze.body.data.version, "7.0");
});

test("maps malformed validation input to the standard envelope", async () => {
  const h = register();
  // PR-085：非法 JSON 由传输层拒绝（FST_ERR_CTP_INVALID_JSON_BODY → 400 VALIDATION_ERROR），封套形状不变
  const malformed = await h.request("POST /api/schema/versions/validate", { rawBody: "not-json" });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error_code, "VALIDATION_ERROR");
});
