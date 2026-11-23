// Component: Individual-Executors（WP-208／SPEC-100 批 2）
// @responsible: generic:* 五执行器——一份代码服务所有类（类无关动作＋classId 路径参数；
//   字段校验按该类绑定 fail-closed）。本体声明这五个动作（类无关，不随类增减）＋契约条目即全量接线；
//   批 1 pendingRoutes 机制自动转安装（执行器在册即装）。
// @context: 经执行工厂全链路（前置/风险/审计 decisions 流水）——个体写即审计。
//   WP-228（SPEC-101 §3.4-1）：writeGuard 可选注入——个体通道只对 storage.kind=
//   markdown-individual 且非 system_projection、非定制渲染的种类放行；目录缺位＝拒绝
//   （fail-closed）。main 装配恒传（三源现编译，写后即变）；既有 CRUD 测试族不传＝维持原行为，
//   守卫语义由 individual-write-guard.test.cjs 钉住。read/list 只读不拦。
"use strict";

const { createError: guardError } = require("./error-factory.cjs");

function registerIndividualExecutors({ service, registerActionExecutor, uiConfigFor, writeGuard }) {
  if (typeof registerActionExecutor !== "function") throw new TypeError("[individual-executors] 需要 registerActionExecutor");
  const guarded = (classId) => {
    if (typeof writeGuard !== "function") return;
    const verdict = writeGuard(classId) || {};
    if (!verdict.allowed) {
      throw guardError("INDIVIDUAL_CHANNEL_FORBIDDEN",
        `类 ${classId} 不经通用个体通道（统一类型契约：${verdict.reason || "TYPE_NOT_IN_CATALOG"}）`, 422,
        { class_id: classId, reason: verdict.reason || "TYPE_NOT_IN_CATALOG" });
    }
  };
  registerActionExecutor("generic:create", (ctx) => {
    const classId = ctx.request?.params?.classId;
    guarded(classId);
    return service.create({ classId, fields: (ctx.body && ctx.body.fields) || {} });
  });
  registerActionExecutor("generic:read", (ctx) =>
    service.read(ctx.request?.params?.classId, ctx.request?.params?.individualId));
  registerActionExecutor("generic:update", (ctx) => {
    const classId = ctx.request?.params?.classId;
    guarded(classId);
    return service.update({
      classId,
      individualId: ctx.request?.params?.individualId,
      fields: (ctx.body && ctx.body.fields) || {},
      expectedRevision: ctx.body && ctx.body.expectedRevision,
    });
  });
  registerActionExecutor("generic:retire", (ctx) => {
    const classId = ctx.request?.params?.classId;
    guarded(classId);
    return service.retire({
      classId,
      individualId: ctx.request?.params?.individualId,
      expectedRevision: ctx.body && ctx.body.expectedRevision,
    });
  });
  registerActionExecutor("generic:list", (ctx) =>
    service.list(ctx.request?.params?.classId));
  // WP-213（红队 M1①）：config 端点动作化——原普通 handler 改动作绑定（action-coverage 覆盖）。
  // uiConfigFor 可选：提供才注册（main 装配恒传；CRUD 测试族不传则 generic:config 缺席——
  // 动作若被声明而执行器缺席，装配层 pendingRoutes 显式可见，不假绿）。
  if (typeof uiConfigFor === "function") {
    registerActionExecutor("generic:config", (ctx) => {
      const classId = ctx.request?.params?.classId;
      guarded(classId);
      return uiConfigFor(classId);
    });
  }
}

module.exports = { registerIndividualExecutors };
