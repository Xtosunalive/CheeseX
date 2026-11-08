const assert = require("node:assert/strict");
const test = require("node:test");
const routes = require("../anomaly-workbench-routes.cjs");
const { createRouteHarness, setupActionRuntime } = require("./helpers/route-harness.cjs"); // WP-048 W1-B：reconcile/operate 已动作化
const fs0 = require("node:fs"); const os0 = require("node:os"); const path0 = require("node:path");
setupActionRuntime({ vaultPath: fs0.mkdtempSync(path0.join(os0.tmpdir(), "anomaly-actions-")) });

test("registers anomaly list, detail, reconcile, and the preview/confirm/reject operation route", () => {
  const h = createRouteHarness();
  routes.register(h.registerRoute, { anomalyWorkbenchService: {} });
  assert.deepEqual([...h.routes.keys()], [
    "POST /api/anomalies/reconcile", "GET /api/anomalies", "GET /api/anomalies/:issueId", "POST /api/anomalies/:issueId/:operation",
  ]);
});

test("N3: POST /api/anomalies/reconcile triggers explicit reconcile and returns summary", async () => {
  const h = createRouteHarness();
  let called = false;
  routes.register(h.registerRoute, { anomalyWorkbenchService: {
    reconcileDiagnostic(payload) { called = true; return { purpose: payload.purpose, verifiedCount: 0, issues: [] }; },
  } });
  const res = await h.call("POST /api/anomalies/reconcile");
  assert.equal(called, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.purpose, "reconcile");
});

test("reject delegates only the reason payload and returns the service result", async () => {
  const h = createRouteHarness();
  let received;
  routes.register(h.registerRoute, { anomalyWorkbenchService: {
    reject(issueId, payload) { received = { issueId, payload }; return { issueId, status: "open", relationCandidate: { candidateStatus: "rejected" } }; },
  } });
  const response = await h.request("POST /api/anomalies/:issueId/:operation", { params: { issueId: "candidate-1", operation: "reject" }, body: { actor: "client-user", reason: "unsupported" } });
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  assert.deepEqual(received, { issueId: "candidate-1", payload: { reason: "unsupported" } });
  assert.equal(response.body.data.relationCandidate.candidateStatus, "rejected");
});

test("defaults to current issues and exposes resolved records only for audit queries", async () => {
  const h = createRouteHarness();
  const calls = [];
  routes.register(h.registerRoute, { anomalyWorkbenchService: { list(options) { calls.push(options); return { generatedAt: "2026-07-20T00:00:00.000Z", issues: [], total: 0 }; } } });

  const current = await h.call("GET /api/anomalies", "/api/anomalies");
  assert.deepEqual(calls[0], { includeResolved: false });
  assert.equal(current.statusCode, 200);

  await h.call("GET /api/anomalies", "/api/anomalies?includeResolved=true");
  assert.deepEqual(calls[1], { includeResolved: true });

  const invalid = await h.call("GET /api/anomalies", "/api/anomalies?includeResolved=yes");
  assert.equal(invalid.statusCode, 400);
});
