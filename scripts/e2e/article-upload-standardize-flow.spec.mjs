// @component: 投稿上传→标准化→候选列表→审批发布闭环——Playwright 迁移件（WP-096 T3 批）
// @context: 旧件 scripts/e2e/article-upload-standardize-flow.e2e.mjs 的运行器层等价迁移——
//   断言集逐条同源（旧 record() 步 ↔ 本 expect/test.step 块；旧 observe() 软观察 ↔ console.log），
//   不借机改测试口径：
//   ①upload 请求体对齐契约 ArticleUploadRequest{fileName, contentBase64}（真 Base64）；
//   ②标准化走真端点 POST /api/articles/precleaned/{id}/standardization {confirmed:true}；
//   ③WP-104 审批绑定消费返回值（revision 对账）；④WP-103 已批准后修改的同身份恢复路径
//  （旧批准绝不可发布新内容：409 APPROVAL_EVIDENCE_STALE / STATE_TRANSITION_FORBIDDEN 三态负例）。
//   注意：本流对测试 Vault 执行真实写入（投稿→precleaned→发布快照），文件名带时间戳可追溯，
//   无删除端点——留档不清理（旧件同口径）。
//   守卫（vault/作用域双通道）在 lib/playwright-global-setup.mjs 前置；契约锚定随本测（旧件同位）。
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("投稿上传 → 标准化 → 候选列表 → 审批发布闭环", async ({ page, request }) => {
  // 审批状态机多轮刷新/恢复轮询叠加，给足运行器超时余量（断言语义不变）
  test.setTimeout(240_000);
  // 契约锚定（旧件同位）
  assertEndpointsInContract([
    "POST /api/articles/upload",
    "POST /api/articles/drafts/validate",
    "POST /api/articles/drafts/promote",
    "GET /api/articles/precleaned",
    "POST /api/articles/precleaned/{id}/standardization",
    "GET /api/approval/status/{articleId}",
    "POST /api/approval/{articleId}/transition",
    "PATCH /api/articles/precleaned/{id}/fields",
  ]);

  const stamp = Date.now();
  const fileName = `e2e-test-article-${stamp}.md`;
  // frontmatter 取值对齐最小 vault 枚举集（PR-014/PR-046/PR-151 谱系，旧件同表——
  // arch_layer/arch_category 必填随字段字典派生，夹具值即夹具 enums.yaml 已配值）
  const content = `---
title: E2E 测试文章 ${stamp}
product: E2eProduct
version: 1.0.0
module: e2e-module
article_type: 排错指南
doc-type: 用户手册
category-path: ops:maintain
arch_layer: service
arch_category: 服务
tags: [test, e2e]
---

# E2E 测试文章 ${stamp}

投稿→标准化→检索闭环的 E2E 造数文章（时间戳可追溯）。
`;

  // Step 1: 加载文章准入页——911e42d 删页内 h1 后页面名唯一承载=PageHeader app-bar-location
  await test.step("Step1 加载文章准入视图", async () => {
    await page.goto("/#/article-workflow", { waitUntil: "networkidle" });
    await expect(
      page.locator('[data-testid="app-bar-location"]').filter({ hasText: "文章准入" }).first(),
      "Load article workflow view",
    ).toBeVisible();
  });

  // Step 2: 上传（契约请求体：contentBase64 必须是真 Base64）
  let taskId;
  await test.step("Step2 API 投稿上传", async () => {
    const upload = await api(request, "/api/articles/upload", {
      method: "POST",
      data: {
        fileName,
        contentBase64: Buffer.from(content, "utf8").toString("base64"),
      },
    });
    expect(
      upload.ok && upload.body?.success === true,
      `POST /api/articles/upload（status=${upload.status}）`,
    ).toBe(true);
    taskId = upload.body?.data?.taskId ?? null;
    expect(
      typeof taskId === "string" || typeof taskId === "number",
      `Upload returned taskId（taskId=${taskId}）`,
    ).toBe(true);
  });

  // Step 3: 任务终态（契约状态机：上传落 raw/drafts/投稿 → awaiting_architect_processing）
  let draftPath = null;
  await test.step("Step3 上传任务终态轮询", async () => {
    expect(taskId != null, "Upload task status pollable（无 taskId 可轮询）").toBe(true);
    for (let attempt = 0; attempt < 10; attempt++) {
      const s = await api(request, `/api/articles/status/${taskId}`);
      const state = s.body?.data?.status;
      draftPath = s.body?.data?.draftPath ?? null;
      if (state === "awaiting_architect_processing" || state === "succeeded") break;
      await sleep(1500);
    }
    const finalState = await api(request, `/api/articles/status/${taskId}`);
    const state = finalState.body?.data?.status;
    draftPath = finalState.body?.data?.draftPath ?? draftPath;
    expect(
      state === "awaiting_architect_processing" || state === "succeeded",
      `Upload reached awaiting_architect_processing（status=${state}）`,
    ).toBe(true);
    expect(
      typeof draftPath === "string" && draftPath.includes("raw/drafts"),
      `Upload landed in raw/drafts (draftPath)（draftPath=${draftPath}）`,
    ).toBe(true);
  });

  // Step 4: 规则 21 路由链——validate → promote（提升到 raw/precleaned/）→ 候选列表可见
  let uploaded;
  await test.step("Step4 validate → promote → 候选列表可见", async () => {
    const validate = await api(request, "/api/articles/drafts/validate", {
      method: "POST",
      data: { filePath: draftPath },
    });
    expect(
      validate.ok && validate.body?.success === true,
      `POST /api/articles/drafts/validate（status=${validate.status} blockers=${validate.body?.data?.blockers?.length ?? validate.body?.data?.blockerCount ?? "?"}）`,
    ).toBe(true);

    const promote = await api(request, "/api/articles/drafts/promote", {
      method: "POST",
      data: { filePath: draftPath, confirmed: true },
    });
    expect(
      promote.ok && promote.body?.success === true,
      `POST /api/articles/drafts/promote（status=${promote.status}）`,
    ).toBe(true);

    const precleaned = await api(request, "/api/articles/precleaned");
    expect(
      precleaned.ok && precleaned.body?.success === true,
      `GET /api/articles/precleaned（status=${precleaned.status}）`,
    ).toBe(true);
    const items = precleaned.body?.data?.items ?? precleaned.body?.data ?? [];
    const stem = fileName.replace(/\.md$/, "");
    uploaded = (Array.isArray(items) ? items : []).find(
      (it) => JSON.stringify(it).includes(stem) || (it.fileName ?? "") === fileName || (it.id ?? "").includes(stem),
    );
    expect(
      Boolean(uploaded),
      `Promoted article visible in precleaned list（${uploaded ? `id=${uploaded.id ?? "??"}` : `未在 ${Array.isArray(items) ? items.length : "?"} 条候选中找到`}）`,
    ).toBeTruthy();
  });

  // Step 5: 标准化（真端点 + 契约请求体 {confirmed:true}）
  await test.step("Step5 标准化", async () => {
    const std = await api(request, `/api/articles/precleaned/${uploaded.id}/standardization`, {
      method: "POST",
      data: { confirmed: true },
    });
    expect(
      std.ok && std.body?.success === true,
      `POST standardization（status=${std.status} errors=${JSON.stringify(std.body?.data ?? std.body?.error ?? "").slice(0, 120)}）`,
    ).toBe(true);
  });

  // Step 6: UI 文章列表可见（真断言：本篇文章行出现 + 「已标准化」状态渲染，锚点来自 PrecleanedTable 真实文案）
  await test.step("Step6 UI 文章列表可见", async () => {
    await page.reload({ waitUntil: "networkidle" });
    const rowTitle = `E2E 测试文章 ${stamp}`;
    await expect(
      page.getByText(rowTitle, { exact: true }).first(),
      `Standardized article visible in UI list（title=${rowTitle}）`,
    ).toBeVisible();
    await expect(
      page.getByText("已标准化", { exact: true }).first(),
      "Standardization status rendered",
    ).toBeVisible();

    // WP-104：真实页面与公开接口对账。校验通过不等于已送审，审批绑定必须消费返回值。
    const row = page.getByRole("row").filter({ hasText: rowTitle });
    await row.getByRole("button", { name: `审批与发布 ${rowTitle}`, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("审批状态：尚未送审", { exact: false }).first(), "Standardized content remains unsubmitted for approval").toBeVisible();
    await dialog.getByRole("button", { name: "标准化（进入待审）", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "确认（批准）", exact: true })).toBeVisible();
    const approvalPath = `/api/approval/status/${encodeURIComponent(uploaded.id)}`;
    const pending = await api(request, approvalPath);
    const revision = pending.body?.data?.revision;
    const dialogText = await dialog.textContent(); // PR-297：折叠 details 的 revision 行 innerText 不可见——textContent 按 DOM 内容取（勘察定性，2026-11-13）
    expect(
      pending.ok && typeof revision === "string" && dialogText.includes(`revision ${revision.slice(0, 12)}`),
      "Submitted approval exposes its returned revision",
    ).toBe(true);

    // 真等待替代固定 sleep（旧件 waitApprovalReady 同函数原样迁移）
    const waitApprovalReady = () => page.waitForFunction(() => {
      const dialog = document.querySelector('[role="dialog"]');
      return dialog && !dialog.textContent.includes("正在读取审批与文章信息")
        && [...dialog.querySelectorAll("button")].some((button) => button.textContent.trim() === "刷新" && !button.disabled);
    });
    await dialog.getByRole("button", { name: "刷新", exact: true }).click();
    await waitApprovalReady();
    const restandardize = dialog.getByRole("button", { name: "重新标准化（源已变化，刷新绑定）", exact: true });
    expect(
      (await restandardize.count()) === 0
        && await dialog.getByRole("button", { name: "确认（批准）", exact: true }).isEnabled(),
      "Refresh without source edit does not invent stale evidence",
    ).toBe(true);

    const changed = await api(request, `/api/articles/precleaned/${encodeURIComponent(uploaded.id)}/fields`, {
      method: "PATCH",
      data: { fields: { tags: ["test", "e2e", `changed-${stamp}`] } },
    });
    expect(changed.ok && changed.body?.success === true, "Change source via public field write").toBe(true);
    await dialog.getByRole("button", { name: "刷新", exact: true }).click();
    await waitApprovalReady();
    expect(
      (await restandardize.count()) === 1
        && !(await dialog.getByRole("button", { name: "确认（批准）", exact: true }).isEnabled()),
      "Real source change explains recovery and disables confirmation",
    ).toBe(true);
    await restandardize.click();
    await page.waitForFunction(() => {
      const button = document.querySelector('[data-action-id="approval-confirm"]');
      return button && !button.disabled;
    });
    const restored = await api(request, approvalPath);
    expect(
      restored.ok
        && restored.body?.data?.revision !== revision
        && (await restandardize.count()) === 0
        && (await dialog.textContent()).includes(`revision ${restored.body?.data?.revision?.slice(0, 12)}`),
      "Restandardization restores confirmation with the new revision",
    ).toBe(true);

    // WP-103：已批准后修改必须有同身份恢复路径，旧批准绝不可发布新内容。
    await dialog.getByRole("button", { name: "确认（批准）", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "发布（打包快照）", exact: true })).toBeVisible();
    const approved = await api(request, approvalPath);
    expect(
      approved.ok && approved.body?.data?.status === "approved",
      "Approve the current content",
    ).toBe(true);
    const unchangedReopen = await api(request, `/api/approval/${encodeURIComponent(uploaded.id)}/transition`, {
      method: "POST",
      data: { operation: "standardize", input: { sourcePath: uploaded.sourcePath } },
    });
    expect(
      unchangedReopen.status === 409 && unchangedReopen.body?.error_code === "STATE_TRANSITION_FORBIDDEN",
      "Unchanged approval rejects reopening with its declared 409 shape",
    ).toBe(true);
    const changedApproved = await api(request, `/api/articles/precleaned/${encodeURIComponent(uploaded.id)}/fields`, {
      method: "PATCH",
      data: { fields: { tags: ["test", `approved-edit-${stamp}`] } },
    });
    expect(changedApproved.ok && changedApproved.body?.success === true, "Edit approved content via public API").toBe(true);
    const transitionPath = `/api/approval/${encodeURIComponent(uploaded.id)}/transition`;
    const publishInput = { operation: "publish", input: { sourcePath: uploaded.sourcePath } };
    const stalePublish = await api(request, transitionPath, { method: "POST", data: publishInput });
    expect(
      stalePublish.status === 409 && stalePublish.body?.error_code === "APPROVAL_EVIDENCE_STALE",
      "Old approval cannot publish changed content",
    ).toBe(true);
    await dialog.getByRole("button", { name: "刷新", exact: true }).click();
    await waitApprovalReady();
    expect(
      (await restandardize.count()) === 1
        && !(await dialog.getByRole("button", { name: "发布（打包快照）", exact: true }).isEnabled()),
      "Approved edit exposes recovery and disables publishing",
    ).toBe(true);
    await restandardize.click();
    await page.waitForFunction(() => {
      const button = document.querySelector('[data-action-id="approval-confirm"]');
      return button && !button.disabled;
    });
    const reopened = await api(request, approvalPath);
    expect(
      reopened.body?.data?.status === "pending" && reopened.body?.data?.revision !== approved.body?.data?.revision,
      "Approved edit returns to pending with new content binding",
    ).toBe(true);
    const unapprovedPublish = await api(request, transitionPath, { method: "POST", data: publishInput });
    expect(
      unapprovedPublish.status === 409 && unapprovedPublish.body?.error_code === "STATE_TRANSITION_FORBIDDEN",
      "New content still requires a fresh approval",
    ).toBe(true);
    await dialog.getByRole("button", { name: "确认（批准）", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "发布（打包快照）", exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "发布（打包快照）", exact: true }).click();
    await expect(dialog.getByText("已发布为正式快照。", { exact: true })).toBeVisible();
    const published = await api(request, approvalPath);
    expect(
      published.ok && published.body?.data?.status === "snapshot"
        && published.body?.data?.revision === reopened.body?.data?.revision,
      "Fresh approval publishes a formal snapshot",
    ).toBe(true);
    const decisions = fs.readFileSync(path.join(VAULT_PATH, ".ledger", "decisions.jsonl"), "utf8")
      .split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((event) => event.articleId === uploaded.id);
    expect(
      decisions.filter((event) => event.decision === "approved").length === 2
        && decisions.filter((event) => event.decision === "standardized").length === 1,
      "Recovery preserves old approvals and adds one standardization receipt",
    ).toBe(true);

    console.log(`• observe: Test article retained — ${fileName} 审计及正式快照留档于本轮测试库（时间戳可追溯）`);
  });
});
