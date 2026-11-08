#!/usr/bin/env node
// Component: Interaction-State-Guard（interaction-state 域门禁——store 层五态枚举）
// 检查面（PR-071 子项二验收「store 状态字段不可出现矛盾组合（loading=true 且 error!=null）」的结构性消灭）：
//   ① zustand store 文件禁声明 `loading: boolean`（主请求必须用 status: RequestStatus，见 src/lib/request-status.ts）
//   ② 同前缀的 `<x>Loading: boolean` 与 `<x>Error: string | null` 配对 → 红（子资源请求同样走 RequestSlice）
//      孤立的 busy 布尔（无同前缀 error 位，如 fieldOptionsLoading）不在本面——单布尔无矛盾组合可言
//   ③ 声明了 status: RequestStatus / RequestSlice 的 store 必须从 @/lib/request-status 取定义（禁本地另写五态字面量）
// 豁免：src/test/**、src/lib/request-status.ts 自身
// @context: contracts/reuse-domains.json#interaction-state（2026-10-21 第二落地：13 store 全部迁五态）
import fs from "node:fs";
import { authorityOf } from "./shared/reuse-domain-refs.mjs"; // PR-208 清债第一批
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = path.join(ROOT, "src");

function fail(vs) {
  console.log(`interaction_state=FAIL violations=${vs.length}`);
  for (const v of vs) console.log(`  ${v}`);
  process.exit(1);
}

function walk(dir, acc) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, acc);
    else if (name.endsWith(".tsx") || (name.endsWith(".ts") && !name.endsWith(".d.ts"))) acc.push(full);
  }
  return acc;
}

const violations = [];
let stores = 0;
const FIVE_STATE_LITERAL = /"idle"\s*\|\s*"loading"\s*\|\s*"success"\s*\|\s*"empty"\s*\|\s*"error"/;

for (const full of walk(SRC, [])) {
  const rel = path.relative(ROOT, full).split(path.sep).join("/");
  if (rel.includes("src/test/") || rel === authorityOf("interaction-state")) continue; // PR-208：目标＝域行 authority
  const text = fs.readFileSync(full, "utf-8");
  if (!/from\s+["']zustand["']/.test(text)) continue;
  stores += 1;
  const lines = text.split("\n");
  const loadingFlags = new Map(); // prefix → line
  const errorFlags = new Map();
  // 行内任意位置匹配（单行写法的 store 如 `type S = { loading: boolean; error: string | null }` 不得漏网）
  const BARE = /(?<![A-Za-z0-9_$.])loading\s*:\s*boolean\b/;
  const PREFIXED_LOADING = /(?<![A-Za-z0-9_$.])([A-Za-z][A-Za-z0-9]*)Loading\s*:\s*boolean\b/g;
  const PREFIXED_ERROR = /(?<![A-Za-z0-9_$.])([A-Za-z][A-Za-z0-9]*)Error\s*:\s*string\s*\|\s*null\b/g;
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith("//") || t.startsWith("*")) return;
    if (BARE.test(t)) violations.push(`[布尔旗标] ${rel}:${i + 1}: loading: boolean → 主请求改用 status: RequestStatus（requestLoading/requestSettled/requestFailed 整体 set）`);
    for (const m of t.matchAll(PREFIXED_LOADING)) loadingFlags.set(m[1], i + 1);
    for (const m of t.matchAll(PREFIXED_ERROR)) errorFlags.set(m[1], i + 1);
  });
  for (const [prefix, line] of loadingFlags) {
    if (errorFlags.has(prefix)) {
      violations.push(`[配对旗标] ${rel}:${line}: ${prefix}Loading + ${prefix}Error 同前缀配对 → 改用 ${prefix}Request: RequestSlice`);
    }
  }
  if (FIVE_STATE_LITERAL.test(text)) {
    violations.push(`[本地枚举] ${rel}: 五态字面量另写 → 从 @/lib/request-status 导入 RequestStatus`);
  }
}

if (violations.length === 0) console.log(`interaction_state=ok stores=${stores} boolean_pairs=0`);
else fail(violations);
