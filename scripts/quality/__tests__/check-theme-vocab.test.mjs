#!/usr/bin/env node
// Component: check-theme-vocab 的门禁回归测试（vocab 固化批）
// @responsible: 钉住词汇对账门禁的执法活性——先红后绿。
//   形态同 check-theme-tokens.test.mjs：仓内受控注入（import.meta.url 定位 ROOT）→ 必须红 → 复原 → 绿。
// 运行：node --test scripts/quality/__tests__/check-theme-vocab.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "..", "theme-vocab-faces.mjs");
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

test("基线自举：当前仓状态跑门禁必须 ok", () => {
  const r = runGate();
  assert.equal(r.code, 0, `基线应 ok，实际：${r.out.slice(0, 300)}`);
  assert.match(r.out, /theme_vocab=ok/);
});

test("反例①：消费不存在的 --color- 词（悬空）→ 红", () => {
  const original = fs.readFileSync(PROBE, "utf-8");
  try {
    fs.writeFileSync(PROBE, original + '\nexport const __vocabPoison1 = <i style={{ color: "var(--color-nonexistent-probe)" }}>x</i>;\n');
    const red = runGate();
    assert.notEqual(red.code, 0, "悬空消费必须非零退出");
    assert.match(red.out, /悬空消费/);
  } finally {
    fs.writeFileSync(PROBE, original);
  }
});

test("反例②：业务代码消费 shadcn 内部词 → 红", () => {
  const original = fs.readFileSync(PROBE, "utf-8");
  try {
    fs.writeFileSync(PROBE, original + '\nexport const __vocabPoison2 = <i style={{ color: "var(--color-primary)" }}>x</i>;\n');
    const red = runGate();
    assert.notEqual(red.code, 0, "shadcn 词必须非零退出");
    assert.match(red.out, /shadcn词/);
  } finally {
    fs.writeFileSync(PROBE, original);
  }
});

test("反例③：index.css 新增死定义 → 红", () => {
  const original = fs.readFileSync(INDEX_CSS, "utf-8");
  try {
    fs.writeFileSync(INDEX_CSS, original + "\n  --color-dead-probe-word: var(--paper);\n");
    const red = runGate();
    assert.notEqual(red.code, 0, "死定义必须非零退出");
    assert.match(red.out, /死定义/);
  } finally {
    fs.writeFileSync(INDEX_CSS, original);
  }
});

test("反例④：退役 kg var 消费 → 红", () => {
  const original = fs.readFileSync(PROBE, "utf-8");
  try {
    fs.writeFileSync(PROBE, original + '\nexport const __vocabPoison4 = <i style={{ color: "var(--color-kg-fact)" }}>x</i>;\n');
    const red = runGate();
    assert.notEqual(red.code, 0, "退役 kg var 必须非零退出");
    assert.match(red.out, /退役var/);
  } finally {
    fs.writeFileSync(PROBE, original);
  }
});

test("反例④b：退役 cat var 消费 → 红（WP-147 连名换装，2026-11-07）", () => {
  const original = fs.readFileSync(PROBE, "utf-8");
  try {
    fs.writeFileSync(PROBE, original + '\nexport const __vocabPoison4b = <i style={{ color: "var(--cat-slate)" }}>x</i>;\n');
    const red = runGate();
    assert.notEqual(red.code, 0, "退役 cat var 必须非零退出");
    assert.match(red.out, /退役var/);
  } finally {
    fs.writeFileSync(PROBE, original);
  }
});

test("反例⑪：分类色 step 词死定义不自证活词 → 红（WP-147 连名自指堵死）", () => {
  // --color-probe-9 与其引用的 vendor 变量 --probe-9 同名（连名换装词形），
  // 定义行自身引用不得作为活词证据——仍须真实业务消费。
  // 注入取文件前置：dead 输出按类别分组抽样（每组 15 条），探针词置于 defined 迭代首位
  // 才保证在大类别（迁移窗口期死定义可达数十条）中确定可见。
  const original = fs.readFileSync(INDEX_CSS, "utf-8");
  try {
    fs.writeFileSync(INDEX_CSS, "  --color-probe-9: var(--probe-9);\n" + original);
    const red = runGate();
    assert.notEqual(red.code, 0, "step 词死定义必须非零退出");
    assert.match(red.out, /死定义[^\n]*probe-9/);
  } finally {
    fs.writeFileSync(INDEX_CSS, original);
  }
});

