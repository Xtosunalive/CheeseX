const assert = require("node:assert/strict");
const test = require("node:test");
const routes = require("../schema-release-routes.cjs");
const { createRouteHarness } = require("./helpers/route-harness.cjs");

test("all legacy Schema change-set and release routes are contract-driven 410 tombstones", async () => {
  const h = createRouteHarness();
  routes.register(h.registerRoute);
  assert.equal(h.routes.size, 7);
  for (const key of h.routes.keys()) {
    const res = await h.request(key, { params: { revision: "r1" } });
    assert.equal(res.statusCode, 410, key);
    assert.equal(res.body.success, false);
    assert.match(res.body.error_code, /RETIRED/);
  }
  await h.close();
});
