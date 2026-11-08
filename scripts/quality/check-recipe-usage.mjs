#!/usr/bin/env node
// ── check-recipe-usage（配方执法器 · Master 2026-10-16「能按契约和配方检查出没收敛的代码吗」）──
// 管控对象：配方层规则的机器可判定子集——六道检查。
// 与 check:table-usage（组件活性）互补：那个管「用什么组件」，这个管「怎么用」。
// 迭代模型：_baseline.json 棘轮只减不增（存量逐步收编，新增即红）。
//   ① 裸 z：全局层级禁数字（z-10/20/30/40/50/[60]/[80]），须走 z-sticky/z-docked/…语义类
//   ② 默认阴影：禁 shadow-sm/md/lg（Tailwind 默认黑），须走 shadow-card/popover/overlay（品牌）
//   ③ h-7 离档：禁新增 h-7（28px 不在 control-height 档），存量棘轮（WP-036 图标归位 26→23，2026-10-28 下压）
//   ④ 自写表格：features/ 禁 <table>（T11/theme-preview 豁免在册）
//   ⑤ 原生 button in cell：表格单元格内禁原生 <button>（须走 ui/button 或 RowActions）
//   ⑥ 死 import：features/ 下 import 的组件模块路径必须存在（防移动后悬空）
// 运行：npm run check:recipe-usage
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..");
const SRC = join(ROOT, "src");

const violations = [];

// ── 棘轮基线 ──
const BASELINE_FILE = join(ROOT, "scripts/quality/recipe-usage-baseline.json");
const baseline = existsSync(BASELINE_FILE) ? JSON.parse(readFileSync(BASELINE_FILE, "utf-8")) : {};
const current = {};

function bumpCount(key) {
  current[key] = (current[key] || 0) + 1;
}

// ── 递归收集 tsx ──
function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (name.endsWith(".tsx") && !name.includes(".test.")) acc.push(p);
  }
  return acc;
}

const featureFiles = walk(join(SRC, "features"));
const componentFiles = walk(join(SRC, "components"));
const allTsx = [...featureFiles, ...componentFiles];

// ══ ① 裸 z ══
const EXEMPT_FILES = /(AnomalyIssueList|ThemePreviewView)\.tsx$/;
const LOCAL_RAISE_OK = /aria\/sidebar|calendar\.tsx/; // 组件内局部堆叠（z-10/z-20 于 relative 容器）
for (const f of allTsx) {
  const rel = relative(ROOT, f).split("\\").join("/");
  if (EXEMPT_FILES.test(rel)) continue;
  if (LOCAL_RAISE_OK.test(rel)) continue;
  const text = readFileSync(f, "utf-8");
  const bareZ = text.match(/(?<![a-z0-9-])z-(?:10|20|30|40|50|\[60\]|\[80\])(?![a-z0-9\]])/g);
  if (bareZ) {
    for (const z of bareZ) bumpCount(`bareZ|${z}`);
    violations.push(`[裸z] ${rel} 含 ${bareZ.join(",")}——须走 z-sticky/z-docked/z-overlay/z-modal/z-chrome/z-popover`);
  }
}

// ══ ② Tailwind 默认阴影 ══
for (const f of allTsx) {
  const text = readFileSync(f, "utf-8");
  const defaultShadows = text.match(/(?<![a-z-])shadow-(?:sm|md|lg)\b/g);
  if (defaultShadows) {
    for (const sh of defaultShadows) bumpCount(`defaultShadow|${sh}`);
    violations.push(`[默认阴影] ${rel2(f)} 含 ${defaultShadows.join(",")}——须走 shadow-card/shadow-popover/shadow-overlay`);
  }
}

function rel2(f) { return relative(ROOT, f).split("\\").join("/"); }

// ══ ③ h-7 离档（棘轮） ══
let h7Count = 0;
for (const f of allTsx) {
  const text = readFileSync(f, "utf-8");
  const h7 = text.match(/(?<![a-z0-9-])h-7(?![a-z0-9])/g);
  if (h7) h7Count += h7.length;
}
if (h7Count > (baseline.h7 ?? 26)) {
  violations.push(`[h7离档] h-7 总数 ${h7Count} 超基线 ${baseline.h7 ?? 26}（PR-071 子项一在册，只减不增）`);
}
current["h7"] = h7Count;

// ══ ④ 自写表格（features/） ══
for (const f of featureFiles) {
  const rel = rel2(f);
  if (EXEMPT_FILES.test(rel)) continue;
  const text = readFileSync(f, "utf-8");
  if (/<table[\s>]/.test(text)) {
    bumpCount("bareTable");
    violations.push(`[自写表格] ${rel}——须走 DataTable`);
  }
}

// ══ ⑤ 表格单元格内原生 button（检查 DataTable 消费者中的 cell render） ══
for (const f of featureFiles) {
  const text = readFileSync(f, "utf-8");
  // 检查 render: 模式内的 <button（粗匹配：render 回调中含原生 button 且非 ui/button import）
  const hasNativeButton = /render:.*<button(?!\s)/s.test(text) && !/from "@\/components\/ui\/button"/.test(text);
  if (hasNativeButton) {
    bumpCount("nativeButtonInCell");
    violations.push(`[cell内原生button] ${rel2(f)}——render 回调含原生 <button>，须走 ui/button 或 RowActions`);
  }
}

// ══ ⑥ 死 import（悬空模块路径） ══
for (const f of allTsx) {
  const text = readFileSync(f, "utf-8");
  const imports = text.matchAll(/from "(@\/[^"]+)"/g);
  for (const m of imports) {
    const modulePath = m[1].replace("@/", SRC + "/");
    // 尝试解析：目录（有 index）或文件（.tsx/.ts）
    const candidates = [modulePath, modulePath + ".tsx", modulePath + ".ts", join(modulePath, "index.tsx"), join(modulePath, "index.ts"), join(modulePath, "index.css")];
    if (!candidates.some(existsSync)) {
      bumpCount("deadImport");
      violations.push(`[悬空import] ${rel2(f)} → ${m[1]} 模块不存在`);
    }
  }
}

// ══ 棘轮对账 ══
const ratchetKeys = ["bareZ|z-10", "bareZ|z-20", "bareZ|z-30", "bareZ|z-40", "bareZ|z-50", "bareZ|z-[60]", "bareZ|z-[80]", "defaultShadow|shadow-sm", "defaultShadow|shadow-md", "defaultShadow|shadow-lg", "h7", "bareTable", "nativeButtonInCell", "deadImport"];
const exempt = new Set(["bareZ|z-10", "bareZ|z-20"]); // 局部堆叠暂豁免（calendar/aria/侧栏/architecture 内部）

for (const key of ratchetKeys) {
  if (exempt.has(key)) continue;
  const now = current[key] || 0;
  const was = baseline[key] || 0;
  if (now > was) {
    // 新增违规在 violations 里已有具体条目，这里不重复推
  }
}

// ── 输出 ──
if (violations.length > 0) {
  console.error(`recipe_usage=FAIL violations=${violations.length}`);
  for (const v of violations) console.error(`  ${v}`);
  console.error(`\n当前计数: ${JSON.stringify(current)}`);
  process.exit(1);
}
console.log(`recipe_usage=ok checks=6 h7_baseline=${baseline.h7 ?? 26}/${h7Count}`);
