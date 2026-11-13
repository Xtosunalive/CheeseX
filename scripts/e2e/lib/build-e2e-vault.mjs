#!/usr/bin/env node
// E2E Vault 构建器（PR-013 3B nightly CI 配套）：从零产出一个可跑全量 e2e 的最小 Obsidian Vault。
//
// 【为什么需要它】e2e 五脚本需要 VAULT_PATH 指向一个带 知识库/ 结构的 Vault（entities 源文档 +
// TheSchema 词表 + master_graph + releases）。9-16 实跑用的是手工自建 /tmp vault（临时脚本未落仓），
// 本脚本把那次的做法固化成可复用入口——CI nightly 与本地验收同源，不再依赖开发者手搓。
//
// 【产物结构】（基于 test/fixtures/minimal-vault 同源配方 + e2e 实跑验证过的增补）
//   <target>/
//   ├── 知识库/wiki/entities/*.md            # 实体源文档（含 1 个缺字段可修复实体——Step 6b 断言面）
//   ├── 知识库/raw/precleaned/*.md           # 候选文章（Step 4 造数兜底目录同源）
//   ├── 知识库/TheSchema/enums.yaml          # 词表（modules/layers 与实体声明自洽；lifecycle 段＝产品主源单源）
//   ├── 知识库/TheSchema/versions.yaml       # 版本注册表
//   ├── 知识库/TheSchema/ontology.yaml       # 本体（关系 capability）
//   ├── 知识库/TheSchema/dependencies.yaml
//   ├── 知识库/architecture/E2eProduct/1.0.0/{semantic_architecture,architecture_layout}.json
//   ├── 知识库/.claude/scripts/pipeline-runner.py   # 从 minimal-vault fixture 复制（pipeline 消费）
//   ├── .ledger/master_graph.json          # 图谱（含 1 个 Document 节点 → 触发「缺失实体模板」CREATE 分支）
//   └── .releases/ (同级)                     # 发布定版新家（WP-023）…原注：.git/anyshare-releases），
//                                            #   并为 e2e 写回链提供 git 上下文；git init 一次即可
//
// 【health ready 语义】/api/health readyState=ready 要求 dashboardRoutes+formalConsumer+schemaRuntime
// 三者装配成功——formalConsumer 需要 release runtime 能解析 current release（或至少不炸装配），
// schemaRuntime 需要 schema 配置齐全。以上结构经实跑验证满足装配（装配失败只 warn 不致命，但
// readyState=partial 会被 e2e Step 1 拦下）。
//
// 【已知边界（2026-10-03 首次全量实跑实录；2026-10-04 PR-014/015 修复后更新）】
// - ✓ entity / relation-review / dashboard 三流全绿；
// - ✓ schema 流（PR-015 修复）：Step 1=enums.yaml layers 补契约字段 color/layout；Step 4=7b 节
//   正规链建 release（collectCompleteArtifacts→builder.build→current.json）；
// - ✓ article 流（PR-014 方案 A，Master 裁决 2026-10-04）：validate/promote-article.py 复制进
//   fixture（知识库/.claude/scripts/），夹具同路径供给；运行时 PYTHON_PATH 须指向带 PyYAML 的
//   解释器（server/shared/python-path.cjs 语义，.env 已配）。
//
// 用法：
//   node scripts/e2e/lib/build-e2e-vault.mjs                          # → /tmp/cheese-e2e-vault（存在则报错）
//   node scripts/e2e/lib/build-e2e-vault.mjs --target /tmp/cheese-e2e --force
//   node scripts/e2e/lib/build-e2e-vault.mjs --print-path             # 只打印目标路径（CI 编排用）
// 退出码：0=建成（stdout 末行 VAULT_PATH=<abs>）；1=目标已存在（未 --force）/写入失败。
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import vocabLoadPort from "../../../server/shared/vocab-load-port.cjs"; // 词表装载端口（W4 收官出口）——产品主源/夹具词表读数一律经端口，禁直读（集成态对账直修）

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const FIXTURE_VAULT = path.join(REPO_ROOT, "test", "fixtures", "minimal-vault");

// ── CLI ──
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};
const TARGET = flag("target") || "/tmp/cheese-e2e-vault";
const FORCE = args.includes("--force");
const PRINT_PATH = args.includes("--print-path");

if (PRINT_PATH) {
  console.log(path.resolve(TARGET));
  process.exit(0);
}

