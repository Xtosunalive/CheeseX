// article-workflow 页级文案单源（WP-151 散写销账第三批）——ADR-019 §二 展示面介质唯一出口（页级 copy 模块）。
// 本特性（ArticleWorkflowView 文章准入页＋components 九组件＋api/store 层）的用户可见文案只在本文件声明：
// 按消费组件分段导出 const 对象，插值句用函数（学 review-copy 先例）；两组件共用的同一事实只一份
// （本地标准化 Skill 结果卡：PrecleanedTable 与 UploadHistoryPanel 共用 ARTICLE_SKILL_OUTCOME_COPY）。
// 禁在其他 article-workflow 文件内联同值中文（lint CJK 字面量族执法，本文件经闭集豁免块豁免）；
// 改文案只改这里。闭集清单登记：eslint.config.js 尾部闭集豁免块＋src/test/copy-vocabulary-closed-set.test.ts
// CLOSED_SET_FILES 投影＋SPEC-091 §2.1（ADR-019 §三.4 闭集仪式）。

import { TERM } from "@/constants/term-const";
// seq209：字段中文名从 shared/field-labels.mjs 派生（status 字段名「状态」——禁手写第二份，WP-150 review-copy 同款）
import { fieldLabel as sharedFieldLabel } from "../../../shared/field-labels.mjs";

// ── api／store 层请求兜底（env.error 缺省／非 Error 对象时的 fallback）──
export const ARTICLE_REQUEST_COPY = {
  /** api request 包装与 store 全部 catch 兜底共用（同一事实只一份） */
  REQUEST_FAILED: "文章传输请求失败",
  /** WP-022：409 修订冲突（WORKFLOW_REVISION_CONFLICT）后的操作提示 */
  REVISION_CONFLICT: "状态已被其他用户更新，已刷新最新状态——请重试",
} as const;

// ── 动作声明写入面（非展示文案——api 层动作登记元数据 writes 段的 vault 路径声明，随搬迁入闭集，
//    改值须与服务端实际写路径同步）──
export const ARTICLE_ACTION_WRITES = {
  /** ARTICLE_STANDARDIZATION_ACTION.writes */
  STANDARDIZATION: ["知识库/wiki/articles/{articleId}/{contentHash}.md", ".ledger/article-upload-tasks.json"],
  /** ARTICLE_STANDARDIZATION_SKILL_ACTION.writes */
  STANDARDIZATION_SKILL: ["知识库/raw/drafts/投稿/*.md（frontmatter 机械补齐与校验印记）", "知识库/raw/precleaned/", "知识库/raw/archive/"],
  /** ARTICLE_FIELD_COMPLETION_ACTION.writes */
  FIELD_COMPLETION: ["知识库/raw/precleaned/*.md（白名单四字段 frontmatter 行级补丁）"],
} as const;

// ── ArticleWorkflowView（投稿工作流规模统计卡）──
export const ARTICLE_WORKFLOW_VIEW_COPY = {
  AWAITING_ARCHITECT_LABEL: "待架构师处理",
  AWAITING_ARCHITECT_HINT: "已投稿、等待架构师处理的工作草稿",
  UPLOAD_TOTAL_LABEL: "全部上传任务",
  UPLOAD_TOTAL_HINT: "投稿记录总数（含各状态）",
} as const;

