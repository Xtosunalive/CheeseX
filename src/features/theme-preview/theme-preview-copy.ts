// theme-preview 页级文案单源（ADR-019 §三.4，WP-147 二期尾项入册）。
// 主题预览页（#/theme，仅 DEV 可路由）用户可见中文的唯一声明处：面板标题、
// token 目录注记、抽样段（分类色/step 档/圆角/表格尺度）说明与页面各处样例文案。
// 分工边界：token 名串（--color-<全局角色词>／--radius-*／--table-*）不住本文件——
// 预览镜像对账（check-theme-vocab §⑦）按 ThemePreviewView.tsx 原文执法
// （「radius/table 族公开 token 须镜像展示」），token 名单留在视图侧；
// CATEGORY_SAMPLES/STEP_ROLE_SAMPLES 整构迁入（条目全为 step 词，不在镜像执法面，
// 且经 Swatch 以 var(${token}) 运行时消费——迁入后由 token 名串通道照常计入 consumed）。
import type { ModeKind } from "@/hooks/use-mode";

/** 显示模式四态标签（PR②）：档位枚举 + 标签（与 ModeToggle 菜单同一词表） */
export const MODE_LABELS: Record<ModeKind, string> = {
  light: "白天",
  dark: "夜间",
  warm: "护眼",
  auto: "跟随系统",
};

/** 当前解析态句（「当前解析态：白天（跟随系统实时）」整句在此组装，视图不拼中文） */
export function resolvedModeText(resolved: "light" | "dark" | "warm", auto: boolean): string {
  return `当前解析态：${MODE_LABELS[resolved]}${auto ? "（跟随系统实时）" : ""}`;
}

/** 各 Panel 标题（title 槽；分类色 Panel 原文含字面花括号转义，此处为真实字符） */
export const PANEL_TITLES = {
  mode: "显示模式（四态）",
  tableScale: "表格尺度（P0 组件 token 首批）",
  status: "状态样例（文字+图形并用）",
  statusSteps: "状态色档位（Radix step 桥）",
  accent: "主操作（accent 紫系）",
  fontFamily: "字体家族（--font-*）",
  typeScale: "展示字阶（--text-2xl/3xl/5xl，大数字档）",
  bento: "Bento 布局件（BentoGrid/BentoCard/Statistic）",
  category: "分类色抽样（--color-{族}-{step}，Radix 12 阶）",
  radius: "圆角档位（--radius-*）",
  depth: "深度层（阴影/玻璃/遮罩）",
} as const;

/** 状态徽章样例（契约禁令 4：文字+图形并用，颜色只是第三重冗余） */
export const STATUS_BADGES = {
  fact: "已准入",
  warn: "待处理",
  error: "已阻断",
  loading: "上传中",
  inferred: "推断",
} as const;

/** 主操作语言样例 */
export const ACCENT_SAMPLES = {
  primary: "主按钮",
  secondary: "次按钮",
  softBg: "淡紫底按钮（hover 加深）",
  countBadge: "计数徽章",
} as const;

/** 字体家族样例：展示文本与 code 注记 */
export const FONT_SAMPLES = {
  display: "标题 Nunito 圆润粗体 123",
  displayHint: "--font-display（font-display 类）",
  body: "正文 Inter 圆润 1234567890",
  bodyHint: "--font-body（body 默认 / font-body 类）",
} as const;

/** 展示字阶样例（大数字档） */
export const TYPE_SCALE_SAMPLES = {
  text2xl: "28 标准大数字",
  text3xl: "32 强调",
  text5xl: "48 主视觉",
} as const;

/** Bento 布局件样例：卡片标题/描述/正文与 Statistic 标签 */
export const BENTO_SAMPLES = {
  mainTitle: "主视觉格",
  mainDesc: "BentoCard colSpan=2——Panel 表面＋跨列",
  mainBody: "跨列单元复用 Panel 的表面/描边/标题槽，第二段 13 页装配的通用件。",
  subTitle: "次级格",
  subBody: "单列单元。",
  statXl: "主数字（text-5xl·48）",
  statLg: "强调（text-3xl·32）",
  statStd: "标准（text-2xl·28）",
} as const;