/** 受控注入（vocab 版）：探针文件尾追加一行，跑门禁，恢复原文 */
function withVocabInjection(poison, label) {
  const original = fs.readFileSync(PROBE, "utf-8");
  try {
    fs.writeFileSync(PROBE, original + poison + "\n");
    const red = runGate();
    assert.notEqual(red.code, 0, `${label}：注入后必须非零退出`);
    assert.match(red.out, new RegExp(label), `${label}：输出应含类别标记`);
  } finally {
    fs.writeFileSync(PROBE, original);
  }
}

test("反例⑤：图内子 CSS var(--table-*) 悬空 → 红（W0-3 命名空间对账）", () => {
  const idx = fs.readFileSync(INDEX_CSS, "utf-8");
  const tmpDir = path.join(ROOT, "src", "styles");
  const tmp = path.join(tmpDir, "__vocab_probe__.css");
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    fs.writeFileSync(tmp, ".probe { top: var(--table-probe-x); }\n");
    fs.writeFileSync(INDEX_CSS, idx + '\n@import "./styles/__vocab_probe__.css";\n');
    const red = runGate();
    assert.notEqual(red.code, 0, "悬空 var 必须非零退出");
    assert.match(red.out, /--table-probe-x/, "输出应含悬空词名");
  } finally {
    fs.rmSync(tmp, { force: true });
    fs.writeFileSync(INDEX_CSS, idx);
  }
});

test("反例⑥：CSS 消费通道合法引用不误伤（子文件 var() 活词 → 门禁仍 ok）", () => {
  const idx = fs.readFileSync(INDEX_CSS, "utf-8");
  const tmpDir = path.join(ROOT, "src", "styles");
  const tmp = path.join(tmpDir, "__vocab_probe__.css");
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    fs.writeFileSync(tmp, ".probe { color: var(--color-surface-card); height: calc(var(--spacing) * 2); }\n");
    fs.writeFileSync(INDEX_CSS, idx + '\n@import "./styles/__vocab_probe__.css";\n');
    const r = runGate();
    assert.equal(r.code, 0, `子文件消费活词应合法，实际：${r.out.slice(0, 200)}`);
  } finally {
    fs.rmSync(tmp, { force: true });
    fs.writeFileSync(INDEX_CSS, idx);
  }
});

test("反例⑦：@theme 外 --shadow-* 被类消费 → 惰性红（shadow-blur-ink 同型陷阱）", () => {
  const probe0 = fs.readFileSync(PROBE, "utf-8");
  const idx = fs.readFileSync(INDEX_CSS, "utf-8");
  try {
    fs.writeFileSync(PROBE, probe0 + '\nexport const __nsPoison7 = <i className="shadow-probe-inert">x</i>;\n');
    fs.writeFileSync(INDEX_CSS, idx + "\n:root { --shadow-probe-inert: 0 1px 2px rgb(0 0 0 / 0.1); }\n");
    const red = runGate();
    assert.notEqual(red.code, 0, "惰性类必须非零退出");
    assert.match(red.out, /惰性类/, "输出应含惰性类标记");
  } finally {
    fs.writeFileSync(PROBE, probe0);
    fs.writeFileSync(INDEX_CSS, idx);
  }
});

