#!/usr/bin/env node
// gen-ui-stat-provenance.mjs — 派生器：contracts/ui-stat-provenance.json 的 sourceApis 半生成件（WP-136 b）
// @responsible: 视图登记面的「描述半」——某个视图的数据模块实际调用哪些后端端点，属可从代码读出
//   的事实，此前由人手抄（实测 WP-134 清出 4 处名实不符＝已在漂）。本生成器按每视图的
//   `apiSources`（人写的规范半：这个视图的数取自哪个 api 模块的哪个导出函数）扫出真实端点字面，
//   归一后以契约拼写写回 `sourceApis`。手抄端点清单自此退役。
// 分档原则（AGENTS §六 单一事实源）：人只声明「取哪次调用」，机器负责「那次调用的 URL 是什么」；
//   两者错位不再可能——`--check` 由 check:derivation-sync 自动跑（reuse-domains 行 generator≠null 即入保）。
// 用法：npm run gen:ui-stat-provenance            写入派生结果
//       npm run gen:ui-stat-provenance -- --check  只比对，漂移即红 exit=1（派生纳保用）
// @inputs: contracts/ui-stat-provenance.json（views[].apiSources）＋ contracts/http-api.openapi.json
//          ＋ 各 apiSources 指向的 src/**/*.ts 文件
// @outputs: 改写 contracts/ui-stat-provenance.json 的 views[].sourceApis；stdout 一行读数
// @context: 生成器即校验器（三件套先例：gen-value-domains／gen-error-registry）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REGISTRY_REL = "contracts/ui-stat-provenance.json";
const CONTRACT_REL = "contracts/http-api.openapi.json";

/** 契约路径 → 归一键（`{param}` 段折成 `*`），供端点字面反查契约拼写。 */
function contractIndex(openapi) {
  const index = new Map();
  for (const p of Object.keys(openapi.paths || {})) {
    const key = p.replace(/\{[^}]+\}/g, "*");
    if (index.has(key)) throw new Error(`契约路径归一后撞键：${key}（${index.get(key)} ⇄ ${p}）`);
    index.set(key, p);
  }
  return index;
}

/**
 * 代码里的端点字面 → 契约拼写。
 * 归一：①砍 query（首个 `?` 之后全丢）②砍紧贴非 `/` 的尾部模板串（拼 query 的 helper）
 * ③整段模板占位 `${...}` → `*`。认不出即抛——宁可红，不静默登记一个契约里不存在的出处。
 */
function resolveContractPath(literal, index, origin) {
  let s = literal.split("?")[0];
  s = s.replace(/([^/])\$\{[^}]*\}$/, "$1");
  s = s.replace(/\$\{[^}]*\}/g, "*");
  const hit = index.get(s);
  if (!hit) {
    throw new Error(`${origin}：端点字面「${literal}」归一为 ${s}，契约 paths 无此项——请核对 apiSources 指向或补契约`);
  }
  return hit;
}

/** 取某个导出函数体的文本切片（从声明行到下一个顶层 export 之前）。 */
function functionSlice(src, name) {
  const decl = new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\b|export\\s+const\\s+${name}\\b`);
  const m = decl.exec(src);
  if (!m) throw new Error(`导出函数未找到：${name}`);
  const rest = src.slice(m.index + m[0].length);
  const next = /\nexport\s/.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

/** 从 apiSources（`file#fn`）派生该视图的端点集合（契约拼写，去重排序）。 */
export function deriveSourceApis(root, apiSources, openapi) {
  const index = contractIndex(openapi);
  const out = new Set();
  for (const source of apiSources) {
    const [rel, fn] = source.split("#");
    if (!rel || !fn) throw new Error(`apiSources 形态应为 "<src/...ts>#<导出函数名>"，实为「${source}」`);
    const full = path.join(root, rel);
    if (!fs.existsSync(full)) throw new Error(`apiSources 指向的文件不存在：${rel}（源「${source}」）`);
    const body = functionSlice(fs.readFileSync(full, "utf8"), fn);
    for (const m of body.matchAll(/(["'`])(\/api\/[^"'`]*)\1/g)) {
      // 排除 `paths["/api/..."]` 这类类型索引——那是编译期引用，不是一次真实调用
      const before = body.slice(Math.max(0, m.index - 8), m.index);
      if (/paths\[\s*$/.test(before)) continue;
      out.add(resolveContractPath(m[2], index, `${rel}#${fn}`));
    }
  }
  if (out.size === 0) throw new Error(`apiSources 未派生出任何端点：${apiSources.join(" , ")}`);
  return [...out].sort();
}

export function build(root) {
  const registryPath = path.join(root, REGISTRY_REL);
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const openapi = JSON.parse(fs.readFileSync(path.join(root, CONTRACT_REL), "utf8"));
  let changedViews = 0;
  for (const view of registry.views) {
    const derived = deriveSourceApis(root, view.apiSources || [], openapi);
    const current = Array.isArray(view.sourceApis) ? [...view.sourceApis].sort() : [];
    if (JSON.stringify(derived) !== JSON.stringify(current)) changedViews += 1;
    view.sourceApis = derived;
  }
  return { registry, changedViews, total: registry.views.length };
}

function main() {
  const check = process.argv.includes("--check");
  const registryPath = path.join(ROOT, REGISTRY_REL);
  const before = fs.readFileSync(registryPath, "utf8");
  const { registry, changedViews, total } = build(ROOT);
  const after = `${JSON.stringify(registry, null, 2)}\n`;
  if (check) {
    const drift = before !== after;
    console.log(`ui_stat_provenance_derive=${drift ? "FAIL" : "ok"} views=${total} driftedViews=${changedViews ? "见下" : "0"} generator=gen-ui-stat-provenance`);
    if (drift) {
      console.error("派生物与源漂移——重跑 `npm run gen:ui-stat-provenance` 后提交（手抄 sourceApis 已退役，改 apiSources 才是改口径）");
      process.exit(1);
    }
    return;
  }
  fs.writeFileSync(registryPath, after);
  console.log(`ui_stat_provenance_derive=written views=${total} rewritten=${changedViews}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