/** 深度层样例 */
export const DEPTH_SAMPLES = {
  glass: "玻璃底 glass",
  shadow: "阴影卡片 shadow-card",
  focusRing: "聚焦环 border-focus",
} as const;

/** L1 token 目录分组标题（分组骨架与 token 名单住视图侧，镜像对账按视图原文执法） */
export const TOKEN_GROUP_TITLES = {
  surface: "表面 Surface（页面画布与容器）",
  text: "文字 Text（四级层次）",
  accent: "主操作 Accent（品牌紫）",
  status: "状态 Status（B 端信号）",
  line: "线 Line（树形与结构线）",
  glass: "玻璃与遮罩 Glass/Overlay",
} as const;

/** L1 token 目录注记（[角色, 语义说明]，按 token 名的驼峰键取用——键与视图侧 token
 *  名单一一对应，漏配/错键由 tsc 红） */
export const TOKEN_ROLE_DESCS = {
  surfaceRoot: ["页面最底层", "全站大背景"],
  surfaceCard: ["卡片", "面板/卡片底（与 root 分层，靠卡片色与边框）"],
  surfaceHover: ["hover 反馈", "行悬停/选中微反馈浅灰"],
  surfaceAlter: ["交替底", "表头/行 hover（P0，antd colorFillAlter 口径；三模式值见 theme-mix-report）"],
  textMain: ["一级", "标题、主内容"],
  textSub: ["二级", "描述、列表正文"],
  textHint: ["三级", "标签、计数、辅助说明"],
  textPlaceholder: ["四级", "占位、禁用（70% 透明）"],
  accentBase: ["主操作", "选中/主按钮/品牌强调"],
  accentBg: ["淡紫底", "hover 语言 12%"],
  accentBgStrong: ["深紫底", "hover 加深 22%"],
  accentContrast: ["紫底白字", "饱和紫底上的前景字（原裸白词已退役）"],
  accentFg: ["淡紫底深字", "淡紫底上的前景字（官方 accent-foreground 角色）"],
  borderFocus: ["聚焦环", "焦点描边 45%"],
  borderThin: ["细边框", "卡片/分隔线 1px 边（L1 边框轴）"],
  borderSoft: ["次级分隔线", "表格行线（P0，antd colorBorderSecondary 口径）"],
  statusFact: ["事实", "已准入/通过（呼吸灯绿）"],
  statusInferred: ["推断", "推断类信号（紫）"],
  statusWarn: ["警示", "待处理/阻断前兆（琥珀）"],
  statusError: ["错误", "阻断/截断（红）"],
  statusLoading: ["加载", "上传中/进行中（青）"],
  lineEdge: ["结构边线", "架构图连线"],
  lineFaint: ["弱线", "浅层辅助线（ink 8%）"],
  lineSubtle: ["次弱线", "分组/轻分隔"],
  gridLine: ["网格线", "画布底格"],
  gridLineStrong: ["强网格线", "精细底格"],
  overlay: ["遮罩", "弹层/模态底罩"],
  glass: ["玻璃", "悬浮层玻璃底"],
} as const satisfies Record<string, readonly [string, string]>;

/** 分类色抽样（WP-147 连名换装：新词形 --color-<族>-<step>＝Radix 12 阶，全量按语义抽样展示；
 *  抽样取确定性色族——Grass/Green、Iris/Indigo、Gray/Mauve 等目检抉择族以对照页为准）。
 *  条目全为 step 词：不在 check-theme-vocab §⑦ 镜像执法面，整构（token 名＋文案）住本文件。 */
export const CATEGORY_SAMPLES: [string, string][] = [
  ["--color-cyan-9", "连接/侧栏主题蓝（CONNECTS_TO）"],
  ["--color-sky-9", "信息提示（BELONGS_TO）"],
  ["--color-teal-9", "关联点缀（ASSOCIATED_WITH）"],
  ["--color-purple-9", "溯源上下文"],
  ["--color-orange-9", "板块/HAS_SYMPTOM"],
  ["--color-lime-9", "DOCUMENTS"],
  ["--color-yellow-9", "版本/USES"],
  ["--color-amber-9", "警示（DEPENDS_ON）"],
  ["--color-red-9", "错误辅底"],
  ["--color-violet-9", "INDEXES/概念"],
  ["--color-slate-9", "RELATED 关系灰"],
];

