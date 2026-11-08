// Component: Api-Schema-Validator (EG-1a 地基 → seq196 enforce 翻转)
// @responsible: 响应出站 schema 校验执法位——把 openapi.json 从文档变成可执行契约（规则 9 补全「响应↔契约」方向执法）。
// @inputs: contracts/http-api.openapi.json（唯一契约事实源，规则 9/30——paths.responses 逐路由推导，禁止另立 schema 目录）。
// @outputs: createContractResponseProbe({logger}) → probe(url, method, status, payload) → { action: "pass"|"block", violations }；
//           contractRouteCount（已编译契约路由数，供启动日志）。
// @context: ADR022 L3 确定性门禁；seq196 enforce 翻转（#1592，用户三项裁定）：
//           ①违约响应阻断=替换 500 INTERNAL_ERROR（不外泄违约载荷）+ 服务端 log；
//           ②API_RESPONSE_SCHEMA_CHECK 默认开（未设=开，"0"=显式关）；
//           ③API_RESPONSE_SCHEMA_SHADOW=<path 前缀,逗号分隔> 白名单端点回退 shadow（违例照发仅记录，ADR060 §5 可单独回退承诺）。
//           校验对象=envelope 级 payload（契约 response schema 描述整个信封——EG-2 批次定型形态），非 data 本体
//           （EG-1a 旧探针送 payload.data 系 envelope 契约定型前的形态，随本翻转退役）。
//           渐进语义：无 response schema 的路由（22 条）、契约外路由（404 fallback）、未声明状态码的响应均跳过不校验。
//           域隔离登记：本模块为 server CJS 域，require 不达 scripts/quality/shared/ajv-schema-validation.mjs（ESM，
//           quality 脚本域 S120 单源入口）——Ajv 实例与其同包同参（draft-2020-12 / allErrors / strict:false），
//           差异缘由在此登记，非单源背离。@-diagram Company>Potal>Allshare-Architect>Api-Schema-Validator
const Ajv2020 = require("ajv/dist/2020.js");
const fs = require("fs");
const path = require("path");

const OPENAPI_PATH = path.resolve(__dirname, "..", "..", "contracts", "http-api.openapi.json");

const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });

/** 实例路径（JSON Pointer）→ 点号路径（域隔离副本，S120 toDotLocation 同参风格）。 */
function toDotLocation(instancePath, rootLabel) {
  if (!instancePath) return rootLabel;
  let out = rootLabel;
  for (const rawSeg of instancePath.split("/").filter((s) => s !== "")) {
    const seg = rawSeg.replace(/~1/g, "/").replace(/~0/g, "~");
    out += /^\d+$/.test(seg) ? `[${seg}]` : `.${seg}`;
  }
  return out;
}

/** url 模板归一：express :param 与契约 {param} 统一为 {x}；去查询串与尾斜杠。 */
function normalizeTemplate(p) {
  return String(p || "").replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{x}").replace(/\{[^/{}]+\}/g, "{x}").replace(/\/+$/, "").split("?")[0];
}

/**
 * 契约 response-schema 推导表（进程内一次）：paths 遍历 → {method, tpl, byStatus}[]。
 * 编译时内联 components（#/components/schemas/X 相对文档根解析）——与 EG-1a 容器编译同参、锚点上下文随文档走。
 * 不可编译形态（Ajv 报错）按渐进登记语义跳过：执法位建立不被存量 schema 形态阻断。
 */
const routeTable = (() => {
  const doc = JSON.parse(fs.readFileSync(OPENAPI_PATH, "utf8"));
  const components = (doc.components && doc.components.schemas) || {};
  const table = [];
  for (const [p, item] of Object.entries(doc.paths || {})) {
    for (const [method, op] of Object.entries(item)) {
      if (!["get", "post", "put", "delete", "patch"].includes(method)) continue;
      const byStatus = new Map();
      for (const [status, resp] of Object.entries(op.responses || {})) {
        const schema = resp && resp.content && resp.content["application/json"] && resp.content["application/json"].schema;
        if (!schema) continue;
        try {
          byStatus.set(status, ajv.compile({ components: { schemas: components }, ...schema }));
        } catch (_compileError) {
          // 渐进登记：该状态码暂不可编译 → 跳过（不阻断执法位建立）。
        }
      }
      if (byStatus.size > 0) table.push({ method, tpl: normalizeTemplate(p), byStatus });
    }
  }
  return table;
})();

