// Component: Retired-Route-Registrar
// @responsible: Register contract-owned 410 tombstones without loading retired domain writers.

const fs = require("node:fs");
const path = require("node:path");
const { sendJSON } = require("./api-envelope.cjs");

const DEFAULT_CONTRACT_PATH = path.resolve(__dirname, "../../contracts/retired-routes.json");

function routeKey(method, pathname) {
  return `${String(method || "").toUpperCase()} ${pathname}`;
}

function loadRetiredRoutes(contractPath = DEFAULT_CONTRACT_PATH) {
  const parsed = JSON.parse(fs.readFileSync(contractPath, "utf8"));
  if (!parsed || !Array.isArray(parsed.retired)) {
    throw new Error(`Invalid retired route contract: ${contractPath}`);
  }
  return parsed.retired;
}

function registerRetiredRoutes(registerRoute, options = {}) {
  const contracted = loadRetiredRoutes(options.contractPath);
  const byKey = new Map(contracted.map((route) => [routeKey(route.method, route.path), route]));
  const requested = options.routes || contracted.map((route) => ({ method: route.method, path: route.path }));

  for (const requestedRoute of requested) {
    const key = routeKey(requestedRoute.method, requestedRoute.path);
    const route = byKey.get(key);
    if (!route) throw new Error(`Retired route is not declared by contract: ${key}`);
    // PR-085：墓碑标记——传输层对其跳过「契约无 requestBody 禁止 body」判定，带 body 调用仍答 410（退役信号不被 400 盖掉）
    const tombstone = function (_req, res) {
      return sendJSON(res, 410, {
        error_code: route.errorCode || "ROUTE_RETIRED",
        message: route.reason || "This route has been retired",
        details: {
          retiredAt: route.retiredAt,
          replacement: route.replacement || null,
        },
      });
    };
    tombstone.tombstone = true;
    registerRoute(route.method.toUpperCase(), route.path, tombstone);
  }
}

module.exports = { DEFAULT_CONTRACT_PATH, loadRetiredRoutes, registerRetiredRoutes, routeKey };
