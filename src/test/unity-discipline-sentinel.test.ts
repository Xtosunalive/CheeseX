// 统一件纪律哨兵（2026-11-17 第 7 批收官，目标 IA"CI 哨兵固化"——B 形态：普通测试，
// 非 scripts/quality/check-* 门禁面〔门禁冻结纪律 WP-143〕；随 test:frontend 全量跑执行）
// 工具：doppel-ts（确定性静态分析，无 AI——统一件纪律审计 2026-11-17 实测选型）。
// 检测：重复/相似 React 组件**基线外新增**（棘轮只减不增沿 ui-kit 先例）——存量已由
// 《统一件纪律审计》逐对对账（无实现级重复），哨兵只拦新形状绕过统一件。
// 影子根：根 tsconfig 无 jsx（在 tsconfig.app.json），doppel-ts 直跑静默 0 组件——
// 本测试自建影子根（tmpdir＋symlink src＋含 jsx 的 tsconfig）绕过，用后清理。
// 基线：test-results/doppel/baseline.json（.gitignore 例外入 git——跨机稳定的棘轮账）。
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");
const BASELINE = path.join(ROOT, "test-results", "doppel", "baseline.json");

const BASE_PREFIX = ["Sidebar", "Sheet", "Dropdown", "Tooltip", "Popover", "Dialog", "Command", "Card", "Tabs", "Avatar", "Breadcrumb", "Collapsible", "Input", "Button", "Select", "Checkbox", "Radio", "Switch", "Scroll", "Separator", "Skeleton", "Table", "Toast", "Toggle", "Label", "Menubar", "Navigation", "Pagination", "Progress", "Alert", "Accordion", "AspectRatio", "Calendar", "Carousel", "Chart", "ContextMenu", "Drawer", "Form", "HoverCard", "InputOTP", "Otp", "Resizable", "ToggleGroup"];
const isBase = (c: { path?: string; name?: string }) =>
  (c.path ?? "").includes("/components/ui/") || BASE_PREFIX.some((pre) => (c.name ?? "").startsWith(pre));

interface DoppelPair { a: { path: string; name: string }; b: { path: string; name: string }; score: number }

function scanBusinessPairs(): { a: string; b: string; score: number }[] {
  const shadow = fs.mkdtempSync(path.join(os.tmpdir(), "doppel-shadow-"));
  try {
    fs.symlinkSync(path.join(ROOT, "src"), path.join(shadow, "src"), "dir");
    fs.writeFileSync(path.join(shadow, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        jsx: "react-jsx", target: "ES2020", module: "ESNext", moduleResolution: "bundler",
        paths: { "@/*": ["./src/*"] }, skipLibCheck: true,
      },
      include: ["src/**/*.tsx"],
    }));
    const out = execFileSync(process.execPath, [
      path.join(ROOT, "node_modules", "doppel-ts", "dist", "index.js"),
      "src", "--format", "json", "--include-local", "--threshold", "0.7",
    ], { encoding: "utf8", cwd: shadow, maxBuffer: 64 * 1024 * 1024 });
    const scan = JSON.parse(out) as { pairs: DoppelPair[] };
    return scan.pairs
      .filter((p) => !isBase(p.a) && !isBase(p.b))
      .map((p) => ({ a: `${p.a.path}#${p.a.name}`, b: `${p.b.path}#${p.b.name}`, score: p.score }));
  } finally {
    fs.rmSync(shadow, { recursive: true, force: true });
  }
}

describe("统一件纪律哨兵（基线外新增相似组件）", () => {
  it("业务面相似对 ⊆ 基线（棘轮只减不增——新形状必须走 PR-01~PR-10 统一件，不复制实现）", () => {
    const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8")) as { pairs: { a: string; b: string }[] };
    const baselineKeys = new Set(baseline.pairs.map((p) => `${p.a}|${p.b}`));
    const bizPairs = scanBusinessPairs();
    const newPairs = bizPairs.filter((p) => !baselineKeys.has(`${p.a}|${p.b}`));
    expect(newPairs, `基线外新增相似对 ${newPairs.length}——新形状必须走统一件；如属故意相似，更新基线并记档`).toEqual([]);
  });
});
