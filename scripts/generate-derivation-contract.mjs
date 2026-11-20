#!/usr/bin/env node
// generate-derivation-contract.mjs — 派生契约段生成器（WP-207／SPEC-100 批 1·交付物①）
//
// @responsible: 从本体全部 approved 动作派生 OpenAPI 契约段（METHOD／路径／operationId／
//   requestBody-from-input_schema／tags=class_id），落 contracts/generated/derivation-openapi-segment.json
//   ——「契约可从本体派生」的可检证明物。过渡期手写 contracts/http-api.openapi.json 仍是唯一
//   权威（权威翻转另批）：本生成器兼对账器，派生段逐条核（METHOD＋模板）必须在手写契约
//   操作表——既有 fail-closed 口径不放松，手写缺项即红。
// @inputs: data/theschema/ontology.yaml（直读仓内主源，零 vault 依赖——CI 可跑；generate-field-view 同款）
//          ＋ server/shared/contract-request-schema.cjs（lookupRoute 契约对账单点）
// @outputs: contracts/generated/derivation-openapi-segment.json；--check 只比对不落盘（与已提交物
//   字节漂移即 exit 1）。输出确定性（路径字典序＋零时间戳）——同输入同输出。
// @context: check-derivation-sync 经 reuse-domains 域行（id=derivation-contract，generator=
//   gen:derivation-contract）自动纳管（WP-133 注册表派生——零新增 check-* 脚本）；矩阵行随批落
//   SPEC-100 §五。
"use strict";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "contracts", "generated", "derivation-openapi-segment.json");
const SOURCE_REL = "data/theschema/ontology.yaml";
const require_ = createRequire(import.meta.url);
const { parseOntologyRaw } = require_(path.join(ROOT, "server/services/schema-manager/ontology-write-service.cjs"));
const contractRequest = require_(path.join(ROOT, "server/shared/contract-request-schema.cjs"));

/** 纯函数（单测直证）：本体数据 → 派生契约段。approved 动作逐条派生；GET/DELETE 不带 body；
 *  input_schema 存在且为对象时派生 requestBody；路径 :param 转 OpenAPI {param}；路径字典序。 */
export function deriveOpenApiSegment(ontologyData) {
  const paths = {};
  const actions = (ontologyData && ontologyData.action_types) || {};
  for (const [id, def] of Object.entries(actions)) {
    const status = def && def.lifecycle_status === undefined ? "approved" : def.lifecycle_status;
    if (status !== "approved") continue;
    const route = String((def && def.http_route) || "").trim();
    if (!route) continue;
    const parts = route.split(/\s+/);
    if (parts.length !== 2) continue;
    const [method, rawPath] = parts;
    const openApiPath = rawPath.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}");
    const entry = {
      operationId: id,
      tags: [def.class_id || "unclassified"],
      responses: { 200: { description: "成功" } },
    };
    const bodyMethod = !["GET", "DELETE", "HEAD"].includes(method.toUpperCase());
    if (bodyMethod && def.input_schema && typeof def.input_schema === "object" && !Array.isArray(def.input_schema)) {
      entry.requestBody = { required: true, content: { "application/json": { schema: def.input_schema } } };
    }
    if (!paths[openApiPath]) paths[openApiPath] = {};
    paths[openApiPath][method.toLowerCase()] = entry;
  }
  const sorted = {};
  for (const key of Object.keys(paths).sort()) sorted[key] = paths[key];
  return { schema_version: 1, paths: sorted };
}

/** 纯函数（单测直证）：对账（fail-closed 不放松）——派生段每条路由必须在手写契约操作表。
 *  返回 { missing: string[] }；missing 非空＝手写契约缺项（新增动作必须先补契约条目，现行纪律）。 */
export function checkParity(segment) {
  const missing = [];
  for (const [openApiPath, ops] of Object.entries(segment.paths)) {
    for (const [methodLower] of Object.entries(ops)) {
      const method = methodLower.toUpperCase();
      const template = openApiPath.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, ":$1");
      if (!contractRequest.lookupRoute(method, template).inContract) missing.push(`${method} ${template}`);
    }
  }
  return { missing };
}

function main() {
  const raw = fs.readFileSync(path.join(ROOT, SOURCE_REL), "utf8");
  const ontology = parseOntologyRaw(raw);
  const segment = deriveOpenApiSegment(ontology.data);
  const parity = checkParity(segment);
  if (parity.missing.length) {
    console.error(JSON.stringify({ ok: false, code: "PARITY_FAILED", missing: parity.missing, hint: "新增动作必须先补手写契约条目（现行纪律：http_route 须在册）" }));
    process.exit(1);
  }
  const out = JSON.stringify({ ...segment, source_revision: ontology.revision }, null, 2) + "\n";
  if (process.argv.includes("--check")) {
    const committed = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
    if (committed !== out) {
      console.error("派生契约段与已提交物漂移——重跑 gen:derivation-contract 并提交生成物");
      process.exit(1);
    }
    console.log(`gen:derivation-contract --check ok paths=${Object.keys(segment.paths).length}`);
    return;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, out);
  console.log(`gen:derivation-contract ok paths=${Object.keys(segment.paths).length} -> ${path.relative(ROOT, OUT)}`);
}

import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
