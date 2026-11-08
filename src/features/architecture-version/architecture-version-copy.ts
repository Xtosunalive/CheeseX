// architecture-version 页级文案单源（WP-152 散写销账第四批·收官批）——ADR-019 §二 展示面介质唯一出口（页级 copy 模块）。
// 本特性（架构版本对比页：产品版本数统计＋对比选择面板＋差异摘要＋组件/关系/文章三栏差异＋api/store 兜底）的
// 用户可见文案只在本文件声明：按消费组件分段导出 const 对象，插值句用函数（学 review-copy 先例）。
// 差异字段中文名仍住同目录闭集 components/version-diff-field-labels.ts（seq209 派生锁），本模块只收页面文案；
// 页名「架构版本对比」引用 TERM.VERSION_ANALYSIS（页面正名守卫），不在此手写。
// 禁在其他 architecture-version 文件内联同值中文（lint CJK 字面量族执法，本文件经闭集豁免块豁免）；改文案只改这里。
// 闭集清单登记：eslint.config.js 尾部闭集豁免块＋src/test/copy-vocabulary-closed-set.test.ts CLOSED_SET_FILES
// 投影＋SPEC-091 §2.1（ADR-019 §三.4 闭集仪式）。

// ── api/store 层请求兜底（api 与 store 同句——同一失败同一句）──
export const AV_REQUEST_COPY = {
  LOAD_FAILED: "产品版本加载失败",
  COMPARE_FAILED: "产品版本分析失败",
} as const;

// ── ArchitectureVersionView（页面入口）──
export const AV_VIEW_COPY = {
  REFRESH: "刷新产品版本",
  STAT_LABEL: "产品版本数",
  STAT_HINT: "可对比的产品版本总数",
  LOADING: "正在加载产品版本...",
  NEED_TWO_VERSIONS: "至少需要两个产品版本",
  OPEN_VERSION_CHECK: "打开产品版本校验",
  TO: "到",
  LINEAGE_VERIFIED: "比较来源已验证",
  LINEAGE_UNVERIFIED: "比较包含实时或待确认来源",
  SNAPSHOT_COMPARISON: "冻结快照对比",
  STATE_COMPARISON: "版本状态对比",
  MANUAL_DECISION: "人工决定",
  SYSTEM_DECISION: "系统按稳定身份计算",
} as const;

// ── VersionComparePanel（对比选择面板）──
export const AV_COMPARE_COPY = {
  /** 版本来源徽标（键＝ProductVersion.sourceMode） */
  SOURCE_SNAPSHOT: "快照",
  SOURCE_LIVE: "实时投影",
  PRODUCT: "产品",
  PRODUCT_PICK_ARIA: "选择产品",
  SOURCE_VERSION: "源版本",
  SOURCE_VERSION_PICK_ARIA: "选择源版本",
  VERSION_PLACEHOLDER: "选择版本",
  TARGET_VERSION: "目标版本",
  TARGET_VERSION_PICK_ARIA: "选择目标版本",
  NO_TARGET: "无可用目标版本",
  START_COMPARE: "开始对比",
} as const;

// ── VersionDiffSummary（差异摘要七格）──
export const AV_SUMMARY_COPY = {
  COMPONENTS_ADDED: "架构组件新增",
  COMPONENTS_REMOVED: "架构组件移除",
  COMPONENTS_CHANGED: "架构组件变更",
  RELATIONS_ADDED: "关系新增",
  RELATIONS_REMOVED: "关系移除",
  DOCUMENTS_ADDED: "文章新增",
  DOCUMENTS_REMOVED: "文章移除",
} as const;

// ── VersionComponentDiff（三栏差异明细）──
export const AV_DIFF_COPY = {
  NO_DIFF: "两个版本的状态一致",
  VALUE_SET: "已设置",
  VALUE_UNSET: "未设置",
  VALUE_EMPTY: "空",
  DOCUMENTS_SECTION: "关联文章",
  UNLAYERED: "未分层",
  UNCATEGORIZED: "未分类",
  GROUP_REMOVED: "移除",
  GROUP_CHANGED: "属性变化",
  OTHER_ATTRIBUTE: "其他属性",
  ARTICLE_INFO: "文章信息",
} as const;