function fail(message) {
  console.error(`✗ build-e2e-vault: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(FIXTURE_VAULT)) fail(`fixture vault 不存在：${FIXTURE_VAULT}（minimal-vault 是词表/本体/pipeline-runner 的单源）`);
// PR-165（DDL 单源双端执行）：替身生成已退役——document_index DDL 唯一文本住
// scripts/vault-py/graph/document_index.sql（与真抽取器同源），构建时投递给桩（见 §5）。
if (fs.existsSync(TARGET) && !FORCE) fail(`目标已存在：${TARGET}（如确认可覆盖请加 --force）`);
if (fs.existsSync(TARGET) && FORCE) {
  // 自起受控栈暴露的缺口（runtime-scope 波1）：schema 流会在 fixture 内晋升 release，产物按
  // read-only-evidence 纪律 chmod 0444/0555 封存——不先恢复写权限 rmSync 即 ENOTEMPTY/EPERM。
  const chmodTree = (p) => {
    try { fs.chmodSync(p, 0o755); } catch { /* 已不可达则交 rm 处理 */ }
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, e.name);
      if (e.isDirectory()) chmodTree(full);
      else { try { fs.chmodSync(full, 0o644); } catch { /* 只读件尽力而为 */ } }
    }
  };
  chmodTree(TARGET);
  fs.rmSync(TARGET, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

const target = path.resolve(TARGET);
const KB = path.join(target, "知识库");

function write(rel, content) {
  const file = path.join(target, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}
function copyFromFixture(rel) {
  const src = path.join(FIXTURE_VAULT, rel);
  if (!fs.existsSync(src)) fail(`fixture 缺文件：${rel}`);
  return write(rel, fs.readFileSync(src));
}

console.log(`▸ 构建 e2e vault → ${target}`);

// ── 1. 词表/本体/版本注册表 ──
// enums 不从 fixture 复制——fixture 词表是 pipeline 专用配方（fixture-module/无 layers），
// e2e 实体声明的是 e2e-module/service 层状态，两者不一致会让「完整实体」也报
// F11/F15 假红（首次实跑实录：应呈现 3 个中文名里 产品模块 缺失）。词表必须与下方实体
// 自洽：modules 覆盖 e2e-module、layers 覆盖 service。
// WP-138 R3（PR-262）：lifecycle 段去手写——夹具只允许「产品会接受的数据」，status 域整段
// 自产品主源 data/theschema/enums.yaml 搬入（四受控值＋盖章缺省＋legacy_status_map 映射）。
// PR-262 事故（系统盖章默认「灰度」不在夹具手写三值里，修复旅程永远修不平）根因即本段
// 手写与产品状态机脱钩；夹具与产品主源的一致性由此构造性成立（构建期对账见 §8）。
const PRODUCT_ENUMS_PATH = path.join(REPO_ROOT, "data", "theschema", "enums.yaml");
// 经词表装载端口读产品主源（resolveTheSchemaDir 回落档=data/theschema）——端口外直读即 vocab-load-port 红
const productEnumsFile = vocabLoadPort.loadVocabBundle(REPO_ROOT, { files: ["enums"] }).files.enums;
const productLifecycle = productEnumsFile && productEnumsFile.state === "present" && productEnumsFile.data
  ? productEnumsFile.data.lifecycle
  : null;
if (
  !productLifecycle
  || !Array.isArray(productLifecycle.status) || productLifecycle.status.length === 0
  || typeof productLifecycle.default_status !== "string" || !productLifecycle.default_status
) {
  fail(`产品词表 lifecycle 段不可用：${PRODUCT_ENUMS_PATH}（status 须非空数组、default_status 须非空字符串——夹具不自造词表，缺了就红）`);
}
// 顶层对象序列化后整体缩进两格，嵌进 lifecycle: 键下（与产品主源同结构，非平铺抄值）
const LIFECYCLE_YAML = stringifyYaml(productLifecycle).trimEnd().split("\n").map((l) => `  ${l}`).join("\n");
// layers[].color/layout 为契约必填（SchemaLayerDefinition required；PR-015 勘误：首跑时
// 缺此二字段致 GET /api/schema/enums 被 enforce 拦截 500，schema-manager 页走 error 分支，
// Step 1 地标断言红——原「缺发布快照数据」定性有误，实为夹具词表违反契约）。
write("知识库/TheSchema/enums.yaml", `modules:
  e2e-module:
    description: E2E vault module used by entity compliance tests.

layers:
  - id: external
    label: 外部系统
    color: slate
    layout: right-panel
  - id: gateway
    label: 接入网关
    color: amber
    layout: central
  - id: service
    label: 业务服务
    color: blue
    layout: left-panel
  - id: foundation
    label: 基础设施
    color: stone
    layout: left-panel

lifecycle:
${LIFECYCLE_YAML}

domains:
  ops: 运维

subdomains:
  ops: [maintain]

article_types: [排错指南]
doc_types: [用户手册]

architecture_projection:
  product: E2eProduct
  version: 1.0.0
  projected_relation_types:
    - DEPENDS_ON
    - DOCUMENTS
    - APPLIES_TO
    - BELONGS_TO
    - ASSOCIATED_WITH
    - REFERENCES
    - HAS_SYMPTOM
  wikilink_type_labels:
    依赖: DEPENDS_ON

arch_categories:
  - 应用组件
  - 服务
  - 概念
  - 子域

concept_types:
  - symptom
`);
write("知识库/TheSchema/versions.yaml", fs.readFileSync(path.join(FIXTURE_VAULT, "知识库", "TheSchema", "versions.yaml"), "utf8")
  .replace(/FixtureProduct/g, "E2eProduct"));
copyFromFixture("知识库/TheSchema/ontology.yaml");
// WP-171/172：夹具本体是精简快照——仓内 ontology.yaml 的 action_types/risk_types 随立法演进
// （drafts-validate 动作化、审批通道、retire 风险绑定），动作注册表在 vault 侧解析、缺条目即
// ACTION_NOT_ACTIVE 500（e2e 实录：WP-171 后 validate 步红、quality 不跑 e2e 故 CI 假绿）。
// 投影＝route-harness mergeW1aActionTypes 同款：整节以仓内为准覆盖夹具快照。
{
  const fs = await import("node:fs").then((m) => m.default);
  const path = await import("node:path").then((m) => m.default);
  const YAML = await import("yaml").then((m) => m.default);
  const repoOntology = YAML.parse(fs.readFileSync(path.join(__dirname, "..", "..", "..", "data", "theschema", "ontology.yaml"), "utf8")) || {};
  const fixtureOntologyPath = path.join(target, "知识库/TheSchema/ontology.yaml");
  const fixtureOntology = fs.existsSync(fixtureOntologyPath) ? (YAML.parse(fs.readFileSync(fixtureOntologyPath, "utf8")) || {}) : {};
  if (repoOntology.action_types) fixtureOntology.action_types = repoOntology.action_types;
  if (repoOntology.risk_types) fixtureOntology.risk_types = repoOntology.risk_types;
  fs.writeFileSync(fixtureOntologyPath, YAML.stringify(fixtureOntology));
}
write("知识库/TheSchema/dependencies.yaml", "rules: []\n");
// ADR-008 D2：字段数据字典进夹具（check:fields-registry 声明集——覆盖消费锚点全部字段的最小字典）。
write("知识库/TheSchema/fields.yaml", `schema_version: 1
fields:
  - name: title
    label: 显示名
    type: string
    required: 是
    scope: [entity, article]
    layer: 内容属性
    description: E2E 夹具字典（最小集——覆盖三消费锚点字段）。
  - name: module
    label: 模块
    type: list
    required: 是
    scope: [entity, article]
    layer: 业务属性
    description: 模块匹配名列表。
  - name: product
    label: 产品
    type: enum
    required: 是
    scope: [article]
    layer: 业务属性
    description: 文章所属产品。
  - name: article_type
    label: 文章类型
    type: enum
    required: 是
    scope: [article]
    layer: 内容属性
    description: 标准文章类型。
  - name: doc-type
    label: 文档类型
    type: enum
    required: 是
    scope: [article]
    layer: 内容属性
    aliases: [doc_type]
    description: 文档形态类型。
  - name: version
    label: 产品版本
    type: enum
    required: 是
    scope: [article]
    layer: 业务属性
    description: 文章针对的产品版本。
  - name: category-path
    label: 分类路径
    type: string
    required: 是
    scope: [entity, article]
    layer: 内容属性
    description: 三段式分类路径。
  - name: arch_layer
    label: 架构层级
    type: enum
    required: 是
    scope: [entity, article]
    layer: 业务属性
    description: 架构层。
  - name: arch_category
    label: 业务分类
    type: enum
    required: 是
    scope: [entity, article]
    layer: 业务属性
    description: 业务分类。
  - name: arch_subdomain
    label: 子域
    type: enum
    required: 建议
    scope: [entity, article]
    layer: 业务属性
    description: 技术子域。
  - name: tags
    label: 标签
    type: list
    required: 否
    scope: [entity, article]
    layer: 内容属性
    description: 检索标签。
  - name: status
    label: 状态
    type: enum
    required: 是
    scope: [entity, article]
    layer: 管理属性
    description: 页面/文档生命周期状态。
`);

// ── 2. 架构投影产物（vault-paths 按 enums.yaml architecture_projection 解析路径）──
write("知识库/architecture/E2eProduct/1.0.0/semantic_architecture.json", JSON.stringify({ generatedAt: "2026-01-01T00:00:00.000Z", nodes: [], connections: [] }, null, 2) + "\n");
write("知识库/architecture/E2eProduct/1.0.0/architecture_layout.json", JSON.stringify({ generatedAt: "2026-01-01T00:00:00.000Z", positions: {} }, null, 2) + "\n");

// ── 3. 实体源文档 ──
// 完整实体：通过全部检查（对照组，防「全是坏实体」掩盖扫描面）。
// F07/F08（arch_since/arch_until）是 semver 校验且 onEmpty:warn——空值只产「建议填」warn，
// 但修复预览的写门按 semver 严格校验：Step 7 的 e2e 时间戳文本若落在 arch_since 输入框，
// preview 必 400「必须是 semver」（首次实跑实录）。故完整实体把 since/until 填成合法 semver，
// 让首输入框稳定落在纯文本字段（aliases/architecture-node-id），预览链路不因造数形状偶发红。
// WP-138 R3：status 取产品会盖章的值＝产品词表 lifecycle.default_status（PR-262：旧手写值
// 「制定中」属 legacy 域，产品盖章面是四值缺省——夹具 frontmatter 与盖章语义同源）。
write("知识库/wiki/entities/e2e-complete-component.md", `---
title: E2E Complete Component
architecture-node-id: e2e-complete-component
arch_component: true
arch_layer: service
arch_category: 服务
arch_subdomain: maintain
arch_since: 1.0.0
arch_until: 9.9.9
module: e2e-module
status: ${productLifecycle.default_status}
date: 2026-01-01
updated: 2026-01-01
aliases: [e2e-alias]
tags: [e2e]
---

# E2E Complete Component

依赖::[[e2e-incomplete-component]]
`);
// 缺字段实体：F01 title / F02 node-id / F03 arch_component / F16 tags 等多条 !passed∧editable∧field
// 检查——Step 6b 断言「应呈现中文名」的驱动数据（抽屉里中文控件名须逐个可见）。
const incompleteEntity = `---
title: E2E Incomplete Component
architecture-node-id: e2e-incomplete-component
arch_component: true
arch_layer: service
arch_category: 服务
arch_subdomain: maintain
module: e2-test-module
status: 灰度
date: 2026-10-08
updated: 2026-10-08
tags: [e2e]
---

# E2E Incomplete Component

原缺字段可修复实体（常驻造数）。PR-302 批补齐必填：治理流铸版闸（ENTITY_COMPLIANCE_BLOCKED）
扫全库实体，常驻残缺＝铸版恒红（CI nightly 三连红实录）；修复流的中文 label 驱动数据
已改为自造测试实体（e2e-test-entity-<pid>，Step4 兜底造数），不依赖此件残缺。
`;

// ── 4. 候选文章（Step 4 兜底造数目录同源；本身合法不产生阻断）──
write("知识库/raw/precleaned/e2e-candidate-article.md", `---
article_id: e2e-candidate-001
title: E2E 候选文章
product: E2eProduct
version: "1.0.0"
module: e2e-module
article_type: 排错指南
doc-type: 用户手册
category-path: ops.maintain
arch_layer: service
arch_category: 服务
tags: "[e2e, 候选]"
architecture_associations: []
---

# E2E 候选文章

用于验证候选文章扫描面（源文档检查页第二条数据链）。
`);

// ── 5. 运行时脚本供给（PR-016 三期 2026-10-04：fixture 复制件退役，仓内单源）──
// pipeline-runner.py 仍从 fixture 复制——那是 164 行专用 stub（a6acfe8 先例，供 dashboard 流
// staging 门控模拟），与 scripts/vault-runtime/ 的 1646 行真 runner 故意不同；e2e 起服务时经
// VAULT_RUNTIME_SCRIPTS_DIR 显式指 vault，保持 dashboard 流消费 stub（真 runner 编排 12 个 B 类
// 脚本按 vault 相对路径，minimal vault 跑不动）。stub 本身是测试资产而非 Vault 脚本副本，留 fixture。
copyFromFixture("知识库/.claude/scripts/pipeline-runner.py");
// PR-165：投递 document_index DDL 单源文件（真身 scripts/vault-py/graph/document_index.sql）——
// 桩与真抽取器执行同一份（投递面由元执法测试钉住：桩的文件依赖必须在复制清单与 §8 自检清单）。
write(
  "知识库/.claude/scripts/document_index.sql",
  fs.readFileSync(path.join(REPO_ROOT, "scripts", "vault-py", "graph", "document_index.sql")),
);
// 六个 A 类脚本：仓内 scripts/vault-runtime/ 是唯一事实源（PR-016 一/二期迁入），建库时直接
// 投影到 vault 约定路径——运行时行为不变（article 流 spawn vault 位、resolver 仓内优先双轨一致），
// 但仓内不再有第二份复制件，漂移问题物理消失（PR-014 双源治理的终局形态）。
// 运行时需 PYTHON_PATH 指向带 PyYAML 的解释器（python-path.cjs 语义；本机 .env 已配 3.10 框架 python）。
const RUNTIME_DIR = path.resolve(__dirname, "..", "..", "vault-runtime");
function copyFromRuntime(name) {
  const src = path.join(RUNTIME_DIR, name);
  if (!fs.existsSync(src)) fail(`scripts/vault-runtime 缺文件：${name}（A 类运行时脚本唯一事实源）`);
  return write(`知识库/.claude/scripts/${name}`, fs.readFileSync(src));
}
// SPEC-022 波 B：校验器族＝统一客户端＋其库——symlink 而非拷贝（真实路径解析回仓，依赖 require 链可达）
function symlinkFromRuntime(name) {
  const src = path.join(RUNTIME_DIR, name);
  if (!fs.existsSync(src)) fail(`scripts/vault-runtime 缺文件：${name}（A 类运行时脚本唯一事实源）`);
  const dest = path.join(target, `知识库/.claude/scripts/${name}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.symlinkSync(src, dest); // 绝对符号链——node require 经真实路径解析回仓（依赖链可达），非拷贝
}
symlinkFromRuntime("schema-write-client.mjs");
symlinkFromRuntime("article-validator-lib.cjs");
// SPEC-022 波 B：e2e vault 补解析物（校验器必填集/值域单源——真库不变量由 derivation-sync 保，
// e2e 由本构建器保）。经仓内生成器派生，不手写副本。
execFileSync(process.execPath, [path.resolve(REPO_ROOT, "scripts/quality/project-resolved-domains.mjs")], {
  // V11 收编后投影写经 repoWrite 目的地执法——fixture 的 TheSchema 须显式钉 THESCHEMA_DIR
  // （钉扎领地合法；不钉则隐式窗口写被 SPEC-021 fail-closed 拦截，构建器即崩——2026-10-27 终验抓出）
  env: { ...process.env, VAULT_PATH: target, THESCHEMA_DIR: path.join(target, "知识库", "TheSchema") },
  stdio: "inherit",
});
copyFromRuntime("promote-article.py");
copyFromRuntime("kb_paths.py");
copyFromRuntime("generate-sa.py");
copyFromRuntime("schema_loader.py");
copyFromRuntime("sa_projection_support.py");
// 库模块（SPEC-011 §三·附：入口 import 的同目录依赖）——漏拷即 ImportError（2026-10-14 e2e 实证：
// fixture 位 promote-article.py import _vault_ledger 失败；主仓既有缺口，随 SPEC-012 验收补上。
// 2026-10-30 PR-166 同族复发：65aee107 批①把 Python 写者迁 write_gateway 后本清单未跟上，
// 钉 VAULT_RUNTIME_SCRIPTS_DIR 形态（CI nightly）promote/sa_projection_support import 即崩——
// 新增依赖须同步「投递面元执法」泛化测试（document-index-ssot.test.cjs 全量 import 对账）
copyFromRuntime("_vault_ledger.py");
copyFromRuntime("vocab_envelope.py"); // WP-049 L3：schema_loader 的信封依赖（同目录投递）
copyFromRuntime("doc_envelope.py"); // WP-117 批2：文档信封接收器（doc_consumption 同目录依赖）
copyFromRuntime("doc_consumption.py"); // WP-155：classify/generate-sa 的文档消费件（同目录投递；validate_classification 已于 WP-156 退役）
copyFromRuntime("identity_port.py"); // WP-051：extract_graph 合并键的身份入口依赖（同目录投递）
copyFromRuntime("_runtime_state_db.py"); // SPEC-012 WP-A：sa_projection_support/pipeline 消费
copyFromRuntime("write_gateway.py"); // runtime-scope 批①（65aee107）：promote-article/sa_projection_support 消费
copyFromRuntime("human_edit_guard.py"); // WP-015（67561251）：write_gateway.write_text_atomic 函数级 import 的裁决门
// 契约投影（schema_loader 的 _CONTRACTS_DIR 按「脚本位 ../../contracts」推导——真仓经 symlink
// import 落 repo 侧自然命中；fixture 位是真实文件，需把 registry＋登记的 schema 投影进
// 知识库/contracts，否则 validate 链 FileNotFoundError→stdout 空→Node 侧按 warnings 200 假绿）
for (const name of [
  "theschema.registry.json",
  "enums.schema.json",
  "theschema.article_associations.schema.json",
  "theschema.dependencies.schema.json",
  "theschema.ontology.schema.json",
  "theschema.versions.schema.json",
]) {
  write(`知识库/contracts/${name}`, fs.readFileSync(path.join(REPO_ROOT, "contracts", name)));
}

// ── 6. master_graph 双位同构（SPEC-012 wave-2 类消收敛，Master 裁 2026-10-15）──
// 现行位＝repo 侧 data/staging（管线门控/ingest 读这里）；旧位＝vault .ledger（仅喂 boot
// importLegacyGraphArtifacts 迁移链——导入即删，此后旧位为空：任何旧位读者与生产一致地读不到，
// 路径漂移当场红，夹具不再当包庇犯）。1 个 Document 节点（module=e2e-module 但无
// Module/ArchitectureComponent 实体节点）→ missingEntityResults 走 CREATE 分支（第二个修复入口形态）。
const FIXTURE_MASTER_GRAPH = JSON.stringify({
  version: "1.0.0",
  generatedAt: "2026-01-01T00:00:00.000Z",
  nodes: [
    {
      id: "doc-e2e-candidate-001",
      label: "E2E 候选文章",
      category: "其他",
      labels: ["Document"],
      properties: {
        title: "E2E 候选文章",
        file_path: "知识库/raw/precleaned/e2e-candidate-article.md",
        source_path: "知识库/raw/precleaned/e2e-candidate-article.md",
        module: "e2e-module",
      },
    },
  ],
  connections: [],
}, null, 2) + "\n";
const buildDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-vault-build-data-"));
process.env.KB_DATA_DIR = buildDataDir; // 供下方持久层装配与 e2e 运行环境（原后置创建前移）
fs.mkdirSync(path.join(buildDataDir, "staging"), { recursive: true });
fs.writeFileSync(path.join(buildDataDir, "staging", "master_graph.json"), FIXTURE_MASTER_GRAPH);
write(".ledger/master_graph.json", FIXTURE_MASTER_GRAPH);

// ── 7. git init＋发布目录（releases 落同级 .releases/——WP-023 迁址；e2e 写回链的 git 上下文）──
try {
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: target, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "e2e@fixture.invalid"], { cwd: target, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "e2e-vault-builder"], { cwd: target, stdio: "ignore" });
  execFileSync("git", ["add", "."], { cwd: target, stdio: "ignore" });
  execFileSync("git", ["commit", "-q", "-m", "e2e vault fixture"], { cwd: target, stdio: "ignore" });
} catch (error) {
  fail(`git init/commit 失败（release-governance 依赖 .git 存在）：${error.message}`);
}

