// Component: Dev-Log-Role-Registry
// @responsible: 角色身份与辖区功能总结的唯一事实源。
//   投影脚本（project-to-vault.mjs）与任何需要「人名 / 职责 / 辖区功能」的地方一律引用本文件，
//   不得在各处复制角色名与职责。zone_summary 是该角色辖区「负责什么功能」的人读总结——
//   静态写一次，投影渲染到每个角色页签顶部，让"每个角色负责什么"一眼可见。
//
// 与 OWNER_ZONE_PREFIXES（scripts/quality/shared/dev-log-ledger.mjs）是同一组角色的两个互补视图：
//   本文件管"人读身份 + 辖区功能总结"（投影用）；ledger 管"机器合规"（门禁越界判定用）。
// 键取自 contracts/dev-log.schema.json 的 owner 枚举（唯一事实源），勿在此增删键。
//
// 零改动搬运自源库（架构图系统-rebuild）同名文件：角色花名/职责/矩阵与源库一致
//（本仓 contracts/dev-log.schema.json 与源库同源，owner 枚举不变）；
// 仅 zone_summary 内个别目录描述按本仓实况微调（shared/ 归殷联枢）。
// 命名来源：dev-log 专家团角色花名（程定理/方织页/…），与 schema owner 枚举一一对应。

export const OWNER_META = {
  "domain-core-engineer": {
    name: "程定理",
    duty: "领域内核（contracts · src/lib/domain · 本体契约）",
    zone_summary:
      "负责系统的领域模型与契约地基：本体（ontology）、实体身份与版本语义、状态机与流转规则，以及跨端共享类型（src/types、shared）与规则契约（contracts/*.schema.json）。一切业务语义的事实源都在这里——前端只派生不重写，避免多份真相。改动牵一发动全身，故重型任务（W5）多集中于此。",
  },
  "feature-module-engineer": {
    name: "方织页",
    duty: "功能模块（src/features/）",
    zone_summary:
      "负责业务特性在 src/features/ 的内聚实现：每个 feature 自含页面流程、特性内状态与用例编排，依赖领域内核提供的类型与契约，不跨 feature 互相引用。是「用户能点到的功能」的落点——新建 feature 还是扩现有 feature 的边界判断在此角色。",
  },
  "ui-component-engineer": {
    name: "袁构呈",
    duty: "UI 组件（src/components · styles · hooks）",
    zone_summary:
      "负责可复用 UI 资产：src/components 公共组件、src/styles 设计令牌与样式体系、src/hooks 交互原语、src/constants 常量。向下承接 feature 的 UI 需求，向上沉淀公共件——某块 UI 该不该下沉成公共组件、样式令牌怎么统一，边界判断在此角色。",
  },
  "server-api-engineer": {
    name: "殷联枢",
    duty: "服务端 API（server/ · OpenAPI · 生成类型）",
    zone_summary:
      "负责服务端：server/ 路由与服务、contracts/http-api.openapi.json HTTP 契约、由契约生成的 src/lib/generated 类型与 src/lib/api.ts 客户端封装，以及跨端共享载体 shared/。前后端字段对齐、入参校验、契约演进都在这里——契约先行，前端只消费生成类型，不手搓字段。",
  },
  "quality-gate-engineer": {
    name: "秦执规",
    duty: "质量门禁（scripts/quality · e2e · 测试）",
    zone_summary:
      "负责质量门禁的「执行面」：scripts/quality 检查器与校验链、scripts/e2e 与 test/ 单元/E2E、coverage 覆盖率。门禁的「跑」与「断言」在此——谁写的门禁谁修（owner 字段），但注册与治理归秦执队（保安队长）。",
  },
  "progress-synthesizer": {
    name: "解监理",
    duty: "进度梳理（docs/dev-log 只读·不碰业务代码）",
    zone_summary:
      "负责只读巡检与进度合成：扫 docs/dev-log 台账与 progress.json，汇总各活跃任务的真实状态，发现「该总结没总结」「已解决又复现」等异常并上报（dev.task.regressed 即由其记）。只读不写业务代码——是监理不是施工方，异常交主理人派发。",
  },
  "guard-captain": {
    name: "秦执队",
    duty: "保安队长（门禁治理：注册启停·健康度·冲突仲裁）",
    zone_summary:
      "负责门禁的「治理面」：contracts/quality-gates.json 的注册/启停/元数据，docs/dev-log/gate-health.md 健康度分析（哪些门禁死寂、哪些常败），以及多门禁同域断言冲突的仲裁。与秦执规的「执法/执行」正交——一个跑门禁，一个管门禁，职责不混。",
  },
  "team-lead": {
    name: "阚定界",
    duty: "主理人（统筹·总账文件·跨域协调）",
    zone_summary:
      "负责全局统筹：REQUIREMENTS.md 总账与跨域协调，裁决无主目录/过期前缀等总监待办，把解监理发现的异常（待总结、假解决）派发到对应角色。是合流者——前缀覆盖全仓是设计而非漏配，旨在兜底任何未被专属辖区认领的目录。",
  },
};

