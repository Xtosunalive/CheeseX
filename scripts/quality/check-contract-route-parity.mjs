#!/usr/bin/env node
// Component: Contract-Route-Parity-Checker（PR-085 第 1 步 · ADR-010 · 复用域 api-contract 缺口「openapi↔后端实现漂移断言」）
// @responsible: 看守「契约操作 ⇄ 注册路由」双向完备：
//   ① 契约声明的每个操作必须有注册路由（契约超前／实现丢失即红）；
//   ② 每个注册路由必须在契约内（契约外路由即红）——retired-routes.json 墓碑例外：其契约之源是退役登记表本身；
//   ③ 同一 (method, 归一模板) 注册两次即红（框架启动亦抛 FST_ERR_DUPLICATED_ROUTE，此处提前到门禁）。
// @inputs: server/main.cjs（装配的 routes 模块清单）、server/routes/*.cjs 字面注册、contracts/retired-routes.json、
//          contracts/http-api.openapi.json（经 server/shared/contract-request-schema.cjs 推导——与运行时同一事实源）
// @outputs: `contract_route_parity=ok ...` 或 `contract_route_parity=FAIL violations=N`（exit 1）
// @context: Quality Gate。静态扫描口径与 check-error-codes 同族；运行时另有 http-app onRoute fail-closed 兜底。
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const METHODS = "GET|POST|PUT|PATCH|DELETE";

function normalizeTemplate(p) {
  return String(p || "").split("?")[0].replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{x}").replace(/\{[^/{}]+\}/g, "{x}").replace(/\/+$/, "") || "/";
}

function collectRegistrations(source, tag, into) {
  const pattern = new RegExp(`registerRoute\\("(${METHODS})",\\s*"([^"]+)"`, "g");
  for (const match of source.matchAll(pattern)) {
    const key = `${match[1]} ${normalizeTemplate(match[2])}`;
    into.set(key, (into.get(key) || []).concat(`${tag}:${match[2]}`));
  }
}

/**
 * @param {{ rootDir?: string }} options
 * @returns {{ ok: boolean, violations: string[], stats: object }}
 */
export function runContractRouteParity(options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const mainPath = path.join(rootDir, "server", "main.cjs");
  const contractPath = path.join(rootDir, "contracts", "http-api.openapi.json");
  const retiredPath = path.join(rootDir, "contracts", "retired-routes.json");
  const violations = [];

  const main = fs.readFileSync(mainPath, "utf8");
  const wired = [...new Set([...main.matchAll(/require\("\.\/routes\/([a-z0-9-]+)\.cjs"\)/g)].map((m) => m[1]))];
  const live = new Map();
  collectRegistrations(main, "server/main.cjs", live);
  // PR-085 第 2 步：传输层自有端点（/api/auth/*，随 auth 装配恒注册）——http-app 为注册面之一
  const httpAppPath = path.join(rootDir, "server", "shared", "http-app.cjs");
  if (fs.existsSync(httpAppPath)) collectRegistrations(fs.readFileSync(httpAppPath, "utf8"), "server/shared/http-app.cjs", live);
  for (const module of wired) {
    const file = path.join(rootDir, "server", "routes", `${module}.cjs`);
    if (!fs.existsSync(file)) { violations.push(`[装配] main.cjs 装配了不存在的路由模块 ${module}.cjs`); continue; }
    collectRegistrations(fs.readFileSync(file, "utf8"), `server/routes/${module}.cjs`, live);
  }
  const tombstones = new Set();
  if (fs.existsSync(retiredPath)) {
    for (const route of JSON.parse(fs.readFileSync(retiredPath, "utf8")).retired || []) {
      const key = `${String(route.method).toUpperCase()} ${normalizeTemplate(route.path)}`;
      tombstones.add(key);
      live.set(key, (live.get(key) || []).concat(`contracts/retired-routes.json:${route.path}`));
    }
  }

  const doc = JSON.parse(fs.readFileSync(contractPath, "utf8"));
  const ops = new Map();
  for (const [p, item] of Object.entries(doc.paths || {})) {
    for (const method of Object.keys(item || {})) {
      if (!/^(get|post|put|patch|delete)$/.test(method)) continue;
      ops.set(`${method.toUpperCase()} ${normalizeTemplate(p)}`, p);
    }
  }

  for (const [key, sources] of live) {
    if (sources.length > 1) violations.push(`[重复] ${key} 注册 ${sources.length} 次：${sources.join(" , ")}`);
    if (!ops.has(key) && !tombstones.has(key)) violations.push(`[契约外] 注册路由 ${key}（${sources.join(" , ")}）未在 contracts/http-api.openapi.json 声明——补契约或退役`);
  }
  for (const [key, p] of ops) {
    if (!live.has(key)) violations.push(`[契约超前] 契约操作 ${key}（${p}）无注册路由——实现丢失或契约死条目`);
  }

  const stats = { routes: live.size, contract_ops: ops.size, wired_modules: wired.length, tombstones_exempt: [...tombstones].filter((k) => !ops.has(k)).length };
  return { ok: violations.length === 0, violations, stats };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = runContractRouteParity({ rootDir: process.env.CONTRACT_PARITY_ROOT || undefined });
  if (!result.ok) {
    for (const line of result.violations) console.error("  " + line);
    console.log(`contract_route_parity=FAIL violations=${result.violations.length}`);
    process.exit(1);
  }
  const s = result.stats;
  console.log(`contract_route_parity=ok routes=${s.routes} contract_ops=${s.contract_ops} wired_modules=${s.wired_modules} tombstones_exempt=${s.tombstones_exempt}`);
}
