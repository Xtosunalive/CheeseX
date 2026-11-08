#!/usr/bin/env node
// Component: Error-Registry-Generator（错误注册物生成器——出生即账，账本由真身生成）
// @responsible: PR-158（副本→计算第一刀）：错误码的真身=抛点；本生成器扫描真身、产出唯一
//   账本 server/shared/error-registry.generated.cjs。账本不再是手抄文件（旧 baseline 已销案），
//   抛点变更后重跑 `npm run gen:error-registry` 再生成；门禁 --check 模式核 freshness。
//
// 「重复/冲突即炸」语义（对齐 openbkn Register 查重）：
//   同一码在不同抛点携带不同显式 status → 生成失败（exit 1）——同一错误两种状态码是
//   契约面矛盾（PR-153 实锤该类病灶：INVALID_VERSION 无 status 兜底 500 被拦）。
//   确属一码多态的，在 DECLARED_MULTI_STATUS 显式声明（声明即审查）。
//
// @inputs: server/**/*.cjs 抛点（经 shared/error-throw-scan.mjs）
// @outputs: server/shared/error-registry.generated.cjs（确定性输出，无时间戳——freshness 可比对）
// @context: Sync
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanThrowSites } from "./shared/error-throw-scan.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = path.join(ROOT, "server", "shared", "error-registry.generated.cjs");

// 一码多态显式声明区（码 → 允许的 status 集合）。新增条目须附理由。
// 首轮声明（PR-158）：以下为现存一码多态的如实登记——声明≠认可，其中携带 500 的组合
// （RELATIONS_INVALID/VALIDATION_ERROR）疑似语义误用，修正留后续刀；先让账本显形。
const DECLARED_MULTI_STATUS = {
  RELATIONS_INVALID: "400 输入校验拒＋500 内部装配失败两种形态混用（语义待拆，显形中）",
  VALIDATION_ERROR: "400 常规＋422 结构族（UnsafeBodyPatch 等）＋500 位疑误用（待修）；422 属 422 目录单元语义",
  ANOMALY_ACTION_INPUT_REQUIRED: "400 缺输入＋409 前置态不满足（异常工作台动作适配器两形态）",
  VERSION_REGISTRY_UNAVAILABLE: "422 关系补丁侧＋503 投影侧（同码两消费形态，语义待拆）",
  INVALID_DISCOVERY_PATCH: "400 常规＋404 位（schema-write-service discoveryEdit 一处，疑误用待修）",
};

function fail(message) {
  console.error(`error_registry=FAIL ${message}`);
  process.exit(1);
}

const sites = scanThrowSites(ROOT);
const statusConflicts = [];
for (const [code, list] of sites) {
  const statuses = [...new Set(list.map((s) => s.status).filter((s) => s !== null))];
  if (statuses.length > 1 && !Object.prototype.hasOwnProperty.call(DECLARED_MULTI_STATUS, code)) {
    statusConflicts.push({ code, statuses, where: list.filter((s) => s.status !== null).map((s) => `${s.file}:${s.line}:${s.status}`).slice(0, 4) });
  }
}
if (statusConflicts.length) {
  fail(`状态冲突 ${statusConflicts.length} 笔——同一错误码多个显式 status（一码多态须在 DECLARED_MULTI_STATUS 声明）：\n` +
    statusConflicts.map((c) => `  ${c.code} ${c.statuses.join("/")} ← ${c.where.join(" | ")}`).join("\n"));
}

const codes = {};
for (const code of [...sites.keys()].sort()) {
  const list = sites.get(code).slice().sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  codes[code] = {
    statuses: [...new Set(list.map((s) => s.status).filter((s) => s !== null))],
    sites: list.map((s) => `${s.file}:${s.line}`),
  };
}

const banner = [
  "// GENERATED FILE — DO NOT EDIT. 真身=抛点；变更后运行 `npm run gen:error-registry` 再生成。",
  "// PR-158（副本→计算第一刀）：错误码唯一账本——出生即账，账本由生成器从抛点真身产出（确定性输出）。",
  "// 消费方：server/shared/error-factory.cjs（strict 模式未知码即炸）；check:error-registry 门禁（freshness）。",
  "",
].join("\n");
const body = `module.exports = ${JSON.stringify({ codes }, null, 2)};\n`;

if (process.argv.includes("--check")) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (current !== banner + body) {
    fail(`注册物过期（${Object.keys(codes).length} 个码）——抛点已变更未再生成。运行 npm run gen:error-registry`);
  }
  console.log(`error_registry=ok codes=${Object.keys(codes).length}（freshness 通过，无状态冲突）`);
  process.exit(0);
}

fs.writeFileSync(OUT, banner + body);
console.log(`error_registry=written codes=${Object.keys(codes).length} → ${path.relative(ROOT, OUT)}`);