// ── 7b. 发布快照数据（PR-015 Step 4 真实依赖）──
// GET /api/kg/classification/list 经 freshnessGate → formalConsumer.withPinnedRelease →
// release-reader.resolveCurrentReleaseId 读 .git/anyshare-releases/current.json——无指针即
// NO_CURRENT_RELEASE(404)，Step 4 红。走仓内正规链建快照（非手拼）：
//   ① collectCompleteArtifacts 收集完整产物（先补 pipeline 派生三件，同
//      approval-state-machine-assembly.test.cjs fixtureVault 先例——master_graph.db 可为空，
//      pipeline_version/extract_manifest 为 pipeline 形状占位）；
//   ② release-builder.build 写 release-<hash>/（manifest+artifacts，全哈希校验）；
//   ③ 手写 current.json 指针（publisher 语义等价：指针三字段与 manifest 一致，reader 校验即过）。
try {
  write(".ledger/pipeline_version.json", '{"generatedAt":"volatile","version":"1"}\n');
  write(".ledger/extract_manifest.json", '{"generatedAt":"volatile","files":{}}\n');
  write(".ledger/master_graph.db", "");
  // cjs 服务经 file:// URL 动态 import（ESM→CJS 互操作）
  const toFileUrl = (p) => `file://${p.split(path.sep).map(encodeURIComponent).join("/")}`;
  // SPEC-012 WP-A：collectCompleteArtifacts 消费 runtime-state store（人裁账本/pipeline_version 物化）——
  // 本脚本独立于 server boot，装配一次性内存库并种 pipeline_version 占位（与上方 json 占位同值）
  const { openPersistenceDb } = await import(toFileUrl(path.join(REPO_ROOT, "server/shared/persistence/sqlite-adapter.cjs")));
  const { initRuntimeStateStore } = await import(toFileUrl(path.join(REPO_ROOT, "server/shared/persistence/runtime-state-store.cjs")));
  initRuntimeStateStore(openPersistenceDb()).pipeline.versionPut({ generatedAt: "volatile", version: "1" });
  // SPEC-012 wave-2：article-manifests 行级投影＋图族原文行——同款一次性内存库装配（e2e vault
  // 不种 manifest 行，boot rebuild 对活源重生成；发布快照物化零 manifest 与旧「目录不造」等价）。
  // 图/清单种入 staging 原文（bundle 物化字节与生产 ingest 同源）；master_graph.db 字节
  // 工件住 data/——buildDataDir 已在 §6 前移创建（staging 双位同构）
  fs.writeFileSync(path.join(buildDataDir, "master_graph.db"), "");
  const { initDerivedIndexStore } = await import(toFileUrl(path.join(REPO_ROOT, "server/shared/persistence/derived-index-store.cjs")));
  const buildDerivedStore = initDerivedIndexStore(openPersistenceDb());
  buildDerivedStore.artifacts.put("master_graph", fs.readFileSync(path.join(buildDataDir, "staging", "master_graph.json"), "utf8"));
  buildDerivedStore.artifacts.put("extract_manifest", '{"generatedAt":"volatile","files":{}}\n');
  const { collectCompleteArtifacts } = await import(
    toFileUrl(path.join(REPO_ROOT, "server/services/release-governance/complete-release-artifact-service.cjs"))
  );
  const { createReleaseBuilderService } = await import(
    toFileUrl(path.join(REPO_ROOT, "server/services/release-governance/release-builder-service.cjs"))
  );
  // WP-023：发布物新家＝vault 根 .releases/（resolver releases-dir.cjs 同款：root=vaultPath）。
  // 修复：此前误写 vault 同级（../.releases）——resolver 读 vault 内不存在，classification/list
  // 404 NO_CURRENT_RELEASE（终验 e2e 抓出；85f6f71b 引入，注释自称 resolver 同款实不一致）
  const releasesDir = path.join(path.resolve(target), ".releases");
  const builder = createReleaseBuilderService({ releasesDir, logger: { info() {}, warn() {}, error() {} } });
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: target }).toString().trim();
  const artifactMap = collectCompleteArtifacts(path.resolve(target));
  const manifest = builder.build({ sourceCommit, artifacts: artifactMap });
  fs.writeFileSync(
    path.join(releasesDir, "current.json"),
    JSON.stringify({ releaseId: manifest.releaseId, sourceCommit, manifestHash: manifest.manifestHash }, null, 2) + "\n",
  );
} catch (error) {
  fail(`发布快照构建失败（PR-015 Step 4 依赖）：${error.message}`);
}

