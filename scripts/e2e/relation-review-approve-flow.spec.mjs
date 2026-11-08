// @component: 关系审核→批准/驳回→账本闭环——Playwright 迁移件（WP-096 T3 批）
// @context: 旧件 scripts/e2e/relation-review-approve-flow.e2e.mjs 的运行器层等价迁移——
//   真实 API 链 = GET /api/kg/pending-review + POST /api/kg/review（浏览器代发）+ GET /api/kg/review-history。
//   断言集逐条同源（旧 record() 步 ↔ 本 expect/test.step 块；旧 observe() 软观察 ↔ console.log，
//   只记不判不计入断言），不借机改测试口径：
//   真闭环硬断言＝账本 records +1；pending 计数联动因 K-P1-1 edgeId 失配降为一致性观察（旧件同口径）。
//   本流对测试库执行真实审批写（review_actions 账本 + master_graph reviewStatus）——仅 E2E fixture 运行。
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

// 每次 API 读即断言（旧件 readPending/readHistoryCount 的 record 同位同语义）
async function readPending(request) {
  const r = await api(request, "/api/kg/pending-review");
  expect(r.ok, "GET /api/kg/pending-review ok").toBeTruthy();
  expect(
    typeof r.body?.data?.pending,
    `GET /api/kg/pending-review 形状（pending=${r.body?.data?.pending} approved=${r.body?.data?.approved}）`,
  ).toBe("number");
  return r.body?.data;
}
async function readHistoryCount(request) {
  const r = await api(request, "/api/kg/review-history");
  expect(r.ok, "GET /api/kg/review-history ok").toBeTruthy();
  expect(Array.isArray(r.body?.data?.records), `GET /api/kg/review-history 形状（records=${r.body?.data?.records?.length}）`).toBe(true);
  return r.body?.data?.records?.length ?? 0;
}

test("关系审核 → 批准/驳回 → 账本闭环验证", async ({ page, request }) => {
  // 契约锚定：审批/驳回经 UI 按钮触发（浏览器代发 POST /api/kg/review），一并锚定（旧件同位）
  assertEndpointsInContract([
    "GET /api/kg/pending-review",
    "POST /api/kg/review",
    "GET /api/kg/review-history",
  ]);
  void VAULT_PATH; // 守卫已证；本流写路径全经公开 API（与旧件同）

  // Step 1: 加载关系审核页——911e42d 删页内 h1 后页面名唯一承载=PageHeader app-bar-location
  //（heading 断言自此恒超时假红，旧件已对齐，本迁移沿用 app-bar-location 锚点）
  await test.step("Step1 加载关系审核视图", async () => {
    await page.goto("/#/review", { waitUntil: "networkidle" });
    await expect(
      page.locator('[data-testid="app-bar-location"]').filter({ hasText: "关系审核" }).first(),
      "Load review view (#/review)",
    ).toBeVisible();
  });

  // Step 2: API 基线（pending / 账本 records）
  let baseline;
  let historyBefore;
  await test.step("Step2 读基线", async () => {
    baseline = await readPending(request);
    historyBefore = await readHistoryCount(request);
  });

  if (baseline.pending === 0) {
    console.log("• observe: No pending relations — 测试库当前无待审核关系——批准/驳回闭环无法执行（造数属独立前置步骤）");
  }

  // Step 3: UI 表格 + 批准按钮（真断言：有待审行时必须能找到「批准」按钮）
  let approveButton = null;
  await test.step("Step3 批准按钮可见性", async () => {
    if (baseline.pending > 0) {
      approveButton = page.getByRole("button", { name: /^批准/ }).first();
      await expect(approveButton, "Approve button visible in table").toBeVisible();
    } else {
      console.log("• observe: Approve button check skipped — pending=0");
    }
  });

  // Step 4: 点击批准 → 真闭环断言（账本 +1 硬断言；pending 联动=一致性观察，K-P1-1 失配下预期不动）
  let historyAfterApproveCount = historyBefore;
  await test.step("Step4 批准闭环（账本 +1）", async () => {
    if (!approveButton) {
      console.log("• observe: Approve loop skipped — 无待审关系");
      return;
    }
    await approveButton.click();
    // toast「已批准关系:」出现（UI 反馈真断言）
    await expect(page.getByText("已批准关系").first(), "Approve toast visible").toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1500);

    const afterApprove = await readPending(request);
    historyAfterApproveCount = await readHistoryCount(request);
    // ⚠️ 已知缺陷（非本流缺陷）：审批写账本成功但 pending 计数不动——K-P1-1 账本 edgeId
    // （a|b|TYPE|file|line|sha）与存储边（edge-*）格式失配致投影回 pending（GIT-CONTEXT 金路径残余红登记）。
    // 账本+1 是审批写路径的硬闭环断言；pending 联动降为一致性观察，K 系列收口后应升回硬断言。
    console.log(`• observe: Pending counter consistency — approve 后 pending ${baseline.pending} → ${afterApprove.pending}（K-P1-1 失配下预期不动；修复后应 -1）`);
    expect(
      historyAfterApproveCount === historyBefore + 1,
      `Ledger grew by 1（${historyBefore} → ${historyAfterApproveCount}）`,
    ).toBe(true);
  });

  // Step 5: 驳回闭环（若仍有待审行）
  await test.step("Step5 驳回闭环（账本 +1）", async () => {
    const mid = await readPending(request);
    if (mid.pending <= 0) {
      console.log("• observe: Reject loop skipped — 仅剩/无待审关系");
      return;
    }
    const rejectButton = page.getByRole("button", { name: /^驳回/ }).first();
    await expect(rejectButton, "Reject button visible in table").toBeVisible();
    await rejectButton.click();
    await expect(page.getByText("已驳回关系").first(), "Reject toast visible").toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1500);
    const afterReject = await readPending(request);
    const historyAfterReject = await readHistoryCount(request);
    console.log(`• observe: Pending counter consistency (reject) — 驳回后 pending ${mid.pending} → ${afterReject.pending}（同 K-P1-1）`);
    expect(
      historyAfterReject === historyAfterApproveCount + 1,
      `Reject ledger grew by 1（ledger → ${historyAfterReject}）`,
    ).toBe(true);
  });
});
