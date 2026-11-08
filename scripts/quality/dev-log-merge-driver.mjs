#!/usr/bin/env node
// dev-log-merge-driver.mjs — 追加式台账 JSONL 的 git merge driver（WP-003 红队③，2026-10-24）。
// @responsible: docs/dev-log/entries/*.jsonl 跨分支合并自动化——替代手工并集：
//   两分支钩子独立计 seq（实测撞号：WP-001 合并时 279×2），git 内建 union 驱动只拼接不去重不重编号，
//   会静默产出 seq 重复（check-dev-log 红）——本驱动按序解决：并集→按内容去重→按 ts 排序→撞号重编。
// @inputs: git merge driver 三参 %O %A %B（base/ours/theirs；git 保证 ours 写回 %A）
// @outputs: 合并结果写 %A，exit 0（无冲突留给 git 判定的情况本驱动不会被调起）
// @context: 注册（每克隆一次性）：git config merge.devlog-union.name "dev-log append-union"
//   && git config merge.devlog-union.driver "node scripts/quality/dev-log-merge-driver.mjs %O %A %B"
//   .gitattributes 已指向 merge=devlog-union。无 base 的首次并行场景按空 base 处理。
import fs from "node:fs";

const [, , base, ours, theirs] = process.argv;
if (!base || !ours || !theirs) {
  console.error("用法：dev-log-merge-driver.mjs %O %A %B（git merge driver 三参）");
  process.exit(2);
}
const read = (p) => {
  try { return fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim()); } catch { return []; }
};
const parse = (lines) => lines.map((l) => {
  try { return { raw: l, obj: JSON.parse(l) }; } catch { return null; }
}).filter(Boolean);

// 追加式账本无删除：两侧全量并集去重即得终态（base 行双侧各有一份→去重为一份；钩子幂等重放同理）。
// base 参数仅作引用，不参与过滤——%A 必须是完整文件而非增量。
const rows = [...parse(read(ours)), ...parse(read(theirs))];
const seen = new Set();
const uniq = [];
for (const e of rows) {
  const key = JSON.stringify(e.obj, Object.keys(e.obj).sort());
  if (seen.has(key)) continue;
  seen.add(key);
  uniq.push(e);
}
// 排序：ts 优先（缺 ts 的排末尾按原样），同 ts 保稳定
uniq.sort((a, b) => String(a.obj.ts ?? "").localeCompare(String(b.obj.ts ?? "")));

// seq 撞号重编：全局最大号之后顺延（保留既有号不动，只挪后到者）
const seqs = uniq.map((e) => (Number.isInteger(e.obj.seq) ? e.obj.seq : 0));
let next = Math.max(0, ...seqs);
const used = new Set(seqs);
for (const e of uniq) {
  const s = e.obj.seq;
  if (Number.isInteger(s) && used.has(s)) {
    const occurrences = uniq.filter((x) => x.obj.seq === s);
    if (occurrences[0] === e) continue; // 组内首个保号
    next += 1;
    while (used.has(next)) next += 1;
    e.obj.seq = next;
    used.add(next);
    e.raw = JSON.stringify(e.obj);
  } else if (Number.isInteger(s)) {
    continue;
  }
}
fs.writeFileSync(ours, uniq.map((e) => e.raw).join("\n") + "\n");
console.error(`devlog-union: ${uniq.length} 事件并集（去重后），seq 重编 ${Math.max(0, ...seqs)}→${next}`);
process.exit(0);
