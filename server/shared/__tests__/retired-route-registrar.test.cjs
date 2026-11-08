const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { registerRetiredRoutes } = require("../retired-route-registrar.cjs");
const { createHttpApp } = require("../http-app.cjs");


test("registers only contract-declared tombstones with a 410 envelope", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "retired-routes-"));
  const contractPath = path.join(root, "retired.json");
  fs.writeFileSync(contractPath, JSON.stringify({ retired: [{
    method: "PUT", path: "/api/legacy", retiredAt: "2026-08-11",
    reason: "Use Proposal", replacement: "POST /api/proposals", errorCode: "LEGACY_WRITE_RETIRED",
  }] }));
  // PR-085：经 http-app（Fastify inject）——墓碑带 tombstone 标记，带 body 调用仍答 410（退役信号不被契约「禁止 body」盖掉）
  const http = createHttpApp({ cors: false });
  registerRetiredRoutes(http.registerRoute, {
    contractPath,
    routes: [{ method: "PUT", path: "/api/legacy" }],
  });
  const res = await http.app.inject({ method: "PUT", url: "/api/legacy", payload: { anything: 1 } });
  const body = res.json();
  assert.equal(res.statusCode, 410);
  assert.equal(body.success, false);
  assert.equal(body.error_code, "LEGACY_WRITE_RETIRED");
  assert.equal(body.details.replacement, "POST /api/proposals");
  await http.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test("fails closed when code requests a tombstone missing from the contract", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "retired-routes-"));
  const contractPath = path.join(root, "retired.json");
  fs.writeFileSync(contractPath, JSON.stringify({ retired: [] }));
  assert.throws(() => registerRetiredRoutes(() => {}, {
    contractPath,
    routes: [{ method: "POST", path: "/api/undeclared" }],
  }), /not declared by contract/);
  fs.rmSync(root, { recursive: true, force: true });
});
