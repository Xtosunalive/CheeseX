// Component: nav-routes（navigation 域共享解析器——两门禁读同一份实现）
// @responsible: WP-122 导航域合一（2026-11-06）。check-navigation 面② 与 check-action-routing
//   面③④此前各自正则抠 src/lib/navigation.ts（域行 authority），同一清单两处各译一遍——源码
//   格式一变双红（假红源）。本模块＝唯一解析实现，消费方只 import 本件。
//   fail-closed：锚点缺失/解析为零条即 throw，由消费门禁转结构红（宁拦勿漏，不静默跳过）。
//   authority 文件定位与 check-navigation 同源：reuse-domains.json#navigation.authority（PR-208 单源）。
// @inputs: src/lib/navigation.ts（NAV_ROUTES/SUB_ROUTES 源码常量——前端编译期字面量类型的权威，
//   提为 JSON 契约会丢失字面量联合保护，故 authority 维持原位，解析收敛为一处）
// @outputs: { file, routes: string[], subRoutes: Map<route, string[]> }
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authorityOf } from "./reuse-domain-refs.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export function loadNavRoutes({ root = ROOT, authority } = {}) {
  const file = authority ?? path.join(root, authorityOf("navigation"));
  const text = fs.readFileSync(file, "utf-8");
  const navStart = text.indexOf("export const NAV_ROUTES");
  const navEnd = text.indexOf("] as const");
  if (navStart < 0 || navEnd < 0 || navEnd < navStart) {
    throw new Error(`nav-routes: ${file} NAV_ROUTES 锚点缺失（authority 源码形态变更——本解析器需同步，fail-closed）`);
  }
  const routes = [...text.slice(navStart, navEnd).matchAll(/"([a-z-]+)",/g)].map((m) => m[1]);
  if (routes.length === 0) {
    throw new Error(`nav-routes: ${file} NAV_ROUTES 解析为零条（fail-closed——宁拦勿漏）`);
  }
  const subRoutes = new Map();
  const subStart = text.indexOf("const SUB_ROUTES");
  const subEnd = subStart >= 0 ? text.indexOf("};", subStart) : -1;
  if (subStart >= 0 && subEnd > subStart) {
    for (const m of text.slice(subStart, subEnd).matchAll(/([a-z-]+):\s*\[([^\]]*)\]/g)) {
      subRoutes.set(m[1], [...m[2].matchAll(/"([a-z-]+)"/g)].map((x) => x[1]));
    }
  }
  return { file, routes, subRoutes, raw: text };
}
