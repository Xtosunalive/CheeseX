// entity-compliance 页级文案单源（WP-152 散写销账第四批·收官批）——ADR-019 §二 展示面介质唯一出口（页级 copy 模块）。
// 本特性（实体合规检查页：统计卡/工具栏/结果卡片/检查行＋修复抽屉/关系修复面板＋store/api 层兜底）的
// 用户可见文案只在本文件声明：按消费组件分段导出 const 对象，插值句用函数（学 review-copy 先例）。
// 同值不同页的事实走更低一层的单源，不在此重抄：回落名（未命名架构组件/相关属性）住 term-const；
// 修复预览/写回失败兜底住 lib-copy（entity-repair-api 同句）；字段占位示例住 components-copy（修复字段母版同句）。
// 禁在其他 entity-compliance 文件内联同值中文（lint CJK 字面量族执法，本文件经闭集豁免块豁免）；
// 改文案只改这里。闭集清单登记：eslint.config.js 尾部闭集豁免块＋src/test/copy-vocabulary-closed-set.test.ts
// CLOSED_SET_FILES 投影＋SPEC-091 §2.1（ADR-019 §三.4 闭集仪式）。
// 位置纪律：本目录处于 seq208 值所有权块内——闭集豁免块须在其后（eslint.config.js 已满足，同 property-gov-copy）。

import { TERM } from "@/constants/term-const";

// ── 多组件共用（同一事实只一份）──
export const ENTITY_COMPLIANCE_COPY = {
  /** 检查通过（统计卡 label／工具栏筛选项／抽屉通过点 title） */
  PASSED: "检查通过",
  /** 缺失实体的补建入口（卡片动作钮／抽屉标题前缀） */
  CREATE_AND_COMPLETE: "创建并补齐",
  /** 关系修复区段标题（抽屉引导卡展开钮／关系面板标题） */
  RELATION_REPAIR_TITLE: "修复文档关系（可选）",
} as const;

// ── api 层请求兜底（env.error 缺省时的 fallback）──
export const EC_REQUEST_COPY = {
  CHECK_FAILED: "源文档校验失败",
  CHECK_ONE_FAILED: "源文档实时刷新失败",
} as const;

// ── entity-compliance-store（刷新播报＋失败兜底）──
export const EC_STORE_COPY = {
  CURRENT_DOC_FALLBACK: "当前文档",
  RECHECK_FAILED: "重新检查失败",
  REFRESH_STALE_HINT: "实时刷新失败，显示的是上次检查结果，可点「重新检查源文档」重试",
  REVISION_MISSING: "源文件版本信息缺失，请刷新后重试",
} as const;

/** aria-live 播报：选中文档阻断数变化 */
export function ecSelectedBlockerDelta(name: string, before: number, after: number): string {
  return `${name}：阻断 ${before} → ${after}`;
}
/** aria-live 播报：源文档阻断数变化 */
export function ecSourceBlockerDelta(before: number, after: number): string {
  return `源文档阻断 ${before} → ${after}`;
}
/** aria-live 播报：无变化 */
export function ecNoChangeSummary(after: number): string {
  return `检查结果无变化，当前 ${after} 项阻断`;
}

// ── EntityComplianceView（页面入口：创建流合成＋空态）──
export const EC_VIEW_COPY = {
  /** 本地合成的缺失实体检查组标题 */
  MISSING_TEMPLATE_GROUP: "缺失实体模板",
  NOT_FILLED_MESSAGE: "尚未填写",
  /** 创建流 URL 未带 title 时的默认名 */
  NEW_ENTITY_TITLE: "新实体",
  EMPTY_NO_MATCH: "未发现匹配的源文档检查结果",
} as const;

// ── SummaryBar（统计主视觉）──
export const EC_SUMMARY_COPY = {
  PASS_RATE_LABEL: "检查通过率",
  PASS_RATE_HINT: "受检源文档中无阻断且无警告的比例",
  PASSED_HINT: "无阻断无警告的源文档数",
  BLOCKER_LABEL: "存在阻断",
  BLOCKER_HINT: "存在阻断级问题的源文档数",
  WARNING_LABEL: "存在警告",
  WARNING_HINT: "存在警告级问题的源文档数",
  INFO_LABEL: "仅有提示",
  INFO_HINT: "仅提示级信息的源文档数",
  AVG_SCORE_LABEL: "平均质量分",
  AVG_SCORE_HINT: "全部受检源文档的平均质量分",
} as const;

export function ecPassRateSub(healthy: number, total: number): string {
  return `${healthy}/${total} 通过`;
}

// ── EntityComplianceToolbar（搜索/结论筛选/重新检查）──
export const EC_TOOLBAR_COPY = {
  FILTER_ALL: "全部",
  SEARCH_ARIA: "搜索源文档检查结果",
  SEARCH_PLACEHOLDER: "搜索标题、架构组件名称或文件名",
  FILTER_ARIA: "筛选源文档检查结论",
  FILTER_TITLE: "按检查结论筛选",
  FILTER_SEARCH_PLACEHOLDER: "筛选严重程度",
  /** 触发器空态与占位同值 */
  FILTER_TRIGGER: "检查结论",
  OPTION_GROUP_SCOPE: "范围",
  OPTION_GROUP_SEVERITY: "严重程度",
  REFRESH_TITLE: "重新读取源文档并更新当前检查结果",
  REFRESH_ARIA: "重新检查源文档",
  REFRESHING: "检查中",
  REFRESH: "重新检查",
  CLEAR_FILTER_ARIA: "清除源文档检查筛选",
} as const;

