#!/usr/bin/env node
// Component: Action-Routing-Contract-Guard（动作路由表子契约执法 · navigation 域）
// @responsible: 看守「问题类型（issueKind）→ 处理方式」对应关系的三重对账
//   ① 完备性：后端 openapi 枚举的每种 issueKind 必须在 action-routing.ts 登记
//      （in-page/handoff/note/exempt/pending 五态之一——漏登记即红，防超集缺口再现）
//   ② 理由完整性：exempt/pending 必须写理由（「有意不处理」与「漏处理」可区分）
//   ③ 跳转合法性：登记表的 handoff route 必须在 navigation.ts 的 NAV_ROUTES 内
//   ④ 参数消费对账：登记表声明的 query 参数名，必须在消费端（URLSearchParams.get）
//      出现——死参数即红（dashboard?highlight= 那类问题的同类防护）
//   ⑤ golden-hash 值连通性：按表语义实跑 mini 复刻的 buildHandoffHash，声明的每个
//      参数必须落到 hash——裸字符串值必须是后端 proposedAction 生产者真实产出的字段名，
//      STATIC 值按字面落 hash。值连不上即红（P0-A wild_tag tab 静默丢失为首个用例）
//      ——mini 版与 action-routing.ts buildHandoffHash 语义须同步维护
// @context: 2026-10-06 Master 报「问题项与处理方式超集关系需梳理」→ 裁「要」→ 立此契约
// @context: WP-122 导航域合一（2026-11-06）——注册表位并入 check-navigation 包装面（域唯一常驻入口），
//   本件五面判定零改动、独立可跑（别名留档）；NAV_ROUTES/SUB_ROUTES 解析收敛 shared/nav-routes.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadNavRoutes } from "./shared/nav-routes.mjs"; // WP-122：与 check-navigation 共用唯一解析实现

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = path.join(ROOT, "src");
const TABLE = path.join(SRC, "features", "anomaly-workbench", "action-routing.ts");
const API_TYPES = path.join(SRC, "lib", "generated", "api-types.ts");

function fail(vs) {
  console.log(`action_routing=FAIL violations=${vs.length}`);
  for (const v of vs) console.log(`  ${v}`);
  process.exit(1);
}

for (const p of [TABLE, API_TYPES]) {
  if (!fs.existsSync(p)) fail([`[结构] 文件不存在: ${path.relative(ROOT, p)}`]);
}

