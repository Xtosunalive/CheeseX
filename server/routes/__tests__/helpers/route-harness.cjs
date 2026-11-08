// Layer: test helper（server/routes/__tests__ 共享）· 验证对象: 经 Fastify inject 走完整传输层管线的路由 handler
// PR-085 第 1 步：31 份各自手搓的假 req/res（EventEmitter emit("data") 模拟 body）随手写 body 读取一并退役——
// 路由单测从此真实经过契约推导校验／钩子／错误处理器，而非直调 handler(req, res)。
// 用法：
//   const h = createRouteHarness();            // 可选 { bodyLimit, writerGate, ... } 透传 createHttpApp
//   routes.register(h.registerRoute, deps);     // 与生产装配同一注册入口
//   const res = await h.request("PUT /api/schema/enums", { body });               // 按注册键
//   const res = await h.request("GET /api/x/:id", { params: { id: "a" } });      // :param 填充
//   const res = await h.request({ method: "POST", url: "/api/kg/review" }, { body });
//   res.statusCode / res.status（同值）· res.body / res.payload（已解析 JSON，非 JSON 时为原始字符串）· res.raw · res.headers
const { createHttpApp } = require("../../../shared/http-app.cjs");
// WP-048 Wave 1：动作化路由单测接线助手——三件 init（vault-io 通道／action-registry 快照／执行工厂）
// ＋把仓内 data/theschema 的 W1-A action_types 定义合并进测试夹具 ontology.yaml（单源：不手抄第二份）。
const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");
const { initVaultIO, resetVaultIO } = require("../../../shared/vault-io.cjs");
const { initActionRegistry, resetActionRegistry } = require("../../../shared/action-registry.cjs");
const { initActionFactory, resetActionFactory } = require("../../../shared/action-execution-factory.cjs");

const REPO_ONTOLOGY = path.resolve(__dirname, "../../../../data/theschema/ontology.yaml");

/** 把仓内 W1-A 动作定义合并进夹具 ontology.yaml（夹具缺 action_types 时动作化端点才可执行）。 */
function mergeW1aActionTypes(ontologyPath) {
  const source = YAML.parse(fs.readFileSync(REPO_ONTOLOGY, "utf8")) || {};
  const target = fs.existsSync(ontologyPath) ? (YAML.parse(fs.readFileSync(ontologyPath, "utf8")) || {}) : {};
  if (source.action_types) target.action_types = source.action_types;
  if (source.risk_types) target.risk_types = source.risk_types;
  fs.mkdirSync(path.dirname(ontologyPath), { recursive: true });
  fs.writeFileSync(ontologyPath, YAML.stringify(target));
}

/** 动作化路由测试的三件初始化（幂等；测试结束调 teardownActionRuntime 复位进程单例）。 */
function setupActionRuntime({ vaultPath }) {
  initVaultIO({ vaultPath });
  initActionRegistry({ vaultPath, logger: null });
  initActionFactory({ vaultPath, logger: null });
}

function teardownActionRuntime() {
  resetVaultIO();
  resetActionRegistry();
  resetActionFactory();
}

function fillParams(pathname, params = {}) {
  return pathname.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_m, name) => {
    if (!(name in params)) throw new Error(`route-harness: 缺少路径参数 ${name}（${pathname}）`);
    return encodeURIComponent(String(params[name]));
  });
}

function createRouteHarness(options = {}) {
  const http = createHttpApp({ cors: false, ...options });
  const routes = new Map();
  function registerRoute(method, pathname, handler) {
    const upper = String(method).toUpperCase();
    http.registerRoute(upper, pathname, handler);
    routes.set(`${upper} ${pathname}`, { method: upper, pathname });
  }
  async function request(target, call = {}) {
    let route = null;
    if (typeof target === "string") {
      route = routes.get(target);
      if (!route) throw new Error(`route-harness: 未注册的路由键 ${target}；已注册：${[...routes.keys()].join(", ")}`);
    } else if (target && typeof target === "object") {
      route = { method: String(target.method).toUpperCase(), pathname: target.url || target.pathname };
    } else {
      throw new Error("route-harness: target 须为注册键字符串或 {method,url}");
    }
    const url = call.url || (call.query ? `${fillParams(route.pathname, call.params)}?${call.query}` : fillParams(route.pathname, call.params));
    const injectOptions = { method: route.method, url, headers: call.headers };
    if (call.body !== undefined) injectOptions.payload = call.body;
    if (call.rawBody !== undefined) { injectOptions.payload = call.rawBody; injectOptions.headers = { "content-type": "application/json", ...(call.headers || {}) }; }
    const res = await http.app.inject(injectOptions);
    let body;
    try { body = res.json(); } catch (_error) { body = res.body; }
    return { statusCode: res.statusCode, status: res.statusCode, body, payload: body, raw: res.body, headers: res.headers };
  }
  /** 位置参数形态（迁移友好）：原 request(handlers["KEY"], url, body) → h.call("KEY", url, body) */
  function call(target, url, body, headers) {
    return request(target, { url: url || undefined, body, headers });
  }
  return { app: http.app, registerRoute, request, call, routes, close: () => http.close() };
}

module.exports = { createRouteHarness, fillParams, mergeW1aActionTypes, setupActionRuntime, teardownActionRuntime };