// ── EntityComplianceCard（结果卡片）──
export const EC_CARD_COPY = {
  COPY_DIAGNOSIS_TITLE: "复制检查结果",
  ALT_FIX_TITLE: "不想重建实体？去待处理问题页改文章的 module 引用",
  ALT_FIX_ACTION: "改文章引用",
  OPEN_IN_OBSIDIAN: "在 Obsidian 中打开",
} as const;

/** 剪贴板诊断书质量分行 */
export function ecDiagnosisScoreLine(score: number): string {
  return `- 质量分：${score}%`;
}
export function ecCompleteFieldsAction(count: number): string {
  return `补齐字段 ${count}`;
}
export function ecRepairFieldsAction(count: number): string {
  return `修复 ${count} 字段`;
}
export function ecOpenInObsidianAria(name: string): string {
  return `${EC_CARD_COPY.OPEN_IN_OBSIDIAN} ${name}`;
}

// ── PropertyCheckRow（检查行）──
export const EC_CHECK_ROW_COPY = {
  UNGRADED: "未分级",
} as const;

// ── EntityRepairDrawer（修复抽屉）──
export const EC_REPAIR_DRAWER_COPY = {
  /** 池行式当前值摘要 */
  VALUE_EMPTY: "未填写",
  VALUE_JSON_FILLED: "已填写",
  /** 底部操作条 */
  CLEAR_ALL: "清除全部",
  GENERATE_SKELETON: "生成空字段",
  PREVIEWING: "生成中…",
  PREVIEW: "查看修复结果",
  APPLYING: "写回中…",
  APPLY: "直接写回",
  /** 抽屉标题前缀（非创建流） */
  REPAIR: "修复",
  /** 行内状态 */
  STATUS_FAILED: "未通过",
  SYSTEM_MANAGED: "系统托管",
  IMMUTABLE_LOCKED: "创建后不可修改",
  ADOPT_SUGGESTION_PREFIX: "采用系统建议：",
  /** 关系修复引导卡 */
  RELATION_FORM_COLLAPSE: "收起关系表单",
  /** 预览区与失败区 */
  PREVIEW_HEADING: "修复预览",
  PREVIEW_NOT_GENERATED: "修复预览未生成",
  PREVIEW_ERROR_HINT: "按上方阻断明细处理后再试；若提示枚举表未配置，需先在 Vault 的 enums.yaml 补录对应枚举段。",
  APPLIED: "已直接写回正式源。",
} as const;

export function ecRepairFieldCount(count: number): string {
  return `可修复字段 ${count} 个 · 点行编辑`;
}
/** 字段行 aria：托管/锁定态追加只读说明 */
export function ecRepairFieldRowAria(label: string, valueText: string, lock: "system" | "immutable" | null): string {
  const suffix = lock === "system" ? "（系统托管，只读）" : lock === "immutable" ? "（创建后不可修改，只读）" : "";
  return `${label}，当前值 ${valueText}${suffix}`;
}
/** 枚举表为空的枚举字段：指明配置出口（页面＝TERM.SCHEMA，页签名由调用方给） */
export function ecEnumStarvedHint(tabName: string): string {
  return `此项的可选值尚未在「${TERM.SCHEMA} · ${tabName}」中维护，前往补齐后此处自动恢复为可选项。`;
}
export function ecRepairBlockerHeading(count: number): string {
  return `阻断明细（${count}）`;
}
export function ecPreviewValidity(time: string, blockerCount: number, warningCount: number): string {
  return `预览有效期至 ${time} · 合并后 ${blockerCount} 个阻断问题 / ${warningCount} 个警告问题`;
}

// ── RelationRepairPanel（关系修复小表单）──
export const EC_RELATION_REPAIR_COPY = {
  OP_ADD: "新增关系",
  OP_REPLACE: "替换现有关系",
  OP_REMOVE: "删除现有关系",
  OP_GROUP_HANDLE: "处理方式",
  OP_GROUP_RISK: "高风险操作",
  DIR_OUTGOING: "当前组件指向目标",
  DIR_INCOMING: "目标组件指向当前",
  DIR_GROUP: "关系方向",
  /** 关系含义（选项分组／字段标签／aria 同值） */
  RELATION_MEANING: "关系含义",
  CURRENT_COMPONENT: "当前组件",
  /** 目标组件（缺省名／字段标签同值） */
  TARGET_COMPONENT: "目标组件",
  SECTION_ARIA: "文档关系修复",
  LABEL_OPERATION: "如何处理",
  OPERATION_ARIA: "关系处理方式",
  OPERATION_TITLE: "选择如何处理关系",
  RELATION_TITLE: "选择组件之间的关系",
  LABEL_DIRECTION: "谁指向谁",
  DIRECTION_TITLE: "选择关系方向",
  TARGET_ARIA: "关系目标组件",
  TARGET_TITLE: "选择目标组件",
  TARGET_SEARCH_PLACEHOLDER: "搜索组件名称",
  TARGET_PLACEHOLDER: "请选择组件",
  TARGET_EMPTY: "当前列表没有其他组件",
  SINCE_LABEL: "生效起始版本 (since)",
  SINCE_PLACEHOLDER: "所有历史版本",
  UNTIL_LABEL: "生效终止版本 (until)",
  UNTIL_PLACEHOLDER: "持续有效",
  FOOTER_HINT: "选择完成后会自动加入本次修复；点击下方\"查看修复结果\"可检查实际写入内容，确认前不会修改源文档。",
} as const;
