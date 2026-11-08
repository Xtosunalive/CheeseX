#!/usr/bin/env node
// Component: Schema-Shape-Guard（schema-shape 域门禁——批16 切片：实体字段候选单源＋R4 装配分支收口）
// 检查面：
//   ① 实体候选键外泄：src/features/** 与 src/components/** 中，对象键 arch_layer/arch_category/arch_subdomain
//      被赋**非字面量**值（候选推导的第二份实现——批16 前双份拍平的正是此形态）。
//      值为字符串字面量（如草稿初值 arch_layer: ""）不违例；类型声明的可选键（arch_layer?:）不违例。
//   ②（推论面）候选推导唯一源＝src/lib/schema-shape.ts entityFieldCandidates——
//      键面类型也应取域内 EntityFieldKey，别处再声明 arch_* 键类型同样命中检查面①。
//   ③ 装配分支收口（PR-277 R4）：SchemaManagerView.tsx 不得含逐页签装配分支——形状判据：
//      `activeTab ===` 字面量比较（if/三元链的逐页签装配语言面）或 `switch (…activeTab)`。
//      装配唯一出口＝src/lib/schema-edit.ts changeOf（TAB_EDIT_META 声明驱动）；
//      store.setActiveTab 动作调用与 tab prop 透传不在判据内（那是动作与取数，不是装配分支）。
//      豁免登记位：TAB_BRANCH_EXEMPTS（{ fragment, reason }——行内唯一片段＋理由＋另案编号），
//      命中豁免显式打印；豁免空转（登记了但永不命中）即红，应摘除。
// 不在本面：src/lib/**（域本体）、*.test.*（测试）、src/features/schema-manager/**（enums 编辑器
//   合法直读 section 原文——它管的是 YAML 编辑面不是候选投影；检查面③按 PR-277 收口对象单指
//   SchemaManagerView.tsx 一个文件，不随 EXCLUDE_REL 扩缩）。
// @context: contracts/reuse-domains.json#schema-shape（SCHEMA-IA-001 批16；收编 EntityComplianceView/
//   AnomalyEntityRepairDrawer 双份拍平后立法，防第三份回潮）；R4 面＝docs/plans/方案决策卡-单源收口四替换-2026-11-07.md §2
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCAN_ROOTS = [path.join(ROOT, "src", "features"), path.join(ROOT, "src", "components")];
const EXCLUDE_REL = [/src\/features\/schema-manager\//]; // enums 编辑器合法面
const VIOLATION = /\barch_(layer|category|subdomain)\s*:\s*[^"'`\s]/; // 键后直取非字面量值（草稿 ""/类型 ?: 不命中）

function fail(vs) {
  console.log(`schema_shape=FAIL violations=${vs.length}`);
  for (const v of vs) console.log(`  ${v}`);
  process.exit(1);
}

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) yield full;
  }
}

const violations = [];
let scanned = 0;
for (const root of SCAN_ROOTS) {
  for (const full of walk(root)) {
    const rel = path.relative(ROOT, full).split(path.sep).join("/");
    if (EXCLUDE_REL.some((re) => re.test(rel))) continue;
    scanned += 1;
    const lines = fs.readFileSync(full, "utf-8").split("\n");
    lines.forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith("//") || t.startsWith("*")) return;
      const m = VIOLATION.exec(line);
      if (m) violations.push(`[候选键外泄] ${rel}:${i + 1}: arch_${m[1]} 由本文件推导——候选单源=schema-shape entityFieldCandidates`);
    });
  }
}

// ── 检查面③（PR-277 R4）：装配分支收口——视图装配唯一出口=schema-edit changeOf ──
const VIEW_REL = "src/features/schema-manager/SchemaManagerView.tsx";
const VIEW_FILE = path.join(ROOT, VIEW_REL);
const TAB_BRANCH = /activeTab\s*===\s*["'`]|switch\s*\(\s*[\w.]*\.?activeTab\s*\)/;
const TAB_BRANCH_EXEMPTS = []; // 豁免登记位：{ fragment: "行内唯一片段", reason: "理由（含另案编号）" }

let tabBranchSites = 0;
let tabExemptSites = 0;
if (fs.existsSync(VIEW_FILE)) {
  const matchedFragments = new Set();
  const lines = fs.readFileSync(VIEW_FILE, "utf-8").split("\n");
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith("//") || t.startsWith("*")) return;
    if (!TAB_BRANCH.test(line)) return;
    const exempt = TAB_BRANCH_EXEMPTS.find((e) => e.fragment && line.includes(e.fragment));
    if (exempt) {
      matchedFragments.add(exempt.fragment);
      tabExemptSites += 1;
      console.log(`  [装配分支豁免] ${VIEW_REL}:${i + 1}: ${exempt.reason}`);
      return;
    }
    tabBranchSites += 1;
    violations.push(`[装配分支] ${VIEW_REL}:${i + 1}: 逐页签装配分支——装配唯一出口=schema-edit changeOf（TAB_EDIT_META 声明驱动）`);
  });
  for (const e of TAB_BRANCH_EXEMPTS) {
    if (!matchedFragments.has(e.fragment)) {
      violations.push(`[豁免空转] ${VIEW_REL}: 豁免片段「${e.fragment}」未命中任何行——空转豁免应摘除（${e.reason}）`);
    }
  }
} else {
  violations.push(`[装配分支] ${VIEW_REL} 不存在——R4 收口对象缺失`);
}

if (violations.length === 0) {
  const exemptNote = tabExemptSites > 0 ? ` view_exempts=${tabExemptSites}` : "";
  console.log(`schema_shape=ok files=${scanned} candidate_sites=0 view_branch_sites=${tabBranchSites}${exemptNote}`);
}
else fail(violations);
