// Layer: gate test（quality 脚本域）· 验证对象: scripts/quality/gen-ui-stat-provenance.mjs（WP-136 b 派生器）
// 判据：①真仓派生须与登记逐字一致（幂等——`--check` 绿的同义）②改 apiSources 即漂（撤线即红）
// ③`paths["/api/..."]` 类型索引不得算成一次调用④契约外端点必须抛（不静默登记）⑤模板串与 query 须归一回契约拼写。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deriveSourceApis, build } from "../gen-ui-stat-provenance.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const openapiOf = (root) => JSON.parse(fs.readFileSync(path.join(root, "contracts", "http-api.openapi.json"), "utf8"));
const realOpenapi = openapiOf(ROOT);

test("①真仓幂等：12 视图派生结果与登记面逐字一致（--check 的等价判据）", () => {
  const { registry, changedViews, total } = build(ROOT);
  const registered = JSON.parse(fs.readFileSync(path.join(ROOT, "contracts", "ui-stat-provenance.json"), "utf8"));
  assert.equal(total, registry.views.length);
  assert.equal(changedViews, 0, `派生与登记漂移的视图数应为 0，实为 ${changedViews}`);
  for (const v of registry.views) {
    const hand = registered.views.find((x) => x.view === v.view);
    assert.deepEqual(v.sourceApis, hand.sourceApis, `${v.view} 派生≠登记`);
    assert.ok(v.apiSources?.length >= 1, `${v.view} 缺 apiSources`);
    assert.ok(!("dataModule" in v), `${v.view} 仍带已退役的 dataModule 字段`);
  }
});

test("②撤线即红：把某视图的 apiSources 换成另一次真实调用，派生面必须漂移", () => {
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, "contracts", "ui-stat-provenance.json"), "utf8"));
  const view = registry.views.find((v) => v.view === "admission");
  const original = [...view.apiSources];
  // 换成本模块内另一次调用（classification/list）——登记面记的是 canvas-admission，二者必不等
  view.apiSources = ["src/features/admission/admission-api.ts#fetchClassificationList"];
  const derived = deriveSourceApis(ROOT, view.apiSources, realOpenapi);
  assert.deepEqual(derived, ["/api/kg/classification/list"]);
  assert.notDeepEqual(derived, view.sourceApis, "改口径后派生结果仍等于旧登记＝本例判力为零");
  view.apiSources = original;
  assert.deepEqual(deriveSourceApis(ROOT, view.apiSources, realOpenapi), view.sourceApis, "复原后应回到一致（本例自净）");
});

test("③类型索引不是调用：admission-api#fetchCanvasAdmission 只派生 canvas-admission 一条", () => {
  // 该模块在函数外的类型别名里引用过 paths["/api/kg/canvas-admission"]，函数后还跟着
  // paths["/api/kg/classification/list"]——排除逻辑若被摘掉，这里会多出第二条或重复第一条
  assert.deepEqual(deriveSourceApis(ROOT, ["src/features/admission/admission-api.ts#fetchCanvasAdmission"], realOpenapi), ["/api/kg/canvas-admission"]);
});

test("④契约外端点必须抛，不得静默写进登记面", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ui-stat-gen-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "x-api.ts"), 'export async function fetchX() {\n  return apiFetchJson("/api/not-in-contract");\n}\n');
  const openapi = { paths: { "/api/demo": { get: { summary: "demo" } } } };
  assert.throws(
    () => deriveSourceApis(root, ["src/x-api.ts#fetchX"], openapi),
    /契约 paths 无此项/,
    "认不出的端点字面必须炸（否则登记面会收到契约外出处）",
  );
});

test("⑤归一：query 与模板占位要回到契约拼写，不是代码字面", () => {
  assert.deepEqual(deriveSourceApis(ROOT, ["src/features/document-inventory/document-inventory-api.ts#fetchDocument"], realOpenapi), ["/api/documents/{documentId}"]);
  assert.deepEqual(deriveSourceApis(ROOT, ["src/features/article-workflow/article-workflow-api.ts#fetchArticleUploads"], realOpenapi), ["/api/articles/uploads"]);
  assert.deepEqual(deriveSourceApis(ROOT, ["src/features/entity-compliance/entity-compliance-api.ts#fetchEntityCompliance"], realOpenapi), ["/api/entity/check"]);
});
