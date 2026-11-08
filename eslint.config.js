import { readFileSync } from "node:fs";
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import tailwindDesignTokens from "eslint-plugin-tailwind-design-tokens";
// WP-138 R5c：分类色板唯一源文件名单不再手抄——经执法面豁免单源（shared/theme-exemptions.mjs）取数
import { PALETTE_SOURCE_FILES } from "./shared/theme-exemptions.mjs";

// ═══ 配置地图与覆盖语义（WP-129 补注）═══
// flat config 同名规则**后块整组替换前块**（规则数组不合并）——跨块叠加选择器必须展开合并
// （写法 `["error", ...单源常量, 新选择器]`），禁止整组重写：seq208 值所有权块曾整组替换
// no-restricted-syntax，致 seq184 前端纯净度集在其 3 个 feature 目录静默失效（WP-129 修复，
// 注入探针对照实证）。块地图（按文件面）：
//   **/*.{ts,tsx}        基础块（react-hooks／设计 token／no-restricted-imports＋前端纯净度集）
//   src/** 豁免块         ui 组件目录／色板单源文件／测试 fixture
//   scripts/**/*.mjs     Node 脚本块（no-undef）＋形状立法块（sha256/date）；e2e 子目录放开 browser globals
//   server/**/*.cjs      后端请求侧块（no-undef＋no-empty＋全量形状＋运行时纪律；T2 依赖方向按层叠加）
//   server/**/*.mjs      WP-129 新块——server/vault-runtime 符号链接路径入扫（no-undef＋no-empty＋纯形状集，
//                        刻意不纳入 PR-056／WP-J 两条请求侧纪律，理据见该块注释）
//   3 个 feature 目录     seq208 值所有权块（展开合并前端纯净度集＋值所有权选择器）

// SPEC-012 WP-J 写者豁免单源（消费点见下方 files 引用处）：合法写者名单只有一份——
// contracts/runtime-scope.json 的 write_primitive_allow，即 runtime-scope 门⑤的执法清单。
// 此前本文件另抄一份（vault-io／repo-file-io／persistence/**），与那张表对不上：
// vocab-envelope-materializer 与 release-publisher-service 在册（门⑤绿）却被本规则判 error（lint 红）——
// 同一事实在两道门下判定相反（PR-171）。现在只从单源取 server/ 侧条目；新增写者须在契约里登记理由
// （该表棘轮只减不增），本文件不再需要同步跟改。解析失败即抛：宁可 lint 跑不起来，也不静默放宽放行面。
const wpjWriterExemptions = JSON.parse(
  readFileSync(new URL("./contracts/runtime-scope.json", import.meta.url), "utf8"),
).write_primitive_allow.map((entry) => entry.file).filter((file) => file.startsWith("server/"));
if (wpjWriterExemptions.length === 0) throw new Error("WP-J 豁免派生为空：write_primitive_allow 无 server/ 侧条目");

// ═══ T2 依赖方向边界（门禁收敛批 2026-11-06；layer-ssot 退役后分层结构级防线的补位）═══
// 规则清单与依据（零自研插件，全部 eslint 内置规则——seq184「内置 no-restricted-syntax，零自研」同款惯例）：
// ① src/**（ts/tsx）禁 import server/｜scripts/（根形态＋相对逃逸形态；载体 no-restricted-imports）
//    依据：前后端职责硬边界（承 seq184 ③「校验与计算单源在后端」）——ImportDeclaration 面自 ③ 迁入本规则
//    （同为内置规则、同文件面；动态 import() 形态由 ③ 的 no-restricted-syntax 选择器补位——
//    no-restricted-imports 覆盖静态 import／export * from／export {x} from，不覆盖动态 import）；
//    scripts/ 为 Node 侧治理/运行时脚本，非浏览器依赖面。
//    勘察（2026-11-06，grep 全量）：src→server／src→scripts 两方向现存 0 处（含 src/test）。
//    刻意不立的两条边界（宁少勿错）：
//    - src → 顶层 shared/：field-labels／date-contract 是前后端双端单源，前端 11 处相对 import 属设计内
//      消费（这正是顶层 shared/ 的存在意义），禁令会与既定结构打架；
//    - src → contracts/*.json：object-dictionary 等 2 处契约消费同为设计面。
// ② server/services/**（生产文件）禁 require routes/（载体 no-restricted-syntax——require 调用不属 import
//    语法面，no-restricted-imports 看不见，用同族内置规则执法）
//    依据：ADR-004 决策 1/2「依赖方向单向 main→routes→services→shared；服务层不得 require 路由模块」。
//    勘察：现存 0 处（历史 3 处命中全在 __tests__ 测试装配，不属层违规，随块 ignores 豁免）。
// ③ server/shared/**（生产文件）禁 require routes/ 与 services/
//    依据：ADR-004「下层不得反向 require 上层」（shared 为最底层）。勘察：routes 0 处；services 3 处
//    （均为已签收的委托实现，见下方 per-file 存量 override）。
// 存量 override 纪律（只减不增）：per-file 豁免每处必须随注释登记理由与在册出处；依赖本体迁层/下沉清偿后
//    必须同步摘除豁免条目；禁止为凑绿放宽规则本体或扩大豁免文件面。
// main.cjs 反向依赖未立规则：勘察 0 处且误伤面实测存在（server 内 *domain.cjs 文件名含 "main" 子串，
// 尾匹配会假红）——宁少勿错，留待真实信号出现再议。

