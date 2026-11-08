// @component: 实体合规修复流——Playwright 试点平行件（WP-096 / PR-233）
// @context: 旧件 scripts/e2e/entity-compliance-repair-flow.e2e.mjs 的运行器层等价迁移——
//   断言集逐条同源（旧 record() 步 ↔ 本 test.step() 块），交互逻辑保留（懒展开/按字段类型
//   给合法值/FilterSelect 弹层 Esc——PR-153 教训全量继承），手写等待轮询换运行器自动等待。
//   守卫三件（vault/作用域双通道/契约锚定）在 lib/playwright-global-setup.mjs 前置执行。
//   断言映射锚点：
//   Step1 API health＋reconcile 自证 │ Step2 视图加载 │ Step3 check 端点 │ Step4 造数自清理
//   Step5/6 修复入口与抽屉 │ Step6b 实体对齐＋中文 label 单源（shared/field-labels.mjs）
//   Step7 按行填合法值解锁 gate │ Step8 预览零错误块＋写回 gate 解锁 │ Step9 写回确认
//   Step10 收尾重查
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
// PR-013 ②：label 单源转换——与抽屉渲染（EntityRepairDrawer → entity-repair-api.fieldLabel）
// 消费同一份字典，spec 侧不得自造中英文映射（改字典断言自动同变，改名≠缺陷）。
import { fieldLabel } from "../../shared/field-labels.mjs";
// SPEC-011 WP1：e2e 物理隔离守卫（globalSetup 已前置，此处进程级再证——与旧件头部同形态）
import { requireE2EVault } from "./lib/e2e-env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VAULT_PATH = requireE2EVault();
const API_BASE = process.env.API_BASE || "http://127.0.0.1:18083";

// 文本类字段 → 合法值单源（与旧件 TEXT_FIELD_VALUES 同表）：arch_since/arch_until 须 semver、date 须 YYYY-MM-DD。
const TEXT_FIELD_VALUES = [
  [/^组件有效期(起点|终点)/, "1.0.5"],
  [/^创建日期|^更新日期/, "2026-10-29"],
  [/^实体名称|^标题/, "E2E Incomplete Component"],
];

async function apiCheck(request) {
  const res = await request.get(`${API_BASE}/api/entity/check`);
  const body = await res.json().catch(() => null);
  return { status: res.status(), ok: res.ok(), body };
}

