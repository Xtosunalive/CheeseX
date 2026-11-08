#!/usr/bin/env node
// Component: Response-Count-Parity-Checker（WP-071 · 复用域 mechanism-patterns 模式五「同集合计数同口径」执法件）
// @responsible: 静态扫描 OpenAPI 响应对象内的成对计数字段（total*/returned*），机器发现「同一响应里
//   一个计数走过滤、另一个走全量」的口径冲突——本类语义级问题现有结构/漂移类门禁扫不到。
// 三条规则（仅对带扩展标记 x-count-parity: true 的对象执法——存量对象只登记不阻断，避免全仓误伤）：
//   R1 口径声明：每个计数字段必须有非空 description（计数不声明口径即红）；
//   R2 配对自洽：totalX 与 returnedX 配对时，returnedX 描述必须声明 ≤ totalX；
//   R3 口径一致：同一对象内所有 total* 字段的「过滤/全量」标记必须相同（一个过滤、一个全量即红）。
// 新对象纳入执法：在该对象加 "x-count-parity": true（声明即执法，不另建清单，SSOT）。
// @inputs: contracts/http-api.openapi.json（本地 $ref 解析，递归遍历 components 与 paths 响应）
// @outputs: `response_count_parity=ok ...` 或 `response_count_parity=FAIL violations=N`（exit 1）
// @context: Quality Gate。静态契约层；运行时口径由后端单测与真实服务断言另守。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const COUNT_FIELD = /^(total|returned)[A-Z][A-Za-z]*$/;
const FILTER_MARKER = /准入|过滤|admission|filtered/i;
const LE_MARKER = /≤|<=|不超过|小于等于/;

function countFieldsOf(obj) {
  if (!obj || obj.type !== "object" || !obj.properties) return [];
  return Object.entries(obj.properties)
    .filter(([name, p]) => COUNT_FIELD.test(name) && p && p.type === "integer")
    .map(([name, prop]) => ({ name, prop }));
}

function isFiltered(desc) {
  return FILTER_MARKER.test(String(desc || ""));
}

function checkObject(obj, context) {
  const violations = [];
  const fields = countFieldsOf(obj);
  if (fields.length === 0) return violations;

  // R1 每个计数字段必须声明口径
  for (const f of fields) {
    if (!String(f.prop.description || "").trim()) {
      violations.push(`[口径缺失] ${context} 计数字段 ${f.name} 无 description——计数必须声明口径，禁止裸 integer`);
    }
  }

  // R3 同对象 total* 过滤标记必须一致
  const totals = fields.filter((f) => f.name.startsWith("total"));
  const markers = new Set(totals.map((f) => isFiltered(f.prop.description)));
  if (totals.length >= 2 && markers.size > 1) {
    const detail = totals.map((f) => `${f.name}=${isFiltered(f.prop.description) ? "过滤" : "全量"}`).join("，");
    violations.push(`[口径冲突] ${context} 的 total* 过滤口径不一致（${detail}）——同集合计数必须同口径`);
  }

  // R2 total/returned 配对，returned 必须声明 ≤ total
  for (const tf of totals) {
    const base = tf.name.replace(/^total/, "");
    const ret = fields.find((f) => f.name === "returned" + base);
    if (ret && !LE_MARKER.test(String(ret.prop.description || ""))) {
      violations.push(`[配对缺失] ${context} returned${base} 描述未声明 ≤ total${base}`);
    }
  }
  return violations;
}

function resolveLocalRef(doc, ref) {
  if (!ref.startsWith("#/")) return {};
  const target = ref.slice(2).split("/")
    .reduce((cur, seg) => (cur ? cur[decodeURIComponent(seg)] : undefined), doc);
  return target || {};
}

function walk(node, doc, context, visit, seen, visitedNodes) {
  if (!node || typeof node !== "object") return;
  if (node.$ref) {
    if (seen.has(node.$ref)) return;
    seen.add(node.$ref);
    walk(resolveLocalRef(doc, node.$ref), doc, `${context}→${node.$ref}`, visit, seen, visitedNodes);
    return;
  }
  // 同一物理对象（含经 $ref 再次到达）只 visit 一次，防重复计数
  if (visitedNodes.has(node)) return;
  visitedNodes.add(node);
  if (node.type === "object") visit(node, context);
  for (const [key, child] of Object.entries(node.properties || {})) {
    walk(child, doc, `${context}.${key}`, visit, seen, visitedNodes);
  }
  if (node.additionalProperties && typeof node.additionalProperties === "object") {
    walk(node.additionalProperties, doc, `${context}.<additional>`, visit, seen, visitedNodes);
  }
  for (const combiner of ["allOf", "oneOf", "anyOf"]) {
    for (const child of node[combiner] || []) walk(child, doc, context, visit, seen, visitedNodes);
  }
}

/**
 * @param {{ rootDir?: string }} options
 * @returns {{ ok: boolean, violations: string[], stats: object }}
 */
export function runResponseCountParity(options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const contractPath = path.join(rootDir, "contracts", "http-api.openapi.json");
  const doc = JSON.parse(fs.readFileSync(contractPath, "utf8"));
  const violations = [];
  let objectsScanned = 0;
  let countObjects = 0;
  let enforcedObjects = 0;
  const seen = new Set();
  const visitedNodes = new WeakSet();
  const visit = (obj, context) => {
    objectsScanned += 1;
    const hasCountFields = countFieldsOf(obj).length > 0;
    if (hasCountFields) countObjects += 1;
    // 声明才执法：仅带 x-count-parity 标记的对象执行三规则，存量对象只登记不阻断
    if (obj["x-count-parity"] === true) {
      enforcedObjects += 1;
      violations.push(...checkObject(obj, context));
    }
  };

  for (const [name, schema] of Object.entries(doc.components?.schemas || {})) {
    walk(schema, doc, `components/schemas/${name}`, visit, seen, visitedNodes);
  }
  for (const [url, item] of Object.entries(doc.paths || {})) {
    for (const [method, op] of Object.entries(item || {})) {
      if (!/^(get|post|put|patch|delete)$/.test(method)) continue;
      // 先穿透 OpenAPI 容器（responses→status→content→json→schema），再让 walk 走标准 schema
      for (const [status, resp] of Object.entries(op.responses || {})) {
        const schema = resp && resp.content && resp.content["application/json"] && resp.content["application/json"].schema;
        if (schema) walk(schema, doc, `paths${url}.${method}.${status}`, visit, seen, visitedNodes);
      }
    }
  }
  return { ok: violations.length === 0, violations, stats: { objectsScanned, countObjects, enforcedObjects } };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = runResponseCountParity({ rootDir: process.env.COUNT_PARITY_ROOT || undefined });
  if (!result.ok) {
    for (const line of result.violations) console.error("  " + line);
    console.log(`response_count_parity=FAIL violations=${result.violations.length}`);
    process.exit(1);
  }
  console.log(`response_count_parity=ok objects=${result.stats.objectsScanned} count_objects=${result.stats.countObjects} enforced=${result.stats.enforcedObjects}`);
}
