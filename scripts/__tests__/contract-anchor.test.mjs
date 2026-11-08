import assert from "node:assert/strict";
import test from "node:test";
import { assertEndpointsInContract, matchContractTemplate } from "../e2e/lib/contract-anchor.mjs";

// 层级标注：本测试为纯单元层——验证锚定器逻辑本身（模板匹配/方法核对/fail-closed 语义），
// 不启动服务、不发请求。验证对象：scripts/e2e/lib/contract-anchor.mjs。

test("matchContractTemplate: 精确路径命中", () => {
  const paths = { "/api/health": { get: {} } };
  assert.equal(matchContractTemplate("/api/health", paths), "/api/health");
});

test("matchContractTemplate: 路径参数模板命中（/{id} 匹配任意段）", () => {
  const paths = { "/api/articles/precleaned/{id}/standardization": { post: {} } };
  assert.equal(
    matchContractTemplate("/api/articles/precleaned/abc123/standardization", paths),
    "/api/articles/precleaned/{id}/standardization",
  );
});

test("matchContractTemplate: 段数不同不命中（防前缀误配）", () => {
  const paths = { "/api/articles/precleaned/{id}": { get: {} } };
  assert.equal(matchContractTemplate("/api/articles/precleaned", paths), null);
  assert.equal(matchContractTemplate("/api/articles/precleaned/a/b", paths), null);
});

test("assertEndpointsInContract: 6 条 E2E 实际调用的正向端点全部在契约（回归基线）", () => {
  // 清单与 6 个 e2e 脚本的实际正向调用一一对应（勘探 2026-09-27 提取）；
  // 退役端点（/api/schema/releases* 断言 404/410 的负向调用）刻意不列入锚定。
  const ok = assertEndpointsInContract([
    "GET /api/health",
    "GET /api/dashboard/topology",
    "GET /api/property/check",
    "GET /api/kg/pending-review",
    "GET /api/kg/review-history",
    "POST /api/kg/review",
    "GET /api/kg/classification/list",
    "POST /api/articles/upload",
    "POST /api/articles/drafts/validate",
    "POST /api/articles/drafts/promote",
    "GET /api/articles/precleaned",
    "POST /api/articles/precleaned/{id}/standardization",
    "GET /api/entity/check",
    "POST /api/entity/repair/preview",
    "PUT /api/schema/entity-parent",
    "POST /api/pipeline/run",
    "GET /api/pipeline/status",
    "POST /api/anomalies/reconcile",
  ]);
  assert.equal(ok, true);
});

test("assertEndpointsInContract: 幽灵端点 → fail-closed 抛出并点名（反例，防恒真）", () => {
  // #1828 家族反例：契约中不存在的端点必须让锚定器红——本测试自身就是该门禁的红灯证据。
  assert.throws(
    () => assertEndpointsInContract(["GET /api/review/actions"]),
    /幽灵端点检测失败[\s\S]*\/api\/review\/actions/,
  );
});

test("assertEndpointsInContract: 端点存在但方法错 → fail-closed（防方法漂移）", () => {
  assert.throws(
    () => assertEndpointsInContract(["PUT /api/health"]),
    /无此方法/,
  );
});
