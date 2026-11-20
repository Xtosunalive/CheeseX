const { compileClassDerivation, compileAllClassDerivations, compileLifecycleRoutes } = require("./derivation-compiler.cjs");
const { normalizeTemplate } = require("../contract-request-schema.cjs");

// WP-207（SPEC-100 批 1·多类推广）：计划面从单类扩到多类——additionalPlans 为其余 approved 类的
// 编译计划。执行器缺位的未绑定计划路由不再炸 boot：入 pendingRoutes 显式可见（不安装、不假绿，
// pending 计数响亮日志）；bind 过的路由仍走严格冲突/执行器语义不变。
function assembleDerivedRoutes({ compiled, additionalPlans = [], registerRoute, executeAction, hasExecutor }) {
  const routes = [
    ...(compiled?.apiRoutes ?? []),
    ...additionalPlans.flatMap((plan) => plan?.apiRoutes ?? []),
  ];
  const routeKey = (method, path) => `${method} ${normalizeTemplate(path)}`;
  const planned = new Map(routes.map((route) => [routeKey(route.method, route.pathTemplate), route]));
  const actionIds = new Set(routes.map((route) => route.actionId));
  const bound = new Set();
  let conflict = null;
  const install = ({ method, pathTemplate, actionId }) => registerRoute(method, pathTemplate, (request, reply) =>
    executeAction({ actionId, request, reply }));
  return {
    bind(method, path, handler, actionId) {
      const key = routeKey(method, path);
      const route = planned.get(key);
      if (!route && !actionIds.has(actionId)) return registerRoute(method, path, handler);
      if (route?.actionId !== actionId || bound.has(key) || handler.tombstone || handler.authExempt) {
        conflict = new Error(`派生路由与既有入口冲突：${key}`);
        throw conflict;
      }
      const result = install(route);
      bound.add(key);
      return result;
    },
    finish() {
      if (conflict) throw conflict;
      const pendingRoutes = [];
      for (const [key, route] of planned) {
        if (bound.has(key)) {
          // 已绑定安装的计划路由：执行器缺位＝接线bug，保持严格抛（响亮）
          if (!hasExecutor(route.executor)) {
            throw new Error(`派生路由缺少登记执行器（已绑定安装）：${route.actionId} @ ${key}`);
          }
          continue;
        }
        if (!hasExecutor(route.executor)) {
          // 未绑定且执行器缺位：显式 pending（不安装不假绿）——批 2 通用执行器到位后自动转安装
          pendingRoutes.push({
            actionId: route.actionId,
            method: route.method,
            pathTemplate: route.pathTemplate,
            reason: "executor 缺位——批 2 通用执行器到位前不安装（显式可见）",
          });
          continue;
        }
        install(route);
      }
      return { pendingRoutes, plannedTotal: planned.size, installed: planned.size - pendingRoutes.length };
    },
  };
}

module.exports = { compileClassDerivation, compileAllClassDerivations, compileLifecycleRoutes, assembleDerivedRoutes };
