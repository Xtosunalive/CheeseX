// navigation — 路由跳转契约（navigation 领域 · 单源 + 唯一出口）
// 契约要点（domain-registry#navigation）：
//   ① NAV_ROUTES 是页面路由的唯一清单；getNavFromHash（App.tsx）的认识范围必须与之一致
//   ② 业务代码跳转一律经 navigate()——禁直写 location.hash（门禁 check-navigation 执法）
//   ③ 目标不在清单 = 编译期类型红 + 运行期 console.error（不再静默回落 dashboard）
//   ④ 读侧同为唯一出口：业务代码取路由/子路由/query 一律经 readNavLocation()/getNavQueryParam()
//      或 useNavLocation() 钩子——禁裸读 location.hash、禁自挂 hashchange（门禁第三检查面执法）
// Master 2026-10-06 17:15 裁 A：修复 PR-026 跳转失败与立领域同一动作。

import { NAV_DIAG_COPY, navIllegalHashSubRoute, navIllegalSubRoute, navIllegalTarget } from "./lib-copy";

/** 全部可跳转的页面路由（与 App.tsx getNavFromHash 的识别清单对账） */
export const NAV_ROUTES = [
  "dashboard",
  "data-dashboard",
  "entity-compliance",
  "admission",
  "review",
  "gaps",
  "property",
  "schema",
  "anomalies",
  "article-workflow",
  "article-associations",
  "impact-analysis",
  "architecture-version",
  "document-inventory",
] as const;

export type NavRoute = (typeof NAV_ROUTES)[number];

/** 子路由/查询参数形态登记（跳转目标合法性的第二层清单）
 *  2026-10-06 动作路由表梳理补登：conflicts/checks 为既有事实（getNavFromHash 的
 *  startsWith 分支早已识别、原 registry 手拼过这两个 hash），此前未登记入清单。 */
const SUB_ROUTES: Partial<Record<NavRoute, string[]>> = {
  review: ["edges", "nodes", "conflicts", "audit"],
  property: ["manifest", "entities", "edges", "checks", "mapping"],
};

function isNavRoute(id: string): id is NavRoute {
  return (NAV_ROUTES as readonly string[]).includes(id);
}

/** 当前地址的三段形态：route=首段、sub=首段之后的剩余路径（无则 null）、query=? 之后的参数 */
export type NavLocation = {
  hash: string;
  route: string;
  sub: string | null;
  query: URLSearchParams;
};

/** 纯解析：任意 hash 字符串 → 三段形态（无副作用，可直接单测） */
export function parseNavHash(hash: string): NavLocation {
  const raw = hash.replace(/^#\/?/, "");
  const qIndex = raw.indexOf("?");
  const path = qIndex === -1 ? raw : raw.slice(0, qIndex);
  const query = new URLSearchParams(qIndex === -1 ? "" : raw.slice(qIndex + 1));
  const slash = path.indexOf("/");
  const route = slash === -1 ? path : path.slice(0, slash);
  const sub = slash === -1 || slash === path.length - 1 ? null : path.slice(slash + 1);
  return { hash, route, sub, query };
}

/** 读侧唯一出口：当前地址的三段形态（无 window 环境返回空形态） */
export function readNavLocation(): NavLocation {
  return parseNavHash(typeof window === "undefined" ? "" : window.location.hash);
}

/** 便捷读单个 query 参数（等价 readNavLocation().query.get(key)） */
export function getNavQueryParam(key: string): string | null {
  return readNavLocation().query.get(key);
}

/**
 * 唯一跳转出口。用法：navigate("article-workflow") / navigate("review", { sub: "edges" })
 * / navigate("impact-analysis", { query: { seed: nodeId } })。
 * 非法目标（不在清单）→ console.error 并不跳转（可判定、可见），而非静默回落。
 */
export function navigate(
  route: NavRoute,
  opts: { sub?: string; query?: Record<string, string | number | undefined> } = {},
): void {
  const sub = opts.sub;
  if (sub !== undefined) {
    const allowed = SUB_ROUTES[route];
    if (!allowed || !allowed.includes(sub)) {
      console.error(navIllegalSubRoute(route, sub, allowed?.join("/") ?? NAV_DIAG_COPY.NONE));
      return;
    }
  }
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && String(v).length > 0) qs.set(k, String(v));
  }
  const subPart = sub ? `/${sub}` : "";
  const qPart = qs.size > 0 ? `?${qs.toString()}` : "";
  window.location.hash = `#/${route}${subPart}${qPart}`;
}

/** 校验外部传入的 hash 目标是否合法（动态目标跳转前的守卫；返回 null=非法） */
export function safeNavigateHash(hash: string): string | null {
  const raw = hash.replace(/^#\/?/, "");
  const [path] = raw.split("?");
  const [head, sub] = path.split("/");
  if (!isNavRoute(head)) {
    console.error(navIllegalTarget(hash));
    return null;
  }
  if (sub && !(SUB_ROUTES[head] ?? []).includes(sub)) {
    console.error(navIllegalHashSubRoute(hash, head, SUB_ROUTES[head]?.join("/") ?? NAV_DIAG_COPY.NONE));
    return null;
  }
  window.location.hash = hash.startsWith("#") ? hash : `#${hash}`;
  return hash;
}
