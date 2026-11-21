// Component: Individual-Routes（WP-208／SPEC-100 批 2）
// @responsible: 通用个体面五条公开端点——路径字面量逐条注册（contract-route-parity 静态扫描口径），
//   全部走统一执行工厂（executeAction→generic:* 执行器→个体 CRUD 引擎）。类来自路径参数：
//   新类零路由/零契约成本（本体类声明＋字段即用）。
// @inputs: 动作快照（individuals.* 五动作，类无关——compileUnboundActionsPlan 全局计划）
// @outputs: 五条注册（POST 创建/GET 清单/GET 读取/PUT 更新/POST 退役）
// @context: SPEC-100 §三 批 2；审计经执行工厂 decisions 流水；角色门走动作 required_roles。
"use strict";

const { executeAction } = require("../shared/action-execution-factory.cjs");
const { sendJSON } = require("../shared/api-envelope.cjs");

function register(registerRoute, deps = {}) {
  // 路径字面量逐条注册（contract-route-parity 静态扫描口径）——每条绑定对应动作
  registerRoute("POST", "/api/individuals/:classId", (req, res) => executeAction({ actionId: "individuals.create", executor: "generic:create", request: req, reply: res }), "individuals.create");
  registerRoute("GET", "/api/individuals/:classId", (req, res) => executeAction({ actionId: "individuals.list", executor: "generic:list", request: req, reply: res }), "individuals.list");
  registerRoute("GET", "/api/individuals/:classId/:individualId", (req, res) => executeAction({ actionId: "individuals.read", executor: "generic:read", request: req, reply: res }), "individuals.read");
  registerRoute("PUT", "/api/individuals/:classId/:individualId", (req, res) => executeAction({ actionId: "individuals.update", executor: "generic:update", request: req, reply: res }), "individuals.update");
  registerRoute("POST", "/api/individuals/:classId/:individualId/retire", (req, res) => executeAction({ actionId: "individuals.retire", executor: "generic:retire", request: req, reply: res }), "individuals.retire");
  // WP-210（SPEC-100 批 4·交付物②）：派生 UI 配置——服务端派生（字段名/中文 display/必填/类型），
  // 中文 display 走 fields.yaml v2 display 单源（未声明回退字段名并如实标注 declared:false）。
  registerRoute("GET", "/api/individuals/:classId/config", (req, res) => {
    try {
      const classId = String((req.params && req.params.classId) || "");
      if (!classId) throw Object.assign(new Error("classId 必填"), { code: "INVALID_CLASS_ID", status: 422 });
      if (typeof deps.uiConfigFor !== "function") throw Object.assign(new Error("uiConfigFor 端口未装配"), { code: "INDIVIDUAL_CONFIG_UNAVAILABLE", status: 503 });
      return sendJSON(res, 200, { success: true, data: deps.uiConfigFor(classId) });
    } catch (error) {
      const status = error.status || 500;
      return sendJSON(res, status, { success: false, error: error.message, error_code: error.code || "INTERNAL_ERROR" });
    }
  });
}

module.exports = { register };
