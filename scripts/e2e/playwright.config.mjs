// @component: Playwright 运行器配置（WP-096 / PR-233 试点批）
// @context: e2e 旅程测试从「playwright-core 裸驱动＋手写编排」迁 @playwright/test 运行器层——
//   断言/夹具/trace/截图/reporter 由运行器托管（PR-233 痛点面）。
//   隔离守卫等价迁移（WP-096 验收③）：requireE2EVault＋requireE2EServiceScope＋契约锚定
//   全部经 globalSetup 前置——守卫不过＝运行器拒启，任何测试不执行（fail-closed 同旧件）。
//   浏览器＝系统 Chrome（channel:"chrome"），不下载 playwright 浏览器包——与 CI quality.yml
//   既有 CHROME_CANDIDATES 约定同源，浏览器二进制零新增下载。
import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: __dirname,
  testMatch: "**/*.spec.mjs",
  globalSetup: path.join(__dirname, "lib", "playwright-global-setup.mjs"),
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "../test-results/playwright-report" }]],
  outputDir: path.resolve(__dirname, "..", "..", "test-results", "playwright-artifacts"),
  use: {
    channel: "chrome",
    headless: true,
    viewport: { width: 1920, height: 1080 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
    baseURL: process.env.BASE_URL || "http://127.0.0.1:5174",
  },
});
