// @component: 图谱检索枢纽→管道诊断（零副作用）→图谱投影一致性——Playwright 迁移件（WP-096 T3 批；2026-11-17 运行概览退役批改钉 #/data-dashboard；2026-11-18 终验批随批迁移 Step6/8 断言宿主——Step6 关系分布改断言拓扑页签「图谱构成分布」折叠子视图、Step8 同步日志区块已退役改断言 ReleaseMintCard 发布入口）
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

test("图谱检索枢纽 → 管道诊断（零副作用契约）→ 图谱投影一致性", async ({ page, request }) => {
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

  // Step 1: 加载图谱检索枢纽（#/data-dashboard；2026-11-17 运行概览退役后本旅程宿主页随之改挂）。
  // 页面名唯一承载=PageHeader app-bar-location。
  await test.step("Step1 加载图谱检索枢纽", async () => {
    await page.goto("/#/data-dashboard", { waitUntil: "networkidle" });
    await expect(
      page.locator('[data-testid="app-bar-location"]').filter({ hasText: "图谱检索" }).first(),
      "Load graph explorer (#/data-dashboard)",
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

  // Step 6: 关系分布呈现（2026-11-17 运行概览退役批：关系类型占比条迁图谱检索枢纽拓扑页签尾
  // 「图谱构成分布」子视图——默认折叠，展开后断言；断言对象不变，宿主面随批迁移）
  await test.step("Step6 拓扑页签图谱构成分布显示关系分布", async () => {
    await page.getByRole("button", { name: "图谱构成分布" }).click();
    await expect(page.getByText("关系类型分布", { exact: true })).toBeVisible();
  });

  // Step 7: 待审核关系计数（契约端点 /api/kg/pending-review）
  await test.step("Step7 待审核关系计数", async () => {
    const pending = await api(request, "/api/kg/pending-review");
    expect(
      pending.ok && typeof pending.body?.data?.pending === "number",
      `GET /api/kg/pending-review（pending=${pending.body?.data?.pending} approved=${pending.body?.data?.approved}）`,
    ).toBe(true);
  });

  // Step 8: 独立发布入口可见（同步日志/最近生成区块已随 2026-11-17 退役批撤——数据源已死，
  // 新鲜度职责由自动刷新兑现；全库定版发布卡＝ReleaseMintCard 住拓扑页签尾，断言保留发布入口）
  await test.step("Step8 全库定版发布入口可见", async () => {
    await expect(page.getByRole("button", { name: "发布", exact: true })).toBeEnabled();
  });
});
