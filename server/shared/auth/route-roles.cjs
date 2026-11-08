// Component: Route-Roles（PR-085 第 3 步 · ADR-010 决策 7：路由→角色绑定表——审批状态机隐含角色的显式化）
// @responsible: 声明各契约操作所需最低角色，由 http-app preHandler 统一执法（构造性消灭：路由代码不写角色检查）；
//               加载即对账契约——表中每键必须是契约操作（写错路径/漂移即启动红）。
//               WP-048 W1-B 起：已动作化端点的角色绑定（含载荷敏感升级）单源＝action_types 快照
//               （payload_role_overrides 声明式承载，原 PAYLOAD_ROLE_RULES 机制随之退役）；本表只保留未迁移端点。
// @inputs: contracts/http-api.openapi.json（经 contract-request-schema 对账）
// @outputs: ROUTE_ROLES（键＝"METHOD 归一模板"）；requiredRolesFor(method, pathname, body) → string[]|null
//           listRouteRoleBindings()（供对账/测试）
const contractRequest = require("../contract-request-schema.cjs");
const { actionRouteRoleFor } = require("../action-registry.cjs"); // WP-048：已迁移端点角色绑定单源＝action_types 快照（ADR-014 §6.1）

// 词表见 auth/principal.cjs（OPERATOR_ROLES）：submit 投稿｜review 审核｜publish 发布｜admin 管理
// WP-048 W1-A/W1-B 已迁移端点的角色绑定迁入 data/theschema/ontology.yaml action_types（required_roles
// ＋payload_role_overrides），由 action-registry 快照供源并与本表互斥对账（快照构建期同键双挂即红）。
const ROUTE_ROLES = {
  // ── 管理（admin）：未迁移的 schema 只读/校验面与发布恢复 ──
  "POST /api/schema/enums/preview": ["admin"],
  "POST /api/schema/versions/validate": ["admin"],
  "POST /api/schema/dependencies/preview": ["admin"],
  "POST /api/schema/dependencies/validate": ["admin"],
};

function assertBindingsInContract() {
  const ops = new Map(contractRequest.listContractOperations().map((op) => [`${op.method} ${op.template}`, op.path]));
  const offenders = Object.keys(ROUTE_ROLES).filter((key) => !ops.has(key));
  if (offenders.length) {
    throw new Error(`[route-roles] fail-closed：角色绑定键不是契约操作（写错路径或契约漂移）：${offenders.join(", ")}`);
  }
}

function requiredRolesFor(method, pathname, body) {
  const key = `${String(method || "").toUpperCase()} ${contractRequest.normalizeTemplate(pathname)}`;
  // WP-048：快照含该路由＝动作定义是角色绑定唯一来源（含载荷敏感升级，与执行工厂动作查找同一
  // active revision）；快照未初始化（部分单测环境）返回 null，回落静态表——生产装配恒初始化。
  const actionRoles = actionRouteRoleFor(method, pathname, body);
  if (actionRoles) return actionRoles;
  return ROUTE_ROLES[key] || null;
}

function listRouteRoleBindings() {
  return { ...ROUTE_ROLES };
}

assertBindingsInContract(); // 启动/加载即对账契约（fail-closed）

module.exports = { ROUTE_ROLES, requiredRolesFor, listRouteRoleBindings };
