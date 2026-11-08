#!/usr/bin/env node
// Component: Navigation-Contract-Guard（navigation 领域门禁 · WP-122 起为域唯一常驻入口）
// 检查面：
//   ① 业务代码禁直写 location.hash（唯一下写点 = src/lib/navigation.ts）
//   ② NAV_ROUTES 与 App.tsx getNavFromHash 识别清单对账（双向：清单有而路由不认识=静默回落源）
//   ③ 业务代码禁裸读 location.hash、禁自挂 hashchange（唯一读/订阅出口 = navigation.ts 读侧 API
//      ＋ hooks/use-nav-location.ts；此前只拦写不拦读，约 10 处各自拼 URLSearchParams——2026-10-21 补面）
//   ④ 包装面（WP-122 导航域合一 2026-11-06）：串联 check-action-routing.mjs 五检查面（issueKind 完备性/
//      理由完整性/跳转合法性/参数消费/golden-hash 连通）——子检查器独立可跑（check:action-routing 别名
//      留档），本门禁＝域唯一常驻位；子件红即本件红，8 个检查面一张不少。
// 豁免：src/test/**、navigation.ts 自身全部；App.tsx（路由器本体 getNavFromHash）与 use-nav-location.ts 豁免 ③
// @context: domain-registry#navigation（Master 17:15 裁 A：修 bug 与立领域同构）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { authorityOf, reuseDomain } from "./shared/reuse-domain-refs.mjs"; // PR-208 清债第一批：目标名单以契约域行为准
import { loadNavRoutes } from "./shared/nav-routes.mjs"; // WP-122：NAV_ROUTES/SUB_ROUTES 唯一解析实现（两门禁读同一份）

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = path.join(ROOT, "src");

function fail(vs) {
  console.log(`navigation=FAIL violations=${vs.length}`);
  for (const v of vs) console.log(`  ${v}`);
  process.exit(1);
}

const violations = [];
const ASSIGN = /location\.hash\s*=/;
const READ = /location\.hash/;
const SUBSCRIBE = /addEventListener\(\s*["']hashchange["']/;
// PR-208 清债第一批：navigation.ts＝域行 authority；use-nav-location.ts＝域行 writers[0]（读侧出口登记）——
// 手抄名单改现场读契约（App.tsx 路由器本体不在契约，保留字面）
const NAV_DOMAIN = reuseDomain("navigation");
const NAV_AUTHORITY = authorityOf("navigation");
const READ_EXEMPT = new Set([
  NAV_AUTHORITY,
  ...((NAV_DOMAIN && Array.isArray(NAV_DOMAIN.writers)) ? NAV_DOMAIN.writers.filter((w) => String(w).includes("use-nav-location")) : []),
  "src/App.tsx",
]);

function walk(dir, acc) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, acc);
    else if (name.endsWith(".tsx") || (name.endsWith(".ts") && !name.endsWith(".d.ts"))) acc.push(full);
  }
  return acc;
}

// ① 直写扫描 ＋ ③ 裸读/裸订阅扫描
for (const full of walk(SRC, [])) {
  const rel = path.relative(ROOT, full).split(path.sep).join("/");
  if (rel === NAV_AUTHORITY || rel.includes("src/test/")) continue;
  const readExempt = READ_EXEMPT.has(rel);
  const lines = fs.readFileSync(full, "utf-8").split("\n");
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith("//") || t.startsWith("*")) return;
    const isAssign = ASSIGN.test(line) && !line.includes("==");
    if (isAssign) {
      violations.push(`[直写] ${rel}:${i + 1}: …${t.slice(0, 70)}… → 应使用 navigate()/safeNavigateHash()`);
      return;
    }
    if (readExempt) return;
    if (READ.test(line)) {
      violations.push(`[裸读] ${rel}:${i + 1}: …${t.slice(0, 70)}… → 应使用 readNavLocation()/getNavQueryParam()/useNavLocation()`);
    }
    if (SUBSCRIBE.test(line)) {
      violations.push(`[裸订阅] ${rel}:${i + 1}: …${t.slice(0, 70)}… → 应使用 useNavLocation()`);
    }
  });
}

// ② 清单对账：NAV_ROUTES 里的每个 id，getNavFromHash 必须认识（解析经共享模块——WP-122 单实现）
const { routes } = loadNavRoutes({ root: ROOT, authority: NAV_AUTHORITY });
const app = fs.readFileSync(path.join(SRC, "App.tsx"), "utf-8");
for (const r of routes) {
  if (!new RegExp(`h === "${r}"|h\\.startsWith\\("${r}`).test(app)) {
    violations.push(`[对账] NAV_ROUTES 含 "${r}" 但 getNavFromHash 无识别分支（静默回落源）`);
  }
}

if (violations.length > 0) fail(violations);

// ④ 包装面：action-routing 子契约五面串联（子件红即本件红）
const child = spawnSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), "check-action-routing.mjs")], {
  cwd: ROOT,
  encoding: "utf-8",
});
if (child.status !== 0) {
  console.log(`navigation=FAIL wrapper=action-routing exit=${child.status}`);
  process.stdout.write(child.stdout || "");
  process.stderr.write(child.stderr || "");
  process.exit(1);
}

console.log(`navigation=ok routes=${routes.length} assign_sites=0 read_sites=0 wrapper=action-routing-ok`);