// ── ArticleAdmissionWorkspace（工作草稿工具行）──
export const ARTICLE_ADMISSION_COPY = {
  SEARCH_ARIA: `搜索${TERM.WORKING_DRAFT}`,
  SEARCH_PLACEHOLDER: "搜索标题、路径、产品或类型",
  /** 标准化校验状态筛选（aria 与搜索占位同值） */
  STATUS_FILTER_ARIA: `筛选${TERM.STANDARDIZATION_VALIDATION}状态`,
  STATUS_FILTER_TITLE: `按${TERM.STANDARDIZATION_VALIDATION}状态筛选`,
  STATUS_FILTER_EMPTY: "全部状态",
  STATUS_FILTER_PLACEHOLDER: "校验状态",
  /** 模块筛选（aria 与搜索占位同值） */
  MODULE_FILTER_ARIA: "筛选模块",
  MODULE_FILTER_TITLE: "按模块筛选",
  MODULE_FILTER_EMPTY: "全部模块",
  MODULE_FILTER_PLACEHOLDER: TERM.MODULE,
  MODULE_FILTER_GROUP: "文章模块",
  /** 筛选无命中 */
  EMPTY_NO_RESULT_TITLE: "没有结果",
  EMPTY_NO_RESULT_DESCRIPTION: "请调整搜索或筛选条件",
  PAGINATION_ARIA: `${TERM.WORKING_DRAFT}分页`,
} as const;

/** 工具行下方计数（筛选后 / 总数 篇工作草稿） */
export function articleDraftCountText(shown: number, total: number): string {
  return `${shown} / ${total} 篇${TERM.WORKING_DRAFT}`;
}

// ── ArticleApprovalDialog（审批与发布对话框；标题取 TERM.GRAPH_PUBLISH）──
export const ARTICLE_APPROVAL_DIALOG_COPY = {
  DESCRIPTION: "标准化校验与审批分别记录；此处处理送审、确认和发布。",
} as const;

// ── ArticlePreviewDialog（工作稿预览对话框）──
export const ARTICLE_PREVIEW_COPY = {
  RECEIPT_TITLE: "这是最近一次校验的审计收据（对哪版内容/哪版规则），不参与审批裁决——批准时的当前结论由审批现场计算给出（ADR-015 副本→收据）",
  /** 版本/提案前缀（尾随空格保留——JSX 原文同行空格） */
  RELEASE_PREFIX: "正式版本 ",
  PROPOSAL_PREFIX: "变更提案 ",
  CLOSE_ACTION: "关闭",
  STANDARDIZE_TITLE: "运行标准化校验；ERROR 阻断，WARNING 进入待处理问题",
  STANDARDIZING: "校验中",
  STANDARDIZE_ACTION: "标准化文章",
} as const;

/** 最近一次标准化校验收据时间行 */
export function articlePreviewReceiptText(validatedAtText: string): string {
  return `最近${TERM.STANDARDIZATION_VALIDATION}收据 ${validatedAtText}`;
}

/** 未标准化时的 WARNING 计数句 */
export function articlePreviewWarningText(count: number): string {
  return `WARNING ${count} 项（进入${TERM.PENDING_ISSUES}，不阻断）`;
}

// ── ArticleRetireDialog（文章退役预演对话框，SPEC-013）──
export const ARTICLE_RETIRE_COPY = {
  RETIRE_FAILED: "退役失败",
  TITLE: "退役文章",
  PLAN_LOADING: "正在生成清理计划…",
  PLAN_HEADING: "将清理：",
  PLAN_WORKING_COPY: "· 工作副本（precleaned）",
  PLAN_ARCHIVE: "· 原文归档（archive，随溯源链）",
  PLAN_MANIFEST_ROW: "· 文章清单行",
  DRY_RUN_NOTE: "预演未修改任何文件",
  CONFIRM_ACTION: "确认退役",
} as const;

/** 对话框说明句（嵌文章标题） */
export function articleRetireDescription(title: string): string {
  return `沿溯源链清理《${title}》的全部物理副本（工作副本＋正式版＋原文归档＋清单行）。退役不可撤销，正式版可从 git 历史找回。`;
}

/** 清理计划：正式版快照份数行 */
export function articleRetireFormalSnapshotsText(count: number): string {
  return `· 正式版快照 ${count} 份（wiki/articles）`;
}

