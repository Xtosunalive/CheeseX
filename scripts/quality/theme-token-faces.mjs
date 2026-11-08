#!/usr/bin/env node
// Component: Theme-Token-Hygiene-Guard（PR-025 阶段 3；WP-147 二期 2026-11-07 面④⑤按 vendor 色板口径重排）
// @responsible: 前端主题契约的机器执法。检查面六项（docs/design/theme-contract.md 五禁令 + 显示模式 PR 补充）：
//   ① 禁字面值：业务 tsx 中不得出现 hex/rgba 色值字面值（白名单：src/test/** 断言）
//   ② 禁裸调色板：业务 tsx 中不得出现 Tailwind 原始调色板类（text-cyan-400 等；档位限定
//      Tailwind 官方步进 50/100..950——Radix 分类色 step 档 1..12 如 text-amber-11 是合法 L1 词）
//   ③ 禁内联色：style={{ color/background/borderColor/fill/stroke : "字面值" }}（var() 引用合法）
//   ④ L0 唯一性（WP-147 新口径）：分类色 L0＝vendor 色板 @radix-ui/colors；@theme inline 内
//      分类色 L1 词（--color-<族>-<step>）必须整值连名引用同名 vendor 变量 var(--<族>-<step>)，
//      其余 L1 词仍走 :root L0 + var()/color-mix()；@theme 内色值字面值一律仍禁
//   ⑤ 退役词防回流：RETIRED_TOKENS 声明的旧词汇不得在业务代码回流（WP-147：cat-* 旧词
//      类名/var/token 名串三通道全量退役）
//   ⑥ 非法描边类：stroke-currentColor（编译静默丢弃=图标隐身，2026-10-07 显示模式 PR 实证）
//   ⑦ CSS 图执法（W0-3 · 契约 A2/L3）：@import 图子文件＋组件直挂 CSS（CardNav 模式）内
//      禁色值字面值／裸 z-index／裸动效时长／裸字重。index.css 自身不适用本节（其 L0/@theme
//      规则由检查④管，裸区存量随类消灭批收敛）。存量走 theme-baseline.json 棘轮：只减不增＋逼销账。
// 豁免区：src/components/ui/**、src/components/aria/**（基础组件按契约禁令 3 保留官方词）、
//        src/test/**（断言需写待断言字面值）、dist/**（构建产物）
// 模式：fail-closed——文件缺失/解析异常一律 exit 1。同值异名检测留待 v2（需语义分析）。
// @inputs: src/**/*.tsx, src/index.css
// @outputs: stdout 报告 theme_tokens=ok|FAIL violations=N；非零退出 = 存在违规
// @context: PR-025 定案 3（严门禁+窄白名单）；范式参照 check-layer-ssot.mjs（PR-008）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectCssGraph, stripCssComments } from "./shared/theme-css-graph.mjs";
import { loadThemeBaseline, compareBaseline } from "./shared/theme-baseline.mjs";
import { themeFileExemptPatterns } from "../../shared/theme-exemptions.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = path.join(ROOT, "src");
const INDEX_CSS = path.join(ROOT, "src", "index.css");

// ── 豁免路径（契约禁令 3 与白名单）──
// WP-138 R5c：豁免名单单源化——原「双清单同步义务」（eslint.config.js 分类色板 override 与本清单
// 各持一份、增删两处同笔改）退役，改经 theme-exemptions.mjs 唯一声明派生（豁免区＋色板唯一源文件）。
// eslint 面同读一份（PALETTE_SOURCE_FILES）——增删豁免只改单源，两侧同变，假红教训不再复发。
const EXEMPT = themeFileExemptPatterns();

