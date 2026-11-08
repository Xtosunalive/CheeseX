// Layer: gate test（quality 脚本域）· 验证对象: scripts/quality/check-contract-route-parity.mjs
// 先红后绿：真仓须 ok；夹具三反例（契约超前／契约外路由／重复注册）必红，墓碑豁免不误伤。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runContractRouteParity } from "../check-contract-route-parity.mjs";

function fixture({ mainRoutes, moduleRoutes, contractPaths, retired = [] }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "parity-"));
  fs.mkdirSync(path.join(root, "server", "routes"), { recursive: true });
  fs.mkdirSync(path.join(root, "contracts"), { recursive: true });
  const main = [
    'require("./routes/demo-routes.cjs").register(registerRoute, {});',
    ...mainRoutes.map(([m, p]) => `registerRoute("${m}", "${p}", () => {});`),
  ].join("\n");
  fs.writeFileSync(path.join(root, "server", "main.cjs"), main);
  fs.writeFileSync(path.join(root, "server", "routes", "demo-routes.cjs"), moduleRoutes.map(([m, p]) => `registerRoute("${m}", "${p}", () => {});`).join("\n"));
  const paths = {};
  for (const [m, p] of contractPaths) { paths[p] = paths[p] || {}; paths[p][m.toLowerCase()] = { responses: { 200: { description: "OK" } } }; }
  fs.writeFileSync(path.join(root, "contracts", "http-api.openapi.json"), JSON.stringify({ openapi: "3.1.0", paths, components: { schemas: {} } }));
  fs.writeFileSync(path.join(root, "contracts", "retired-routes.json"), JSON.stringify({ retired }));
  return root;
}

test("真仓：契约操作⇄注册路由双向对齐（0 违例）", () => {
  const result = runContractRouteParity();
  assert.equal(result.ok, true, result.violations.join("\n"));
  assert.ok(result.stats.contract_ops >= 90);
  assert.ok(result.stats.routes >= result.stats.contract_ops);
});

test("绿：模块路由＋main 路由＋墓碑（契约外但在退役登记表）→ ok，墓碑计入豁免", () => {
  const root = fixture({
    mainRoutes: [["GET", "/api/health"]],
    moduleRoutes: [["POST", "/api/items/:id"]],
    contractPaths: [["GET", "/api/health"], ["POST", "/api/items/{id}"]],
    retired: [{ method: "POST", path: "/api/legacy", errorCode: "X" }],
  });
  const result = runContractRouteParity({ rootDir: root });
  assert.equal(result.ok, true, result.violations.join("\n"));
  assert.equal(result.stats.tombstones_exempt, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test("红①：契约声明了操作但无注册路由 → 契约超前", () => {
  const root = fixture({ mainRoutes: [], moduleRoutes: [["GET", "/api/a"]], contractPaths: [["GET", "/api/a"], ["POST", "/api/ghost"]] });
  const result = runContractRouteParity({ rootDir: root });
  assert.equal(result.ok, false);
  assert.match(result.violations.join("\n"), /契约超前.*POST \/api\/ghost/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("红②：注册了契约外路由（非墓碑）→ 契约外", () => {
  const root = fixture({ mainRoutes: [], moduleRoutes: [["GET", "/api/a"], ["PUT", "/api/rogue"]], contractPaths: [["GET", "/api/a"]] });
  const result = runContractRouteParity({ rootDir: root });
  assert.equal(result.ok, false);
  assert.match(result.violations.join("\n"), /契约外.*PUT \/api\/rogue/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("红③：同一路由注册两次（含 :param 与 {param} 归一同键）→ 重复", () => {
  const root = fixture({ mainRoutes: [["GET", "/api/x/:id"]], moduleRoutes: [["GET", "/api/x/:other"]], contractPaths: [["GET", "/api/x/{id}"]] });
  const result = runContractRouteParity({ rootDir: root });
  assert.equal(result.ok, false);
  assert.match(result.violations.join("\n"), /重复.*GET \/api\/x\/\{x\}/);
  fs.rmSync(root, { recursive: true, force: true });
});
