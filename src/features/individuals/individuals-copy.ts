// WP-210（SPEC-100 批 4）：个体派生面文案。
// WP-214：类管理地图（声明性文案——类增删时随批维护，PR-338 R4 关联；自动化派生另批）。
export const INDIVIDUALS_COPY = {
  VIEW_TITLE: "个体管理（派生面）",
  VIEW_HINT: "按本体类派生：字段与中文绑定名来自服务端派生配置；创建/更新/退役走通用个体面（单一执法点）。",
  CLASS_LABEL: "类 ID",
  CLASS_PLACEHOLDER: "如 FaqCard（本体已声明的 approved 类）",
  LOAD_BUTTON: "加载",
  CREATE_TITLE: "新建个体",
  EDIT_TITLE: "编辑个体",
  SAVE_BUTTON: "保存",
  CREATE_BUTTON: "创建",
  RETIRE_BUTTON: "退役",
  EDIT_BUTTON: "编辑",
  CANCEL_BUTTON: "取消",
  LIST_EMPTY: "该类暂无未退役个体（空数据态合法）",
  COL_ID: "个体 ID",
  COL_ACTIONS: "操作",
  EDIT_ACTION: "编辑",
  RETIRE_ACTION: "退役",
  UNDECLARED_SHORT: "（未声明）",
  TABLE_ARIA: "个体清单表",
  COL_TITLE: "标题",
  NEUTRAL_FALLBACK: "中性兜底",
  LIST_TITLE: "个体清单",
  REQUIRED_MARK: "必填",
  UNDECLARED_NOTE: "字段未在 fields.yaml 声明 display（回退字段名）",
  MAP_SUMMARY: "类管理地图（15 类＋新类各在哪管）",
  RETIRED_TYPE: "该种类已退役",
  REPLACEMENT_TYPE_PREFIX: "替代种类：",
  MANAGED_ELSEWHERE: "该种类由所属管理面维护，本页不挂载通用清单或写按钮",
  GO_TO_HOST: "前往所属管理面",
  UNSUPPORTED_ACTION: "当前页面不支持动作：",
} as const;

/** WP-214 类管理地图：四族×管理面×通道（声明性治理文案——依据批 A 处置提案＋Wave3 交付边界）。
 *  机制层已统一（写通道/审计/生命周期/动作契约一套底座）；本图回答的是入口层"各在哪管"。 */
export const CLASS_MANAGEMENT_MAP = [
  {
    family: "内容族（业务页管内容）",
    rows: [
      { cls: "知识文章", surface: "文章准入/工作流页＋审批工作台", channel: "专属流水线：上传→标准化→审批→发布→退役" },
      { cls: "实体", surface: "实体族治理页（编辑/合规检查），或 Obsidian 直改", channel: "实体编辑线（防误改守卫＋合规检查在岗）" },
    ],
  },
  {
    family: "词表族（配置页管清单）",
    rows: [
      { cls: "业务域/子域", surface: "图谱规则配置页（域清单）", channel: "词表登记＋写通道，节点系统生成" },
      { cls: "模块", surface: "图谱规则配置页（模块清单）", channel: "词表登记＋写通道" },
      { cls: "产品/产品版本", surface: "图谱规则配置页（产品版本表）", channel: "版本登记线（draft→released→deprecated）" },
    ],
  },
  {
    family: "聚合族（系统生成，不直接编辑）",
    rows: [
      { cls: "板块/团队/系统节点", surface: "无编辑入口", channel: "从文档元数据/架构审定件自动聚合" },
      { cls: "对象卡三张（业务/配置/运行视图）", surface: "对象字典专项线", channel: "对象字典治理（ADR-012）" },
    ],
  },
  {
    family: "派生面新增（本页管）",
    rows: [
      { cls: "FaqCard 及后续声明的新类", surface: "本页（个体管理派生面）", channel: "声明即得：接口/存储投影/界面全自动" },
    ],
  },
] as const;
