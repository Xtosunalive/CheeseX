#!/usr/bin/env node
// Component: check-theme-tokens 的门禁回归测试（PR-025 关闭卡回归固化位置）
// @responsible: 钉住主题门禁的执法活性——先红后绿形态。
//   实现说明：门禁脚本以 import.meta.url 定位 ROOT（与 cwd 无关），故不能用 tmp 树驱动；
//   本测试在真实仓内做「注入违规 → 必须红 → 复原 → 必须绿」的受控破坏实验
//   （与阶段 3 验收时的手工破坏实验同形态，脚本化固化）。
// @context: PR-025 阶段 3 门禁 + 关账回归；范式参照 check-layer-ssot.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "..", "theme-token-faces.mjs");
const ROOT = path.resolve(__dirname, "..", "..", "..");
const PROBE = path.join(ROOT, "src", "features", "dashboard", "DashboardView.tsx");
const INDEX_CSS = path.join(ROOT, "src", "index.css");

function runGate() {
  try {
    const out = execFileSync("node", [SCRIPT], { encoding: "utf-8" });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") };
  }
}

/** 受控注入：在探针文件尾追加一行，跑门禁，恢复原文，再跑门禁 */
function withInjection(file, poison, label) {
  const original = fs.readFileSync(file, "utf-8");
  try {
    fs.writeFileSync(file, original + poison + "\n");
    const red = runGate();
    assert.notEqual(red.code, 0, `${label}：注入后必须非零退出`);
    assert.match(red.out, new RegExp(label), `${label}：输出应含类别标记`);
  } finally {
    fs.writeFileSync(file, original);
  }
}

test("基线自举：当前仓状态跑门禁必须 ok", () => {
  const r = runGate();
  assert.equal(r.code, 0, `基线应 ok，实际：${r.out.slice(0, 300)}`);
  assert.match(r.out, /theme_tokens=ok/);
});

test("反例①：裸调色板注入 → 红（先红）", () => {
  withInjection(PROBE, 'export const __poison1 = <i className="text-cyan-400">x</i>;', "退役词");
});

test("反例②：内联 style 字面值注入 → 红", () => {
  withInjection(PROBE, 'export const __poison2 = <i style={{ color: "#ff0000" }}>x</i>;', "内联色|字面值");
});

test("反例②b：text-white 注入 → 红（收口批新断言）", () => {
  withInjection(PROBE, 'export const __poison2b = <i className="bg-accent-base text-white">x</i>;', "退役词");
});

