// @component: Dashboard 运行概览→管道诊断（零副作用）→图谱投影一致性——Playwright 迁移件（WP-096 T3 批）
// @context: 旧件 scripts/e2e/dashboard-pipeline-integration-flow.e2e.mjs 的运行器层等价迁移——
//   断言集逐条同源（旧 record() 步 ↔ 本 expect/test.step 块；旧 observe() 软观察 ↔ console.log），
//   不借机改测试口径。关键语义（G-e/#1773 教训立法）：POST /api/pipeline/run = 只读全局诊断
//  （purpose=global_diagnostic，不发布主图）——据此断言「诊断零副作用」totalEdges 诊断前后不变。
//   守卫（vault/作用域双通道）在 lib/playwright-global-setup.mjs 前置；契约锚定随本测（旧件同位）。
import { test, expect } from "@playwright/test";
// SPEC-011 WP1：e2e 物理隔离守卫（globalSetup 已前置，此处进程级再证——与旧件头部同形态）
import { requireE2EVault } from "./lib/e2e-env.mjs";
import { assertEndpointsInContract } from "./lib/contract-anchor.mjs";

const VAULT_PATH = requireE2EVault();
const API_BASE = process.env.API_BASE || "http://127.0.0.1:18083";

// 统一 fetch：响应体只读一次，非 JSON 落 null——与旧件 api() 同形
async function api(request, pathname, init) {
  const res = await request.fetch(`${API_BASE}${pathname}`, init);
  let body = null;
  try { body = await res.json(); } catch { /* 非 JSON */ }
  return { status: res.status(), ok: res.ok(), body };
}

// 图谱投影读面：形状断言随每次读（旧件 readTopology 的 record 同位同语义）
async function readTopology(request) {
  const r = await api(request, "/api/dashboard/topology?scope=full");
  expect(
    r.ok && r.body?.success === true && Array.isArray(r.body?.data?.topology?.nodes) && Array.isArray(r.body?.data?.topology?.edges),
    `GET /api/dashboard/topology（status=${r.status} nodes=${r.body?.data?.topology?.nodes?.length ?? "?"} totalEdges=${r.body?.data?.totalEdges ?? "?"}）`,
  ).toBe(true);
  return {
    nodes: r.body?.data?.topology?.nodes?.length ?? 0,
    totalEdges: typeof r.body?.data?.totalEdges === "number" ? r.body.data.totalEdges : null,
  };
}

test("Dashboard 运行概览 → 管道诊断（零副作用契约）→ 图谱投影一致性", async ({ page, request }) => {
  // 诊断轮询上界 30×2s=60s，叠加页面加载与诊断执行，给足运行器超时余量（断言语义不变）
  test.setTimeout(180_000);
  // 契约锚定（旧件同位）
  assertEndpointsInContract([
    "GET /api/dashboard/topology",
    "GET /api/kg/pending-review",
    "POST /api/pipeline/run",
    "GET /api/pipeline/status",
  ]);
  void VAULT_PATH; // 守卫已证；本流只读＋诊断（零发布，与旧件同）

  // Step 1: 加载运行概览页（#/dashboard，非图谱检索页——后者由 seq212 切片测试承载）。
  // 911e42d 删页内 h1 主标题——页面名唯一承载=PageHeader app-bar-location。
  await test.step("Step1 加载运行概览", async () => {
    await page.goto("/#/dashboard", { waitUntil: "networkidle" });
    await expect(
      page.locator('[data-testid="app-bar-location"]').filter({ hasText: "运行概览" }).first(),
      "Load dashboard (#/dashboard)",
    ).toBeVisible();
  });

  // Step 2: 图谱投影基线（契约端点 + 形状断言）
  let before;
  await test.step("Step2 图谱投影基线", async () => {
    before = await readTopology(request);
    console.log(`• observe: Baseline counts — nodes=${before.nodes} totalEdges=${before.totalEdges}`);
  });

  // Step 3: 管道状态（契约端点存在 + state 字段）
  let canRun = false;
  await test.step("Step3 管道状态", async () => {
    const status1 = await api(request, "/api/pipeline/status");
    expect(
      status1.ok && typeof status1.body?.data?.state === "string",
      `GET /api/pipeline/status（state=${status1.body?.data?.state}）`,
    ).toBe(true);
    canRun = ["idle", "failed", "succeeded"].includes(status1.body?.data?.state);
  });

  // Step 4: 触发全局诊断（quick 档只读，不发布主图——契约 purpose=global_diagnostic）
  let diagnosticSucceeded = false;
  await test.step("Step4 全局诊断（quick，零发布）", async () => {
    if (!canRun) {
      console.log(`• observe: Pipeline diagnostic skipped — state 非 idle/succeeded/failed`);
      return;
    }
    const start = await api(request, "/api/pipeline/run?mode=quick", { method: "POST" });
    expect(
      start.ok && start.body?.success === true,
      `POST /api/pipeline/run?mode=quick（status=${start.status}）`,
    ).toBe(true);
    for (let attempt = 0; attempt < 30; attempt++) {
      await page.waitForTimeout(2000);
      const s = await api(request, "/api/pipeline/status");
      const state = s.body?.data?.state;
      if (state === "succeeded") { diagnosticSucceeded = true; break; }
      if (state === "failed") break;
    }
    expect(diagnosticSucceeded, "Pipeline diagnostic completed").toBe(true);
  });

  // Step 5: 诊断零副作用断言（契约语义：run 不发布主图 → totalEdges 不变）
  await test.step("Step5 诊断零副作用（totalEdges 不变）", async () => {
    const after = await readTopology(request);
    if (!diagnosticSucceeded) {
      console.log("• observe: Zero-publish check skipped — 诊断未执行");
      return;
    }
    expect(
      after.totalEdges === before.totalEdges,
      `Diagnostic zero-publish (totalEdges unchanged)（before=${before.totalEdges} after=${after.totalEdges}）`,
    ).toBe(true);
  });

  // Step 6: 运行概览 UI 统计可见（真断言：必须出现节点/关系计数词）
  await test.step("Step6 运行概览统计可见", async () => {
    const hasStats = await page.evaluate(() => {
      const text = document.body.textContent || "";
      return text.includes("实体") || text.includes("关系");
    });
    expect(hasStats, "Dashboard UI stats visible").toBe(true);
  });

  // Step 7: 待审核关系计数（契约端点 /api/kg/pending-review）
  await test.step("Step7 待审核关系计数", async () => {
    const pending = await api(request, "/api/kg/pending-review");
    expect(
      pending.ok && typeof pending.body?.data?.pending === "number",
      `GET /api/kg/pending-review（pending=${pending.body?.data?.pending} approved=${pending.body?.data?.approved}）`,
    ).toBe(true);
  });

  // Step 8: 质量指标词可见（真断言）
  await test.step("Step8 质量指标可见", async () => {
    const hasQuality = await page.evaluate(() => {
      const text = document.body.textContent || "";
      return text.includes("通过") || text.includes("阻断") || text.includes("警告");
    });
    expect(hasQuality, "Quality metrics visible").toBe(true);
  });
});