// ── 退役词汇表（随阶段推进登记；形态=正则源）──
// 阶段 2 已从业务侧清零的同义词与裸板（ui//aria/ 基础组件合法区除外）
// WP-147 二期（2026-11-07 连名换装）：cat-* 旧词全量退役——类名/var/token 名串三通道防回流
const RETIRED_TOKENS = [
  { pattern: /\b(text|bg|ring)-(?:muted-foreground|secondary|background|foreground)\b/, successor: "text-text-sub / bg-surface-hover 等 L1 词" },
  { pattern: /\bbg-primary\b|\btext-primary\b|\bring-ring\b/, successor: "bg/text-accent-base、ring-accent-base" },
  // 裸板档位限定 Tailwind 官方步进（50/100..950）——Radix 分类色 step 档 1..12（text-amber-11 等）是合法 L1 词，不得误伤
  { pattern: /\b(text|bg|border|ring|fill|stroke)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-(?:50|[1-9]\d{2})\b/, successor: "status-* 语义 token 或 --color-<族>-<step> 分类色（WP-147 Radix 换装）" },
  { pattern: /\b(text|bg|border|ring|fill|stroke)-kg-(?:fact|inferred|warn|error)\b/, successor: "status-fact/inferred/warn/error（kg 颜色别名已退役；字阶 kg-xs/2xs/md 保留）" },
  { pattern: /\b(text|bg|ring)-white\b/, successor: "text-accent-contrast（饱和紫底白字）/ bg-surface-card（白色表面）——text-white 收口批（2026-10-05）" },
  { pattern: /\b(?:text|bg|border|ring|fill|stroke|from|to|via|outline|decoration|divide|caret)-cat-[a-z0-9-]+\b/, successor: "--color-<族>-<step>（Radix 12 阶；映射见 docs/plans/方案决策卡-Radix映射-2026-11-07.md §3.1）" },
  { pattern: /var\(--cat-[a-z0-9-]+\)/, successor: "var(--color-<族>-<step>)（cat L0 名随 WP-147 连名换装退役）" },
  { pattern: /["'`]--cat-[a-z0-9-]+["'`]/, successor: "--color-<族>-<step>（集中表存 token 名随连名换装更新，契约禁令 5）" },
];

// 色值字面值：hex 3/4/6/8 位或 rgb(a)(。排除纯数字 3-5 位短串——本仓 issue 引用
// 形如 #1756/#800，纯数字十六进制色值在实践中不出现于本项目（已知色值均含字母）。
// B2（红队）：色值字面值含全部颜色函数族——hex/rgb(a)/hsl(a)/hwb/oklch/oklab/lab/lch/color()
const COLOR_FN = /rgba?\(\s*\d|hsla?\(\s*[\d.]-|hwb\(\s*\d|oklch\(\s*[-\d.]|oklab\(\s*[-\d.]|lab\(\s*[\d.]|lch\(\s*[\d.]|color\(/;
const LITERAL_COLOR = new RegExp(`#[0-9a-fA-F]*[a-fA-F][0-9a-fA-F]{2,7}\\b|${COLOR_FN.source}`);
const INLINE_COLOR_PROP = /(color|Color|background|fill|stroke)\s*:\s*["'][^"']*?(#[0-9a-fA-F]{3,8}|rgba?\(\s*\d|hsla?\(\s*[\d.]-|hwb\(\s*\d|oklch\(\s*[-\d.]|lab\(\s*[\d.])[^"']*?["']/;

// 非法 SVG 描边类名（显示模式 PR 实证陷阱，2026-10-07）：stroke-currentColor 不是合法
// Tailwind 类（合法 = stroke-current），编译器静默丢弃 → 图标无描边无填充=隐身。
// 眼下常见变体：stroke-currentColor / stroke:currentColor（任意值语法同样错）。
const BAD_STROKE_CLASS = /\bstroke-(?:-)?currentColor\b|\bstroke:\s*currentColor\b/;

function fail(violations) {
  // 类别直方图随摘要输出：详情区只展示前 50 条（WP-147 迁移窗口期退役词可占满上限），
  // 直方图保证各检查面的计数始终可读，防中间态噪声掩盖其他类别的真实违规
  const byCat = {};
  for (const v of violations) {
    const c = v.match(/^\[(.+?)\]/)?.[1] || "其他";
    byCat[c] = (byCat[c] || 0) + 1;
  }
  console.log(`theme_tokens=FAIL violations=${violations.length} by_category=${JSON.stringify(byCat)}`);
  for (const v of violations.slice(0, 50)) console.log(`  ${v}`);
  if (violations.length > 50) console.log(`  …另 ${violations.length - 50} 处`);
  process.exit(1);
}

function isExempt(relPath) {
  return EXEMPT.some((re) => re.test(relPath));
}

function walk(dir, acc) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, acc);
    // 口径教训（PR-025 18:20 漏网事件）：色值不只住在 .tsx——.ts 里的常量表
    // （如 schema-manager-types LAYER_COLOR_MAP）同样承载色值，漏扫=.ts 成法外之地
    else if (name.endsWith(".tsx") || (name.endsWith(".ts") && !name.endsWith(".d.ts"))) acc.push(full);
  }
  return acc;
}

const violations = [];

// ── ①②③⑤ 业务 tsx 扫描 ──
const files = walk(SRC, []);
for (const full of files) {
  const rel = path.relative(ROOT, full).split(path.sep).join("/");
  if (isExempt(rel)) continue;
  const lines = fs.readFileSync(full, "utf-8").split("\n");
  let inJsxComment = false;
  lines.forEach((line, i) => {
    const loc = `${rel}:${i + 1}`;
    const trimmed = line.trim();
    // 跳过注释：JS 行注释 / 块注释续行 / 多行 JSX 注释（{/* … */}）内部
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
    if (inJsxComment) {
      if (line.includes("*/}")) inJsxComment = false;
      return;
    }
    if (line.includes("{/*") && !line.includes("*/}")) { inJsxComment = true; return; }
    let effective = line.replace(/\{\/\*[\s\S]*?\*\}/g, "");
    // ① 字面值（含任意值类名形态 bg-[rgba(...)]；在 effective=剔除注释后的行上判定）
    const lit = effective.match(LITERAL_COLOR);
    if (lit) violations.push(`[字面值] ${loc}: …${effective.trim().slice(Math.max(0, lit.index - 20), lit.index + 30)}…`);
    // ③ 内联 style 颜色（var() 引用合法，只拦字面值）
    if (INLINE_COLOR_PROP.test(effective)) violations.push(`[内联色] ${loc}: …${trimmed.slice(0, 80)}…`);
    // ②⑤ 裸调色板 / 退役词
    for (const rt of RETIRED_TOKENS) {
      if (rt.pattern.test(effective)) {
        const m = effective.match(rt.pattern);
        violations.push(`[退役词] ${loc}: ${m ? m[0] : ""} → 应使用 ${rt.successor}`);
      }
    }
    // ⑥ 非法 SVG 描边类名（stroke-currentColor 编译静默丢弃 = 图标隐身）
    if (BAD_STROKE_CLASS.test(effective)) {
      violations.push(`[非法描边类] ${loc}: stroke-currentColor 不是合法 Tailwind 类 → 用 stroke-current（recipes mode-switch.triggerIcon 陷阱记录）`);
    }
  });
}

// ── ④ index.css 的 @theme inline 块（WP-147 二期 vendor 色板口径重写）──
// 新口径：分类色 L0＝vendor 色板（@radix-ui/colors，包文件不入执法图）；@theme inline 内
// 分类色 L1 词（--color-<族>-<step>）必须整值连名引用同名 vendor 变量 var(--<族>-<step>)，
// 其余 L1 词仍走 :root L0 var()/color-mix()；@theme 内色值字面值一律仍禁。
if (!fs.existsSync(INDEX_CSS)) {
  fail(["[结构] src/index.css 不存在"]);
}
const cssText = fs.readFileSync(INDEX_CSS, "utf-8");
const cssLines = cssText.split("\n");
// 连名一致性（结构面）：分类色词形已出现而 vendor 色板未接入 → L0 无来源（契约 L0 铁律）
const STEP_DEF = /^\s*--color-([a-z]+-(?:[1-9]|1[0-2]))\s*:\s*([^;]+);/;
if (/--color-[a-z]+-(?:[1-9]|1[0-2])\s*:/.test(cssText) && !/@radix-ui\/colors/.test(cssText)) {
  violations.push("[L0结构] src/index.css: 出现 --color-<族>-<step> 分类色定义但未 @import @radix-ui/colors（L0＝分类色唯一引用 vendor 色板处，WP-147 铁律）");
}
let inTheme = false;
let depth = 0;
cssLines.forEach((line, i) => {
  // 只认行首真实指令（@theme inline {）；注释/文档中提及不算
  if (/^\s*@theme\s+inline\s*\{/.test(line)) { inTheme = true; depth = 1; return; }
  if (inTheme) {
    depth += (line.match(/{/g) || []).length;
    depth -= (line.match(/}/g) || []).length;
    if (depth <= 0) inTheme = false;
  }
  if (inTheme) {
    // 阴影复合 token 结构豁免（收窄版，2026-10-05 收尾批）：offset/blur/长度的字面数字合法，
    // 但颜色部分必须是 var() 引用——黑系 rgb 已拆入 :root L0（--shadow-ring-ink/--shadow-blur-ink）。
    if (/^\s*--shadow-/.test(line)) {
      const value = line.replace(/^\s*--shadow-[\w-]+\s*:\s*/, "");
      if (/rgba?\(|#/.test(value)) {
        violations.push(`[L1阴影字面值] src/index.css:${i + 1}: 阴影值含色值字面值（颜色应拆入 :root L0 深度 token，如 --shadow-ring-ink）: ${line.trim().slice(0, 70)}`);
      }
      return;
    }
    // WP-147 面④新增：分类色连名对账——--color-<族>-<step> 值必须恰为 var(--<同族同档>)
    // chart-1..5 是图表系列号（非 Radix step 档，值走 :root --chart-* L0），不属连名辖域
    const stepDef = line.match(STEP_DEF);
    if (stepDef && !stepDef[1].startsWith("chart-")) {
      const value = stepDef[2].replace(/\/\*[\s\S]*?\*\//g, "").trim();
      if (value !== `var(--${stepDef[1]})`) {
        violations.push(`[L1分类色连名] src/index.css:${i + 1}: --color-${stepDef[1]} 必须整值连名引用同名 vendor 变量 var(--${stepDef[1]})（色值字面值唯一来源＝vendor 色板包）: ${line.trim().slice(0, 70)}`);
      }
    }
    const lit = line.match(LITERAL_COLOR);
    // 注释里的档位溯源标注（/* Cyan 9 */）合法；只拦值位字面值
    if (lit && !/\/\*/.test(line.slice(0, lit.index))) {
      violations.push(`[L1字面值] src/index.css:${i + 1}: @theme inline 块内出现色值字面值（分类色走 vendor 变量连名引用，其余移入 :root L0 层）: ${line.trim().slice(0, 70)}`);
    }
  }
});

// ── ⑦ CSS 图执法（W0-3 · 红队复核修复版：B1/S1/S3/S4/S5）──
// 执法面：@import 图子文件＋组件直挂 CSS＋index.css 裸区（红队 B1：@theme/:root/.dark/
// [data-mode]/@keyframes/@font-face 合法块之外的裸区曾是完全免检后门）。
// 扫描单位＝声明（prop: value;，跨行归并——红队 S3），值先剥 url()/引号串（S5 假红防护）。
// 存量走 theme-baseline.json 棘轮：只减不增＋逼销账。
const cssFindings = []; // { fp, msg }
const bumpFp = (map, k) => map.set(k, (map.get(k) || 0) + 1);
const { subFiles } = collectCssGraph({ root: ROOT, src: SRC });

// 声明级归并：产出 { line, prop, value }（S3 跨行声明）
function* declsOf(strippedLines) {
  let buf = "";
  let startLine = 0;
  for (let i = 0; i < strippedLines.length; i++) {
    let line = strippedLines[i];
    if (/^\s*@(?:import|plugin|custom-variant|tailwind)\b/.test(line)) continue;
    if (!buf) startLine = i + 1;
    buf += " " + line;
    for (;;) {
      const cut = buf.search(/[;{}]/);
      if (cut === -1) break;
      const seg = buf.slice(0, cut).trim();
      buf = buf.slice(cut + 1);
      const m = seg.match(/^([a-zA-Z-]{2,})\s*:\s*(.+)$/);
      if (m && !seg.startsWith("@")) yield { line: startLine, prop: m[1].toLowerCase(), value: m[2].trim() };
      if (!buf.trim()) { buf = ""; startLine = 0; }
      else startLine = startLine; // 归并段行号取起始行
    }
  }
}
// 值预处理：剥 url(...) 与引号串（资产地址/文案不是主题字面值——S5）
const cleanValue = (v) => v.replace(/url\([^)]*\)/gi, " ").replace(/"[^"]*"|'[^']*'/g, " ");
// index.css 合法块跟踪（:root/.dark/[data-mode]/@theme/@keyframes/@font-face 内不扫——L0 家与动画定义域）
const LEGAL_BLOCK = /^\s*(?::root|\.dark\b|\[data-mode[^{]*|@theme[^{]*|@keyframes[^{]*|@font-face\b)[^{]*\{/;

function scanDeclarations(rel, strippedLines, isSubFile) {
  for (const d of declsOf(strippedLines)) {
    const loc = `${rel}:${d.line}`;
    const v = cleanValue(d.value);
    // 指纹取完整函数调用/整词，声明内多个色值逐个入账（截断指纹无法与基线稳定对账）
    for (const lit of v.matchAll(/rgba?\([^)]*\)|hsla?\([^)]*\)|hwb\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)|lab\([^)]*\)|lch\([^)]*\)|color\([^)]*\)|#[0-9a-fA-F]*[a-fA-F][0-9a-fA-F]{2,7}\b/gi)) {
      const fp = `${rel}|CSS字面值|${lit[0].toLowerCase().replace(/\s+/g, "")}`;
      cssFindings.push({ fp, msg: `[CSS字面值] ${loc}: …${d.prop}: ${d.value.slice(0, 60)}…（L3/L0 域外禁色值字面值，颜色走 token）` });
    }
    if (d.prop === "z-index" && !v.startsWith("var(")) { // S1：整值判定（calc/负数/+/回退均拦）
      const fp = `${rel}|CSS裸z|z-index:${v.split(/\s+/)[0]}`;
      cssFindings.push({ fp, msg: `[CSS裸z] ${loc}: z-index: ${v.slice(0, 20)}（层级一律 var() 引用 token，L3 禁令）` });
    }
    if (/^(transition|animation|transition-duration|animation-duration|transition-property)$/.test(d.prop) ||
        (/^(transition|animation)$/.test(d.prop))) {
      const dur = v.match(/\d+(?:\.\d+)?m?s\b/);
      if (dur) {
        const fp = `${rel}|CSS裸时长|${dur[1] || dur[0]}`;
        cssFindings.push({ fp, msg: `[CSS裸时长] ${loc}: ${d.prop}: …${dur[0]}…（动效时长一律 var() 引用 token，L3 禁令）` });
      }
    }
    if ((d.prop === "font-weight" && /^\d{3}\b/.test(v)) || (d.prop === "font" && /^\d{3}\s/.test(v))) { // S4
      const fp = `${rel}|CSS裸字重|${v.slice(0, 3)}`;
      cssFindings.push({ fp, msg: `[CSS裸字重] ${loc}: ${d.prop}: …${v.slice(0, 12)}…（字重用语义类，L3 禁令）` });
    }
    if (isSubFile && d.prop.startsWith("--") && /\d+(?:\.\d+)?m?s\b/.test(v) && !v.startsWith("var(")) { // S2：子文件自定义属性时长间接
      const fp = `${rel}|CSS裸时长|${v.match(/\d+(?:\.\d+)?m?s\b/)[0]}`;
      cssFindings.push({ fp, msg: `[CSS裸时长] ${loc}: ${d.prop}: …${v.slice(0, 24)}…（时长型自定义属性在子文件需经注册 token/var 链）` });
    }
  }
}

for (const file of subFiles) {
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  scanDeclarations(rel, stripCssComments(fs.readFileSync(file, "utf-8")), true);
}
// B1：index.css 裸区（合法块外）同等执法
{
  const stripped = stripCssComments(fs.readFileSync(INDEX_CSS, "utf-8"));
  let inLegal = false, depth = 0;
  const bareLines = stripped.map((line) => {
    if (!inLegal && LEGAL_BLOCK.test(line)) { inLegal = true; depth = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length; return ""; }
    if (inLegal) {
      depth += (line.match(/\{/g) || []).length; depth -= (line.match(/\}/g) || []).length;
      if (depth <= 0) inLegal = false;
      return "";
    }
    return line;
  });
  scanDeclarations("src/index.css", bareLines, false);
}

const cssNow = new Map();
for (const f of cssFindings) bumpFp(cssNow, f.fp);
const baseline = loadThemeBaseline();
if (baseline.error) violations.push(`[结构] ${baseline.error}`);
const cssRatchet = compareBaseline(baseline.tokens_css, cssNow);
for (const [k] of cssRatchet.added) {
  const first = cssFindings.find((f) => f.fp === k);
  violations.push(`${first ? first.msg : k}（基线外新增——契约禁令，存量只减不增）`);
}
for (const [k, was, now] of cssRatchet.stale) {
  violations.push(`[CSS图·快照滞留] ${k}：基线 ${was} → 现存 ${now}（已收敛——请从 theme-baseline.json 删该条目销账）`);
}
const cssBaselineHeld = cssFindings.length - cssRatchet.added.reduce((s, [, n]) => s + n, 0);

if (violations.length === 0) {
  console.log(`theme_tokens=ok files_scanned=${files.length} css_subfiles=${subFiles.length} css_baseline_held=${cssBaselineHeld} retired_tokens=${RETIRED_TOKENS.length}`);
} else {
  fail(violations);
}