// 形状立法选择器·纯形状部分（seq195／seq208 历次立法累计）——与模块形态无关的代码形状冻结，
// cjs／mjs 两块共用：server/**/*.cjs 块与 server/**/*.mjs 块（WP-129 盲区闭合）都从这里取，
// 避免整组复制产生第二事实源。
const serverShapeLegislationSelectors = [
  {
    selector: 'Literal[regex.pattern="^sha256:[0-9a-f]{64}$"]',
    message: "sha256 revision 形状正则已单源：require SNAPSHOT_HASH_PATTERN from server/shared/version-contract.cjs（seq195 立法）",
  },
  {
    selector: 'Literal[regex.pattern="^sha256:([0-9a-f]{64})$"]',
    message: "sha256 捕获组形状已冻结：复用 SNAPSHOT_HASH_PATTERN.source 或 require 单源（seq195 立法）",
  },
  {
    selector: 'Literal[regex.pattern="^[a-z][a-z0-9]*(-[a-z0-9]+)*$"]',
    message: "kebab 形状正则已单源：require KEBAB_RE from server/services/entity-compliance-helpers.cjs（seq195 立法）",
  },
  {
    selector: 'Literal[value="^[a-z][a-z0-9]*(-[a-z0-9]+)*$"]',
    message: "kebab 形状字符串已冻结：用 KEBAB_RE.source 代替字面量（seq195 立法）",
  },
  {
    selector: 'Literal[regex.pattern="^\\\\d{4}-\\\\d{2}-\\\\d{2}$"]',
    message: "date 形状正则已单源：require DATE_PATTERN from shared/date-contract.mjs（seq195 立法，seq208 载体迁移）",
  },
  {
    selector: 'Literal[value="^\\\\d{4}-\\\\d{2}-\\\\d{2}$"]',
    message: "date 形状字符串已冻结：用 DATE_PATTERN 代替字面量（seq195 立法，seq208 载体迁移）",
  },
  {
    selector: 'Literal[regex.pattern="^\\\\d+\\\\.\\\\d+(\\\\.\\\\d+)?([.-].+)?$"]',
    message: "semver 形状正则已单源：require SEMVER_RE from server/services/entity-compliance-helpers.cjs（seq195 立法）",
  },
  {
    selector: 'Literal[value="^\\\\d+\\\\.\\\\d+(\\\\.\\\\d+)?([.-].+)?$"]',
    message: "semver 形状字符串已冻结：用 SEMVER_RE.source 代替字面量（seq195 立法）",
  },
  {
    selector: 'Literal[regex.pattern="^[A-Za-z0-9-]+$"]',
    message: "snapshotId 形状校验已单源：enums-write-service rollbackSnapshot 内层校验已覆盖，勿重复实现（seq195 立法）",
  },
];

// server 请求路径运行时纪律（仅 server/**/*.cjs 请求侧块叠加）——vault-runtime .mjs 为 CLI 工具区，
// 不在以下两条纪律的适用面内（理据勘察见 WP-129 新 mjs 块注释）。
const serverCjsRuntimeSelectors = [
  // PR-056 运行时纪律（SPEC-011 四案修复随件）：server 禁同步子进程——execFileSync/spawnSync/execSync
  // 在 git/python 慢时冻结事件循环（reconcile 最坏 5×10s、python 校验 30-120s，均为请求路径）。
  // 例外：python-path.cjs / approval-state-machine-assembly.cjs 为 boot 期一次性调用（行内豁免+理由）。
  {
    selector: "CallExpression[callee.type='MemberExpression'][callee.property.name=/^(execFileSync|spawnSync|execSync)$/]",
    message: "PR-056：server 运行时禁同步子进程（阻塞事件循环）——改用 server/shared/async-exec.cjs 的 runCommand（异步，spawnSync 同形状结果）",
  },
  {
    selector: "CallExpression[callee.name=/^(execFileSync|spawnSync|execSync)$/]",
    message: "PR-056：server 运行时禁同步子进程（阻塞事件循环）——改用 server/shared/async-exec.cjs 的 runCommand（异步，spawnSync 同形状结果）",
  },
  // SPEC-012 WP-J：vault 写禁令常驻 eslint（第 21 号棘轮门禁退役随件，PR-057 终态）——
  // server/** 禁裸 fs.writeFileSync/appendFileSync；vault 数据写必须经 vault-io 通道
  // （server/shared/vault-io.cjs）或 persistence 层（server/shared/persistence/**）。
  // 合法写者文件级豁免见下方独立块（vault-io/repo-file-io/persistence）。
  {
    selector: "CallExpression[callee.type='MemberExpression'][callee.property.name=/^(writeFileSync|appendFileSync)$/]",
    message: "SPEC-012 WP-J：server 禁裸 fs.writeFileSync/appendFileSync——vault 数据写经 vault-io 通道（server/shared/vault-io.cjs）或 persistence 层（server/shared/persistence/**）",
  },
  {
    selector: "CallExpression[callee.name=/^(writeFileSync|appendFileSync)$/]",
    message: "SPEC-012 WP-J：server 禁裸 writeFileSync/appendFileSync——vault 数据写经 vault-io 通道（server/shared/vault-io.cjs）或 persistence 层（server/shared/persistence/**）",
  },
];

