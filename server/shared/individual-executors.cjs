// Component: Individual-Executors（WP-208／SPEC-100 批 2）
// @responsible: generic:* 五执行器——一份代码服务所有类（类无关动作＋classId 路径参数；
//   字段校验按该类绑定 fail-closed）。本体声明这五个动作（类无关，不随类增减）＋契约条目即全量接线；
//   批 1 pendingRoutes 机制自动转安装（执行器在册即装）。
// @context: 经执行工厂全链路（前置/风险/审计 decisions 流水）——个体写即审计。
"use strict";

function registerIndividualExecutors({ service, registerActionExecutor, uiConfigFor }) {
  if (typeof registerActionExecutor !== "function") throw new TypeError("[individual-executors] 需要 registerActionExecutor");
  registerActionExecutor("generic:create", (ctx) =>
    service.create({ classId: ctx.request?.params?.classId, fields: (ctx.body && ctx.body.fields) || {} }));
  registerActionExecutor("generic:read", (ctx) =>
    service.read(ctx.request?.params?.classId, ctx.request?.params?.individualId));
  registerActionExecutor("generic:update", (ctx) =>
    service.update({
      classId: ctx.request?.params?.classId,
      individualId: ctx.request?.params?.individualId,
      fields: (ctx.body && ctx.body.fields) || {},
      expectedRevision: ctx.body && ctx.body.expectedRevision,
    }));
  registerActionExecutor("generic:retire", (ctx) =>
    service.retire({
      classId: ctx.request?.params?.classId,
      individualId: ctx.request?.params?.individualId,
      expectedRevision: ctx.body && ctx.body.expectedRevision,
    }));
  registerActionExecutor("generic:list", (ctx) =>
    service.list(ctx.request?.params?.classId));
  // WP-213（红队 M1①）：config 端点动作化——原普通 handler 改动作绑定（action-coverage 覆盖）。
  // uiConfigFor 可选：提供才注册（main 装配恒传；CRUD 测试族不传则 generic:config 缺席——
  // 动作若被声明而执行器缺席，装配层 pendingRoutes 显式可见，不假绿）。
  if (typeof uiConfigFor === "function") {
    registerActionExecutor("generic:config", (ctx) =>
      uiConfigFor(ctx.request?.params?.classId));
  }
}

module.exports = { registerIndividualExecutors };
