// ── 表格 URL 状态（P2 · N1：筛选/排序/分页进 URL，刷新不丢）──
// 落点＝hash 的查询段（#/review?q=...&sort=field.desc&page=2）；自研路由
// getNavFromHash 已剥 ?query 解析导航（App.tsx），互不干扰。
// 序列化口径：query=q、筛选=f:<key>=v1|v2（逗号转义）、排序=sort=<field>.<asc|desc>、页码=page=<n+1>。
// 只对「可分享场景表」开启（决策卡 §十：T01/T02/T06/T07/T09/T10，迁移波逐表接）。
// 读地址一律经 navigation 读侧出口（readNavLocation）；本文件只写查询段（replaceState），不写路径。
import { readNavLocation } from "@/lib/navigation";

export type TableUrlState = {
  query?: string;
  filters?: Record<string, string[]>;
  sortField?: string;
  sortDirection?: "asc" | "desc";
  page?: number; // 0 基
};

function readHashSearch(): URLSearchParams {
  return readNavLocation().query;
}

function writeHashSearch(params: URLSearchParams): void {
  const { route, sub } = readNavLocation();
  const path = route ? `/${route}${sub ? `/${sub}` : ""}` : "";
  const search = params.toString();
  // replaceState：不产生历史条目（表格内筛选不该污染回退栈）
  window.history.replaceState(null, "", `#${path}${search ? `?${search}` : ""}`);
}

export function encodeTableUrlState(state: TableUrlState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  for (const [key, values] of Object.entries(state.filters ?? {})) {
    if (values.length > 0) params.set(`f:${key}`, values.map((v) => v.replace(/,/g, "%2C")).join(","));
  }
  if (state.sortField) params.set("sort", `${state.sortField}.${state.sortDirection ?? "desc"}`);
  if (state.page && state.page > 0) params.set("page", String(state.page + 1));
  return params;
}

export function writeTableUrlState(key: string, state: TableUrlState): void {
  const params = readHashSearch();
  // 命名空间：多表同页时以 <key>: 前缀隔离（当前单表场景前缀省略位——key 保留扩展位）
  for (const name of [...params.keys()]) {
    if (key ? name === `${key}:*` : true) params.delete(name);
  }
  const encoded = encodeTableUrlState(state);
  for (const [name, value] of encoded) params.set(key ? `${key}:${name}` : name, value);
  writeHashSearch(params);
}

export function readTableUrlState(key: string): TableUrlState {
  const params = readHashSearch();
  const get = (name: string): string | null => (key ? params.get(`${key}:${name}`) : params.get(name));
  const state: TableUrlState = {};
  const q = get("q");
  if (q) state.query = q;
  const sort = get("sort");
  if (sort) {
    const dot = sort.lastIndexOf(".");
    if (dot > 0) {
      state.sortField = sort.slice(0, dot);
      state.sortDirection = sort.slice(dot + 1) === "asc" ? "asc" : "desc";
    }
  }
  const page = get("page");
  if (page && Number.isFinite(Number(page))) state.page = Math.max(0, Number(page) - 1);
  const filters: Record<string, string[]> = {};
  for (const [name, value] of params.entries()) {
    const local = key ? (name.startsWith(`${key}:`) ? name.slice(key.length + 1) : null) : name;
    if (local?.startsWith("f:")) {
      const filterKey = local.slice(2);
      if (filterKey && value) filters[filterKey] = value.split(",").map((v) => v.replace(/%2C/g, ","));
    }
  }
  if (Object.keys(filters).length > 0) state.filters = filters;
  return state;
}
