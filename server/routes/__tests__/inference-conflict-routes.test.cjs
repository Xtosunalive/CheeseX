const assert = require("node:assert/strict");
const test = require("node:test");
const routes = require("../inference-conflict-routes.cjs");
const { createRouteHarness } = require("./helpers/route-harness.cjs");

function registerWith(deps) {
  const h = createRouteHarness();
  routes.register(h.registerRoute, deps);
  return h;
}

test("registers read-only inference conflict history without a direct review route", async () => {
  let reviewCalls = 0;
  const h = registerWith({
    conflictStore: {
      list: () => [{ conflictId: "conflict-1", status: "resolved" }],
      review: () => { reviewCalls += 1; },
    },
    operatorContext: { getOperatorId: () => "local-architect" },
  });

  assert.equal(h.routes.has("POST /api/kg/inference-conflicts/review"), false);
  const response = await h.call("GET /api/kg/inference-conflicts", "/api/kg/inference-conflicts?status=resolved");
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.total, 1);
  assert.equal(reviewCalls, 0);
});
