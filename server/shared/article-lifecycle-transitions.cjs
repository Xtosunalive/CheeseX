// Component: Article-Lifecycle-Transitions
// @responsible: 文章生命周期"该走到哪"唯一决定面（WP-069 S4／SPEC-069 §3.4）。
//   WP-066 收敛了"能不能走"（transitions 边表＋assertTransitionState 状态守卫）；本模块收敛
//   残留的另一半——"下一态是什么/边起点是什么/落到哪个目录"此前散落各服务（守卫字面量＋
//   目录函数直调即隐式决定）。决定是纯函数（OpenMAIC plan.ts advanceRun 形态：决定与提交分离），
//   单源＝contracts/article-lifecycle.json transitions 边表；服务只问不判。
// @inputs: contracts/article-lifecycle.json（transitions 边表＋roles 角色行）
// @outputs: nextState(state, action)／requiredFrom(action)／dirFor(state, vaultPath, lane?)／ACTIONS
// @context: Canvas
"use strict";

const CONTRACT = require("../../contracts/article-lifecycle.json");
const lifecyclePaths = require("./article-lifecycle-paths.cjs");

const EDGES = CONTRACT.transitions || [];
const ROLES = new Set((CONTRACT.roles || []).map((r) => r.id || r.role || r.name));

// 契约完整性：边两端必须是已登记角色（装载期断言——表打错在首次 require 即炸，不等到第一次转移）
for (const edge of EDGES) {
  if (!ROLES.has(edge.from)) throw new TypeError(`article-lifecycle transitions 边起点未登记：${edge.from}（${edge.action}）`);
  if (!ROLES.has(edge.to)) throw new TypeError(`article-lifecycle transitions 边终点未登记：${edge.to}（${edge.action}）`);
}

const EDGE_BY_KEY = new Map(EDGES.map((edge) => [`${edge.from}::${edge.action}`, edge]));
// requiredFrom 单起点前提的装载期断言（红队 2026-11-02）：同动作出现第二起点即炸，不让"首起点"静默
// 误报合法第二起点为 409——契约生长到多起点时须同步把 requiredFrom 泛化为集合语义
{
  const starts = new Map();
  for (const edge of EDGES) {
    if (starts.has(edge.action) && starts.get(edge.action) !== edge.from) {
      throw new TypeError(`article-lifecycle transitions 动作 ${edge.action} 多起点（${starts.get(edge.action)}/${edge.from}）——requiredFrom 单起点语义失效，须先泛化`);
    }
    starts.set(edge.action, edge.from);
  }
}
const ACTIONS = Object.freeze([...new Set(EDGES.map((edge) => edge.action))]);

/**
 * 状态×动作 → 下一状态（唯一决定面）。
 * @param {string} state 当前状态 id（article-lifecycle roles）
 * @param {string} action 转移动作（promote/publish/archive/retire…随边表生长）
 * @returns {string|null} 下一状态 id；无此边＝null（调用方按未知转移拒绝，不得自判目标态）
 */
function nextState(state, action) {
  const edge = EDGE_BY_KEY.get(`${state}::${action}`);
  return edge ? edge.to : null;
}

/**
 * 动作 → 合法边起点（守卫面单源——assertTransitionState 的 expected 不再由调用方写字面量）。
 * 单起点语义由装载期断言保证（多起点边入表即 TypeError），不存在"静默取首"路径。
 * @returns {string|null}
 */
function requiredFrom(action) {
  const edge = EDGES.find((e) => e.action === action);
  return edge ? edge.from : null;
}

/**
 * 状态 → 该角色的落位目录（决定函数的落地伴生面——服务不再按角色猜目录函数）。
 * @param {string} state 角色 id
 * @param {string} vaultPath
 * @param {string} [lane] source-archive 分道（archiveDir 可选 lane）
 */
function dirFor(state, vaultPath, lane) {
  switch (state) {
    case "draft": return lifecyclePaths.draftsDir(vaultPath);
    case "standard-working": return lifecyclePaths.workingDir(vaultPath);
    case "standard-formal": return lifecyclePaths.formalArticlesDir(vaultPath);
    case "source-archive": return lifecyclePaths.archiveDir(vaultPath, lane);
    default: throw new TypeError(`ARTICLE_LIFECYCLE_ROLE_UNMAPPED: 角色 ${state} 无落位目录映射——扩展本函数并同步契约 roles`);
  }
}

module.exports = { nextState, requiredFrom, dirFor, ACTIONS, EDGES };
