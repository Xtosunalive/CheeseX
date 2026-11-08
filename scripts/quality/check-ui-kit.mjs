#!/usr/bin/env node
// Component: UI-Kit-Guard（ui-kit 域门禁——原生 <button>/<input> 双标签棘轮基线）
// 政策（2026-10-21 复用效力复查批，Master「批准修复」）：新代码必须走 @/components/ui/button 与
// @/components/ui/input；存量按触碰迁移，不专项替换（手写样式与 ui/ 风格差异大，强换会改视觉）。
// 2026-10-21 二次扩面（Master 审计「门禁只管 button 没管 input」）：input 纳入同一条棘轮，
// 合法落点＝新件 src/components/ui/input.tsx（首消费 TablePagination 页码输入）。
// 机制＝棘轮基线（照 contracts/test-coverage-baseline.json 先例）：
//   ① 基线外文件出现原生标签 → 红（新文件/新接入必须用 ui/ 基础件）
//   ② 基线内文件某标签计数 > 登记值 → 红（存量只减不增）
//   ③ 基线内文件全部标签归零 → 红（僵尸条目必须缩减——`--write` 重算基线即可）
//   计数下降不拦（按触碰迁移的正向信号）；`--write` 以当前仓重算基线（只在迁移批里用，CI 不带）。
// 范围：src/**/*.tsx；豁免 src/components/ui/**（基础件自身）、src/components/aria/**（侧栏专属皮肤，PR-070）、src/test/**
// @context: contracts/reuse-domains.json#ui-kit；基线＝contracts/ui-kit-baseline.json（机器生成，禁手改）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = path.join(ROOT, "src");
const BASELINE = path.join(ROOT, "contracts", "ui-kit-baseline.json");
const WRITE = process.argv.includes("--write");
const TAGS = ["button", "input"];
const TAG_RE = {
  button: /<button\b/g,
  input: /<input\b/g,
};

function fail(vs) {
  console.log(`ui_kit=FAIL violations=${vs.length}`);
  for (const v of vs) console.log(`  ${v}`);
  process.exit(1);
}

function walk(dir, acc) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, acc);
    else if (name.endsWith(".tsx")) acc.push(full);
  }
  return acc;
}

function exempt(rel) {
  return rel.includes("src/test/") || rel.startsWith("src/components/ui/") || rel.startsWith("src/components/aria/");
}

// 现场计数：rel → { tag: n }（注释行不计）
const actual = new Map();
for (const full of walk(SRC, [])) {
  const rel = path.relative(ROOT, full).split(path.sep).join("/");
  if (exempt(rel)) continue;
  const counts = {};
  // 并发测试的探针文件可能在 walk 与读取之间被清理（check-table-usage 等共用探针位）——消失即跳过，不裸崩
  let source;
  try { source = fs.readFileSync(full, "utf-8"); }
  catch (error) { if (error && error.code === "ENOENT") continue; throw error; }
  for (const line of source.split("\n")) {
    const t = line.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("{/*")) continue;
    for (const tag of TAGS) counts[tag] = (counts[tag] || 0) + (line.match(TAG_RE[tag]) || []).length;
  }
  for (const tag of TAGS) if (counts[tag] > 0) actual.set(rel, { ...(actual.get(rel) || {}), [tag]: counts[tag] });
}

if (WRITE) {
  const files = Object.fromEntries([...actual.entries()].sort(([a], [b]) => a.localeCompare(b)));
  const total = Object.fromEntries(TAGS.map((tag) => [tag, [...actual.values()].reduce((s, c) => s + (c[tag] || 0), 0)]));
  const payload = {
    $comment: "ui-kit 域原生 <button>/<input> 棘轮基线（check:ui-kit 执法；机器生成——改动一律 `node scripts/quality/check-ui-kit.mjs --write` 重算，禁手改）。规则：①基线外文件出现原生标签即红（新代码必须用 @/components/ui/button 与 ui/input）②基线内文件分标签计数只减不增③全部标签归零的条目必须缩减（重算即可）。豁免 ui/（基础件自身）与 aria/（侧栏专属皮肤，PR-070）。",
    generated_at: new Date().toLocaleDateString("sv-SE"),
    total,
    files,
  };
  fs.writeFileSync(BASELINE, JSON.stringify(payload, null, 2) + "\n");
  console.log(`ui_kit_baseline=written files=${actual.size} raw_buttons=${total.button} raw_inputs=${total.input}`);
  process.exit(0);
}

let baseline;
try { baseline = JSON.parse(fs.readFileSync(BASELINE, "utf-8")).files || {}; } catch (e) {
  fail([`[基线不可读] ${path.relative(ROOT, BASELINE)}: ${e.message}（fail-closed）`]);
}

const violations = [];
for (const [rel, counts] of actual) {
  if (!(rel in baseline)) {
    const tags = TAGS.filter((tag) => counts[tag] > 0).join("/");
    violations.push(`[新文件原生${tags}] ${rel} → 用 @/components/ui/ 基础件（新代码不进基线）`);
  } else {
    for (const tag of TAGS) {
      if ((counts[tag] || 0) > (baseline[rel][tag] || 0)) {
        violations.push(`[存量膨胀] ${rel}: <${tag}> ${counts[tag]} > 基线 ${baseline[rel][tag] || 0}——原生标签只减不增`);
      }
    }
  }
}
for (const rel of Object.keys(baseline)) {
  if (!actual.has(rel)) violations.push(`[基线僵尸] ${rel}: 现场全标签归零——条目须缩减（跑 --write 重算）`);
}

const total = Object.fromEntries(TAGS.map((tag) => [tag, [...actual.values()].reduce((s, c) => s + (c[tag] || 0), 0)]));
const baseTotal = Object.fromEntries(TAGS.map((tag) => [tag, Object.values(baseline).reduce((s, c) => s + (c[tag] || 0), 0)]));
const dropped = TAGS.filter((tag) => total[tag] < baseTotal[tag]);
if (violations.length === 0) {
  console.log(
    `ui_kit=ok files=${actual.size} raw_buttons=${total.button} raw_inputs=${total.input} baseline=${baseTotal.button}/${baseTotal.input}` +
      (dropped.length ? "（已下降，可重算基线）" : "")
  );
} else fail(violations);