// ── 后端 issueKind 全集（openapi 生成类型的 AnomalyIssue.issueKind 联合）──
const apiText = fs.readFileSync(API_TYPES, "utf-8");
const anchor = apiText.indexOf("AnomalyIssue: {");
if (anchor < 0) fail(["[结构] api-types.ts 未找到 AnomalyIssue schema"]);
const kindField = apiText.slice(anchor).match(/issueKind\??:\s*([^;]+);/);
if (!kindField) fail(["[结构] AnomalyIssue.issueKind 字段未找到（openapi 结构可能变了——门禁需同步）"]);
const backendKinds = [...kindField[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);

// ── 登记表已登记项 ──
const table = fs.readFileSync(TABLE, "utf-8");
// WP-150：理由值单源迁至同目录闭集叶子 action-routing-reasons.ts（SPEC-091 §2.1 CJK 字面量族
// 禁止本表内联中文——与「理由必须内联带引号」的旧解析口径冲突，此处适配新单源：
// reason 键允许 `ANOMALY_ROUTING_REASONS.<key>` 标识符形态，值从叶子文件解析（同长度下限）。
const REASONS_FILE = path.join(SRC, "features", "anomaly-workbench", "action-routing-reasons.ts");
if (!fs.existsSync(REASONS_FILE)) fail([`[结构] 文件不存在: ${path.relative(ROOT, REASONS_FILE)}`]);
const reasonsSource = fs.readFileSync(REASONS_FILE, "utf-8");
const reasonsValues = new Map([...reasonsSource.matchAll(/([a-z_]+):\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]));
const tableStart = table.indexOf("ACTION_ROUTING");
const tableEnd = table.indexOf("/** 由登记表生成 handoff hash");
const block = table.slice(tableStart, tableEnd > 0 ? tableEnd : undefined);
const registered = new Map(); // kind → { handling, reason, route, sub, params, deadAck }
// 括号配平提取条目（教训：登记表单行/多行混排，跨块 regex 会吞并——改配平扫描）
for (const m of block.matchAll(/^\s{2}([a-z_]+):\s*\{/gm)) {
  const kind = m[1];
  const start = m.index + m[0].length;
  let depth = 1;
  let i = start;
  while (i < block.length && depth > 0) {
    if (block[i] === "{") depth++;
    else if (block[i] === "}") depth--;
    i++;
  }
  const body = block.slice(start, i - 1);
  const handling = (body.match(/handling:\s*"([a-z-]+)"/) || [])[1] || "（缺 handling）";
  // 理由双形态：内联带引号串（旧形态）或 ANOMALY_ROUTING_REASONS.<key> 标识符（WP-150 单源形态，同长度下限）
  const reasonInline = (body.match(/reason:\s*"([^"]{4,})"/) || [])[1] || null;
  const reasonRef = (body.match(/reason:\s*ANOMALY_ROUTING_REASONS\.([a-z_]+)/) || [])[1] || null;
  const reasonRefValue = reasonRef ? (reasonsValues.get(reasonRef) ?? null) : null;
  const reason = reasonInline ?? (reasonRefValue && reasonRefValue.length >= 4 ? reasonRefValue : null);
  const route = (body.match(/route:\s*"([a-z-]+)"/) || [])[1] || null;
  const sub = (body.match(/sub:\s*"([a-z-]+)"/) || [])[1] || null;
  // 参数只取 handoff.query 子块内部（教训：handling/route/sub 是路由字段非 query 参数）
  // queryPairs 供 ⑤ golden-hash：值形态二分——STATIC("x")=静态常量 / "x"=payload 字段名
  const queryBlock = (body.match(/query:\s*\{([\s\S]*?)\}/) || [])[1] || "";
  const queryPairs = [...queryBlock.matchAll(/(\w+):\s*(?:STATIC\("([^"]*)"\)|"([^"]*)")/g)].map((m) => ({
    param: m[1],
    isStatic: m[2] !== undefined,
    value: m[2] !== undefined ? m[2] : m[3],
  }));
  const params = queryPairs.map((q) => q.param);
  const deadAck = /known-dead-param/.test(body); // 有意保留的死参数（出报告不判红）
  registered.set(kind, { handling, reason, route, sub, params, deadAck, queryPairs });
}

const violations = [];

// ① 完备性对账
for (const kind of backendKinds) {
  if (!registered.has(kind)) {
    violations.push(`[完备性] 后端 issueKind "${kind}" 未在 action-routing.ts 登记（漏处理≠有意豁免——须显式登记）`);
  }
}
// 反向：登记表有而后端没有的（幽灵登记）
for (const kind of registered.keys()) {
  if (!backendKinds.includes(kind)) {
    violations.push(`[完备性] 登记表含后端不存在的 "${kind}"（后端枚举变更未同步登记表）`);
  }
}

// ② 理由完整性 + ③ 跳转合法性 + ④ 参数消费
// （WP-122：NAV_ROUTES/SUB_ROUTES 解析收敛到 shared/nav-routes.mjs 唯一实现——此前此处独立正则抠
//   navigation.ts，与 check-navigation 面② 重复翻译，源码格式一变双红；本件同时被 check-navigation
//   包装串联为面④，也可经 check:action-routing 别名独立复跑）
const { routes: navRouteList, subRoutes: navSubRoutes } = loadNavRoutes({ root: ROOT });
const navRoutes = new Set(navRouteList);
const subRoutes = navSubRoutes;

// ── 后端 payload 字段全集（⑤ golden-hash 的连通锚点）──
// 扫描 server/（排除测试）中 proposedAction 的对象字面量，收集顶层字段名。
// 局限：动态构造/spread 的 payload 无法静态提取——表值引用到未静态出现的字段会红，
// 属安全方向的假阳性（迫使其可见化登记），而非静默漏过。
const SERVER = path.join(ROOT, "server");
const payloadFields = new Set();
function collectPayloadFields(text) {
  // proposedAction 与 { 同行（覆盖 `relationIssue ? {` 三元形态）；配平提取后只收顶层键
  for (const m of text.matchAll(/proposedAction\b[^\n{]*\{/g)) {
    const start = m.index + m[0].length - 1;
    let depth = 0;
    let i = start;
    while (i < text.length) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
      i++;
    }
    if (depth !== 0) continue; // 未闭合（文件截断形态）——跳过
    const objBody = text.slice(start + 1, i);
    let d = 0;
    for (const k of objBody.matchAll(/([A-Za-z_]\w*)\s*:|[{}[\]]/g)) {
      const t = k[0];
      if (t === "{" || t === "[") d++;
      else if (t === "}" || t === "]") d--;
      else if (d === 0 && k[1]) payloadFields.add(k[1]);
    }
  }
}
function walkCjs(dir, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walkCjs(full, acc);
    else if (name.endsWith(".cjs") && !name.includes(".test.") && !full.includes("__tests__")) acc.push(full);
  }
  return acc;
}
for (const f of walkCjs(SERVER)) collectPayloadFields(fs.readFileSync(f, "utf-8"));
// 消费端：全仓 URLSearchParams.get("参数名") 或 navigation 读侧 getNavQueryParam("参数名")（2026-10-21 读侧收编后为规范写法）出现处
const consumers = new Map(); // param → [files]
function walk(dir, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, acc);
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) acc.push(full);
  }
  return acc;
}
for (const f of walk(SRC)) {
  const t = fs.readFileSync(f, "utf-8");
  for (const m of t.matchAll(/(?:\.get|getNavQueryParam)\("([a-zA-Z]+)"\)/g)) {
    const p = m[1];
    if (!consumers.has(p)) consumers.set(p, []);
    consumers.get(p).push(path.relative(ROOT, f));
  }
}

