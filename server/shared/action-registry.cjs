// Component: Action-Registry（WP-048 Wave 1 · ADR-014 §6.1）
// @responsible: action_types/risk_types 只读快照单一来源——route-roles 投影与执行工厂动作查找
//               必须读到同一 active revision（同本模块同缓存实例保证）；快照构建时完成 OpenAPI
//               对账（动作路由必须是在册契约操作）与静态 ROUTE_ROLES 互斥对账（同一端点不得
//               同时维护两份角色声明）。构建失败：首次（boot）即抛=fail-closed；重建失败保留
//               旧快照并显式报错（新 revision 不激活）。
// @inputs: ontology.yaml（经 readOntology 通用咽喉——形态收口语义与 Wave 0 一致；红队发现②：其局部
//          降级对带点号 ID 失效〔存量缺口〕，动作定义的形状防线由快照构建期自查承载，见 buildSnapshot）
// @outputs: initActionRegistry({ vaultPath, logger }) / getActiveActionSnapshot() /
//           actionRouteRoleFor(method, template) / resetActionRegistry()（测试）
// @context: WP-048 SPEC-043 C4；ADR-014 §3.1（缺省 approved、仅 approved 活消费）。
//   快照按 ontology.yaml 内容 revision 缓存：getActiveActionSnapshot() 每次现读文件比对 revision，
//   变更即重建——写端点低频，接受每次写请求一次 YAML 读解析的成本（GET 路由同款成本先例）。
const { readOntology } = require("./../services/schema-manager/ontology-write-service.cjs");
const contractRequest = require("./contract-request-schema.cjs");
const { displayTheSchemaPath } = require("./theschema-root.cjs");
// 注意：route-roles 反向消费本模块（requiredRolesFor 查快照）——静态表经函数内惰性 require
// 取用，避免 CommonJS 循环加载拿到半成品导出。

let state = null; // { vaultPath, logger, snapshot }

function canonicalRouteKey(httpRoute) {
  // 契约模板形如 "PUT /api/schema/ontology"；参数段在契约侧收敛为 {x}（route-roles 同口径）
  const key = String(httpRoute || "").trim();
  const spaceAt = key.indexOf(" ");
  if (spaceAt <= 0) return null;
  const method = key.slice(0, spaceAt).toUpperCase();
  if (!/^(GET|POST|PUT|PATCH|DELETE)$/.test(method)) return null;
  const template = contractRequest.normalizeTemplate(key.slice(spaceAt + 1));
  return template && template !== "/" ? `${method} ${template}` : null;
}

function contractOperationKeys() {
  const ops = new Map();
  for (const op of contractRequest.listContractOperations()) {
    ops.set(`${op.method} ${op.template}`, op);
    // 原始路径（含命名参数 {issueId}）也接受——归一到模板键
    if (op.path && op.path !== op.template) {
      const alt = canonicalRouteKey(`${op.method} ${op.path}`);
      if (alt && !ops.has(alt)) ops.set(alt, op);
    }
  }
  return ops;
}