test("反例⑧：预览页删一个公开 token → 镜像对账红（W0-4 · B3）", () => {
  const pv = path.join(ROOT, "src", "features", "theme-preview", "ThemePreviewView.tsx");
  const original = fs.readFileSync(pv, "utf-8");
  try {
    // WP-147 二期尾项文案拆分后：中文注记住 theme-preview-copy 模块，视图侧保留 token 名串——
// 夹具改为变异视图侧名串（镜像执法面仍按 ThemePreviewView 原文），断言意图不变。
    fs.writeFileSync(pv, original.replace('"--color-status-warn"', '"--color-status-XXXX"'));
    const red = runGate();
    assert.notEqual(red.code, 0, "预览缺镜像必须非零退出");
    assert.match(red.out, /预览缺镜像.*--color-status-warn/);
  } finally {
    fs.writeFileSync(pv, original);
  }
});

test("反例⑧b：删基词镜像、同前缀长词仍在 → 照红（WP-147 scope_revision 3：子串假绿堵死）", () => {
  // 旧判定用裸子串 includes：删掉 --color-accent-bg 后，--color-accent-bg-strong 仍让子串命中 → 门禁不红（假绿）。
  // 状态色档桥（--color-status-warn-2 等）入预览后同型放大，故按词边界判定并钉住。
  const pv = path.join(ROOT, "src", "features", "theme-preview", "ThemePreviewView.tsx");
  const original = fs.readFileSync(pv, "utf-8");
  assert.ok(original.includes('"--color-accent-bg-strong"'), "锚点漂移：预览页同前缀长词 accent-bg-strong 不在");
  try {
    fs.writeFileSync(pv, original.replace('"--color-accent-bg"', '"--color-accent-XX"'));
    const red = runGate();
    assert.notEqual(red.code, 0, "同前缀长词不得顶替基词镜像");
    assert.match(red.out, /预览缺镜像\] --color-accent-bg 未出现/);
  } finally {
    fs.writeFileSync(pv, original);
  }
});

test("反例⑨：@apply 工具类计入消费 → 死词出棘轮触发逼销账（红队 S6：@apply 是合法消费通道）", () => {
  // 收官存量清零批后基线归零、--radius-pill 已退役——原「借真实基线条目」的载体不复存在，
  // 改为自注入双探针（@theme 临时定义＋基线临时条目），验证棘轮逼销账机制本身不随清零失活。
  const idx = fs.readFileSync(INDEX_CSS, "utf-8");
  const baselinePath = path.join(ROOT, "scripts", "quality", "theme-baseline.json");
  const baselineOriginal = fs.readFileSync(baselinePath, "utf-8");
  const tmpDir = path.join(ROOT, "src", "styles");
  const tmp = path.join(tmpDir, "__vocab_probe__.css");
  const anchor = "  --radius-sm: 8px;";
  assert.ok(idx.includes(anchor), "锚点漂移：--radius-sm 定义行不存在");
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    fs.writeFileSync(tmp, ".probe { @apply rounded-probe9; }\n");
    fs.writeFileSync(INDEX_CSS, idx.replace(anchor, `${anchor}\n  --radius-probe9: 9px;`) + '\n@import "./styles/__vocab_probe__.css";\n');
    const baselineJson = JSON.parse(baselineOriginal);
    fs.writeFileSync(baselinePath, JSON.stringify({ ...baselineJson, vocab_ns: { ...(baselineJson.vocab_ns || {}), "死定义|radius|probe9": 1 } }, null, 2));
    const red = runGate();
    assert.notEqual(red.code, 0, "死词被 @apply 消费后应触发快照滞留（逼销账）");
    assert.match(red.out, /ns快照滞留[^\n]*probe9/, "输出应含 probe9 的销账提示");
  } finally {
    fs.rmSync(tmp, { force: true });
    fs.writeFileSync(INDEX_CSS, idx);
    fs.writeFileSync(baselinePath, baselineOriginal);
  }
});

test("反例⑩：方位变体基础档未定义 → 悬空类红（红队 S7：rounded-t-nonexistent 绕行堵死）", () => {
  withVocabInjection('export const __nsPoison10 = <i className="rounded-t-nonexistentprobe">x</i>;', "悬空类");
});

test("复原后绿：门禁回到 ok", () => {
  const r = runGate();
  assert.equal(r.code, 0, `复原后必须 ok，实际：${r.out.slice(0, 300)}`);
});