test("反例③：@theme inline 块内字面值注入 → 红（:root L0 不误伤）", () => {
  const original = fs.readFileSync(INDEX_CSS, "utf-8");
  try {
    const poisoned = original.replace(
      /(@theme inline \{)/,
      "$1\n  --color-poison-probe: #fefefe; /* 注入探针 */"
    );
    assert.notEqual(poisoned, original, "探针未注入成功");
    fs.writeFileSync(INDEX_CSS, poisoned);
    const red = runGate();
    assert.notEqual(red.code, 0, "@theme 字面值必须非零退出");
    assert.match(red.out, /L1字面值/);
  } finally {
    fs.writeFileSync(INDEX_CSS, original);
  }
});

test("反例③b：--shadow- 值内塞 rgb 字面值 → 红（白名单收窄批新断言）", () => {
  const original = fs.readFileSync(INDEX_CSS, "utf-8");
  try {
    const poisoned = original.replace(
      /(--shadow-card:\s*0 0 0 1px )var\(--shadow-ring-ink\)/,
      "$1rgb(0 0 0 / 0.06)"
    );
    assert.notEqual(poisoned, original, "探针未注入成功（--shadow-card 值未替换）");
    fs.writeFileSync(INDEX_CSS, poisoned);
    const red = runGate();
    assert.notEqual(red.code, 0, "阴影值含 rgb 字面值必须非零退出");
    assert.match(red.out, /L1阴影字面值/);
  } finally {
    fs.writeFileSync(INDEX_CSS, original);
  }
});

test("反例④：stroke-currentColor 注入 → 红（检查面 ⑥，显示模式 PR 实证陷阱）", () => {
  withInjection(
    PROBE,
    'export const __poison4 = <i className="[&>svg]:stroke-currentColor">x</i>;',
    "非法描边类"
  );
});

test("反例④b：stroke-currentColor 任意值语法 stroke:currentColor → 红", () => {
  withInjection(
    PROBE,
    "export const __poison4b = <i className=\"[&>svg]:[stroke:currentColor]\">x</i>;",
    "非法描边类"
  );
});

test("反例④c：合法写法 stroke-current 不误伤", () => {
  const original = fs.readFileSync(PROBE, "utf-8");
  try {
    fs.writeFileSync(
      PROBE,
      original + '\nexport const __ok4 = <i className="[&>svg]:stroke-current">x</i>;\n'
    );
    const r = runGate();
    assert.equal(r.code, 0, `stroke-current 应合法，实际：${r.out.slice(0, 200)}`);
  } finally {
    fs.writeFileSync(PROBE, original);
  }
});

// ── WP-147 二期新形态夹具（vendor 色板口径，2026-11-07）──
// 探针统一前置 vendor @import：隔离 [L0结构] 面，让断言精确命中目标检查面
// （主文件是否已接入 vendor 色板不影响夹具判定）。

test("反例⑤：退役 cat 类名注入 → 红（面⑤防回流，WP-147 连名换装）", () => {
  withInjection(PROBE, 'export const __poison5 = <i className="bg-cat-amber-500 text-cat-sky">x</i>;', "退役词");
});

test("反例⑤b：var(--cat-*) 退役 L0 名注入 → 红（面⑤ var 通道）", () => {
  withInjection(PROBE, 'export const __poison5b = <i style={{ color: "var(--cat-slate)" }}>x</i>;', "退役词");
});

test("反例⑤c：Radix step 档类名（text-amber-11）不误伤（裸板禁令档位收窄为 50/100..950）", () => {
  const original = fs.readFileSync(PROBE, "utf-8");
  try {
    fs.writeFileSync(PROBE, original + '\nexport const __ok5c = <i className="text-amber-11">x</i>;\n');
    const r = runGate();
    assert.equal(r.code, 0, `step 档应合法，实际：${r.out.slice(0, 200)}`);
  } finally {
    fs.writeFileSync(PROBE, original);
  }
});

test("反例④w：@theme 分类色连名断裂（值非同名 vendor 变量）→ 红（面④ WP-147）", () => {
  const original = fs.readFileSync(INDEX_CSS, "utf-8");
  try {
    const poisoned = '@import "@radix-ui/colors/blue.css"; /* 探针 */\n' + original.replace(
      /(@theme inline \{)/,
      "$1\n  --color-poison-9: var(--blue-9); /* 注入探针 */"
    );
    assert.notEqual(poisoned, original, "探针未注入成功");
    fs.writeFileSync(INDEX_CSS, poisoned);
    const red = runGate();
    assert.notEqual(red.code, 0, "连名断裂必须非零退出");
    assert.match(red.out, /L1分类色连名/);
  } finally {
    fs.writeFileSync(INDEX_CSS, original);
  }
});

test("反例④x：@theme 分类色字面值 → 红（vendor 化后仍禁字面值）", () => {
  const original = fs.readFileSync(INDEX_CSS, "utf-8");
  try {
    const poisoned = '@import "@radix-ui/colors/cyan.css"; /* 探针 */\n' + original.replace(
      /(@theme inline \{)/,
      "$1\n  --color-poison-9: #fefefe; /* 注入探针 */"
    );
    assert.notEqual(poisoned, original, "探针未注入成功");
    fs.writeFileSync(INDEX_CSS, poisoned);
    const red = runGate();
    assert.notEqual(red.code, 0, "分类色字面值必须非零退出");
    assert.match(red.out, /L1字面值/);
  } finally {
    fs.writeFileSync(INDEX_CSS, original);
  }
});

test("反例④y：合法连名引用 var(--同族同档) 不误伤（面④ 绿夹具）", () => {
  const original = fs.readFileSync(INDEX_CSS, "utf-8");
  try {
    const poisoned = '@import "@radix-ui/colors/cyan.css"; /* 探针 */\n' + original.replace(
      /(@theme inline \{)/,
      "$1\n  --color-cyan-9: var(--cyan-9); /* 注入探针 */"
    );
    assert.notEqual(poisoned, original, "探针未注入成功");
    fs.writeFileSync(INDEX_CSS, poisoned);
    const r = runGate();
    assert.equal(r.code, 0, `合法连名引用应保持 ok，实际：${r.out.slice(0, 200)}`);
  } finally {
    fs.writeFileSync(INDEX_CSS, original);
  }
});

/** CSS 图探针：写临时子文件＋index.css 注入 @import，跑门禁，复原（W0-3 检查⑦） */
function withCssProbe(cssBody, label) {
  const idx = fs.readFileSync(INDEX_CSS, "utf-8");
  const tmpDir = path.join(ROOT, "src", "styles");
  const tmp = path.join(tmpDir, "__tokens_probe__.css");
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    fs.writeFileSync(tmp, cssBody + "\n");
    fs.writeFileSync(INDEX_CSS, idx + '\n@import "./styles/__tokens_probe__.css";\n');
    const red = runGate();
    assert.notEqual(red.code, 0, `${label}：注入后必须非零退出`);
    assert.match(red.out, new RegExp(label), `${label}：输出应含类别标记`);
  } finally {
    fs.rmSync(tmp, { force: true });
    fs.writeFileSync(INDEX_CSS, idx);
  }
}

test("反例⑦a：图内子 CSS 色值字面值 → 红（W0-3 CSS 图执法）", () => {
  withCssProbe(".probe { box-shadow: 0 0 0 1px rgba(0, 0, 0, 1); }", "CSS字面值");
});

test("反例⑦b：图内子 CSS 裸 z-index／裸时长／裸字重 → 红（L3 禁令机器面）", () => {
  withCssProbe(
    ".probe { z-index: 42; transition: all 0.3s ease; font-weight: 600; }",
    "CSS裸z|CSS裸时长|CSS裸字重"
  );
});

test("反例⑦c：图内子 CSS 纯 var() 引用不误伤（合法消费通道）", () => {
  const idx = fs.readFileSync(INDEX_CSS, "utf-8");
  const tmpDir = path.join(ROOT, "src", "styles");
  const tmp = path.join(tmpDir, "__tokens_probe__.css");
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    fs.writeFileSync(tmp, ".probe { color: var(--color-surface-card); height: calc(var(--spacing) * 2); }\n");
    fs.writeFileSync(INDEX_CSS, idx + '\n@import "./styles/__tokens_probe__.css";\n');
    const r = runGate();
    assert.equal(r.code, 0, `纯 var() 子文件应合法，实际：${r.out.slice(0, 200)}`);
  } finally {
    fs.rmSync(tmp, { force: true });
    fs.writeFileSync(INDEX_CSS, idx);
  }
});

test("反例⑦d：index.css 裸区注入色值 → 红（红队 B1：裸区免检后门已封）", () => {
  const original = fs.readFileSync(INDEX_CSS, "utf-8");
  try {
    fs.writeFileSync(INDEX_CSS, original + "\n.backdoor-probe { color: #abc; background: hsl(0 0% 0%); z-index: 5; }\n");
    const red = runGate();
    assert.notEqual(red.code, 0, "裸区字面值必须非零退出");
    assert.match(red.out, /CSS字面值/);
  } finally {
    fs.writeFileSync(INDEX_CSS, original);
  }
});

test("反例⑦e：图内子 CSS hsl/oklch 色值函数族 → 红（红队 B2）", () => {
  withCssProbe(".probe { color: hsl(0 0% 50%); border-color: oklch(0.6 0.2 30); }", "CSS字面值");
});

test("反例⑦f：@import 带查询串（?v=2）的子文件 → 仍入执法图（红队 B3 通道 1）", () => {
  const idx = fs.readFileSync(INDEX_CSS, "utf-8");
  const tmpDir = path.join(ROOT, "src", "styles");
  const tmp = path.join(tmpDir, "__tokens_probe__.css");
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    fs.writeFileSync(tmp, ".probe { box-shadow: 0 0 0 1px rgba(0, 0, 0, 1); }\n");
    fs.writeFileSync(INDEX_CSS, idx + '\n@import "./styles/__tokens_probe__.css?v=2";\n');
    const red = runGate();
    assert.notEqual(red.code, 0, "查询串形态的 @import 子文件必须被图发现并执法");
    assert.match(red.out, /CSS字面值/);
  } finally {
    fs.rmSync(tmp, { force: true });
    fs.writeFileSync(INDEX_CSS, idx);
  }
});

test("复原后绿：门禁回到 ok（后绿）", () => {
  const r = runGate();
  assert.equal(r.code, 0, `复原后必须 ok，实际：${r.out.slice(0, 300)}`);
});
