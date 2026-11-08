// Layer: gate test（quality 脚本域）· 验证对象: scripts/quality/check-response-count-parity.mjs
// 先红后绿：真仓须 ok（topology 两对象已执法且合规）；夹具覆盖 R1/R2/R3 反例必红，无标记对象只登记不阻断。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runResponseCountParity } from "../check-response-count-parity.mjs";

// fields: 字段名 → description（null 表示裸 integer，无 description）
function fixture({ enforce, fields }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "count-parity-"));
  fs.mkdirSync(path.join(root, "contracts"), { recursive: true });
  const properties = {};
  for (const [name, desc] of Object.entries(fields)) {
    properties[name] = desc === null ? { type: "integer" } : { type: "integer", description: desc };
  }
  const demo = { type: "object", properties };
  if (enforce) demo["x-count-parity"] = true;
  const doc = { openapi: "3.1.0", paths: {}, components: { schemas: { Demo: demo } } };
  fs.writeFileSync(path.join(root, "contracts", "http-api.openapi.json"), JSON.stringify(doc));
  return root;
}

const GREEN_FIELDS = {
  totalNodes: "准入实体节点总数（经 graph-admission 过滤）",
  returnedNodes: "实际返回节点数，恒 ≤ totalNodes",
  totalEdges: "准入实体之间的边总数（经 graph-admission 过滤）",
  returnedEdges: "实际返回边数，恒 ≤ totalEdges",
};

test("真仓：topology 两执法对象合规，0 违例", () => {
  const result = runResponseCountParity();
  assert.equal(result.ok, true, result.violations.join("\n"));
  assert.equal(result.stats.enforcedObjects, 2);
});

test("绿：合规标记对象（同过滤口径＋returned 含 ≤）→ ok", () => {
  const root = fixture({ enforce: true, fields: GREEN_FIELDS });
  const result = runResponseCountParity({ rootDir: root });
  assert.equal(result.ok, true, result.violations.join("\n"));
  assert.equal(result.stats.enforcedObjects, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test("红 R1：标记对象的计数字段无 description → 口径缺失", () => {
  const root = fixture({ enforce: true, fields: { totalNodes: null, totalEdges: "边总数（经 graph-admission 过滤）" } });
  const result = runResponseCountParity({ rootDir: root });
  assert.equal(result.ok, false);
  assert.match(result.violations.join("\n"), /口径缺失.*totalNodes/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("红 R3：totalNodes 过滤、totalEdges 全量 → 口径冲突", () => {
  const root = fixture({
    enforce: true,
    fields: {
      totalNodes: "准入实体节点总数（经 graph-admission 过滤）",
      totalEdges: "原始图全部边总数",
    },
  });
  const result = runResponseCountParity({ rootDir: root });
  assert.equal(result.ok, false);
  assert.match(result.violations.join("\n"), /口径冲突/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("红 R2：returnedNodes 描述未声明 ≤ totalNodes → 配对缺失", () => {
  const root = fixture({
    enforce: true,
    fields: {
      totalNodes: "准入实体节点总数（经 graph-admission 过滤）",
      returnedNodes: "实际返回的节点数",
      totalEdges: "准入实体之间的边总数（经 graph-admission 过滤）",
      returnedEdges: "实际返回边数，恒 ≤ totalEdges",
    },
  });
  const result = runResponseCountParity({ rootDir: root });
  assert.equal(result.ok, false);
  assert.match(result.violations.join("\n"), /配对缺失.*returnedNodes/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("无标记对象即使字段无描述也不阻断（只登记，enforced=0）", () => {
  const root = fixture({ enforce: false, fields: { totalNodes: null, totalEdges: null } });
  const result = runResponseCountParity({ rootDir: root });
  assert.equal(result.ok, true);
  assert.equal(result.stats.enforcedObjects, 0);
  fs.rmSync(root, { recursive: true, force: true });
});
