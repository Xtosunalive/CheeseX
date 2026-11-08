// CSS token 完整性测试——PR-117 回归固化（生产构建 L2 组件 token 块丢失）
// 面覆盖：①源码注释语法完整性（lightningcss 解析零 UnexpectedToken——4 处 `*/` 提前闭合
// 曾致解析错误恢复吞掉 :root token 块）②生产构建保留 token 定义（真实 vite build 产物
// 断言 --z-*/--table-*/--control-height-md 定义在场——@theme tree-shake 假说的常备反证）
// 层级标注：测试 1＝纯单元（构建输入完整性）；测试 2＝Adapter 契约（构建边界产物）
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// lightningcss 为 Tailwind v4 构建链自带解析器（@tailwindcss/vite 依赖树内），
// 与生产构建报「Unexpected token」的是同一解析器——反例检测与生产线同源。
import { transform as lightningTransform } from "lightningcss";

const CSS_FILES = ["src/index.css", "src/styles/table-preset.css", "src/features/document-inventory/components/CardNav.css"];
const TOKEN_DEFINITIONS = [
  "--z-modal:50",
  "--z-chrome:35",
  "--z-sticky:10",
  "--z-popover:80",
  "--table-radius:",
  "--table-toolbar-height:",
  "--table-cell-py-lg:",
  "--control-height-md:",
];

describe("CSS token 完整性（PR-117 回归）", () => {
  it("源码注释语法完整：lightningcss 解析零 UnexpectedToken（纯单元）", () => {
    for (const file of CSS_FILES) {
      const result = lightningTransform({
        filename: file,
        code: readFileSync(file),
        errorRecovery: true,
      });
      // AtRuleInvalid＝Tailwind 专用指令（@theme/@utility/@custom-variant）对原生
      // lightningcss 的预期噪音（生产构建由 @tailwindcss/vite 先行消化）——只拦
      // UnexpectedToken：注释 `*/` 提前闭合后的裸文本必落此类型（PR-117 实证）。
      const garbage = result.warnings.filter((w) => w.type !== "AtRuleInvalid");
      expect(garbage, `${file} 存在非指令类解析警告（注释断裂/裸文本——生产构建会吞块）`).toHaveLength(0);
    }
  });

  it("生产构建保留 L2 组件 token 定义（Adapter 契约——构建边界）", () => {
    const outDir = mkdtempSync(join(tmpdir(), "pr117-css-tokens-"));
    try {
      execFileSync(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--outDir", outDir, "--emptyOutDir"], {
        cwd: process.cwd(),
        stdio: "pipe",
        timeout: 120_000,
      });
      const assetsDir = join(outDir, "assets");
      const css = readdirSync(assetsDir)
        .filter((f) => f.endsWith(".css"))
        .map((f) => readFileSync(join(assetsDir, f), "utf8"))
        .join("\n");
      for (const token of TOKEN_DEFINITIONS) {
        expect(css.includes(token), `构建产物缺少 token 定义「${token}」——L2 :root 块被丢弃（PR-117 症状）`).toBe(true);
      }
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 180_000);
});
