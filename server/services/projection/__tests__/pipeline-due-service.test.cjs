// @tests: server/services/projection/pipeline-due-service.cjs（SPEC-025 C2 触发收敛＋运行时摄取接线）
// 层级：纯单元——runScript/ingestStagedGraph/recordGraphRefreshed 全注入，零真实进程零真实库。
//   钉死的不变量：①due 才抽取、成功才 mark-run；②抽取成功即运行时摄取＋记刷新基线（「服务跑着=自动更新」
//   的可见性兑现）；③摄取失败 fail-open（运行仍记 ok，warn 落账）；④check/抽取失败零副作用。
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { createPipelineDueService } = require("../pipeline-due-service.cjs");
// buildSpawnEnv 单测随 WP-069 §3.1 退役——env 组装职责移交唯一拉起模块，
// 其行为契约（回落/透传/优先级＋身份变量禁携）由 server/shared/__tests__/vault-runtime-spawn.test.cjs 承接。

function makeService({ responses = {}, ingest, record, injectDeps = true } = {}) {
  const calls = { scripts: [], traces: [], warns: [], ingest: 0, record: 0 };
  const svc = createPipelineDueService({
    logger: { warn: (e) => calls.warns.push(e), info: () => {} },
    telemetry: { recordTrace: (kind, payload) => calls.traces.push({ kind, payload }) },
    runScript: async (script, args) => {
      const key = `${script} ${args.join(" ")}`;
      calls.scripts.push(key);
      const r = responses[key];
      if (r === "THROW") throw new Error(`${key} failed`);
      return r === undefined ? "" : r;
    },
    ...(injectDeps
      ? {
          ingestStagedGraph: ingest === undefined ? () => { calls.ingest += 1; return { graphArtifacts: 1 }; } : ingest,
          recordGraphRefreshed: record === undefined ? () => { calls.record += 1; } : record,
        }
      : {}),
  });
  return { svc, calls };
}

test("due 即抽取：成功后 mark-run＋运行时摄取＋记刷新基线＋trace ok", async () => {
  const { svc, calls } = makeService({ responses: { "pipeline_due.py --check": '{"due":true,"reason":"count>=1"}' } });
  const result = await svc.runIfDue();
  assert.equal(result.ran, true);
  assert.deepEqual(calls.scripts, [
    "pipeline_due.py --check",
    "extract_graph.py --apply --incremental",
    "pipeline_due.py --mark-run",
  ]);
  assert.equal(calls.ingest, 1, "抽取成功即运行时摄取");
  assert.equal(calls.record, 1, "摄取成功后记图族刷新基线");
  const runTrace = calls.traces.find((t) => t.kind === "pipeline-run");
  assert.equal(runTrace.payload.ok, true);
  assert.deepEqual(runTrace.payload.ingested, { graphArtifacts: 1 });
  assert.equal(calls.warns.length, 0);
});

test("not due：只 check，零抽取零摄取", async () => {
  const { svc, calls } = makeService({ responses: { "pipeline_due.py --check": '{"due":false}' } });
  const result = await svc.runIfDue();
  assert.equal(result.ran, false);
  assert.deepEqual(calls.scripts, ["pipeline_due.py --check"]);
  assert.equal(calls.ingest, 0);
});

test("抽取失败：不 mark-run、不摄取、trace ok=false", async () => {
  const { svc, calls } = makeService({
    responses: { "pipeline_due.py --check": '{"due":true,"reason":"x"}', "extract_graph.py --apply --incremental": "THROW" },
  });
  const result = await svc.runIfDue();
  assert.equal(result.ran, false);
  assert.deepEqual(calls.scripts, ["pipeline_due.py --check", "extract_graph.py --apply --incremental"]);
  assert.equal(calls.ingest, 0);
  const runTrace = calls.traces.find((t) => t.kind === "pipeline-run");
  assert.equal(runTrace.payload.ok, false);
});

test("摄取失败 fail-open：运行仍记 ok、ingested=null、warn 落账", async () => {
  const { svc, calls } = makeService({
    responses: { "pipeline_due.py --check": '{"due":true,"reason":"x"}' },
    ingest: () => { throw new Error("db locked"); },
  });
  const result = await svc.runIfDue();
  assert.equal(result.ran, true);
  assert.deepEqual(calls.scripts, [
    "pipeline_due.py --check",
    "extract_graph.py --apply --incremental",
    "pipeline_due.py --mark-run",
  ]);
  assert.equal(calls.record, 0, "摄取失败不记基线");
  assert(calls.warns.some((w) => w && w.event === "pipeline-due-ingest-failed"));
  const runTrace = calls.traces.find((t) => t.kind === "pipeline-run");
  assert.equal(runTrace.payload.ok, true);
  assert.equal(runTrace.payload.ingested, null);
});

test("未注入摄取依赖时照常成功（向后兼容）", async () => {
  const { svc, calls } = makeService({
    injectDeps: false,
    responses: { "pipeline_due.py --check": '{"due":true,"reason":"x"}' },
  });
  const result = await svc.runIfDue();
  assert.equal(result.ran, true);
  assert.equal(calls.warns.length, 0);
  const runTrace = calls.traces.find((t) => t.kind === "pipeline-run");
  assert.equal(runTrace.payload.ingested, null);
});
