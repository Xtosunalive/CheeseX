// approval-workbench 页级文案单源（WP-151 散写销账第三批）——ADR-019 §二 展示面介质唯一出口（页级 copy 模块）。
// 本特性（ApprovalWorkbench 审批工作区＋approval-api 请求层）的用户可见文案只在本文件声明：
// 按消费组件分段导出 const 对象，插值句用函数（学 review-copy 先例）。
// 禁在其他 approval-workbench 文件内联同值中文（lint CJK 字面量族执法，本文件经闭集豁免块豁免）；
// 改文案只改这里。闭集清单登记：eslint.config.js 尾部闭集豁免块＋src/test/copy-vocabulary-closed-set.test.ts
// CLOSED_SET_FILES 投影＋SPEC-091 §2.1（ADR-019 §三.4 闭集仪式）。

import { TERM } from "@/constants/term-const";

// ── api 层请求兜底错误（env.error 缺省时的 fallback）──
export const APPROVAL_REQUEST_COPY = {
  /** approval-api request 包装（状态读取／状态迁移／候选列表共用） */
  REQUEST_FAILED: "审批状态机请求失败",
} as const;

// ── ApprovalWorkbench（审批工作区）──
export const APPROVAL_WORKBENCH_COPY = {
  /** 状态机步骤指示器（下标与 activeWorkflowStep 对齐，勿重排） */
  WORKFLOW_STEPS: ["送审", "审批", "发布", "已发布"] as const,
  STEPS_ARIA: "审批流程",
  /** 面板 aria 与面板标题同值（同一事实只一份） */
  WORKSPACE_LABEL: "审批工作区",
  STATUS_BADGE_PREFIX: "审批：",
  /** 操作失败兜底（error 非 Error 对象时） */
  LOAD_STATUS_FAILED: "加载状态失败",
  OPERATE_FAILED: "操作失败",
  STANDARDIZE_FAILED: "标准化失败",
  RESUBMIT_FAILED: "重新提交失败",
  /** ROLE_DENIED 角色说明尾句 */
  ROLE_DENIED_GUIDANCE: "请联系系统维护者核对账号角色配置；如需调整，由维护者处理，配置生效后再重试。",
  /** 候选文章选择 */
  SELECT_ARTICLE_LABEL: "选择投稿文章",
  SELECT_ARTICLE_ARIA: "选择审批文章",
  CANDIDATES_LOADING: `（${TERM.LOADING}）`,
  /** 当前文章信息 */
  ARTICLE_PREFIX: "文章：",
  STATUS_SUMMARY_PREFIX: "审批状态：",
  NOT_SUBMITTED: "尚未送审",
  LOADING_INFO: "正在读取审批与文章信息…",
  /** 源变化后的重新标准化恢复按钮 */
  RESTANDARDIZE_TITLE: "源文件在标准化之后发生了变化，旧审批绑定已失效；重新标准化后回到待审，再执行确认",
  RESTANDARDIZE_ACTION: "重新标准化（源已变化，刷新绑定）",
  /** 各状态操作按钮 */
  STANDARDIZE_ACTION: "标准化（进入待审）",
  CONFIRM_BLOCKED_TITLE: "源文件已变化，请先重新标准化刷新审批绑定",
  CONFIRM_ACTION: "确认（批准）",
  REJECT_ACTION: "驳回",
  REJECT_REASON_PLACEHOLDER: "驳回理由",
  PUBLISH_BLOCKED_TITLE: "内容已变化，请先重新标准化并重新审批",
  PUBLISH_ACTION: "发布（打包快照）",
  RESUBMIT_ACTION: "修改后重新提交",
  SNAPSHOT_DONE: "已发布为正式快照。",
  SELECT_PROMPT: "请选择一篇真实候选文章开始审批流程。",
  REFRESH: "刷新",
} as const;

/** ROLE_DENIED：本次服务端详情给出的所需角色 */
export function approvalRequiredRolesLine(required: string[]): string {
  return `所需角色：${required.join("、")}。`;
}

/** ROLE_DENIED：本次服务端详情给出的当前角色（空数组显示「无」） */
export function approvalCurrentRolesLine(have: string[]): string {
  return `当前角色：${have.length ? have.join("、") : "无"}。`;
}