// 初始 Release 只包含合规实体；随后加入待处理实体，用于验证新内容能编辑但下次发布会拦截。
write("知识库/wiki/entities/e2e-incomplete-component.md", incompleteEntity);

// ── 8. 自检：关键路径逐项断言（产物即契约，缺一即废）──
const required = [
  "知识库/TheSchema/enums.yaml",
  "知识库/TheSchema/versions.yaml",
  "知识库/TheSchema/ontology.yaml",
  "知识库/wiki/entities/e2e-complete-component.md",
  "知识库/wiki/entities/e2e-incomplete-component.md",
  "知识库/raw/precleaned/e2e-candidate-article.md",
  "知识库/.claude/scripts/pipeline-runner.py",
  "知识库/.claude/scripts/document_index.sql",
  "知识库/.claude/scripts/_runtime_state_db.py",
  "知识库/.claude/scripts/_vault_ledger.py",
  "知识库/.claude/scripts/write_gateway.py",
  "知识库/.claude/scripts/human_edit_guard.py", // WP-015：write_gateway 函数级 import 的裁决门
  "知识库/.claude/scripts/schema-write-client.mjs",
  "知识库/.claude/scripts/article-validator-lib.cjs",
  "知识库/.claude/scripts/promote-article.py",
  "知识库/.claude/scripts/kb_paths.py",
  "知识库/.claude/scripts/generate-sa.py",
  "知识库/.claude/scripts/schema_loader.py",
  "知识库/.claude/scripts/vocab_envelope.py",  // WP-049 L3：信封接收器（schema_loader 同目录依赖）
  "知识库/.claude/scripts/doc_envelope.py",  // WP-117 批2：文档信封接收器（doc_consumption 同目录依赖）
  "知识库/.claude/scripts/doc_consumption.py",  // WP-155：classify/generate-sa 的文档消费件（validate_classification 已于 WP-156 退役）
  "知识库/.claude/scripts/identity_port.py",  // WP-051：身份入口 Python 侧（extract_graph 同目录依赖）
  "知识库/.claude/scripts/sa_projection_support.py",
  ".ledger/master_graph.json",
  ".ledger/master_graph.db",
  ".ledger/pipeline_version.json",
  ".ledger/extract_manifest.json",
  ".releases/current.json",  // 波5 复核：随 484c702b 落 vault 内（resolver 同款）——自检项同步
  ".git",
];
const missing = required.filter((rel) => !fs.existsSync(path.join(target, rel)));
if (missing.length) fail(`自检失败，缺：${missing.join("、")}`);

