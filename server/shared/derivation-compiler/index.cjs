const { compileClassDerivation } = require("./derivation-compiler.cjs");
const { normalizeTemplate } = require("../contract-request-schema.cjs");

function assembleDerivedRoutes({ compiled, registerRoute, executeAction, hasExecutor }) {
  const routes = compiled?.apiRoutes ?? [];
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
      for (const route of routes) {
        if (!hasExecutor(route.executor)) {
          throw new Error(`文章动作缺少登记执行器：${route.actionId}`);
        }
      }
      for (const [key, route] of planned) {
        if (!bound.has(key)) install(route);
      }
    },
  };
}

module.exports = { compileClassDerivation, assembleDerivedRoutes };
