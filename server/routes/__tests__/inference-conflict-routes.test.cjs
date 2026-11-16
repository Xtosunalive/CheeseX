const assert = require("node:assert/strict");
const test = require("node:test");
const routes = require("../inference-conflict-routes.cjs");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
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

// Wave3 阶段三：裁决/重开端点（路径字面量供 action-coverage 哨兵；委托断言）
test("review 端点委托 store.review：resolve 成功原样返回裁决后对象", async () => {
  const { setupActionRuntime } = require("./helpers/route-harness.cjs");
  setupActionRuntime({ vaultPath: fs.mkdtempSync(path.join(os.tmpdir(), "conflict-review-")) });
  const conflictStore = {
    list: () => [],
    review(conflictId, request) {
      assert.equal(conflictId, "cf-1");
      assert.equal(request.action, "resolve");
      assert.equal(request.reviewer, "local-architect");
      assert.ok(request.decision && request.decision.sourceRevision === "rev-1");
      return { conflictId, status: "resolved", decision: request.decision };
    },
  };
  const h = registerWith({ conflictStore });
  const response = await h.call("POST /api/kg/inference-conflicts/:conflictId/review", "/api/kg/inference-conflicts/cf-1/review", {
    action: "resolve", reviewer: "local-architect", reason: "裁决理由",
    decision: { decision: "select_effect", selectedEffect: "ASSERT", sourceRevision: "rev-1" },
  });
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  assert.equal(response.body.data.status, "resolved");
});