// 组合常量（保持既有名与 4 个 cjs 消费点不变）：cjs 请求侧块的全量选择器＝纯形状＋运行时纪律。
const serverCjsShapeSelectors = [...serverShapeLegislationSelectors, ...serverCjsRuntimeSelectors];

// seq184 前端纯净度选择器集（ADR025 惯例：ESLint 内置 no-restricted-syntax，零自研）——
// 单源常量：基础 ts/tsx 块与 seq208 值所有权块（3 feature 目录）共同消费，后者在本集之后
// 追加值所有权选择器。新增前端纯净度选择器只改这里；任何块不得整组替换本集（WP-129 教训）。
const frontendPuritySelectors = [
  // ①业务错误文案必须来自后端返回（env.error 优先），禁前端自造中文业务断言
  {
    "selector": "ThrowStatement > NewExpression[callee.name='Error'][arguments.length=1][arguments.0.type='Literal'][arguments.0.value=/[\u4e00-\u9fa5]/]",
    "message": "业务错误文案必须来自后端返回：使用 throw new Error(env.error ?? \"中性兜底\") 形态，禁止前端自造中文业务断言",
  },
  // ①-b（seq201 补形状）：TemplateLiteral 参数分支——首段 quasi 含中文即拦（覆盖 `刷新失败 (HTTP ${s})` 形态；
  // 插值后中段 quasi 的中文残留由 seq201 R2 存量探针/复核兜底，esquery 无法跨 quasi 全量正则）
  {
    "selector": "ThrowStatement > NewExpression[callee.name='Error'][arguments.length=1][arguments.0.type='TemplateLiteral'][arguments.0.quasis.0.value.raw=/[\u4e00-\u9fa5]/]",
    "message": "业务错误文案必须来自后端返回：模板串参数同样禁止自造中文业务断言（seq201 立法）",
  },
  // ②禁硬编码 severity 字面量比较（seq182 漂移类根治——语义判断归后端）
  {
    "selector": "BinaryExpression[operator=/===|!==/][left.raw=/'(?:blocker|warning|error|warn)'|\"(?:blocker|warning|error|warn)\"/]",
    "message": "禁止硬编码 severity 字面量比较：严重度语义判断归后端（entity-compliance-severity.cjs 单源），前端消费契约值渲染",
  },
  // ②-b（seq201 补形状）：右字面量 severity 比较——`g.severity === "blocker"` 形态（seq184 selector 仅匹配左字面量，
  // 该形态存量 tree-table-model.ts:130 曾静默穿透；severity 属性名约束避免误伤 status/tone 等非 severity 判别）
  {
    "selector": "BinaryExpression[operator=/===|!==/][right.raw=/'(?:blocker|warning|error|warn)'|\"(?:blocker|warning|error|warn)\"/][left.property.name=/[sS]everity/]",
    "message": "禁止硬编码 severity 字面量比较：严重度语义判断归后端（entity-compliance-severity.cjs 单源），前端消费契约值渲染（seq201 补右字面量形状）",
  },
  // ②-c（seq201 补形状）：右字面量 + 裸 severity 标识符——`severity === "warning"` 解构形态
  {
    "selector": "BinaryExpression[operator=/===|!==/][right.raw=/'(?:blocker|warning|error|warn)'|\"(?:blocker|warning|error|warn)\"/][left.name=/[sS]everity/]",
    "message": "禁止硬编码 severity 字面量比较：严重度语义判断归后端（entity-compliance-severity.cjs 单源），前端消费契约值渲染（seq201 补右字面量形状）",
  },
  // ③前后端职责硬边界（语法残面补位）：import 声明面已迁入主块 no-restricted-imports（T2）。
  //   no-restricted-imports 覆盖静态 import／export * from／export {x} from（实测），动态 import()
  //   是唯一残面，由本选择器补位（require 形态同理保留在此执法）。
  {
    "selector": "ImportExpression[source.value=/^(?:\\.\\.\\/)*(server|scripts)(\\/|$)/]",
    "message": "前端禁止动态 import server/、scripts/ 模块：校验与计算单源在后端（T2 补位语法形态）",
  },
  {
    "selector": "CallExpression[callee.name='require'][arguments.0.value=/^server\\//]",
    "message": "前端禁止 require server/ 模块：校验与计算单源在后端",
  },
];