const contractRouteCount = routeTable.length;

/** url+method → 路由行（模板匹配：{x} 段通配）。契约外路由返回 null（渐进语义跳过）。 */
function matchRoute(method, url) {
  const p = normalizeTemplate(url);
  for (const route of routeTable) {
    if (route.method !== String(method || "").toLowerCase()) continue;
    const pattern = route.tpl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\{x\\\}/g, "[^/]+");
    if (new RegExp("^" + pattern + "$").test(p)) return route;
  }
  return null;
}

/**
 * 状态码 → schema 选择：精确码匹配，无精确码跳过（返回 null）。
 * 渐进语义（e2e 活阻断实证后修正，#1592）：错误码声明覆盖面本身渐进中（409 仅 26/79 路由声明），
 * 族兜底（如 409 就近用 400 schema）会把未声明码的合法 fail-closed 响应误判违约——
 * 可用性损失 > 漏校验渐进面，故无精确码不校验；错误码声明随 EG-2 逐码定型演进自然扩大执法面。
 */
function pickValidator(route, status) {
  const exact = String(status);
  return route.byStatus.get(exact) || null;
}

/**
 * 契约推导响应探针工厂（enforce 语义）。
 * @returns {(url, method, status, payload) => {action: "pass"|"block", violations: Array}}
 *   - 契约外路由 / 无该码族 schema → pass（渐进语义）
 *   - 合规 → pass
 *   - API_RESPONSE_SCHEMA_SHADOW 名单内（path 前缀匹配）违例 → pass（照发，仅记录——ADR060 §5 可单独回退）
 *   - 名单外违例 → block（envelope 收到后替换 500 INTERNAL_ERROR，不外泄违约载荷）
 *   - 探针自身异常由调用方（api-envelope）吞掉：观测/执法面异常不波及响应链路可用性。
 */
function createContractResponseProbe(options) {
  const logger = (options && options.logger) || null;
  const shadowPrefixes = String(process.env.API_RESPONSE_SCHEMA_SHADOW || "")
    .split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  const log = logger || console;
  return function probe(url, method, status, payload) {
    const route = matchRoute(method, url);
    if (!route) return { action: "pass", violations: [] };
    const validate = pickValidator(route, status);
    if (!validate) return { action: "pass", violations: [] };
    const urlPath = normalizeTemplate(url);
    if (validate(payload)) return { action: "pass", violations: [] };
    const violations = (validate.errors || []).map(function (error) {
      return {
        location: toDotLocation(error.instancePath || "", route.tpl),
        message: toDotLocation(error.instancePath || "", route.tpl) + " " + error.message,
        keyword: error.keyword,
      };
    });
    for (const prefix of shadowPrefixes) {
      if (urlPath.startsWith(prefix)) {
        // shadow 回退（ADR060 §5）：名单端点违例照发，仅记录观测。
        const warn = log.warn || log.info || console.log;
        warn.call(log, { subsystem: "api", event: "api_response_schema_shadow_hit", url: urlPath, status: status, violation_count: violations.length });
        return { action: "pass", violations: violations };
      }
    }
    (log.error || console.error).call(log, {
      subsystem: "api",
      event: "api_response_schema_enforce_block",
      url: urlPath,
      method: String(method || "").toUpperCase(),
      status: status,
      violations: violations,
    });
    return { action: "block", violations: violations };
  };
}

module.exports = { createContractResponseProbe, contractRouteCount, matchRoute, pickValidator, toDotLocation };
