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

test("真仓：3 文件 7 点 3 来源全部合规，0 违例", () => {
  // 3 文件不变／4→7 点＝2026-11-17 第 3 批补登 workbench 视图（第 2 批漏账；pending-review 经 store 接线非直拉不入登记）；前史：9→3 文件／16→4 点＝MAIC 形态批（Master 实测 OpenMAIC 后裁 A 全套对齐：常驻统计卡
  // 全退役——dashboard/document-inventory/article-workflow/entity-compliance/property-check-results/
  // property-manifest-list 六视图清出登记，仅存数据仪表盘 2＋拓扑缺口 1＋待审关系 1）。前史：
  // 12→10 文件／38→33 点＝量值对齐批（退役五卡）；10→9／33→16＝概览退役两波（映射 11→1、实体合规
  // 5→3、投稿 2→1、检查结果 3→2）。来源 12→3＝随视图清出同批收敛。
  const result = runUiStatProvenance();
  assert.equal(result.ok, true, result.violations.join("\n"));
  assert.deepEqual(result.stats, { files: 3, statPoints: 7, views: 3, sourceApis: 3 });
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
