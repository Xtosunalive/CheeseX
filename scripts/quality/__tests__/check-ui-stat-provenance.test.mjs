// Layer: gate test（quality 脚本域）· 验证对象: scripts/quality/check-ui-stat-provenance.mjs
// 先红后绿：真仓须 ok（12 文件 38 点 10 来源）；夹具覆盖 R1 覆盖/点数/幽灵、R2 出处、R3 口径反例必红。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runUiStatProvenance } from "../check-ui-stat-provenance.mjs";

// 构造最小绿态：一个视图文件含 1 个 Statistic，登记来源 /api/demo，OpenAPI 含该路径且有 summary
function fixture({
  statText = "<Statistic label=\"x\" value={1} />",
  extraFrontendFile = null,
  manifestOverrides = null,
  openapiPath = "/api/demo",
  withSummary = true,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ui-stat-prov-"));
  const dir = path.join(root, "src", "features", "demo");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "DemoView.tsx"), statText);
  if (extraFrontendFile) {
    fs.mkdirSync(path.dirname(path.join(root, extraFrontendFile.rel)), { recursive: true });
    fs.writeFileSync(path.join(root, extraFrontendFile.rel), extraFrontendFile.text);
  }

  const views = [{
    view: "demo",
    file: "src/features/demo/DemoView.tsx",
    statCount: 1,
    dataModule: "demo-api",
    sourceApis: [openapiPath],
  }];
  const manifest = {
    schema_version: 1,
    title: "t",
    description: "d",
    views,
    excluded: [{ file: "src/components/statistic/Statistic.tsx", reason: "组件定义" }],
  };
  if (manifestOverrides) manifestOverrides(manifest);
  fs.mkdirSync(path.join(root, "contracts"), { recursive: true });
  fs.writeFileSync(path.join(root, "contracts", "ui-stat-provenance.json"), JSON.stringify(manifest));

  const getOp = withSummary ? { tags: ["t"], summary: "demo 口径" } : { tags: ["t"] };
  const doc = { openapi: "3.1.0", paths: { [openapiPath]: { get: getOp } } };
  fs.writeFileSync(path.join(root, "contracts", "http-api.openapi.json"), JSON.stringify(doc));
  return root;
}

test("真仓：12 文件 38 点 13 来源全部合规，0 违例", () => {
  // 来源数 14→13＝Radix 收尾批（a63a9af9）某视图实际取数端点收敛一台——检查器 ok（登记面⊇实际），
  // 期望随实际取数面更新；files/statPoints/views 三项不变＝谓词面与统计点未被触碰（2026-11-08 落地收尾批实测复核）。前史：10→14＝WP-134 波4 登记面纠偏（四条视图补上实际取数端点：readiness／inference-conflicts／
  // dashboard topology／candidates search＋document detail）。files/statPoints/views 三项不变＝
  // 谓词面与统计点未被触碰，这正是本批「只纠偏不扩面」的读数证据；若有人扩了标签谓词，本例会红。
  const result = runUiStatProvenance();
  assert.equal(result.ok, true, result.violations.join("\n"));
  assert.deepEqual(result.stats, { files: 12, statPoints: 38, views: 12, sourceApis: 13 });
});

test("绿：合规夹具（视图登记＋来源存在＋有 summary）→ ok", () => {
  const root = fixture();
  const result = runUiStatProvenance({ rootDir: root });
  assert.equal(result.ok, true, result.violations.join("\n"));
  assert.equal(result.stats.statPoints, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test("红 R1：前端多出未登记的 Statistic 文件 → 未登记", () => {
  const root = fixture({
    extraFrontendFile: {
      rel: "src/features/other/OtherView.tsx",
      text: "<Statistic label=\"y\" value={2} />",
    },
  });
  const result = runUiStatProvenance({ rootDir: root });
  assert.equal(result.ok, false);
  assert.match(result.violations.join("\n"), /未登记.*OtherView/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("红 R1：视图实际点数与清单 statCount 不符 → 点数不符", () => {
  const root = fixture({
    statText: "<Statistic label=\"a\" value={1} />\n<Statistic label=\"b\" value={2} />",
  });
  const result = runUiStatProvenance({ rootDir: root });
  assert.equal(result.ok, false);
  assert.match(result.violations.join("\n"), /点数不符/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("红 R1：清单登记但前端无该文件 → 幽灵登记", () => {
  const root = fixture({
    manifestOverrides: (m) => {
      m.views[0].file = "src/features/ghost/GhostView.tsx";
    },
  });
  const result = runUiStatProvenance({ rootDir: root });
  assert.equal(result.ok, false);
  assert.match(result.violations.join("\n"), /幽灵登记/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("红 R2：来源 API 不在 OpenAPI paths → 出处不存在", () => {
  const root = fixture({
    manifestOverrides: (m) => { m.views[0].sourceApis = ["/api/missing"]; },
  });
  const result = runUiStatProvenance({ rootDir: root });
  assert.equal(result.ok, false);
  assert.match(result.violations.join("\n"), /出处不存在.*\/api\/missing/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("红 R3：来源 operation 无 summary 也无 description → 口径缺失", () => {
  const root = fixture({ withSummary: false });
  const result = runUiStatProvenance({ rootDir: root });
  assert.equal(result.ok, false);
  assert.match(result.violations.join("\n"), /口径缺失/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("绿：来源用 description 而非 summary 也认可", () => {
  const root = fixture({
    withSummary: false,
    manifestOverrides: (m) => {
      // openapi 由 fixture 主流程生成，这里通过改 openapiPath 不变，直接在生成后另写
    },
  });
  // 覆写 OpenAPI，把 summary 换成 description
  const doc = JSON.parse(fs.readFileSync(path.join(root, "contracts", "http-api.openapi.json"), "utf8"));
  doc.paths["/api/demo"].get = { description: "详细口径" };
  fs.writeFileSync(path.join(root, "contracts", "http-api.openapi.json"), JSON.stringify(doc));
  const result = runUiStatProvenance({ rootDir: root });
  assert.equal(result.ok, true, result.violations.join("\n"));
  fs.rmSync(root, { recursive: true, force: true });
});
