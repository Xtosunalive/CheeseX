#!/usr/bin/env node
// ── check-table-usage（A2+B · Master 审计 2026-10-16「组件活性门禁」批）──
// 管控对象：表格域「注册↔沉淀」闭环的三道闸——域内组件用法合规＋BEM 类活性＋tsx 组件 import 活性。
// 迭代模型：_baseline.json 棘轮只减不增（存量逐步收编，新增即红）。
//   ①用法面：features/ 下出现 <table 自写骨架 → 红（必须走 DataTable 基座；T11 豁免在册）
//   ②BEM 面：table-preset.css 定义的 .data-table__* 类在 tsx/css 图内零挂载 → 红（死类）
//   ③活性面：域内统一件（data-table/row-actions/statistic/status-dot/table-*/filter-select）在 features/ 零 import → 红（死件）
// 运行：npm run check:table-usage
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..");
const FEATURES = join(ROOT, "src", "features");
const COMPONENTS = join(ROOT, "src", "components");
const PRESET = join(ROOT, "src", "styles", "table-preset.css");

const violations = [];

// ── 递归收集 tsx ──
function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (name.endsWith(".tsx") && !name.includes(".test.")) acc.push(p);
  }
  return acc;
}

// 列目录与读文件之间文件可能已被并发测试的探针清理（check-ui-kit 等共用 src/features/dashboard/ 探针位）——
// 消失的文件按空文本处理，不裸崩；其他错误照抛
function readText(f) {
  try { return readFileSync(f, "utf-8"); }
  catch (error) { if (error && error.code === "ENOENT") return ""; throw error; }
}
const featureFiles = walk(FEATURES);
const allTsx = [...featureFiles, ...walk(COMPONENTS)];

// ══ ① 用法面：features/ 下禁自写 <table 骨架 ══
const EXEMPT = /(?:anomaly-workbench\/components\/AnomalyIssueList|theme-preview\/ThemePreviewView)\.tsx$/; // T11＝Master 验收的 Linear 壳契约；预览页＝token 目检静态样例（非业务表格）
for (const f of featureFiles) {
  const rel = relative(ROOT, f).split("\\").join("/");
  if (EXEMPT.test(rel)) continue;
  const text = readText(f);
  // 排除 DataTable 基座自身（components/ 不在 features/，不会命中）
  if (/<table[\s>]/.test(text)) {
    violations.push(`[自写表格] ${rel} 含原生 <table>——必须走 DataTable 基座（T11 豁免除外）`);
  }
}

// ══ ② BEM 面：preset 类必须有人挂载 ══
const presetText = readFileSync(PRESET, "utf-8");
const bemClasses = [...presetText.matchAll(/\.(data-table__[a-z-]+(?:--[a-z-]+)?)/g)].map((m) => m[1]);
const uniqueBem = [...new Set(bemClasses)];
// 挂载面＝全仓 tsx＋preset 自身的选择器组合（如 .data-table--sticky .data-table__th）
const allText = [...allTsx.map((f) => readText(f)), presetText].join("\n");
for (const cls of uniqueBem) {
  // 类在 preset 选择器中定义＋在 tsx className 或 preset 复合选择器中出现
  const usedInTsx = allTsx.some((f) => readText(f).includes(cls));
  // preset 内组合使用（排除定义行本身）
  const usedInPreset = presetText.split(cls).length > 2; // 出现＞定义处
  if (!usedInTsx && !usedInPreset) {
    violations.push(`[BEM死类] .${cls} 在 table-preset.css 定义但全仓零挂载`);
  }
}

// ══ ③ 活性面：域内统一件必须有消费者 ══
const DOMAIN_COMPONENTS = [
  { import: "@/components/data-table/DataTable", name: "DataTable" },
  // F5 拆分后命名空间对象住 editable-cell-group（组件文件只留组件），消费面按新路径计
  { import: "@/components/data-table/editable-cell-group", name: "EditableCell" },
  { import: "@/components/row-actions/RowActions", name: "RowActions" },
  { import: "@/components/statistic/Statistic", name: "Statistic" },
  { import: "@/components/status-dot/StatusDot", name: "StatusDot" },
  { import: "@/components/table-pagination", name: "TablePagination" },
  { import: "@/components/table-sort-header", name: "TableSortHeader" },
  { import: "@/components/filter-select", name: "FilterSelect" },
];
for (const comp of DOMAIN_COMPONENTS) {
  const consumers = featureFiles.filter((f) => readText(f).includes(`from "${comp.import}`)).length;
  if (consumers === 0) {
    violations.push(`[死件] ${comp.name}（${comp.import}）在 features/ 零消费`);
  }
}

// ══ 输出 ══
if (violations.length > 0) {
  console.error(`table_usage=FAIL violations=${violations.length}`);
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}
console.log(`table_usage=ok bem_classes=${uniqueBem.length} domain_components=${DOMAIN_COMPONENTS.length}`);