// ── ArticleUploadDock（原始资料投稿浮动栏）──
export const ARTICLE_UPLOAD_DOCK_COPY = {
  /** FileReader 读取失败（reject 原因） */
  READ_FAILED: "无法读取文件",
  READ_RESULT_INVALID: "文件读取结果无效",
  ENCODE_FAILED: "文件编码失败",
  /** 队列条目失败原因 */
  TRANSFER_FAILED: "传输失败",
  FILE_READ_FAILED: "文件读取失败",
  DOCK_ARIA: "原始资料投稿浮动栏",
  /** 队列条目状态 */
  ENTRY_SUCCEEDED: "已投稿",
  ENTRY_UPLOADING: "传输中",
  ENTRY_QUEUED: "待投稿",
  /** 选择文件（按钮 title 与 aria 同值） */
  PICK_FILES: "选择多个文件",
  PICK_INPUT_ARIA: "选择多个原始资料",
  PICK_PROMPT: "选择或拖放多个原始文件",
  TARGET_HINT: "目标：知识库/raw/drafts/投稿 · 单文件最大 10 MiB",
} as const;

/** 入队预校验：队列上限 */
export function uploadQueueLimitError(max: number): string {
  return `最多选择 ${max} 个文件`;
}

/** 入队预校验：扩展名不在值域 */
export function uploadTypeUnsupportedError(fileName: string): string {
  return `${fileName} 类型不支持`;
}

/** 入队预校验：空文件 */
export function uploadEmptyFileError(fileName: string): string {
  return `${fileName} 为空文件`;
}

/** 入队预校验：超过单文件上限 */
export function uploadTooLargeError(fileName: string): string {
  return `${fileName} 超过 10 MiB`;
}

/** 入队预校验：同名已在队列 */
export function uploadDuplicateError(fileName: string): string {
  return `${fileName} 已在队列中`;
}

/** 队列条目移除按钮（title 与 aria 同值） */
export function uploadRemoveEntryLabel(fileName: string): string {
  return `移除 ${fileName}`;
}

/** 浮动栏汇总行 */
export function uploadQueueSummary(pending: number, succeeded: number, total: number): string {
  return `${pending} 个待投稿 · 已投稿 ${succeeded}/${total}`;
}

/** 投稿按钮 title／aria */
export function uploadSubmitLabel(count: number): string {
  return `投稿 ${count} 个文件`;
}

/** 投稿按钮可见短文本 */
export function uploadSubmitShortLabel(count: number): string {
  return `投稿 ${count} 个`;
}

// ── ArticleWorkflowSummary（工作草稿统计行）──
/** 待标准化提示句 */
export function articlePendingStandardizationText(count: number): string {
  return `${count} 篇工作草稿仍待标准化。`;
}

// ── CandidateFieldForm（候选字段补齐表单）──
export const CANDIDATE_FIELD_FORM_COPY = {
  SECTION_ARIA: "字段补齐",
  FIELDS_LOADING: "字段清单加载中…",
  ARRAY_PLACEHOLDER: "多个值用英文逗号分隔",
  SAVE_DISABLED_TITLE: "修改任一字段后可保存",
  SAVING: "保存中…",
  SAVE_ACTION: "补齐字段",
  HINT: "Skill 上报的缺口字段在此补齐；枚举值由 Vault 规则校验，通过后即可运行标准化校验。",
} as const;

/** 保存按钮 title：列出将补齐的字段名 */
export function candidateFieldSaveTitle(labels: string[]): string {
  return `补齐字段：${labels.join("、")}`;
}

// ── 本地标准化 Skill 结果卡（PrecleanedTable 与 UploadHistoryPanel 共用）──
export const ARTICLE_SKILL_OUTCOME_COPY = {
  FAILED: "本地标准化 Skill 执行失败，草稿保持原状",
  DONE: "本地标准化 Skill 完成，候选已进入工作草稿区",
  AUTO_FILLED_PREFIX: "已自动补齐 frontmatter 字段：",
} as const;

/** 已知问题计数句 */
export function articleSkillKnownIssuesText(count: number): string {
  return `已知问题 ${count} 项（不阻断，进入待处理问题跟进补齐）`;
}

