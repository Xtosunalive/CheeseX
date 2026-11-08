// Component: Contract-Request-Schema（PR-085 第 1 步 · ADR-010 决策 2–4 · SPEC-024 集成契约 ②③④⑤）
// @responsible: 请求侧契约执法位——把 contracts/http-api.openapi.json 每个操作的 requestBody 推导为 Fastify route
//               schema.body，与响应探针 api-schema-validator.cjs 同源同构（同一契约文件、同一 Ajv2020 实例参数、同一
//               components 内联解析法）。禁止手写 route schema（第二份事实源）；requestBody 缺席＝该操作禁止携带 body。
// @inputs: contracts/http-api.openapi.json（唯一契约事实源）；路由注册的 method ＋ `:param` 风格 pathname
// @outputs: lookupRoute(method, pathname) → { inContract, template, hasRequestBody, bodyRequired, bodySchema, bodyLimit }
//           createValidatorCompiler() → Fastify schemaController.compilersFactory.buildValidator
//           listContractOperations() → [{ method, template, path, hasRequestBody }]（供 check:contract-route-parity）
//           PROJECT_AJV_OPTIONS / normalizeTemplate
// @context: 探针实证（scripts/probes/fastify-integration-probe.mjs）：框架默认校验器解析不了契约 $ref（D0）且会静默
//           剥字段/强转/填默认（D1–D3）——本模块以项目 Ajv2020 实例＋显式关掉三项改写为唯一校验器。
//           x-body-limit-bytes：契约操作级扩展字段，承载路由级 bodyLimit（上传路由 14 MiB），数值只在契约一处。
const fs = require("fs");
const path = require("path");
const Ajv2020 = require("ajv/dist/2020.js");

const OPENAPI_PATH = path.resolve(__dirname, "..", "..", "contracts", "http-api.openapi.json");
const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// 与 api-schema-validator.cjs:22 同参，再显式关掉三个会改写请求体的框架默认项（SPEC-024 ③）。
const PROJECT_AJV_OPTIONS = Object.freeze({
  allErrors: true, strict: false, validateFormats: false,
  removeAdditional: false, coerceTypes: false, useDefaults: false,
});

/** url 模板归一：`:param` 与 `{param}` 统一为 `{x}`；去查询串与尾斜杠（与响应探针同法）。 */
function normalizeTemplate(p) {
  return String(p || "")
    .split("?")[0]
    .replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{x}")
    .replace(/\{[^/{}]+\}/g, "{x}")
    .replace(/\/+$/, "") || "/";
}

function routeKey(method, template) {
  return `${String(method || "").toUpperCase()} ${normalizeTemplate(template)}`;
}

const contract = (() => {
  const doc = JSON.parse(fs.readFileSync(OPENAPI_PATH, "utf8"));
  const components = (doc.components && doc.components.schemas) || {};
  const index = new Map();
  const operations = [];
  for (const [p, item] of Object.entries(doc.paths || {})) {
    for (const [method, op] of Object.entries(item || {})) {
      if (!["get", "post", "put", "delete", "patch"].includes(method)) continue;
      const requestBody = op.requestBody || null;
      const bodySchema = requestBody && requestBody.content && requestBody.content["application/json"]
        ? requestBody.content["application/json"].schema || null
        : null;
      if (requestBody && !bodySchema) {
        throw new Error(`契约 ${method.toUpperCase()} ${p} 声明了 requestBody 但无 application/json schema——请求侧执法位无法推导`);
      }
      const bodyLimit = Number.isInteger(op["x-body-limit-bytes"]) && op["x-body-limit-bytes"] > 0 ? op["x-body-limit-bytes"] : null;
      const entry = {
        method: method.toUpperCase(),
        path: p,
        template: normalizeTemplate(p),
        hasRequestBody: Boolean(requestBody),
        bodyRequired: Boolean(requestBody && requestBody.required === true),
        bodySchema,
        bodyLimit,
      };
      const key = routeKey(entry.method, p);
      if (index.has(key)) throw new Error(`契约路径归一后撞车：${key}（${index.get(key).path} 与 ${p}）`);
      index.set(key, entry);
      operations.push(entry);
    }
  }
  return { components, index, operations };
})();

/**
 * 路由注册时查契约：返回该 (method, pathname) 的请求侧契约事实。
 * - inContract=false：契约外路由（check:contract-route-parity 负责对账，本模块不裁）
 * - hasRequestBody=true：bodySchema 必为对象（推导失败在加载期已抛，不会走到这里返回 null）
 */
function lookupRoute(method, pathname) {
  const entry = contract.index.get(routeKey(method, pathname));
  if (!entry) return { inContract: false, template: normalizeTemplate(pathname), hasRequestBody: false, bodyRequired: false, bodySchema: null, bodyLimit: null };
  return { inContract: true, ...entry };
}

/** 全部契约操作（供双向对账门禁）。 */
function listContractOperations() {
  return contract.operations.map((op) => ({ method: op.method, path: op.path, template: op.template, hasRequestBody: op.hasRequestBody }));
}

/** 可携带 body 的方法（写方法）。 */
function isBodyMethod(method) {
  return BODY_METHODS.has(String(method || "").toUpperCase());
}

/**
 * Fastify 校验器工厂：项目 Ajv2020 实例 ＋ components 内联（$ref 相对契约文档根解析，与响应探针同法）。
 * 用法：fastify({ schemaController: { compilersFactory: { buildValidator: createValidatorCompiler() } } })
 */
function createValidatorCompiler(options = {}) {
  const ajv = new Ajv2020({ ...PROJECT_AJV_OPTIONS, ...(options.ajvOptions || {}) });
  return function buildValidator(_externalSchemas, _ajvOptions) {
    return function compileRouteSchema({ schema }) {
      return ajv.compile({ components: { schemas: contract.components }, ...schema });
    };
  };
}

module.exports = {
  OPENAPI_PATH,
  PROJECT_AJV_OPTIONS,
  normalizeTemplate,
  routeKey,
  lookupRoute,
  listContractOperations,
  isBodyMethod,
  createValidatorCompiler,
};
