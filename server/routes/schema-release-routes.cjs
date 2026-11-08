// @responsible: 注册已退役 Schema 发布接口的 410 契约墓碑路由。
// Legacy Schema release routes retained only as contract-owned 410 tombstones.
const { registerRetiredRoutes } = require("../shared/retired-route-registrar.cjs");

const RETIRED_ROUTES = [
  { method: "POST", path: "/api/schema/change-sets/preview" },
  { method: "POST", path: "/api/schema/change-sets/apply" },
  { method: "GET", path: "/api/schema/releases" },
  { method: "POST", path: "/api/schema/releases" },
  { method: "POST", path: "/api/schema/releases/:revision/promote" },
  { method: "POST", path: "/api/schema/releases/:revision/redeploy" },
  { method: "POST", path: "/api/schema/releases/:revision/revert-preview" },
];

function register(registerRoute) {
  registerRetiredRoutes(registerRoute, { routes: RETIRED_ROUTES });
}

module.exports = { register };
