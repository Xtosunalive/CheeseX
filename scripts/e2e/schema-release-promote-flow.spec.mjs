// @component: Schema 写链现状验证——Playwright 迁移件（WP-096 T3 批）
// @context: 旧件 scripts/e2e/schema-release-promote-flow.e2e.mjs 的运行器层等价迁移——
//   断言集逐条同源（旧 record() 步 ↔ 本 expect/test.step 块），不借机改测试口径：
//   ①schema-manager 页面地标 ②直接写回写门负例（不存在子实体 → fail-closed，零写）
//   ③退役端点保持退役（404/410——E' 系列退役面断言）④schema 域只读现状面 ⑤UI 现状一致性。
//   守卫（vault/作用域双通道）在 lib/playwright-global-setup.mjs 前置；契约锚定随本测
//   （旧件在 main() 内自锚——只锚正向端点，Step 3 退役面是有意调用的 404/410，不入锚）。
import { test, expect } from "@playwright/test";
// SPEC-011 WP1：e2e 物理隔离守卫（globalSetup 已前置，此处进程级再证——与旧件头部同形态）
import { requireE2EVault } from "./lib/e2e-env.mjs";
import { assertEndpointsInContract } from "./lib/contract-anchor.mjs";

const VAULT_PATH = requireE2EVault();
const API_BASE = process.env.API_BASE || "http://127.0.0.1:18083";

// 统一 fetch：响应体只读一次，非 JSON（如 410 静默页）落 null——与旧件 api() 同形
async function api(request, pathname, init) {
  const res = await request.fetch(`${API_BASE}${pathname}`, init);
  let body = null;
  try { body = await res.json(); } catch { /* 非 JSON */ }
  return { status: res.status(), ok: res.ok(), body };
}

test("Schema 写链现状验证（ADR043 直接写回语义）", async ({ page, request }) => {
  // 契约锚定：只锚定期望成功的正向端点——退役面（/api/schema/releases*）断言 404/410 为正确态，
  // 不属于"应在契约中"的引用（与旧件同口径）。
  assertEndpointsInContract([
    "PUT /api/schema/entity-parent",
    "GET /api/kg/classification/list",
  ]);
  void VAULT_PATH; // 守卫已证；本流只读不直写 vault（与旧件同）

  // Step 1: 加载图谱规则配置页（真断言地标；路由 id=schema——旧版 #/schema-manager 落
  // fallback 运行概览的恒真断言曾放过）
  await test.step("Step1 加载 schema-manager 视图", async () => {
    await page.goto("/#/schema", { waitUntil: "networkidle" });
    await expect(
      page.locator('[aria-label="图谱规则配置面板"]').first(),
      "Load schema manager view",
    ).toBeVisible();
  });

  // Step 2: 写门负例（契约 PUT /api/schema/entity-parent；childId 不存在 → 必须 fail-closed，零写）
  await test.step("Step2 写门负例（未知子实体 fail-closed）", async () => {
    const gate = await api(request, "/api/schema/entity-parent", {
      method: "PUT",
      data: { patch: { childId: "e2e-nonexistent-child-xyz" } },
    });
    expect(
      !gate.ok && gate.body?.success === false,
      `PUT entity-parent fails closed on unknown child（status=${gate.status} code=${gate.body?.error_code ?? gate.body?.errorCode ?? "??"}）`,
    ).toBe(true);
  });

  // Step 3: 退役面保持退役（ADR043/E3' 已删 schema release 状态机——410/404 是正确态）
  await test.step("Step3 退役端点保持退役", async () => {
    for (const retired of ["/api/schema/releases", "/api/schema/releases/r1/promote"]) {
      const r = await api(request, retired, { method: "POST" });
      expect(
        r.status === 404 || r.status === 410,
        `Retired endpoint stays retired: ${retired}（status=${r.status}）`,
      ).toBe(true);
    }
  });

  // Step 4: schema 域只读现状面（分类轴真端点）
  await test.step("Step4 分类轴只读现状面", async () => {
    const classification = await api(request, "/api/kg/classification/list");
    expect(
      classification.ok && classification.body?.success === true,
      `GET /api/kg/classification/list（status=${classification.status}）`,
    ).toBe(true);
  });

  // Step 5: UI 现状一致性（真断言：reload 后面板地标仍在——比文本 contains 更强）
  await test.step("Step5 UI 现状一致性", async () => {
    await page.reload({ waitUntil: "networkidle" });
    await expect(
      page.locator('[aria-label="图谱规则配置面板"]').first(),
      "Schema manager UI renders schema content",
    ).toBeVisible();
  });
});
