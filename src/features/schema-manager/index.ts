// schema-manager feature 公共出口 — 供其他 feature 通过 barrel 访问 Schema 枚举 API。
// 内部模块（schema-manager-api/schema-manager-types 等）不对外直接暴露。
export { fetchEnums } from "./schema-manager-api";
export { normalizeEnumsData } from "./schema-manager-types";
// #1800：版本注册表只读查询出口（待处理问题抽屉有效期字段候选源；写接口不外泄）
export { fetchVersionRegistry } from "./version-registry-api";