// WP-142 波 1（SPEC-091 §2.1／ADR-019 §二 展示面归属律）：展示面两族出口选择器——
// CJK 字面量族（用户文案出口：闭集外 JSX 文本／字符串字面量／模板串写中文即红，唯一合法介质＝文案闭集）
// 与裸 fetch（HTTP 信封出口：唯一合法介质＝src/lib/api.ts 的 apiFetchEnvelope）。
// 零自研插件，挂现有 lint 门禁（ADR-019 §三.1）；闭集文件由文件尾部闭集豁免块显式摘除本族（保留基础纯净度集）。
// AST 面依据（WP-142 红队复核 F1/F4 修正，2026-11-07 探针实测）：
//   JSXText 保持 raw——JSX 文本节点的源文本即文案本体，红队实测正常命中，不动；
//   Literal／TemplateElement 弃顶层 raw、改解析值面——raw 是源码原文：写 \uXXXX 转义形态的串其
//   raw 不含中文字符（漏网），且 TemplateElement 节点顶层根本没有 raw 属性（raw 在 value 里，
//   原 `TemplateElement[raw=…]` 恒匹配空集、模板串整体漏网——红队实测）；改后为
//   Literal[value]／TemplateElement[value.raw]（实测同时命中正常串与纯转义串；数字字面量的
//   value 非字符串，正则不会误命中）。
//   裸 fetch 两形态并列执法：标识符调用 callee.name（fetch(...)）＋成员调用 callee.property.name
//   （window.fetch(...)——红队 F4 实测仅前者拦不住后者，补面）。
const COPY_MEDIA_SELECTORS = [
  {
    selector: "JSXText[raw=/[\u4e00-\u9fff]/]",
    message: "用户文案唯一出口是文案闭集（src/constants/term-const.ts＋页级 copy/labels 模块＋lib/domain/StatusDisplay，ADR-019 §二）：闭集外 JSX 文本禁写中文，迁入闭集后消费",
  },
  {
    selector: "Literal[value=/[\u4e00-\u9fff]/]",
    message: "用户文案唯一出口是文案闭集（src/constants/term-const.ts＋页级 copy/labels 模块＋lib/domain/StatusDisplay，ADR-019 §二）：闭集外字符串字面量禁写中文，迁入闭集后消费",
  },
  {
    selector: "TemplateElement[value.raw=/[\u4e00-\u9fff]/]",
    message: "用户文案唯一出口是文案闭集（src/constants/term-const.ts＋页级 copy/labels 模块＋lib/domain/StatusDisplay，ADR-019 §二）：闭集外模板串禁写中文，迁入闭集后消费",
  },
  {
    selector: "CallExpression[callee.name='fetch']",
    message: "HTTP 信封唯一出口是 src/lib/api.ts 的 apiFetchEnvelope（ADR-019 §二）：闭集外禁裸 fetch，经信封模块消费",
  },
  {
    selector: "CallExpression[callee.property.name='fetch']",
    message: "HTTP 信封唯一出口是 src/lib/api.ts 的 apiFetchEnvelope（ADR-019 §二）：闭集外禁成员形态 fetch 调用（window.fetch 等），经信封模块消费",
  },
];

// seq208 值所有权选择器单源（WP-142 红队复核 F5① 从 seq208 值所有权块内联提取为具名常量，
// 选择器与语义零变更）：seq208 值所有权块与文件尾部闭集豁免块共同展开消费——闭集块整组替换
// 曾使落在 3 目录内的两个闭集文件（property-gov-copy.ts／anomaly-workbench-copy.ts）丢失值
// 所有权执法面（WP-129 覆盖语义连带），并入本集恢复。
const valueOwnershipSelectors = [
  {
    "selector": "MemberExpression[property.name='value'][object.name='finding'], MemberExpression[property.name='value'][object.name='check'], MemberExpression[property.name='value'][object.type='MemberExpression'][object.object.name='checks']",
    "message": "诊断不拥有值（契约06 值所有权法则）：现值唯一来源=sourceValues（源文档）；禁止从诊断对象读 .value 作数据源",
  },
];

