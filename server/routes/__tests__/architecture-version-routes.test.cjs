const assert = require("assert");
const test = require("node:test");
const routes = require("../architecture-version-routes.cjs");
const { createRouteHarness } = require("./helpers/route-harness.cjs");

function harness(service, extra = {}) {
  const h = createRouteHarness();
  routes.register(h.registerRoute, { architectureVersionService: service, ...extra });
  return h;
}

test("registers product version, version state, and compare routes", async () => {
  const service = {
    listVersions: () => ({ items: [{ product: "AnyShare", version: "7.0" }] }),
    getVersion: (product, version) => ({ product, version }),
    compare: (product, source, target) => ({ product, source: { version: source }, target: { version: target } }),
  };
  const h = harness(service);
  const versions = await h.call("GET /api/kg/product-versions", "/api/kg/product-versions");
  assert.strictEqual(versions.statusCode, 200);
  const state = await h.call("GET /api/kg/architecture-version", "/api/kg/architecture-version?product=AnyShare&version=7.0");
  assert.strictEqual(state.body.data.version, "7.0");
  const compare = await h.call("GET /api/kg/architecture-version-compare", "/api/kg/architecture-version-compare?product=AnyShare&source=7.0&target=7.1");
  assert.strictEqual(compare.body.data.target.version, "7.1");
});

test("maps invalid queries and stale snapshots", async () => {
  const stale = new Error("stale"); stale.code = "STALE_VERSION_SNAPSHOT"; stale.status = 409;
  const h = harness({ listVersions: () => ({ items: [] }), getVersion: () => { throw stale; }, compare: () => ({}) });
  const invalid = await h.call("GET /api/kg/architecture-version", "/api/kg/architecture-version");
  assert.strictEqual(invalid.statusCode, 400);
  const conflict = await h.call("GET /api/kg/architecture-version", "/api/kg/architecture-version?product=AnyShare&version=7.0");
  assert.strictEqual(conflict.statusCode, 409);
  assert.strictEqual(conflict.body.error_code, "STALE_VERSION_SNAPSHOT");
});

test("formal version routes pin once, return Release identity and never call Vault service", async () => {
  let pins = 0;
  let vaultCalls = 0;
  const releaseId = `release-${"a".repeat(64)}`;
  const sourceCommit = "b".repeat(40);
  const formalConsumer = { withPinnedRelease(callback) { pins += 1; return callback({ releaseId, sourceCommit, marker: "release" }); } };
  const h = harness({
    listVersions() { vaultCalls += 1; }, getVersion() { vaultCalls += 1; }, compare() { vaultCalls += 1; },
  }, {
    formalConsumer,
    serviceFactory(context) {
      assert.strictEqual(context.marker, "release");
      return {
        listVersions: () => ({ items: [] }),
        getVersion: (product, version) => ({ product, version }),
        compare: (product, source, target) => ({ product, source: { version: source }, target: { version: target } }),
      };
    },
  });
  for (const [key, url] of [
    ["GET /api/kg/product-versions", "/api/kg/product-versions"],
    ["GET /api/kg/architecture-version", "/api/kg/architecture-version?product=AnyShare&version=7.0"],
    ["GET /api/kg/architecture-version-compare", "/api/kg/architecture-version-compare?product=AnyShare&source=7.0&target=7.1"],
  ]) {
    const res = await h.call(key, url);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.data.releaseId, releaseId);
    assert.strictEqual(res.body.data.sourceCommit, sourceCommit);
  }
  assert.strictEqual(pins, 3);
  assert.strictEqual(vaultCalls, 0);
});