// R3 对账（WP-138／PR-262）：夹具词表 lifecycle 段与产品主源逐字段对账——构建期 fail-closed，
// 不等即废。只核对「造出来的」与「产品声明的」是否同一份，防止未来有人把 §1 的搬入改回手写。
const fixtureEnumsFile = vocabLoadPort.loadVocabBundle(target, { files: ["enums"] }).files.enums;
const fixtureLifecycle = fixtureEnumsFile && fixtureEnumsFile.state === "present" && fixtureEnumsFile.data
  ? fixtureEnumsFile.data.lifecycle
  : null;
if (JSON.stringify(fixtureLifecycle) !== JSON.stringify(productLifecycle)) {
  fail(`夹具 lifecycle 段与产品主源不一致（${PRODUCT_ENUMS_PATH}）——夹具不自造词表，请让构建器从主源取`);
}

console.log(`✓ e2e vault 就绪：${target}（${required.length} 项关键产物齐）`);
console.log(`  lifecycle 段对账＝产品主源 data/theschema/enums.yaml：status=[${productLifecycle.status.join("、")}] default_status=${productLifecycle.default_status}` +
  (productLifecycle.legacy_status_map ? ` legacy_keys=[${Object.keys(productLifecycle.legacy_status_map).join("、")}]` : ""));
console.log(`VAULT_PATH=${target}`);
// PR-086：本地跑 e2e 须知——起 API 服务时须随 CI 协议导出 VAULT_RUNTIME_SCRIPTS_DIR 指本夹具脚本目录
//（不设则 runner 解析器按「仓内优先」选真 1646 行 runner，其编排的 B 类脚本留在数据仓，minimal 夹具必败于 Stage 1）。
console.log(`VAULT_RUNTIME_SCRIPTS_DIR=${path.join(target, "知识库", ".claude", "scripts")}`);