export default tseslint.config(
  // discipline-kit/fixtures/**：discipline-kit 自有测试的夹具数据（mini-repo 假仓等），非本仓执法对象。
  // WP-142 波 1 施工中实测：其 writer.cjs（ESM 语法住在 .cjs）fatal 解析错不可被 suppressions 基线
  // 吸收（ruleId=null），不豁免则 lint 门禁与基线棘轮结构性永远红。该红为 2026-11-07 并行线
  // WP-138 合入所带、主工作树对照实测在位（与本波改动无关）。
  { ignores: ["dist", "coverage", ".claude/worktrees/**", "src/index.css", ".tmp/**", "归档/**", "discipline-kit/fixtures/**", "discipline-kit/reference/**", "src/lib/generated/**"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: { ecmaVersion: 2020, globals: globals.browser },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      "tailwind-design-tokens": tailwindDesignTokens,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "react-hooks/exhaustive-deps": "error",
      // 成熟工具：设计 token 强制（替代自研 hex 硬编码检查）
      // cssFile 指向 @theme 定义源（src/index.css），插件自动识别本项目 token
      // no-hardcoded-colors: error（hex/rgba 硬编码已清零，直接锁定）
      // allow: 微调表面层次 rgba（0.05-0.45 白/黑/紫 overlay/shadow/glass 派生）
      // no-default-palette: warn（722 处存量默认色板类历史债，先暴露后随触及迁移）
      "tailwind-design-tokens/no-hardcoded-colors": ["error", {
        cssFile: "./src/index.css",
        allow: [
          "rgba(0,0,0,0.45)", "rgba(0,0,0,0.4)", "rgba(0,0,0,0.3)",
          "rgba(148, 163, 184, 0.12)", "rgba(139,92,246,0.05)", "rgba(139,92,246,0.12)",
          "rgba(139,92,246,0.22)", "rgba(255,255,255,0.05)", "rgba(255,255,255,0.06)",
          "rgba(255,255,255,0.10)", "rgba(255,255,255,0.12)", "rgba(255,255,255,0.15)",
        ],
      }],
      "tailwind-design-tokens/no-default-palette": "warn",
      // seq184 前端纯净度三规则（ADR025 惯例：ESLint 内置 no-restricted-syntax，零自研）——
      // 选择器集单源提为 frontendPuritySelectors 常量（export default 前定义），此处展开引用；
      // seq208 值所有权块（3 feature 目录）同样展开合并该集——flat config 同名规则后块整组替换
      // 前块，此前的整组重写曾使本集在那些目录静默失效（WP-129 修复）。
      // WP-142 波 1：追加 COPY_MEDIA_SELECTORS（展示面两族出口：CJK 字面量族＋裸 fetch，ADR-019）；
      // 闭集文件的豁免见文件尾部闭集豁免块（只摘两族，基础纯净度集保留）。
      "no-restricted-syntax": ["error", ...frontendPuritySelectors, ...COPY_MEDIA_SELECTORS],
      // T2 ①：依赖方向边界（前后端＋Node 侧脚本区）——import 声明面载体（动态 import 由上方 ③ 选择器补位）。
      // 根形态承 seq184 ③ 原边界；相对逃逸形态（../../server 等）为本次补齐。依据与勘察见文件顶部 T2 注释块。
      "no-restricted-imports": ["error", {
        patterns: [
          { regex: "^(?:\\.\\./)*server(/|$)", message: "前端禁止引用 server/ 模块：校验与计算单源在后端，前端经 HTTP 契约消费（T2 立法，承 seq184 ③边界）" },
          { regex: "^(?:\\.\\./)*scripts(/|$)", message: "前端禁止引用 scripts/ 模块：scripts 为 Node 侧治理/运行时脚本，非浏览器依赖面（T2 立法，勘察现存 0 处）" },
        ],
      }],
    },
  },
  {
    files: ["src/components/ui/**"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  {
    // 分类色板唯一源（色值在此权威定义，不查硬编码）+ 测试 fixture + @theme 主题定义
    // WP-138 R5c：文件名单从 theme-exemptions.mjs 单源派生（PALETTE_SOURCE_FILES＋测试区）
    files: [...PALETTE_SOURCE_FILES, "src/test/**"],
    rules: {
      "tailwind-design-tokens/no-hardcoded-colors": "off",
      "tailwind-design-tokens/no-default-palette": "off",
    },
  },
  {
    // Node 脚本层静态守卫（成熟模式：no-undef + globals.node 拦截未定义标识符）
    // 背景：check-core-business-loop-http.mjs 曾用未 import 的 execFileSync，运行时才炸（#801）。
    // 存量策略：只启用 no-undef（detekt/SonarQube new-code：先拦新增，存量已清零），后续可加码。
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node, __dirname: "off", require: "off", module: "off" },
    },
    rules: { "no-undef": "error" },
  },
  {
    // e2e 脚本例外（#1811 批，规则 27 顺手修基线红）：在 Node 里驱动浏览器（page.evaluate 注入 document），
    // 仅对此目录放开 browser globals——quality 脚本的 no-undef 守卫面不放宽。
    files: ["scripts/e2e/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
    rules: { "no-undef": "error" },
  },
  {
    // scripts 层形状立法（seq195 刀3，审计族 R）：sha256 revision 形状冻结——单源
    // SNAPSHOT_HASH_PATTERN（server/shared/version-contract.cjs 导出）；新代码禁止
    // 再写同形状正则字面量，复用单源或 eslint-disable-next-line + 理由注释。
    // 注意 selector 转义：esquery 属性值内 \d 须写 \\d，本文件 JS 字符串再翻倍为 \\\\d。
    files: ["scripts/**/*.mjs"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: 'Literal[regex.pattern="^sha256:[0-9a-f]{64}$"]',
          message: "sha256 revision 形状正则已单源：require SNAPSHOT_HASH_PATTERN from server/shared/version-contract.cjs（seq195 立法）",
        },
        {
          selector: 'Literal[regex.pattern="^sha256:([0-9a-f]{64})$"]',
          message: "sha256 捕获组形状已冻结：复用 SNAPSHOT_HASH_PATTERN.source 或 require 单源（seq195 立法）",
        },
        {
          // seq208：date 形状冻结（scripts 份曾不及面——check-core-business-loop-design:372 存量已收敛 shared/date-contract.mjs）
          selector: 'Literal[regex.pattern="^\\\\d{4}-\\\\d{2}-\\\\d{2}$"]',
          message: "date 形状正则已单源：import DATE_PATTERN from shared/date-contract.mjs（seq208 立法）",
        },
        {
          selector: 'Literal[value="^\\\\d{4}-\\\\d{2}-\\\\d{2}$"]',
          message: "date 形状字符串已冻结：用 DATE_PATTERN 代替字面量（seq208 立法）",
        },
      ],
    },
  },
  {
    // 后端 electron 服务层静态守卫（成熟模式：no-undef + 禁空 catch）
    // 背景（#976）：server/*.cjs 曾完全不在 eslint 扫描范围——后端 JS 无 lint 门禁，
    //   22 处裸 catch{}（cleanup best-effort / sink 抑制）无语义标注。
    // 策略：①no-undef 拦截未定义标识符（对齐 scripts 层 #801 模式）；②no-empty 禁空 catch
    //   （成熟项目禁空 catch——业务判定失败必须 fail-closed 或显式标注）；
    //   存量 cleanup 处用 eslint-disable-next-line no-empty + 语义注释（best-effort 有意的）。
    // 形状立法（seq195 刀3，审计族 R）：sha256/kebab/date/semver/snapshotId 五形状正则
    //   已单源收敛（SNAPSHOT_HASH_PATTERN → version-contract；KEBAB_RE/DATE_RE/SEMVER_RE →
    //   entity-compliance-helpers；snapshotId guard → enums-write-service），单源定义处
    //   行内 eslint-disable + 注释豁免；新代码禁止再写同形状正则/字符串字面量。
    files: ["server/**/*.cjs"],
    ignores: ["server/**/__tests__/**", "server/**/*.test.cjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: {
      "no-undef": "error",
      "no-empty": ["error", { allowEmptyCatch: false }],
      "no-restricted-syntax": ["error", ...serverCjsShapeSelectors],
    },
  },

  // ── server/**/*.mjs 块（WP-129 盲区闭合）──
  // 背景：server/vault-runtime 是 git 跟踪的符号链接（→ scripts/vault-runtime，TheSchema 统一写客户端
  //   schema-write-client.mjs 等 3 件 .mjs 在内）。经该符号链接路径访问时本文件此前无任何块匹配
  //   （server cjs 块只认 .cjs），eslint 解析出 0 条规则（2026-11-06 实测：注入 no-undef＋sha256 形状
  //   违规零报告）；同一物理文件经 scripts/ 真实路径只有 scripts 块的 2 条规则——同一文件两种 lint
  //   身份，server 身份全盲。
  // 规则强度（沿 server 块惯例按适用性取舍，宁少勿错——2026-11-06 勘察，3 件零基线红）：
  //   ①no-undef＋no-empty：与 server cjs 块同强度（勘察 3 件无空 catch、无未定义引用）；
  //   ②no-restricted-syntax 取纯形状立法全集（与模块形态无关，共用 serverShapeLegislationSelectors 单源）；
  //   ③刻意不纳入两条 server cjs 纪律（理据不随路径迁移）：
  //     - PR-056 同步子进程禁令的理据是「请求路径阻塞事件循环」——vault-runtime 是 CLI 工具区，
  //       无请求路径（scripts 块同此口径；勘察 3 件现 0 处同步子进程）；
  //     - SPEC-012 WP-J 裸写禁令——vault-runtime 的 dump-doc-envelope/dump-vocab-envelope 两件恰是
  //       contracts/runtime-scope.json write_primitive_allow 在册写者本体（裸写即其登记能力），
  //       纳入即让契约在册合法写者经本路径假红；schema-write-client.mjs 本体不直接写盘。
  {
    files: ["server/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node, __dirname: "off", require: "off", module: "off" },
    },
    rules: {
      "no-undef": "error",
      "no-empty": ["error", { allowEmptyCatch: false }],
      "no-restricted-syntax": ["error", ...serverShapeLegislationSelectors],
    },
  },

  // ── T2 ②：ADR-004 依赖方向——services 层（生产文件）禁 require 路由层 ──
  // 测试装配（__tests__ require 路由模块做端到端组装）不属层违规，随 ignores 豁免（与形状块口径一致）。
  {
    files: ["server/services/**/*.cjs"],
    ignores: ["server/**/__tests__/**", "server/**/*.test.cjs"],
    rules: {
      "no-restricted-syntax": ["error", ...serverCjsShapeSelectors, {
        selector: "CallExpression[callee.name='require'][arguments.0.value=/routes\\//]",
        message: "ADR-004：依赖方向单向 main→routes→services→shared——services 层不得 require 路由层（端点装配只在 main/routes 完成）",
      }],
    },
  },

  // ── T2 ③：ADR-004 依赖方向——shared 层（生产文件）禁反向 require services/routes ──
  {
    files: ["server/shared/**/*.cjs"],
    ignores: ["server/**/__tests__/**", "server/**/*.test.cjs"],
    rules: {
      "no-restricted-syntax": ["error", ...serverCjsShapeSelectors, {
        selector: "CallExpression[callee.name='require'][arguments.0.value=/routes\\//]",
        message: "ADR-004：下层不得反向 require 上层——shared 层不得 require 路由层",
      }, {
        selector: "CallExpression[callee.name='require'][arguments.0.value=/services\\//]",
        message: "ADR-004：下层不得反向 require 上层——shared 层不得 require services 层（已签收委托实现走下方 per-file 存量豁免，只减不增）",
      }],
    },
  },

  // ── T2 ③ 存量 override（只减不增）：三处已签收的 shared→services 委托实现，非新增欠账 ──
  // 逐处理由（勘察 2026-11-06，出处均为在册工作包决策）：
  // - read-model-port.cjs：查询入口读模型版本（WP-055/SPEC-049）委托 master-graph-service 现算
  //   （WP-056 G-A「DB 真身读取收编——注入分发链不动」）
  // - write-gate-policy.cjs：2026-11-07 摘除——field-rule-declarations 迁住 server/shared 后反向 require 消失（WP-138 commit⑦前直修，只减不增）
  // - action-registry.cjs：经 readOntology 通用咽喉读 ontology（WP-048，形态收口语义与 Wave 0 一致）
  // 清偿路径＝依赖本体下沉 shared 或消费方上移 services；清偿时必须删除对应条目，不得留空壳豁免。
  // 注意：仅对这三个文件关闭方向选择器，形状立法选择器（serverCjsShapeSelectors）保持全量生效。
  {
    files: [
      "server/shared/read-model-port.cjs",
      "server/shared/action-registry.cjs",
    ],
    rules: {
      "no-restricted-syntax": ["error", ...serverCjsShapeSelectors],
    },
  },

  // SPEC-012 WP-J 写禁令豁免（合法写者文件级白名单，沿 :127 先例 per-files 关规则形态）：
  // vault-io（唯一写通道本体）、repo-file-io（repo 侧维护写）、persistence 层（SQLite/库文件写）
  // 是规则的执法对象之外的落法者——对其关闭 server 块 no-restricted-syntax（其余规则仍生效）。
  {
    files: wpjWriterExemptions,
    rules: {
      "no-restricted-syntax": "off",
    },
  },