// ── PrecleanedTable（工作草稿表）──
export const PRECLEANED_TABLE_COPY = {
  COL_TITLE: "文章标题",
  COL_TITLE_ASC: "标题 A-Z",
  COL_TITLE_DESC: "标题 Z-A",
  COL_PRODUCT_MODULE: "产品 / 模块",
  COL_PRODUCT_MODULE_ASC: "产品 / 模块 A-Z",
  COL_PRODUCT_MODULE_DESC: "产品 / 模块 Z-A",
  COL_TYPE_VERSION: "类型 / 版本",
  COL_TYPE_VERSION_ASC: "类型 / 版本 A-Z",
  COL_TYPE_VERSION_DESC: "类型 / 版本 Z-A",
  COL_STATUS: `${TERM.STANDARDIZATION_VALIDATION}状态`,
  COL_STATUS_ASC: "待标准化优先",
  COL_STATUS_DESC: "管道处理中优先",
  WARNING_TITLE: "标准化校验 WARNING 已进入待处理问题，不阻断检索与阅读",
  COL_UPDATED_AT: "更新时间",
  COL_UPDATED_AT_ASC: "最旧优先",
  COL_UPDATED_AT_DESC: "最新优先",
  TABLE_ARIA: "工作草稿表",
  LOADING_LABEL: "正在读取 precleaned...",
} as const;

/** 状态列 WARNING 计数 */
export function precleanedWarningCountText(count: number): string {
  return `WARNING ${count} 项`;
}

/** 行操作：查看 */
export function precleanedOpenActionLabel(title: string): string {
  return `查看 ${title}`;
}

/** 行操作：审批与发布 */
export function precleanedApproveActionLabel(title: string): string {
  return `${TERM.GRAPH_PUBLISH} ${title}`;
}

/** 行操作：退役 */
export function precleanedRetireActionLabel(title: string): string {
  return `退役 ${title}`;
}

/** 行操作菜单 aria */
export function precleanedRowActionsAria(title: string): string {
  return `${title}行操作`;
}

// ── UploadHistoryPanel（投稿记录面板）──
export const UPLOAD_HISTORY_COPY = {
  /** 面板 aria 与标题同值 */
  TITLE: "投稿记录",
  SUMMARY_DONE_WITH_STANDARDIZED: "投稿已完成，审批与发布见工作草稿。",
  SUMMARY_DONE: "投稿已完成",
  COL_FILE: "文件",
  COL_SIZE: "大小",
  COL_CREATED_AT: "投稿时间",
  // 「状态」＝shared/field-labels.mjs 实体域 status 字段中文名（seq209 单源原则：字段中文名不手写第二份，经派生）
  COL_STATUS: sharedFieldLabel("status"),
  COLLAPSE_ARIA: "收起投稿记录",
  EXPAND_ARIA: "展开投稿记录",
  TABLE_ARIA: "投稿记录表",
  EMPTY_NONE: "暂无投稿记录",
  EMPTY_NO_PENDING: "当前没有待处理投稿",
  EMPTY_NO_PENDING_DESCRIPTION: "可展开下方终态历史查看完整记录",
} as const;

/** 汇总行：待处理/已处理计数 */
export function uploadHistorySummaryCounts(pending: number, processed: number): string {
  return `${pending} 条待处理 · ${processed} 条已处理`;
}

/** 状态列候选数尾巴（多候选时） */
export function uploadHistoryCandidateSuffix(count: number): string {
  return ` · ${count} 篇候选`;
}

/** 标题旁计数 */
export function uploadHistoryCountText(total: number, active: number): string {
  return `共 ${total} 条 · 活跃 ${active} 条`;
}

/** 终态历史开关（前缀动作词由 TERM.EXPAND_ACTION／COLLAPSE_ACTION 给出） */
export function uploadHistoryTerminalToggleText(count: number): string {
  return `终态历史 ${count} 条（已完成/源已删/已消化——完整审计走 vault git）`;
}
