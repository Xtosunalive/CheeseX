// @tests: server/routes/relations-routes.cjs（EDGE-RELATION-GOV-001 对象本体批）
// 层级：Adapter 契约（route-harness 完整传输层：契约推导 body 校验/错误处理器真实经过；
//   THESCHEMA_DIR 钉扎 tmp 领地，写不触真仓 data/theschema）。
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const relationsRoutes = require("../relations-routes.cjs");
const { createRouteHarness, mergeW1aActionTypes, setupActionRuntime, teardownActionRuntime } = require("./helpers/route-harness.cjs");

function pinAndRegister(onRelationsWritten = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relations-routes-"));
  const the = path.join(dir, "theschema");
  fs.mkdirSync(the, { recursive: true });
  fs.writeFileSync(path.join(the, "ontology.yaml"), "relation_types:\n  containment:\n    description: 包含\n    label_cn: 包含\n    fact_encoding: governance_assertion\n    projected: true\nnode_types: {}\ninference_rules: []\nconstraints: []\n");
  const saved = process.env.THESCHEMA_DIR;
  process.env.THESCHEMA_DIR = the;
  mergeW1aActionTypes(path.join(the, "ontology.yaml")); // WP-048 W1-A：PUT/rollback 已动作化
  setupActionRuntime({ vaultPath: dir });
  const h = createRouteHarness();
  relationsRoutes.register(h.registerRoute, { vaultPath: dir, onRelationsWritten });
  return { dir, the, h, restore: () => { if (saved === undefined) delete process.env.THESCHEMA_DIR; else process.env.THESCHEMA_DIR = saved; } };
}

const ROW = { source: "知识本体", target: "关系类型", type: "containment", note: "D3", asserted_by: "human", asserted_at: "2026-10-24" };

test("GET 空账＝真实零值；PUT 合法写回＋写后挂钩触发；错误面 400/409", async () => {
  let hookCalls = 0;
  const ctx = pinAndRegister(() => { hookCalls += 1; });
  try {
    const empty = await ctx.h.request("GET /api/schema/relations", { url: "/api/schema/relations" });
    assert.equal(empty.statusCode, 200);
    assert.deepEqual(empty.body.data.relations, []);
    assert.match(empty.body.data.revision, /^sha256:/);

    const put = await ctx.h.request("PUT /api/schema/relations", { body: { relations: [ROW], revision: empty.body.data.revision } });
    assert.equal(put.statusCode, 200, JSON.stringify(put.body));
    assert.equal(put.body.data.success, true);
    assert.equal(put.body.data.relations.length, 1);
    assert.equal(hookCalls, 1, "写后并源挂钩触发（投影重建由 main 注入）");

    // PR-200：契约 required 后，缺 revision 在传输层即拒（零落盘），载荷校验取新基线后再进
    const noRevision = await ctx.h.request("PUT /api/schema/relations", { body: { relations: [ROW] } });
    assert.equal(noRevision.statusCode, 400, "缺必填 revision 必须 400：" + JSON.stringify(noRevision.body));
    assert.equal(noRevision.body.error_code, "VALIDATION_ERROR");

    const afterWrite = await ctx.h.request("GET /api/schema/relations", { url: "/api/schema/relations" });
    const bad = await ctx.h.request("PUT /api/schema/relations", { body: { relations: [{ ...ROW, target: "不存在对象" }], revision: afterWrite.body.data.revision } });
    assert.equal(bad.statusCode, 400);
    assert.equal(bad.body.error_code, "RELATIONS_INVALID");

    const stale = await ctx.h.request("PUT /api/schema/relations", { body: { relations: [], revision: empty.body.data.revision } });
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.body.error_code, "RELATIONS_REVISION_CONFLICT");

    const hist = await ctx.h.request("GET /api/schema/relations/history", { url: "/api/schema/relations/history" });
    assert.equal(hist.statusCode, 200);
    assert.ok(Array.isArray(hist.body.data.snapshots));

    const rollbackBad = await ctx.h.request("POST /api/schema/relations/rollback", { body: { snapshotId: "bad id!" } });
    assert.equal(rollbackBad.statusCode, 400);
  } finally {
    ctx.restore();
    fs.rmSync(ctx.dir, { recursive: true, force: true });
  }
});