// seq208 值所有权法则（契约 06）执法：诊断不拥有值——两域禁止从诊断对象读 .value 作为数据源。
// 现值唯一来源=sourceValues（源文档映射）。违规=把诊断值接回渲染/编辑链（seq207 退役的旧线）。
// WP-129 覆盖缺口修复：本块此前对 no-restricted-syntax 整组替换（flat config 同名规则后块覆盖
// 前块），seq184 前端纯净度选择器集在这 3 个目录静默失效（对照实测 2026-11-06：同形状探针在
// schema-manager 咬、在此 3 目录零报告）。现展开合并继承 frontendPuritySelectors 全集——
// seq208 自身立法语义不变（仅追加值所有权选择器），静默失效消除。
// WP-142 波 1：追加展开合并 COPY_MEDIA_SELECTORS——否则本块整组替换会让展示面两族在这
// 3 个 feature 目录静默失效（WP-129 同款覆盖语义；闭集豁免块在文件尾部按文件摘除两族）。
// WP-142 红队复核 F5①：值所有权选择器提取为上方 valueOwnershipSelectors 单源常量（本块消费不变）。
{
  files: [
    "src/features/entity-compliance/**/*.{ts,tsx}",
    "src/features/anomaly-workbench/**/*.{ts,tsx}",
    "src/features/property-gov/**/*.{ts,tsx}",
  ],
  rules: {
    "no-restricted-syntax": ["error", ...frontendPuritySelectors, ...COPY_MEDIA_SELECTORS, ...valueOwnershipSelectors],
  },
},