// 人名 · 职责 的快捷标签（供需要单行标识处引用）。
export const OWNER_LABELS = Object.fromEntries(
  Object.entries(OWNER_META).map(([k, v]) => [k, `${v.name}·${v.duty}`]),
);

// ── 统一责任矩阵（角色 × 职能域）── 单一事实源。
//   单元格 = 性质：register=登记（注册 / 记录归属）、execute=执行（做）、arbitrate=分析仲裁（治理 / 裁决）。
//   同一份数据派生三视图（见 project-to-vault.mjs）：①网格 ②按性质分列 ③竖读每列 = 职能矩阵（该域谁主责）。
//   来源 = 用户裁定：各角色主责一个职能域，秦执规只「执行」门禁、秦执队只「登记 / 分析仲裁」门禁——执行与仲裁彻底分离（SoD）。
export const RESPONSIBILITY_NATURE = {
  register: "登记",
  execute: "执行",
  arbitrate: "分析仲裁",
};

// 职能域（列）。命名对齐 dev-log 专家团辖区，与 OWNER_ZONE_PREFIXES 互补（那是目录区，这是职能域）。
export const RESPONSIBILITY_DOMAINS = [
  { key: "coord", name: "统筹" },
  { key: "ledger", name: "进度台账" },
  { key: "domain", name: "领域契约" },
  { key: "server", name: "服务端接口" },
  { key: "feature", name: "业务功能" },
  { key: "ui", name: "UI 呈现" },
  { key: "gateExec", name: "门禁执行" },
  { key: "gateGov", name: "门禁治理" },
];

// 角色（行）顺序——对齐用户裁定表的呈现次序。
export const RESPONSIBILITY_ROW_ORDER = [
  "team-lead",
  "progress-synthesizer",
  "quality-gate-engineer",
  "guard-captain",
  "domain-core-engineer",
  "server-api-engineer",
  "feature-module-engineer",
  "ui-component-engineer",
];

// 角色 → { 职能域 key: { n: 性质数组, light?: true } }。light = 分析仲裁(轻量)。
// 这是矩阵的唯一事实源；投影据此渲染网格 / 按性质分列 / SoD 体检，绝不另立硬编码常量。
export const ROLE_RESPONSIBILITY = {
  "team-lead": { coord: { n: ["register", "arbitrate"] } },
  "progress-synthesizer": { ledger: { n: ["register", "arbitrate"], light: true } },
  "quality-gate-engineer": { gateExec: { n: ["execute"] } },
  "guard-captain": { gateGov: { n: ["register", "arbitrate"] } },
  "domain-core-engineer": { domain: { n: ["register", "execute"] } },
  "server-api-engineer": { server: { n: ["register", "execute"] } },
  "feature-module-engineer": { feature: { n: ["execute"] } },
  "ui-component-engineer": { ui: { n: ["execute"] } },
};
