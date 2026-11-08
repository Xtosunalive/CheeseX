#!/usr/bin/env node
// check-action-coverage.mjs — 注册路由×测试树点名对账（WP-067 / SPEC-067 §二.3）
//
// 背景（2026-11-01 事件 tr_f73535a7）：三个潜伏接线缺陷全部漏网到用户实测——共同点之一是
// 「死路径无哨兵」：current 恢复接口在生产死了几周无人知（测试环境分叉假绿）。本脚本把
// 「哪些注册路由在测试树里完全没人提」变成机器可回答的问题（死路径哨兵）。
//
// 口径诚实声明：本脚本是 **tripwire（静态点名）**——路由路径字面量是否被测试树提及。
// 它不证明「真实通道验证存在」（那由 E2E 旅程与真实集成测试承担）；零点名的路由几乎必然
// 无任何真实覆盖，但有点名的路由不保证点名者走的是真实通道。两层分工见 SPEC-067 §二.3。
//
// 执法规则：registerRoute("METHOD", "/path") 注册的每条路由必须在测试树
// （server/**/*.test.*、src/test/**、scripts/e2e/*.e2e.mjs｜*.spec.mjs（T3 两代命名）、scripts/e2e/__tests__/**）
// 中出现路径字面量，否则红；豁免单（EXEMPT）显式列出并注明理由（只减不增棘轮）。
// @responsible: quality-gate-engineer 辖区（npm run check:action-coverage）
// @inputs: --root <仓库根> --json
// @outputs: `action_coverage=ok|FAIL total=N uncovered=M`（--json 给结构化清单）；退出码 0/1
// @context: 只读扫描；不写任何文件。
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROUTE_RE = /registerRoute\(\s*"(GET|POST|PUT|DELETE|PATCH)"\s*,\s*"([^"]+)"/g;

// 豁免单（只减不增棘轮：新增豁免必须在 reason 写明为何不可测/为何无需测）
const EXEMPT = {
  "GET /api/health": { reason: "健康探针本身——被所有 E2E 流程与自起栈轮询消费（e2e-server/env 守卫面），独立单测无增量" },
  // ── WP-067 首跑基线（2026-11-01）：路由面零点名存量，逐条销号前挂账（只减不增）──
  "GET /api/graph/master": { reason: "存量零点名（WP-067 首跑基线）——待补测销号" },
  "GET /api/approval/status/:articleId": { reason: "存量零点名（WP-067 首跑基线）——审批状态读面，待补测销号" },
  "GET /api/schema/data-roles": { reason: "存量零点名（WP-067 首跑基线）——read-model-version 测试仅源码同源检查未走路径，待补测销号" },
  "GET /api/schema/dependencies/history": { reason: "存量零点名（WP-067 首跑基线）——待补测销号" },
  "POST /api/schema/dependencies/rollback": { reason: "存量零点名（WP-067 首跑基线）——依赖回滚写面零覆盖，待补测销号" },
  "GET /api/schema/ontology/history": { reason: "存量零点名（WP-067 首跑基线）——待补测销号" },
  "GET /api/pipeline/graph-freshness": { reason: "存量零点名（WP-067 首跑基线）——服务层有单测（computeGraphFreshness），路由面待补测销号" },
  "POST /api/property/refresh": { reason: "存量零点名（WP-067 首跑基线）——属性刷新写面零覆盖，待补测销号" },
  "GET /api/schema/subjects": { reason: "存量零点名（WP-067 首跑基线）——subjects 挂起泳道（ADR-009）随主体层启动补测" },
  "GET /api/system/changes-since": { reason: "存量零点名（WP-067 首跑基线）——WP-018 变更探针路由面，待补测销号" },
};

function parseArgs(argv) {
  const out = { root: process.cwd(), json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") out.root = argv[++i];
    else if (argv[i] === "--json") out.json = true;
    else if (argv[i] === "--help") out.help = true;
    else { console.error(`check-action-coverage: 未知参数 ${argv[i]}`); process.exit(2); }
  }
  return out;
}

function walkFiles(dir, filter, acc = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "coverage") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, filter, acc);
    else if (filter(full)) acc.push(full);
  }
  return acc;
}

/** 纯对账核心（可测；exempt 供测试注入红绿夹具）：返回 { routes, uncovered, exempted } */
export function reconcileCoverage({ root, readText = (p) => fs.readFileSync(p, "utf8"), exempt = EXEMPT }) {
  const serverDir = path.join(root, "server");
  const routeFiles = walkFiles(serverDir, (p) => p.endsWith(".cjs"));
  const routes = [];
  const seen = new Set();
  for (const file of routeFiles) {
    let text;
    try { text = readText(file); } catch { continue; }
    for (const match of text.matchAll(ROUTE_RE)) {
      const key = `${match[1]} ${match[2]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      routes.push({ method: match[1], route: match[2], key, file: path.relative(root, file) });
    }
  }

  // 测试树：server 单测＋src/test 前端单测＋E2E 流程与其单测
  const testFiles = [
    ...walkFiles(path.join(root, "server"), (p) => /\.test\.(cjs|mjs)$/.test(p)),
    ...walkFiles(path.join(root, "src", "test"), (p) => /\.(test|e2e)\.(cjs|mjs|ts|tsx)$/.test(p)),
    // T3 迁移（WP-096）：旧 .e2e.mjs 由 Playwright .spec.mjs 替代——两代命名都入点名树（旧件退役后只余 spec 形）
    ...walkFiles(path.join(root, "scripts", "e2e"), (p) => /\.(e2e|spec)\.mjs$/.test(p) || (/\.test\.mjs$/.test(p) && p.includes("__tests__"))),
  ];
  const mentions = new Map(); // route path → 首个点名文件
  for (const file of testFiles) {
    let text;
    try { text = readText(file); } catch { continue; }
    for (const { route } of routes) {
      if (mentions.has(route)) continue;
      if (text.includes(route)) mentions.set(route, path.relative(root, file));
    }
  }

  const uncovered = [];
  const exempted = [];
  for (const { method, route, key, file } of routes) {
    const exemption = exempt[key] ?? exempt[route];
    if (exemption) { exempted.push({ method, route, ...exemption }); continue; }
    if (!mentions.has(route)) uncovered.push({ method, route, file });
  }
  return { routes, uncovered, exempted };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("用法: node scripts/quality/check-action-coverage.mjs [--root <仓库根>] [--json]");
    process.exit(0);
  }
  const { routes, uncovered, exempted } = reconcileCoverage({ root: path.resolve(args.root) });
  const ok = uncovered.length === 0;
  if (args.json) {
    console.log(JSON.stringify({ ok, total: routes.length, uncovered, exempted }, null, 2));
  } else {
    for (const { method, route, file } of uncovered) {
      console.log(`UNCOVERED ${method} ${route}  (${file})`);
    }
    console.log(`action_coverage=${ok ? "ok" : "FAIL"} total=${routes.length} uncovered=${uncovered.length} exempted=${exempted.length}`);
  }
  process.exit(ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