// ═══ WP-142 波 1（SPEC-091 §2.1／ADR-019 §三.4）闭集豁免块 ═══
// 文案闭集与 HTTP 信封单源文件显式豁免「展示面两族」（COPY_MEDIA_SELECTORS）：闭集是用户文案／
// HTTP 信封的唯一合法介质（ADR-019 §二），新文案写在闭集内合法。flat config 靠后覆盖——
// 本块挂基础纯净度集＋值所有权集（frontendPuritySelectors＋valueOwnershipSelectors），
// 两族新选择器在闭集文件面关闭；
// 基础纯净度集与 seq208 值所有权面之外的其余规则（react-hooks 等）不受本块影响，
// 闭集不是自由区（闭集文件对其他规则的违规照常吃基线棘轮）。
// 位置纪律：本块必须位于 seq208 值所有权块之后——property-gov-copy.ts 与
// anomaly-workbench-copy.ts 两个闭集文件落在 seq208 三目录内，靠后覆盖才能压住该块的整组替换
// （WP-129 覆盖语义）。该整组替换曾连带丢弃这两文件的值所有权执法面（此前注释误写为
// 「无执法面损失」——两文件虽为标签模块，执法面确实变窄，属如实失实）；WP-142 红队复核
// F5① 已将 valueOwnershipSelectors 并进本块数组恢复：这两文件面恢复为
// 基础纯净度集＋值所有权集（执法面完整）；本块其余 8 个闭集文件同获值所有权执法
// （均为标签/状态/信封单源模块，不触诊断对象 .value，lint 全量实测零误伤）。
// 闭集清单新增＝SPEC 变更（ADR-019 §三.4）；闭集文件逐个单列，不用目录 glob（红队 F2）。
{
  files: [
    "src/constants/term-const.ts", // 文案闭集母体：term-const.ts 术语词表单源（全站 TERM 消费）——单列文件名不用目录 glob（红队 F2：目录 glob 会让未来放进该目录的文件静默入闭集，ADR-019 §三.4 闭集仪式必须真实可审）
    "src/features/property-gov/property-gov-copy.ts", // property-gov 页级文案单源
    "src/features/anomaly-workbench/anomaly-workbench-copy.ts", // anomaly-workbench 页级文案单源
    "src/features/anomaly-workbench/action-routing-reasons.ts", // anomaly 动作路由豁免/待定理由声明串单源（WP-150 入册——独立叶子防 copy↔routing 初始化期双向依赖）
    "src/features/theme-preview/theme-preview-copy.ts", // theme-preview 页级文案单源（WP-147 二期尾项入册，token 预览镜像对账仍按 ThemePreviewView 原文执法）
    "src/features/document-inventory/components/article-panorama-labels.ts", // 文章全景标签单源
    "src/features/document-inventory/components/document-result-field-labels.ts", // 文档结果字段标签单源
    "src/features/schema-manager/dangling-kind-labels.ts", // 悬空类型标签单源
    "src/features/schema-manager/schema-manager-copy.ts", // schema-manager 页级文案单源（WP-149 散写销账入册，ADR-019 §三.4 仪式）
    "src/features/review/review-copy.ts", // review 页级文案单源（WP-150 散写销账入册，ADR-019 §三.4 仪式）
    "src/features/gap-engine/gap-engine-copy.ts", // gap-engine 页级文案单源（WP-151 散写销账入册，ADR-019 §三.4 仪式）
    "src/features/approval-workbench/approval-workbench-copy.ts", // approval-workbench 页级文案单源（WP-151 散写销账入册，ADR-019 §三.4 仪式）
    "src/features/article-workflow/article-workflow-copy.ts", // article-workflow 页级文案单源（WP-151 散写销账入册，ADR-019 §三.4 仪式）
    "src/features/impact-analysis/impact-analysis-copy.ts", // impact-analysis 页级文案单源（WP-151 散写销账入册，ADR-019 §三.4 仪式）
    "src/features/document-inventory/document-inventory-copy.ts", // document-inventory 页级文案单源（WP-151 散写销账入册，ADR-019 §三.4 仪式；字段名仍住同目录两 labels 模块）
    "src/features/data-dashboard/data-dashboard-copy.ts", // data-dashboard 页级文案单源（WP-152 收官批入册，ADR-019 §三.4 仪式）
    "src/features/entity-compliance/entity-compliance-copy.ts", // entity-compliance 页级文案单源（WP-152 收官批入册，ADR-019 §三.4 仪式；落在 seq208 三目录内——本块靠后覆盖同 property-gov-copy）
    "src/features/admission/admission-copy.ts", // admission 页级文案单源（WP-152 收官批入册，ADR-019 §三.4 仪式）
    "src/features/article-associations/article-associations-copy.ts", // article-associations 页级文案单源（WP-152 收官批入册，ADR-019 §三.4 仪式）
    "src/features/architecture-version/architecture-version-copy.ts", // architecture-version 页级文案单源（WP-152 收官批入册，ADR-019 §三.4 仪式；差异字段名仍住同目录 version-diff-field-labels）
    "src/features/dashboard/dashboard-copy.ts", // dashboard（运行概览）页级文案单源（WP-152 收官批入册，ADR-019 §三.4 仪式）
    "src/components/components-copy.ts", // components 共享组件库＋App 外壳文案单源（WP-152 收官批入册，ADR-019 §三.4 仪式）
    "src/lib/lib-copy.ts", // lib 层文案单源：请求兜底/写门阻断中文化/本体校验理由/导航诊断/防区显示名/schema 分区与页签正名镜像（WP-152 收官批入册，ADR-019 §三.4 仪式）
    "src/features/architecture-version/components/version-diff-field-labels.ts", // 版本对比字段标签单源
    "src/lib/domain/StatusDisplay.ts", // 状态展示投影单源（枚举→用户文案）
    "src/lib/domain/RelationProvenance.ts", // 关系来源分组标签单源（RELATION_SOURCE_GROUPS 正名，与 dangling-kind-labels 同形态）
    "src/lib/domain/EntityCategory.ts", // 实体类别正名具名出口（类别名＝数据值，satisfies 钉生成物值域；与 RelationProvenance 同形态，WP-152 入册）
    "src/lib/domain/ConclusionEffectLabels.ts", // 推断冲突「采用结论」效果四词标签单源（存量 labels 模块，WP-152 入册）
    "src/lib/api.ts", // HTTP 信封单源：apiFetchEnvelope 本体，裸 fetch 是其登记能力（ADR-019 §二）
  ],
  rules: {
    "no-restricted-syntax": ["error", ...frontendPuritySelectors, ...valueOwnershipSelectors],
  },
},

// ═══ WP-142 波 1（SPEC-091 §2.1 注释豁免面）测试豁免块 ═══
// src/test/** 的中文是断言夹具与行为描述（测试自身即其「闭集」），不是用户可见文案介质——
// SPEC-091 §2.1 签收文本明写「注释豁免面：src/test/** 断言」，与闭集块同机制（只摘两族、
// 保留基础纯净度集），故测试区不进基线、不占销账规模（波 3 射程＝生产展示面）。
{
  files: ["src/test/**"],
  rules: {
    "no-restricted-syntax": ["error", ...frontendPuritySelectors],
  },
}
);
