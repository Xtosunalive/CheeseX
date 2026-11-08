#!/usr/bin/env node
// Component: Theme-Mix-Report（W0-5 · 契约 A7：新颜色角色三模式验收的机算件）
// @responsible: 对 color-mix 派生角色计算 light/dark/warm 三模式实际值与对卡片底的对比比——
//   「新增/修改 L1 角色必须在台账登记三模式计算值」的硬数据来源（目检保留但不再是唯一手段）。
// 输入：src/index.css 的 :root / .dark / [data-mode="warm"] 覆盖块 L0 值（hex）。
// 角色 registry：ROLES（下方）——P0 首批两个全局角色；新角色登记在此（与契约 §2 命名轴同步）。
// 补救路径提醒（契约 §6）：某模式不达标时，禁止在 .dark/[data-mode] 直接改 L1——
//   合法路径＝该模式补一个 L0 中间词，角色仍从 L0 派生。
// @outputs: stdout 三模式表格（hex + 对卡片底 CR）；--json 出 JSON（供测试/台账引用）
// 模式：fail-closed——L0 值缺失或非 hex 即非零退出。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const INDEX_CSS = path.join(ROOT, "src", "index.css");

// 派生角色 registry（color-mix(in srgb, A p%, B) 形态；对比底＝--paper〔卡片底同值〕）
// WP-147 二期（2026-11-07）：分类色已 vendor 化（--color-<族>-<step> 整值连名引用 @radix-ui/colors
// 变量，非 color-mix 派生）——不入本表；其三模式取值由 vendor palette（浅/深两套，.dark 切换＝走向 B）
// 保证，对比度为 Radix 官方 APCA 校验域。本表只收 color-mix 派生角色；新增派生角色照旧在此登记。
const ROLES = [
  { name: "--color-surface-alter", a: "--mist", p: 35, b: "--paper", note: "交替底（表头/行 hover；antd colorFillAlter 口径）" },
  { name: "--color-border-soft", a: "--mist-border", p: 65, b: "--paper", note: "次级分隔线（antd colorBorderSecondary 口径）" },
];
const MODES = [
  { name: "light", block: ":root" },
  { name: "dark", block: ".dark" },
  { name: "warm", block: '[data-mode="warm"]' },
];

function fail(msg) {
  console.error(`theme_mix=FAIL ${msg}`);
  process.exit(1);
}
if (!fs.existsSync(INDEX_CSS)) fail("src/index.css 不存在");

// ── 解析覆盖块：block 起始行到配对 }，收集 --名: #hex ──
const lines = fs.readFileSync(INDEX_CSS, "utf-8").split("\n");
function parseBlockVars(blockOpen) {
  const start = lines.findIndex((l) => new RegExp(`^\\s*${blockOpen.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`).test(l));
  if (start === -1) fail(`覆盖块 ${blockOpen} 未找到`);
  const vars = {};
  let depth = 1;
  for (let i = start + 1; i < lines.length && depth > 0; i++) {
    depth += (lines[i].match(/\{/g) || []).length;
    depth -= (lines[i].match(/\}/g) || []).length;
    // L0 值形态双收：#rrggbb 与 hsl(H S% L%)（空格语法，角度可带 deg、数值可带小数）
    const m = lines[i].match(/^\s*(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6}|hsl\(\s*[\d.]+(?:deg)?\s+[\d.]+%\s+[\d.]+%\s*\))\s*;/);
    if (m && !(m[1] in vars)) vars[m[1]] = m[2];
  }
  return vars;
}
const modeVars = {};
for (const mode of MODES) {
  const vars = parseBlockVars(mode.block);
  modeVars[mode.name] = vars;
}

const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hsl2rgb = (H, S, L) => {
  // CSS hsl()（sRGB）→ rgb；S/L 百分数
  const s = S / 100, l = L / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((H % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return [r1 + m, g1 + m, b1 + m].map((v) => v * 255);
};
const toRgb = (v) => {
  if (v.startsWith("#")) return hex2rgb(v);
  const m = v.match(/hsl\(\s*([\d.]+)(?:deg)?\s+([\d.]+)%\s+([\d.]+)%\s*\)/);
  return hsl2rgb(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
};
const rgb2hexFrom = (v) => "#" + v.map((x) => Math.round(x).toString(16).padStart(2, "0")).join("");
const rgb2hex = ([r, g, b]) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const mix = (aVal, p, bVal) => {
  const [r1, g1, b1] = toRgb(aVal);
  const [r2, g2, b2] = toRgb(bVal);
  const w = p / 100;
  return rgb2hexFrom([r1 * w + r2 * (1 - w), g1 * w + g2 * (1 - w), b1 * w + b2 * (1 - w)]);
};
// WCAG 相对亮度与对比比
const relLum = (rgb) => {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
};
const contrast = (aHex, bVal) => {
  const [l1, l2] = [relLum(hex2rgb(aHex)), relLum(toRgb(bVal))].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

const L0_WORDS = ["--mist", "--mist-border", "--paper"];
for (const mode of MODES) {
  for (const w of L0_WORDS) {
    if (!modeVars[mode.name][w]) fail(`${mode.name} 模式缺 L0 词 ${w}（或值非 #rrggbb hex / hsl(H S% L%)）`);
  }
}

const report = [];
for (const role of ROLES) {
  for (const mode of MODES) {
    const v = modeVars[mode.name];
    const mixed = mix(v[role.a], role.p, v[role.b]);
    report.push({
      role: role.name, mode: mode.name, formula: `color-mix(in srgb, var(${role.a}) ${role.p}%, var(${role.b}))`,
      value: mixed, cardBg: v["--paper"], contrastVsCard: Number(contrast(mixed, v["--paper"]).toFixed(3)),
    });
  }
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("theme_mix=ok（三模式实算——台账登记用；不达标走 L0 中间词补救路径，禁直改 L1）");
  for (const r of report) {
    console.log(`  ${r.role} [${r.mode}] = ${r.value}（对卡片底 CR ${r.contrastVsCard}）`);
  }
}