/** step 档语义样例（以 cyan 为例：同一色族 12 阶的角色分组——Radix 官方口径：
 *  2 极淡底 / 9 实色线点 / 11 可读文字；旧 -lighter/-实色/-light 档由此归位）。
 *  同 CATEGORY_SAMPLES：全为 step 词，整构住本文件。 */
export const STEP_ROLE_SAMPLES: [string, string][] = [
  ["--color-cyan-4", "淡档/弱化文字"],
  ["--color-cyan-9", "实色/线/点"],
  ["--color-cyan-11", "可读文字"],
];

/** step 档抽样区引言（Panel 内说明句） */
export const STEP_ROLE_INTRO =
  "step 档语义样例（以 cyan 为例：底 2-4 / 实色 9 / 文字 11，夜间随 .dark 走向 B 换 vendor dark palette）";

/** 状态色档桥注记（WP-147 scope_revision 3：携带式 alpha 按卡 §2.2 选档后的 step 封闭类；
 *  按 step 短名取用——token 名单住视图侧，属镜像执法面） */
export const STATUS_STEP_NOTES = {
  s2: "2 极淡底（原 /5 /10）",
  s3: "3 淡底（原 /15-/25、hover /10）",
  s4: "4 悬停底（原 hover /25）",
  s6: "6 弱边环（原 /20-/30）",
  s7: "7 常规边（原 /40）",
  s8: "8 强边（原 /70）",
  s11: "11 次级文字（原文字带透明）",
} as const;

/** 状态色档桥引言（Panel 内说明句） */
export const STATUS_STEP_INTRO =
  "fact→Jade／warn→Amber／error→Ruby／loading→Sky，夜间随深色色板换值；推断（品牌紫）不在 Radix 色板，不设档位";

/** 圆角档位注记（按档位短名取用；--radius-* token 名单住视图侧——radius 族在镜像执法面） */
export const RADIUS_NOTES = {
  sm: "8px 小按钮/标签（Shakuro）",
  md: "12px 输入框/卡片 · 按钮默认（Shakuro）",
  lg: "16px 大卡片/弹窗（Shakuro）",
  panel: "16px 悬浮任务池面板（PR-026，W2 对齐 lg 上限）",
  xl: "16px 大容器",
} as const;

/** 表格 token 注记（按条目短名取用；--table-* token 名单住视图侧——table 族在镜像执法面） */
export const TABLE_TOKEN_NOTES = {
  cellLg: "密度 large（默认）纵向/横向 16/16",
  cellMd: "密度 middle 12/8",
  cellSm: "密度 small 8/8",
  cellCurrent: "当前档（data-density 切换）",
  fontSize: "字号（--text-sm＝14）",
  lineHeight: "行高 1.5715（组件专属比值例外）",
  radius: "外圆角（--radius-md）",
  toolbarHeight: "工具栏高 32",
  selectionWidth: "选择列宽 32",
  paginationHeight: "分页高 32/24",
  statePadding: "空/载/错状态区留白 48/24",
  actionGap: "行操作列间距 8",
  stickyZ: "吸顶/固定列层级 10（<全局弹层档 30+）",
  stickyCornerZ: "角格层级＝sticky+1（相对值）",
  fixedShadow: "固定列阴影（几何例外，墨水走 L0）",
} as const;

/** 表格尺度三档密度标签 */
export const TABLE_SCALE_LABELS = {
  lg: "large（默认 16/16）",
  md: "middle（12/8）",
  sm: "small（8/8）",
} as const;

/** L2 token 清单区引言 */
export const TABLE_LIST_HINT = "L2 token 清单（值＝派生式，溯源 antd 读码对照表）：";

/** 表格实样内的固定文案（表头/行/状态区） */
export const TABLE_DEMO = {
  toolbar: "工具栏（32 高）",
  colA: "列一",
  colB: "列二",
  colStatus: "状态",
  rowFocus: "示例行（可聚焦）",
  cellFact: "事实",
  cellHover: "悬停看行反馈",
  cellInferred: "推断",
  stateArea: "空／载／错状态区（统一留白，三态组件 P1 落地）",
} as const;

/** 表格实样底注（「共 2 条 · 密度 lg」） */
export function tableMetaText(density: string): string {
  return `共 2 条 · 密度 ${density}`;
}
