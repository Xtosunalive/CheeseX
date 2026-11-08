/**
 * 推理规则冲突 API 路由测试 — Task 7 RED→GREEN
 */
const assert = require("assert");
const test = require("node:test");
const { register } = require("../inference-conflict-routes.cjs");
const { createRouteHarness } = require("./helpers/route-harness.cjs");

async function invoke(method, pathname, options = {}) {
  const { query, body, handlerOverride, operatorId = "local-architect" } = options;
  const h = createRouteHarness();
  register(h.registerRoute, { conflictStore: handlerOverride || mockStore(), operatorContext: { getOperatorId: () => operatorId } });
  const key = `${method} ${pathname}`;
  if (!h.routes.has(key)) throw new Error(`handler not found: ${key}`);
  const qs = query ? Object.entries(query).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&") : "";
  const res = await h.call(key, qs ? `${pathname}?${qs}` : pathname, body);
  await h.close();
  return { statusCode: res.statusCode, body: res.raw };
}

function baseConflict(overrides = {}) {
  return {
    conflictId: "conf-1",
    code: "RULES_CONFLICT",
    subjectNodeId: "a",
    conclusionKey: "arch_layer",
    sourceRevision: "sha256:source",
    ruleIds: ["r1", "r2"],
    status: "unresolved",
    conclusions: [
      { ruleId: "r1", subjectNodeId: "a", conclusionKey: "arch_layer", effect: "ASSERT", evidence: ["e1"] },
      { ruleId: "r2", subjectNodeId: "a", conclusionKey: "arch_layer", effect: "WAIVE", evidence: ["e2"] },
    ],
    firstSeenAt: "2026-01-01T00:00:00Z",
    lastSeenAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function mockStore(conflicts) {
  let data = conflicts || [
    baseConflict(),
    baseConflict({ conflictId: "conf-2", subjectNodeId: "b", conclusionKey: "arch_status", ruleIds: ["r3", "r4"], status: "resolved", resolution: "accepted r3", resolvedBy: "alice", resolvedAt: "2026-01-02T00:00:00Z" }),
  ];
  return {
    list() { return data; },
    review(conflictId, request) {
      const found = data.find((c) => c.conflictId === conflictId);
      if (!found) {
        const error = new Error("CONFLICT_NOT_FOUND");
        error.code = "CONFLICT_NOT_FOUND";
        throw error;
      }
      if (found.status === "resolved" && request.action === "resolve") {
        const error = new Error("conflict already resolved");
        error.code = "CONFLICT_RESOLVED";
        throw error;
      }
      if (found.status === "unresolved" && request.action === "reopen") {
        const error = new Error("conflict already unresolved");
        error.code = "CONFLICT_UNRESOLVED";
        throw error;
      }
      found.status = request.action === "resolve" ? "resolved" : "unresolved";
      found.resolution = request.resolution;
      found.decision = request.decision;
      found.resolvedBy = request.action === "resolve" ? request.reviewer : undefined;
      found.resolvedAt = request.action === "resolve" ? new Date().toISOString() : undefined;
      return found;
    },
  };
}

// Helper to unwrap sendJSON's okEnvelope({ data, ... })
function unwrap(body) {
  return JSON.parse(body).data;
}

// ── GET list tests ──────────────────────────────────────────────

test("returns conflict list with standard envelope", async () => {
  const res = await invoke("GET", "/api/kg/inference-conflicts");
  assert.strictEqual(res.statusCode, 200);
  const data = unwrap(res.body);
  assert(Array.isArray(data.conflicts));
  assert.strictEqual(data.total, 2);
});

test("filters by status=unresolved", async () => {
  const res = await invoke("GET", "/api/kg/inference-conflicts", { query: { status: "unresolved" } });
  const data = unwrap(res.body);
  assert.strictEqual(data.total, 1);
  assert.strictEqual(data.conflicts[0].conflictId, "conf-1");
});

test("filters by status=resolved", async () => {
  const res = await invoke("GET", "/api/kg/inference-conflicts", { query: { status: "resolved" } });
  const data = unwrap(res.body);
  assert.strictEqual(data.total, 1);
  assert.strictEqual(data.conflicts[0].conflictId, "conf-2");
});

test("filters by status=all", async () => {
  const res = await invoke("GET", "/api/kg/inference-conflicts", { query: { status: "all" } });
  assert.strictEqual(unwrap(res.body).total, 2);
});

test("returns 503 when store unavailable", async () => {
  const res = await invoke("GET", "/api/kg/inference-conflicts", {
    handlerOverride: { list() { const error = new Error("BOOM"); error.code = "CONFLICT_STORE_CORRUPT"; throw error; } },
  });
  assert.strictEqual(res.statusCode, 503);
});

test("does not register the retired direct review route", () => {
  const h = createRouteHarness();
  register(h.registerRoute, { conflictStore: mockStore() });
  assert(!h.routes.has("POST /api/kg/inference-conflicts/review"));
});
