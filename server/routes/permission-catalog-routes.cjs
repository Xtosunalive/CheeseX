// Component: Permission-Catalog-Routes（WP-211／SPEC-100 批 3→批 5·交付物④权限点自动派生）
// @responsible: 权限点目录只读面——从动作注册快照派生（approved 动作：actionId/路由/required_roles/
//   载荷敏感升级）＋route-roles 静态车道分列。单一事实源＝快照（与运行时角色门 actionRouteRoleFor
//   同一查询口）——目录即角色门的只读投影，零第二份维护。
// @inputs: 动作注册快照（getActiveActionSnapshot）＋route-roles.listRouteRoleBindings（静态表）
// @outputs: GET /api/permissions/catalog（信封）
// @context: SPEC-100 §三 批 5（权限点目录派生）；同源对账测试＝__tests__/permission-catalog.test.cjs。
"use strict";

const { sendJSON } = require("../shared/api-envelope.cjs");
const { getActiveActionSnapshot, actionRouteRoleFor } = require("../shared/action-registry.cjs");
const { listRouteRoleBindings } = require("../shared/auth/route-roles.cjs");

function buildCatalog(snapshot) {
  const actions = [];
  for (const [actionId, def] of (snapshot && snapshot.actions) || new Map()) {
    actions.push({
      actionId,
      httpRoute: def.http_route || null,
      requiredRoles: [...(def.required_roles || [])],
      payloadRoleOverrides: (def.payload_role_overrides || []).map((o) => ({
        body_field: o.body_field,
        equals: o.equals,
        roles: [...(o.roles || [])],
      })),
    });
  }
  actions.sort((a, b) => String(a.actionId).localeCompare(String(b.actionId)));
  const staticRoutes = Object.entries(listRouteRoleBindings())
    .map(([route, roles]) => ({ route, requiredRoles: [...roles] }))
    .sort((a, b) => String(a.route).localeCompare(String(b.route)));
  return {
    generatedFrom: snapshot ? snapshot.revision : null,
    actions,
    staticRoutes,
  };
}

function register(registerRoute) {
  registerRoute("GET", "/api/permissions/catalog", (req, res) => {
    const snapshot = getActiveActionSnapshot();
    const catalog = buildCatalog(snapshot);
    // 同源自证：目录内每条动作路由的角色，经运行时同一查询口复核（不一致＝目录失真，当场红）
    const mismatches = [];
    for (const entry of catalog.actions) {
      if (!entry.httpRoute) continue;
      const [method, template] = String(entry.httpRoute).split(/\s+/);
      const runtimeRoles = actionRouteRoleFor(method, template, null, snapshot);
      const expect = entry.requiredRoles;
      if (JSON.stringify(runtimeRoles || []) !== JSON.stringify(expect || [])) {
        mismatches.push({ actionId: entry.actionId, catalog: expect, runtime: runtimeRoles || [] });
      }
    }
    if (mismatches.length) {
      return sendJSON(res, 500, { error_code: "PERMISSION_CATALOG_MISMATCH", message: "目录与运行时角色门不一致（同源对账失败）", details: { mismatches } });
    }
    return sendJSON(res, 200, catalog);
  });
}

module.exports = { register, buildCatalog };
