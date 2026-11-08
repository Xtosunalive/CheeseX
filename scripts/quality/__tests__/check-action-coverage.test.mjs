// check-action-coverage 红绿夹具（WP-067 / SPEC-067 T3 的 tripwire 有效性实证）：
// 点名路由→绿；零点名路由→红（新死路径落地即拦）；豁免→出 uncovered 进豁免列。
// 口径提醒（SPEC-067 §二.3）：本对账是静态点名哨兵，不冒充真实通道证明。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { reconcileCoverage } from "../check-action-coverage.mjs";

function fixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "action-coverage-"));
  fs.mkdirSync(path.join(root, "server", "routes"), { recursive: true });
  fs.mkdirSync(path.join(root, "server", "routes", "__tests__"), { recursive: true });
  fs.writeFileSync(path.join(root, "server", "routes", "demo-routes.cjs"), `
    registerRoute("GET", "/api/demo/covered", handler);
    registerRoute("POST", "/api/demo/orphan", handler);
  `);
  fs.writeFileSync(path.join(root, "server", "routes", "__tests__", "demo.test.cjs"), `
    test("covers the covered route", () => { fetch("/api/demo/covered"); });
  `);
  return root;
}

test("绿：被测试树点名的路由不进 uncovered", () => {
  const result = reconcileCoverage({ root: fixtureRoot(), exempt: {} });
  assert.equal(result.routes.length, 2);
  assert.deepEqual(result.uncovered.map((u) => u.route), ["/api/demo/orphan"]);
});

test("红：零点名路由被拦（tripwire 有效性——新死路径落地即红）", () => {
  const result = reconcileCoverage({ root: fixtureRoot(), exempt: {} });
  assert.equal(result.uncovered.length, 1);
  assert.equal(result.uncovered[0].method, "POST");
  assert.equal(result.uncovered[0].route, "/api/demo/orphan");
  assert.match(result.uncovered[0].file, /demo-routes\.cjs$/);
});

test("豁免：显式豁免出 uncovered 进豁免列（棘轮只减不增的挂账面）", () => {
  const result = reconcileCoverage({ root: fixtureRoot(), exempt: { "POST /api/demo/orphan": { reason: "测试夹具豁免" } } });
  assert.deepEqual(result.uncovered, []);
  assert.equal(result.exempted.length, 1);
  assert.equal(result.exempted[0].reason, "测试夹具豁免");
});
