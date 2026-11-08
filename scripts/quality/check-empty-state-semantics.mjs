#!/usr/bin/env node
// Component: Empty-State-Semantics-Gate（空态语义域门禁——WP-070／SPEC-070 §3.5，error-copy 域首个执法面）
// @responsible: 契约 contracts/empty-state-semantics.json 的机器执法四面：
//   ① 形状：契约符合 empty-state-semantics.schema.json（ajv draft-07）
//   ② 边闭合：absence_kinds[*].requires 全部指向在册种类，且无自指/环
//   ③ 站点闭合：sites[*].kinds ⊆ absence_kinds；消费类站点必带 error_code；站点 module 文件存在
//   ④ 文案 tripwire（OpenMAIC B 式）：server/** 内「请到「」样式指引字符串只许出现在唯一组装点
//      server/shared/availability-view.cjs——其他位置出现＝第二文案源（WP-062 内联/UNMOUNTED_GUIDANCE 同族病）即红
// @inputs: contracts/empty-state-semantics{,.schema}.json；server/** 源面
// @outputs: stdout empty_state_semantics=ok|FAIL violations=N；非零退出＝违规
// @context: Sync（CI 可跑；无 vault 依赖）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONTRACT = path.join(ROOT, "contracts", "empty-state-semantics.json");
const SCHEMA = path.join(ROOT, "contracts", "empty-state-semantics.schema.json");
// PR-208 清债第二批：组装点＝error-copy 域 guide 键（契约立法处，此前手抄同串）
export const GUIDANCE_ASSEMBLY_POINT = (() => {
  const dom = JSON.parse(fs.readFileSync(path.join(ROOT, "contracts", "reuse-domains.json"), "utf8")).domains.find((d) => d.id === "error-copy");
  return dom && dom.guide ? dom.guide : "server/shared/availability-view.cjs";
})();
// 指引文案指纹：从契约 guide_template 派生——{what} 与 {where} 之间的固定片段（如「——去处：「」），
// 第二组装点必然复现它；指纹随模板走，不写死（单源纪律）
function fingerprintOf(contract) {
  const t = String(contract.guide_template || "");
  const seg = t.slice(t.indexOf("{what}") + "{what}".length, t.indexOf("{where}"));
  if (!seg) throw new Error("guide_template 须含 {what}…{where} 固定片段以派生指纹");
  return new RegExp(seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}
let GUIDANCE_FINGERPRINT = null;

const vs = [];
const red = (face, msg) => vs.push(`[${face}] ${msg}`);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "__tests__" || e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(cjs|mjs|js)$/.test(e.name)) out.push(full);
  }
  return out;
}

/** 纯函数面（供守护测试）：对契约对象跑 ②③ 两面，返回违规串数组 */
export function checkContractClosure(contract, { fileExists = () => true } = {}) {
  const out = [];
  const kinds = contract.absence_kinds || {};
  for (const [id, kind] of Object.entries(kinds)) {
    for (const req of kind.requires || []) {
      if (req === id) out.push(`[②边闭合] ${id}.requires 自指`);
      else if (!kinds[req]) out.push(`[②边闭合] ${id}.requires → ${req} 未登记`);
    }
  }
  // 环检测（requires 为 DAG：前置排序必须可达终点）
  const visiting = new Set(); const done = new Set();
  const visit = (id, trail) => {
    if (done.has(id)) return;
    if (visiting.has(id)) { out.push(`[②边闭合] requires 成环：${[...trail, id].join(" → ")}`); return; }
    visiting.add(id);
    for (const req of (kinds[id] && kinds[id].requires) || []) if (kinds[req]) visit(req, [...trail, id]);
    visiting.delete(id); done.add(id);
  };
  for (const id of Object.keys(kinds)) visit(id, []);
  for (const site of contract.sites || []) {
    for (const k of site.kinds || []) if (!kinds[k]) out.push(`[③站点闭合] site ${site.id} kinds → ${k} 未登记`);
    if (site.class === "consumer" && !site.error_code) out.push(`[③站点闭合] 消费类站点 ${site.id} 缺 error_code（reject-guide 必须有定义码）`);
    if (site.module && !fileExists(site.module)) out.push(`[③站点闭合] site ${site.id} module 不存在：${site.module}`);
  }
  return out;
}

/** 纯函数面：文案 tripwire——rel 非组装点且文本含指纹即违规 */
export function scanGuidanceSource(rel, text, fingerprint = GUIDANCE_FINGERPRINT) {
  if (rel === GUIDANCE_ASSEMBLY_POINT) return false;
  return Boolean(fingerprint) && fingerprint.test(text);
}

function main() {
  const contract = JSON.parse(fs.readFileSync(CONTRACT, "utf8"));
  GUIDANCE_FINGERPRINT = fingerprintOf(contract);
  // ①
  const Ajv = require("ajv");
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(JSON.parse(fs.readFileSync(SCHEMA, "utf8")));
  if (!validate(contract)) for (const e of validate.errors) red("①形状", `${e.instancePath || "/"} ${e.message}`);
  // ②③
  for (const v of checkContractClosure(contract, { fileExists: (rel) => fs.existsSync(path.join(ROOT, rel)) })) vs.push(v);
  // ④
  for (const file of walk(path.join(ROOT, "server"))) {
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    if (scanGuidanceSource(rel, fs.readFileSync(file, "utf8"))) {
      red("④文案tripwire", `${rel} 含指引文案指纹（契约 guide_template 固定片段）——第二文案源；指引只许由 ${GUIDANCE_ASSEMBLY_POINT} 组装（经 guidanceFor/availabilityView 消费）`);
    }
  }
  if (!fs.existsSync(path.join(ROOT, GUIDANCE_ASSEMBLY_POINT))) red("④文案tripwire", `唯一组装点缺席：${GUIDANCE_ASSEMBLY_POINT}`);

  if (vs.length) {
    console.log(`empty_state_semantics=FAIL violations=${vs.length}`);
    for (const v of vs.slice(0, 40)) console.log(`  ${v}`);
    process.exit(1);
  }
  console.log(`empty_state_semantics=ok faces=①②③④ kinds=${Object.keys(contract.absence_kinds).length} sites=${contract.sites.length} classes=${Object.keys(contract.consumer_classes).length}`);
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) main();
