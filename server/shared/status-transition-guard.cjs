// Component: Status-Transition-Guard
// @responsible: status 字段审批状态机迁移校验（2026-10-08 字段托管功能）——四值域+迁移表单源=契约 statusMachine 段。
// @inputs: 当前 status、目标 status、事件（confirm-verified / reject / reopen）
// @outputs: 合法迁移通过；非法迁移抛 STATUS_TRANSITION_FORBIDDEN（写路径拒绝落盘）
// @context: entity-repair-service 写路径 + 问题状态机事件驱动（confirm→verified 置在线 / reject 置退役 / reopen 回灰度）
//
// 设计（指令 16:03）：
// - 迁移表：创建→灰度；灰度→在线（审批通过 ∧ error=0）；灰度→退役（驳回）；退役→灰度（重提）；在线→退役（人工下线保留）
// - 「已驳回」独立值：由 reject 决策产生（灰度→已驳回→重提灰度 亦合法路径，见 transitions）
// - 服务端写路径校验非法迁移拒绝落盘；迁移由既有问题处理状态机事件驱动，不新增审批界面与端点

const { createError } = require("./error-factory.cjs");

// 四值/迁移单源＝contracts/entity-readiness-rules.json.statusMachine（状态机语义宿主）；
// TheSchema lifecycle.status 为词表声明面。两侧对账由 status-domain-ssot.test.cjs 钉住（WP-049
// 余量批收敛 P6 状态族值表）。下方内置缺省仅契约文件缺失时的护栏（不再视为独立副本）。
let STATUS_MACHINE = { values: ["灰度", "在线", "退役", "已驳回"], default: "灰度", transitions: {} };
try { STATUS_MACHINE = require("../../contracts/entity-readiness-rules.json").statusMachine || STATUS_MACHINE; } catch (_e) { /* 契约缺失回退内置缺省（护栏，对账钉在测试） */ }

// 事件 → 目标状态（问题状态机事件驱动的映射）
const EVENT_TARGETS = {
  "confirm-verified": "在线", // confirm 链路走完（账本 verified）
  reject: "退役",             // 审批驳回
  reopen: "灰度",             // 修复重新提交
  manualoffline: "退役",      // 在线→退役 人工下线路径
  rejected: "已驳回",         // 已驳回独立值（拆分自 reject 主轨）
};

function isValidTransition(from, to) {
  if (from === to) return true; // 幂等（同值写入非迁移）
  const allowed = (STATUS_MACHINE.transitions || {})[from] || [];
  return allowed.includes(to);
}

/**
 * 迁移守卫：由事件驱动（问题状态机 confirm/reject/reopen）或显式目标值。
 * @param {object} input
 * @param {string} input.from 当前 frontmatter status（可能为空=缺失）
 * @param {string} [input.to] 显式目标（服务端注入路径用）
 * @param {string} [input.event] 驱动事件（confirm-verified/reject/reopen/manualoffline/rejected）
 * @returns {string} 合法目标值（守卫通过）
 * @throws STATUS_TRANSITION_FORBIDDEN（409）非法迁移
 */
function assertTransition({ from, to, event }) {
  const values = STATUS_MACHINE.values || [];
  const fromValue = (typeof from === "string" && from.trim()) || STATUS_MACHINE.default; // 缺失=灰度（对账语义）
  if (to === undefined && event) to = EVENT_TARGETS[event];
  if (to === undefined || to === null) return fromValue; // 无目标=保持现值（编辑场景）
  if (!values.includes(to)) {
    throw createError("VALIDATION_ERROR", "status 目标值不在受控四值域: " + to, 400, { field: "status", allowedValues: values });
  }
  if (!isValidTransition(fromValue, to)) {
    const allowed = (STATUS_MACHINE.transitions || {})[fromValue] || [];
    throw createError("STATE_TRANSITION_FORBIDDEN", "status 非法迁移: " + fromValue + " → " + to + "（须走审批状态机；允许: " + (allowed.join("、") || "无") + "）", 409, { from: fromValue, to, allowed, hint: "灰度→在线 须审批通过（confirm 链路 verified）且合规 error=0" });
  }
  return to;
}

module.exports = { assertTransition, isValidTransition, STATUS_MACHINE, EVENT_TARGETS };