const deadParams = []; // 已知死参数（登记表显式登记 → 出报告不判红，但保持可见）
for (const [kind, spec] of registered) {
  if (spec.handling === "exempt" || spec.handling === "pending" || spec.handling === "note") {
    if (!spec.reason) violations.push(`[理由] "${kind}" 为 ${spec.handling} 但未写 reason（有意不处理与漏处理必须可区分）`);
    continue;
  }
  if (spec.handling === "handoff" || spec.route) {
    if (spec.route && !navRoutes.has(spec.route)) {
      violations.push(`[跳转] "${kind}" 的 handoff route "${spec.route}" 不在 NAV_ROUTES`);
    }
    // B.1 子路由对账：sub 必须在该 route 的 SUB_ROUTES 登记内（运行期 navigate/safeNavigateHash
    // 会拒绝——门禁在提交前拦下，不留到运行期才暴露）
    if (spec.sub) {
      const allowed = spec.route ? subRoutes.get(spec.route) : undefined;
      if (!allowed) {
        violations.push(`[跳转] "${kind}" 声明子路由 "${spec.sub}"，但 ${spec.route ? `route "${spec.route}" 无 SUB_ROUTES 登记` : "缺 route"}——运行期跳转会被拒绝`);
      } else if (!allowed.includes(spec.sub)) {
        violations.push(`[跳转] "${kind}" 的子路由 "${spec.sub}" 不在 ${spec.route} 的 SUB_ROUTES 登记 [${allowed.join("/")}]`);
      }
    }
    // ⑤ golden-hash 值连通性：mini 复刻 buildHandoffHash（action-routing.ts 语义），
    // fixture = 后端 payload 字段全集 → 每个声明参数必须落到 hash（P0-A 类：值来源
    // 既非 STATIC 也非后端 payload 字段 → 参数在真实跳转中被静默丢弃）
    if (spec.route && spec.queryPairs.length > 0) {
      const fixture = {};
      for (const f of payloadFields) fixture[f] = `sentinel:${f}`;
      const qs = new URLSearchParams();
      for (const { param, isStatic, value } of spec.queryPairs) {
        const v = isStatic ? value : fixture[value];
        if (typeof v === "string" && v.trim()) qs.set(param, v);
      }
      const subPart = spec.sub ? `/${spec.sub}` : "";
      const hash = `#/${spec.route}${subPart}${qs.size > 0 ? `?${qs.toString()}` : ""}`;
      for (const { param, isStatic, value } of spec.queryPairs) {
        const landed = qs.get(param);
        if (!landed) {
          violations.push(`[golden-hash] "${kind}" 声明参数 "${param}" 未落到实跑 hash——值来源 "${value}" 既非 STATIC 常量也非后端 payload 字段（参数被静默丢弃，P0-A 类）`);
        } else if (isStatic && landed !== value) {
          violations.push(`[golden-hash] "${kind}" 参数 "${param}" STATIC 值失真（期望 "${value}"，实得 "${landed}"）`);
        }
      }
      if (!/^#\/[a-z-]+(\/[a-z-]+)?(\?.*)?$/.test(hash)) {
        violations.push(`[golden-hash] "${kind}" 实跑 hash 形态异常: ${hash}`);
      }
    }
    for (const p of spec.params) {
      // 「有则展无则显未记录」的载荷参数豁免对账（未被消费不构成死参数）
      // B.3：tab 移出豁免——其值连通性已由 ⑤ golden-hash 承担，消费对账回归常规
      const PAYLOAD_PARAMS = new Set(["seed", "handoff", "sourceLine", "create"]);
      if (PAYLOAD_PARAMS.has(p)) continue;
      const sites = consumers.get(p);
      if (!sites || sites.length === 0) {
        const line = `[死参数] "${kind}" 声明参数 "${p}" 但全仓无消费端 get("${p}")`;
        if (spec.deadAck) deadParams.push(line + "（已登记 known-dead-param，待裁决）");
        else violations.push(line);
      }
    }
  }
}

const counts = [...registered.values()].reduce((acc, s) => {
  acc[s.handling] = (acc[s.handling] || 0) + 1;
  return acc;
}, {});
if (violations.length === 0) {
  console.log(
    `action_routing=ok backend_kinds=${backendKinds.length} registered=${registered.size} payload_fields=${payloadFields.size} ` +
      `in-page=${counts["in-page"] || 0} handoff=${counts.handoff || 0} note=${counts.note || 0} exempt=${counts.exempt || 0} pending=${counts.pending || 0}` +
      (deadParams.length > 0 ? ` known_dead_params=${deadParams.length}` : ""),
  );
  for (const d of deadParams) console.log(`  ~ ${d}`);
} else {
  fail(violations);
}