#!/usr/bin/env node
// check-pipeline-rules.mjs — D6 规则资产版本门执法（红队复验 #76 面2 修复件）
// @responsible: 三面——①active.json 指针合法（指 versions/ 内存在版本；候选在册成对〔源版本存在〕）
//   ②版本名白名单 vN / vN-cK（防穿越）③已发布版本哈希自校验（active.json.published[vN].sha256
//   对 versions/vN/relation-expectations.json 实算——原地篡改即红；README「哈希可验」机器兑现）。
// @inputs: data/governance/pipeline-rules/** @outputs: pipeline_rules=ok|FAIL
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RULES = path.join(ROOT, "data/governance/pipeline-rules");
const vs = [];
const push = (m) => vs.push(m);
const VER_RE = /^v\d+(-c\d+)?$/;

let active;
try {
  active = JSON.parse(fs.readFileSync(path.join(RULES, "active.json"), "utf8"));
} catch (e) {
  console.error(`pipeline_rules=FAIL——active.json 不可读: ${e.message}`);
  process.exit(1);
}
const act = active.active;
if (!VER_RE.test(act)) push(`active 版本名非法: ${act}（白名单 vN）`);
if (act.includes("-c")) push(`active 不得指向候选: ${act}（候选不碰 active——README 发布流）`);
const actFile = path.join(RULES, "versions", act, "relation-expectations.json");
if (!fs.existsSync(actFile)) push(`active 指向的版本不存在: ${act}`);
for (const [ver, meta] of Object.entries(active.published || {})) {
  if (!VER_RE.test(ver)) { push(`published 版本名非法: ${ver}`); continue; }
  const f = path.join(RULES, "versions", ver, "relation-expectations.json");
  if (!fs.existsSync(f)) { push(`published 版本缺文件: ${ver}`); continue; }
  if (meta.sha256) {
    const real = crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
    if (real !== meta.sha256) push(`已发布版本哈希不符: ${ver}（登记 ${meta.sha256?.slice(0, 12)}≠实算 ${real.slice(0, 12)}）——原地篡改或登记过期`);
  }
}
// candidates 在册成对：vN-cK 的源版本 vN 须为已发布
const candDir = path.join(RULES, "candidates");
if (!fs.existsSync(candDir)) fs.mkdirSync(candDir, { recursive: true }); // 空目录缺席自建（终态结构面）
for (const c of fs.readdirSync(candDir).filter((d) => !d.startsWith("."))) {
  if (!VER_RE.test(c) || !c.includes("-c")) push(`candidates 非法条目: ${c}`);
  else {
    const src = c.split("-c")[0];
    if (!(src in (active.published || {}))) push(`候选 ${c} 的源版本 ${src} 不在 published——候选须自已发布版本衍生`);
  }
}
if (vs.length) {
  console.error("pipeline_rules=FAIL");
  for (const v of vs) console.error("  - " + v);
  process.exit(1);
}
console.log(`pipeline_rules=ok active=${act} published=${Object.keys(active.published || {}).length} candidates=${fs.readdirSync(candDir).filter((d) => !d.startsWith(".")).length}`);