test("实体合规修复流（上传缺失字段实体 → 修复抽屉 → 预览 → 直接写回）", async ({ page, request }) => {
  // 受检面 = raw/precleaned 候选文章（与旧件同位）；造数文件名带 pid 可追溯，finally 自清理
  const testEntityPath = path.join(VAULT_PATH, "知识库", "raw", "precleaned", `e2e-test-entity-${process.pid}.md`);
  let testEntityCreated = false;

  try {
    // Step 1: API 健康（readyState 在 data 内）＋ reconcile 自证常设断言（PR-062 A 层）
    await test.step("Step1 API health + reconcile 自证", async () => {
      const health = await request.get(`${API_BASE}/api/health`);
      expect(health.ok()).toBeTruthy();
      const body = await health.json();
      expect(body?.data?.readyState).toBe("ready");
      expect(typeof body?.data?.lastReconcileAt).toBe("string");
      expect(body?.data?.reconcileStale).toBe(false);
    });

    // Step 2: 加载源文档检查页——搜索框随检查数据渲染（真等待由运行器托管）
    await test.step("Step2 加载源文档检查视图", async () => {
      await page.goto("/#/entity-compliance", { waitUntil: "networkidle" });
      await expect(page.getByLabel("搜索源文档检查结果")).toBeVisible();
    });

    // Step 3: 合规检查数据面（真端点 /api/entity/check，契约形状）
    await test.step("Step3 GET /api/entity/check", async () => {
      const check = await apiCheck(request);
      expect(check.ok).toBeTruthy();
      expect(check.body?.success).toBe(true);
    });

    // Step 4: 无可修复实体则造数（缺必填字段），造数后必须真出现修复入口（真断言——证明扫描器识别）
    await test.step("Step4 确保存在可修复实体（必要时造数）", async () => {
      const entryCount = await page.getByRole("button", { name: /修复 \d|补齐字段|创建并补齐/ }).count();
      if (entryCount === 0) {
        fs.mkdirSync(path.dirname(testEntityPath), { recursive: true });
        fs.writeFileSync(testEntityPath, `---
title: E2E Test Entity
---

# E2E Test Entity

缺 product/version/module 等必填字段的造数源文档（E2E 用，finally 自清理）。
`, "utf8");
        testEntityCreated = true;
        await page.reload({ waitUntil: "networkidle" });
        await expect(page.getByRole("button", { name: /修复 \d|补齐字段|创建并补齐/ }).first()).toBeVisible();
      }
    });

    // Step 5+6: 修复入口可见 → 打开抽屉（「可修复字段」编辑面出现；fce2ad8 池化定稿口径）
    const drawer = page.locator('[aria-label^="修复 "], [aria-label^="创建并补齐"]').last();
    await test.step("Step5/6 修复入口与抽屉", async () => {
      const repairButton = page.getByRole("button", { name: /修复 \d|补齐字段|创建并补齐/ }).first();
      await expect(repairButton).toBeVisible();
      await repairButton.click();
      await expect(page.getByText("可修复字段").first()).toBeVisible();
    });

    // Step 6b: 实体对齐（来源文档反查，不得自取 API 序首）＋中文 label 单源断言
    await test.step("Step6b 实体对齐＋可修复字段中文名呈现", async () => {
      const checkFresh = await apiCheck(request);
      const sourceLine = await drawer.locator('p[title^="来源文档："]').first().innerText();
      const drawerSourceKey = String(sourceLine).replace(/^来源文档：/, "").trim();
      const items = checkFresh.body?.data?.items || [];
      const drawerEntity = items.find((item) => item.sourceKey === drawerSourceKey) || null;
      expect(drawerEntity, `抽屉 sourceKey=${drawerSourceKey} 应命中 API items（实体对齐——排序不一致时整批假红的旧病）`).toBeTruthy();

      // 口径 a：!passed ∧ editable ∧ field 非空（与前端 repairable-fields.ts 渲染门槛同口径）
      const failedEditableChecks = (drawerEntity.groups || [])
        .flatMap((g) => (g.checks || []).filter((c) => !c.passed && c.editable && c.field));
      // 口径 b：技术键 → 中文名（shared/field-labels.mjs 单源，entity→article 兜底序同形）
      const expectedLabels = [...new Set(failedEditableChecks.map((c) => fieldLabel(String(c.field))))];
      expect(expectedLabels.length, "抽屉应至少有 1 条未通过的可修复检查").toBeGreaterThan(0);
      const drawerText = await drawer.innerText();
      const missingLabels = expectedLabels.filter((label) => !drawerText.includes(label));
      expect(missingLabels, `应呈现中文名 ${expectedLabels.length} 个，缺失：${missingLabels.join("、")}`).toHaveLength(0);
    });

    // Step 7: 按行标签选字段、按字段类型给合法值，直至预览 gate 解锁（PR-153 教训全量继承）
    await test.step("Step7 按行填合法值解锁预览 gate", async () => {
      const previewGate = drawer.getByRole("button", { name: "查看修复结果" }).first();
      const gateEnabled = async () => (await previewGate.count()) > 0 && !(await previewGate.isDisabled());

      let filled = false;
      // 行展开＝交互细节不作硬断言（旧件只等 350ms 即走）：抽屉随每次状态变更重渲染，
      // 点击可能被吞——尝试点击后短轮询 aria-expanded，两轮不展开即放弃换行（等价旧件宽容度）。
      const expandRow = async (rowBtn) => {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          await rowBtn.click().catch(() => {});
          for (let settle = 0; settle < 3; settle += 1) {
            await page.waitForTimeout(250);
            if ((await rowBtn.getAttribute("aria-expanded")) === "true") return true;
          }
        }
        return false;
      };
      // gate 解锁轮询：受控组件 onChange 后 React 状态批处理有延迟（旧件 350ms sleep 的真等待替代）
      const waitGate = async () => {
        for (let poll = 0; poll < 12; poll += 1) {
          if (await gateEnabled()) return true;
          await page.waitForTimeout(250);
        }
        return false;
      };
      const expandableRows = drawer.locator("button[aria-expanded]:not([aria-label*='系统托管'])");
      const rowCount = await expandableRows.count();
      for (let rowIdx = 0; rowIdx < Math.min(rowCount, 12) && !filled; rowIdx += 1) {
        // FilterSelect 弹层（radix popper）拦截指针事件——换行前必须 Esc 关闭（旧件同款）
        await page.keyboard.press("Escape").catch(() => {});
        if (await gateEnabled()) { filled = true; break; }
        const rowBtn = expandableRows.nth(rowIdx);
        const rowLabel = (await rowBtn.getAttribute("aria-label")) || "";
        // 身份字段跳过：连跑幂等要求本流不碰身份（已存在时再填=重命名，后端正确拒绝）
        if (rowLabel.includes("架构组件身份") || rowLabel.includes("架构组件标识") || rowLabel.includes("代号")) continue;
        // 枚举/生长类字段（select 行）整体跳过——自由文本会被 growth 门正确拒绝，盲填制造死路
        if (rowLabel.startsWith("架构分层") || rowLabel.startsWith("实体类别") || rowLabel.startsWith("子域")) continue;
        if ((await rowBtn.getAttribute("aria-expanded")) !== "true") {
          await expandRow(rowBtn);
        }
        const textSpec = TEXT_FIELD_VALUES.find(([re]) => re.test(rowLabel));
        const textInput = drawer.locator('input[type="text"]:visible, input:not([type]):visible, textarea:visible').first();
        if (textSpec && (await textInput.count()) > 0) {
          await textInput.fill(textSpec[1]);
          if (await waitGate()) { filled = true; break; }
          continue;
        }
        const switchCtl = drawer.locator('input[role="switch"]').first();
        if (!textSpec && (await switchCtl.count()) > 0) {
          // 布尔开关只把 false 切 true（F03 要求显式 true；已 true 再点=翻 false → POST_CHECK_REGRESSION 连跑残留教训）
          if (rowLabel.includes("当前值 true") || /当前值\s*(是|已填写)/.test(rowLabel)) continue;
          await switchCtl.click({ force: true });
          if (await waitGate()) { filled = true; break; }
        }
      }
      expect(filled, `展开 ${Math.min(rowCount, 12)} 行均未使预览 gate 解锁`).toBe(true);
    });

    // Step 8: 查看修复结果——失败区块（repair-preview-error）不出现且「直接写回」脱离 disabled
    //（PR-153 修：旧 text=修复预览 子串匹配连失败态标题也命中，真判据＝status=preview_ready 可观察面）
    await test.step("Step8 预览成功且写回 gate 解锁", async () => {
      const previewButton = drawer.getByRole("button", { name: "查看修复结果" }).first();
      await previewButton.click();
      const applyGate = drawer.getByRole("button", { name: "直接写回" }).first();
      await expect(applyGate).toBeEnabled({ timeout: 15_000 });
      await expect(drawer.locator('[data-testid="repair-preview-error"]')).toHaveCount(0);
    });

    // Step 9: 直接写回（preview_ready → 「已直接写回正式源。」）
    await test.step("Step9 直接写回确认", async () => {
      await drawer.getByRole("button", { name: "直接写回" }).first().click();
      await expect(page.getByText("已直接写回正式源")).toBeVisible();
    });

    // Step 10: 收尾核验（重查 API）
    await test.step("Step10 写回后一致性重查", async () => {
      const recheck = await apiCheck(request);
      expect(recheck.ok).toBeTruthy();
      expect(recheck.body?.success).toBe(true);
    });
  } finally {
    // 造数自清理（与旧件 finally 同款——不留工作树垃圾）
    if (testEntityCreated && fs.existsSync(testEntityPath)) {
      fs.rmSync(testEntityPath, { force: true });
    }
  }
});