function buildSnapshot(vaultPath, logger) {
  const ontology = readOntology(vaultPath); // 抛错＝构建失败（首次即 boot 红）
  const data = ontology.data || {};
  const actions = new Map();
  const risks = new Map();
  const routeAction = new Map();
  const routeRoles = new Map();
  const errors = [];

  // 红队发现②（WP-049 L3 收紧）：动作/风险面的脏定义在装载点（theschema-loader）降级丢弃——
  // 静默少一个动作＝静默改鉴权面，必须构建失败。此前该保障仅对含点 ID 生效（dropNode 缺口使
  // 其幸存装载、漏到本层自检）；缺口修复后改为对账降级收据——schema 覆盖与未覆盖的形状错误
  // 一律响亮失败，强于原保障。
  for (const node of ontology.degradedNodes || []) {
    const head = (node.pathParts && node.pathParts[0]) || String(node.path || "").split(".")[0];
    if (head === "action_types" || head === "risk_types") {
      const detail = (node.errors && node.errors[0]) ? `：${node.errors[0]}` : "";
      errors.push(`本体装载降级：${node.path}（动作/风险面脏定义不静默回落——红队发现②）${detail}`);
    }
  }

  for (const [id, def] of Object.entries(data.risk_types || {})) {
    // ADR-014 §3.1：lifecycle_status 缺省＝approved；非现役剔除（不进活消费面）
    const riskDef = def || {};
    const status = riskDef.lifecycle_status === undefined ? "approved" : riskDef.lifecycle_status;
    if (status !== "approved") continue;
    risks.set(id, riskDef);
  }
  // ADR-014 §3.1：lifecycle_status 缺省＝approved
  for (const [id, rawDef] of Object.entries(data.action_types || {})) {
    const def = rawDef || {};
    const status = def.lifecycle_status === undefined ? "approved" : def.lifecycle_status;
    if (status !== "approved") continue;
    actions.set(id, def);
    if (def.http_route !== undefined) {
      const key = canonicalRouteKey(def.http_route);
      if (!key) { errors.push(`动作 ${id} 的 http_route 不是合法 "METHOD /path" 形式: ${JSON.stringify(def.http_route)}`); continue; }
      if (routeAction.has(key)) { errors.push(`路由 ${key} 挂了两个动作（${routeAction.get(key)} 与 ${id}）——同路由双动作拒绝`); continue; } // 红队发现④
      routeAction.set(key, id);
      // 红队发现②（W1-B 复核）：TheSchema 局部降级对带点号 ID 失效（degradedNodePaths/dropNode
      // 按点切分，存量缺口）——动作防线由本快照构建期自查承载：required_roles/payload_role_overrides/
      // success_status 形状非法即构建失败（fail-closed），不静默回落空角色。
      if (def.required_roles !== undefined && !Array.isArray(def.required_roles)) {
        errors.push(`动作 ${id} 的 required_roles 必须是字符串数组: ${JSON.stringify(def.required_roles)}`);
        continue;
      }
      if (def.required_roles && def.required_roles.some((role) => typeof role !== "string")) {
        errors.push(`动作 ${id} 的 required_roles 含非字符串角色`);
        continue;
      }
      const overridesRaw = def.payload_role_overrides;
      if (overridesRaw !== undefined && !Array.isArray(overridesRaw)) {
        errors.push(`动作 ${id} 的 payload_role_overrides 必须是数组`);
        continue;
      }
      const overrides = [];
      for (const rule of overridesRaw || []) {
        if (!rule || typeof rule !== "object" || typeof rule.body_field !== "string" || !rule.body_field
            || !Array.isArray(rule.roles) || rule.roles.some((role) => typeof role !== "string")) {
          errors.push(`动作 ${id} 的 payload_role_overrides 条目形状非法（body_field/equals/roles）: ${JSON.stringify(rule)}`);
          continue;
        }
        overrides.push({ bodyField: rule.body_field, equals: rule.equals, roles: [...rule.roles] });
      }
      if (def.success_status !== undefined && (!Number.isInteger(def.success_status) || def.success_status < 200 || def.success_status > 299)) {
        errors.push(`动作 ${id} 的 success_status 必须是 200-299 整数: ${JSON.stringify(def.success_status)}`);
        continue;
      }
      routeRoles.set(key, {
        roles: Array.isArray(def.required_roles) ? [...def.required_roles] : [],
        overrides,
      });
    }
  }

  // OpenAPI 对账：动作路由必须是在册契约操作（写错路径/契约漂移即构建失败）
  const ops = contractOperationKeys();
  for (const key of routeAction.keys()) {
    if (!ops.has(key)) errors.push(`动作路由 ${key} 不在契约操作表（http-api.openapi.json）`);
  }

  // 互斥对账：同一端点不得同时挂在快照与静态 ROUTE_ROLES（ADR-014 §6.1 单源约束）
  const { listRouteRoleBindings } = require("./auth/route-roles.cjs");
  const staticKeys = listRouteRoleBindings();
  for (const key of routeRoles.keys()) {
    if (staticKeys[key]) errors.push(`路由 ${key} 同时存在于 action_types 快照与静态 ROUTE_ROLES（两份角色声明）`);
  }

  if (errors.length) {
    const failure = new Error(`[action-registry] 快照构建失败：\n  - ${errors.join("\n  - ")}`);
    if (logger) logger.error({ event: "action-registry-snapshot-invalid", errors });
    throw failure;
  }

  return {
    revision: ontology.revision,
    sourcePath: displayTheSchemaPath(vaultPath, "ontology.yaml"),
    actions,
    risks,
    routeAction,
    routeRoles,
    builtAt: new Date().toISOString(),
  };
}

function initActionRegistry({ vaultPath, logger } = {}) {
  if (!vaultPath) throw new TypeError("[action-registry] initActionRegistry 需要 vaultPath");
  // 首次构建失败＝boot fail-closed（仓内基线必然合法；活库改坏本体属现场事故，大声失败）
  const snapshot = buildSnapshot(vaultPath, logger);
  state = { vaultPath, logger, snapshot };
  return snapshot;
}

function getActiveActionSnapshot() {
  if (!state) return null;
  try {
    const current = readOntology(state.vaultPath);
    if (current.revision === state.snapshot.revision) return state.snapshot;
    const next = buildSnapshot(state.vaultPath, state.logger);
    state.snapshot = next;
    return next;
  } catch (error) {
    // 重建失败：保留旧快照（新 revision 不激活），显式报错——ADR-014 §6.1
    if (state.logger) state.logger.error({ event: "action-registry-rebuild-failed", error: error.message });
    return state.snapshot;
  }
}

/** preHandler 角色门查询口（route-roles 消费）——与工厂动作查找同一快照实例。
 *  W1-B 起 body 参与解析（载荷敏感升级首条匹配生效）；未初始化或未挂路由返回 null。 */
function actionRouteRoleFor(method, template, body) {
  const snapshot = getActiveActionSnapshot();
  if (!snapshot) return null;
  const key = `${String(method || "").toUpperCase()} ${contractRequest.normalizeTemplate(String(template || ""))}`;
  const binding = snapshot.routeRoles.get(key);
  if (!binding) return null;
  for (const override of binding.overrides || []) {
    if (body && override.bodyField in body && body[override.bodyField] === override.equals) {
      return [...override.roles];
    }
  }
  return [...binding.roles];
}

function resetActionRegistry() {
  state = null;
}

module.exports = { initActionRegistry, getActiveActionSnapshot, actionRouteRoleFor, resetActionRegistry, canonicalRouteKey };
