---
title: 架构治理系统组件词汇表
version: "5.1"
updated: 2026-05-16
---

# 架构治理系统：组件词汇表

本系统由三个限界上下文（Bounded Context）组成：**知识源 (Vault)**、**逻辑中枢 (Pipeline)** 与 **表现层 (Canvas)**。每个组件有唯一名称，跨 SKILL、脚本、排障时统一引用。

## 数据契约

以下文件是上下文之间的**形式化契约**，任何对结构的修改必须向后兼容：

| 契约文件                         | 位置                                    | 角色                         |
| ---------------------------- | ------------------------------------- | -------------------------- |
| `master_graph.json`          | `VAULT_ROOT/.ledger/`               | Vault ↔ Pipeline 契约        |
| `semantic_architecture.json` | `VAULT/architecture/AnyShare/master/` | Pipeline ↔ Canvas 契约       |
| `pipeline-manifest.yaml`     | `知识库/.claude/scripts/`                | 管道 I/O 主权注册表，Stage 定义唯一事实源 |
| `dashboard_data.json`        | `VAULT_ROOT/`                         | Pipeline → Dashboard 数据契约  |
| `electron/main.cjs` API 路由  | `架构图系统/electron/main.cjs`           | Canvas Renderer ↔ Electron Main Process 运行时契约（51 REST + 42 IPC） |

---
## A. 知识源上下文 (Vault Context)

负责原始事实的存储与架构定义。

**Fact-Store（事实主权库）** — `wiki/entities/`、`wiki/concepts/`、`raw/precleaned/`、`raw/imported/`、`TheSchema/` 五个目录构成知识原材料的事实来源。

**入库闸门** — 文档/entity 入库前的校验层，拦截 frontmatter 缺失、分类非法、entity schema 违规等问题。

**文档生命周期** — 摄入（MHT/PDF 提取 → 批量转换）→ 分类（推断元数据 → 合并裁决）→ 晋升（drafts → precleaned）的完整链路。

**分类与标签治理** — 枚举值管理 + 非法标签修复，确保四层分类体系闭合。

**辅助工具** — 索引生成、图谱查询翻译、待办管理、仪表盘数据、Wikilink 完整性等支撑功能。

## B. 逻辑中枢上下文 (Pipeline Context)

负责数据抽取、清洗、图谱构建与语义转换。由 Pipeline-Runner 统一编排为 Stage 0-7 管道。

**抽取与构建** — 全文扫描 → 五条晋升规则 → master_graph.json 原子写入。

**校验层** — 本体约束（ontology.yaml 合规）、管道契约（I/O 声明、阶段漂移）、投影一致性（graph → SA → layout）三层校验。

**投影与同步** — master_graph.json → semantic_architecture.json + architecture_layout.json，同步写入前端。

**运维支撑** — CI 播种、Electron 守护、健康报告、质量闸门、契约修复等。

## C. 表现层上下文 (Canvas Context)

负责可视化展示与实时交互，运行在 Electron + React 中。

**网关层** — Electron 主进程：HTTP API（51 REST）、SQLite 引擎、IPC 桥接（42 通道）、自检引擎。

**画布渲染层** — React 组件：架构主画布（SVG/ReactFlow）、知识图谱画布、侧边栏详情、树视图。

**布局引擎** — Dagre 布局算法：层带分组、泳道着色、节点坐标计算。

**治理面板** — KG 面板多 Tab（分析/审计/仪表盘/缺口/清单/设置/版本）、准入判定、漂移检测、边对账。

**状态管理** — Zustand stores（Graph-Store、Version-Store、KG-UI-Store）、API 客户端、认证逻辑。

**类型与契约** — TS 端架构常量（Arch-Contract）、本体类型（Ontology-Registry）、错误码（Error-Codes）、布局类型。

---

## 协作约定

1. **讨论时引用组件名**："Semantic-Projector 过滤了 plate 层" 而非 "那个 sync 脚本"
2. **排障时按数据流定位**：沿管道 Stage 追溯，用组件名指代断点
3. **脚本头部标注**：每个脚本文件顶部注释包含 `# Component: <组件名>` 及 `@responsible/@inputs/@outputs/@context`
4. **组件文件查找**：使用 `component-index.json` 进行 O(1) 查找，禁止全项目 grep
5. **修改组件元数据后**：运行 `python3 知识库/.claude/scripts/gen-system-components.py --apply` 刷新下方组件描述段

---

## 组件详情（自动生成）

> 以下内容由 `gen-system-components.py` 从代码头部元数据自动生成，**禁止手改**。
> 新增/修改组件 → 更新代码头部的 `@responsible/@inputs/@outputs/@context` → 运行生成器或管道 Stage 3.6。


<!-- GENERATED_COMPONENTS_START -->
### 2026-10-06 Master 报「问题项与处理方式超集关系需梳理」→ 裁「要」→

#### Action-Routing-Contract-Guard（动作路由表子契约执法 · navigation 域）
- **文件**: `scripts/quality/check-action-routing.mjs`
- **职责**: 看守「问题类型（issueKind）→ 处理方式」对应关系的三重对账

### 2026-10-08 Master 批（00:58「可以」）——P1 名言「单向对账会漏一半」在错误码域重演后的立门禁

#### Error-Code-Contract-Guard（错误码事实源双向对账 · P1 模式新实例）
- **文件**: `scripts/quality/check-error-codes.mjs`
- **职责**: 看守「服务端抛出的错误码 ↔ 契约 error_code enum」的双向完备：

### 2026-10-08 规则生命周期治理方案第 0+1 步；先例=check-error-codes.mjs（P1 双向对账模式）

#### Rules-Lifecycle-Guard（规则生命周期治理 · 第 1 步审计模式 / 第 3 步门禁预留）
- **文件**: `scripts/quality/check-rules-lifecycle.mjs`
- **职责**: 把「人肉理解规则体系」升级为「机器对账」——三层（22 规则声明 / 13 检查器出口 /
- **输入**: contracts/rules-lifecycle-index.json + issue-kind-index.json + derivation-index.json
- **输出**: --audit 输出断点全景表（md 到 stdout + docs/plans/ 断点文件）；缺省=门禁模式（第 3 步启用）

### A. 知识源上下文 (Vault Context)

#### Article-Classifier
- **文件**: `scripts/vault-py/content/classify.py`
- **职责**: entity↔module 映射维护 + 待审核文档批量归类，支持基于关键词的自动映射建议
- **输入**: entity 列表 / 待审核文档
- **输出**: module 映射 / frontmatter 写入

#### Article-Promoter
- **文件**: `scripts/vault-runtime/promote-article.py`
- **职责**: 人工确认后将 drafts/ 中文章提升到 precleaned/，完成定居和归档
- **输入**: drafts/*.md（需含 validation_status）
- **输出**: precleaned/*.md + 原始文件归档

#### Classification-Validator
- **文件**: `scripts/vault-py/tools/validate_classification.py`
- **职责**: 校验文章四层分类体系的合规性（category-path 闭合枚举、tags 白名单、module 法定值）
- **输入**: 全量或单文件 .md
- **输出**: 校验报告 / 修复建议（`--fix`）

#### Dashboard-Data-Generator
- **文件**: `scripts/vault-py/pipeline/generate_dashboard_data.py`
- **职责**: 扫描项目文件系统 + git 状态 + Python import 依赖 + Obsidian 插件信息，生成 `dashboard_data.json` 供 Project-Dashboard 消费
- **输入**: Vault 文件系统、git 历史、CLAUDE.md、插件 manifest、Python 脚本
- **输出**: `dashboard_data.json`

#### Entity-Validator
- **文件**: `scripts/vault-py/tools/validate-entity.py`
- **职责**: entity 页面或 dependencies.yaml 变更后，提交前校验 frontmatter schema 合规性
- **输入**: 变更的 entity 页面 / dependencies.yaml
- **输出**: 校验报告（ERROR 必须清零方可提交）

#### Infer-From-Body
- **文件**: `scripts/vault-py/pipeline/infer-from-body.py`
- **职责**: 从文档正文内容推断 product / module / article_type 等业务元数据
- **输入**: 标准化文档 .md
- **输出**: 推断结果（供 Merge-Inferred 汇总）

#### Infer-From-Config
- **文件**: `scripts/vault-py/pipeline/infer-from-config.py`
- **职责**: 从 enums.yaml 和分类配置推断文档元数据归属
- **输入**: `TheSchema/enums.yaml` + 文档 frontmatter
- **输出**: 推断结果

#### Infer-From-Wiki
- **文件**: `scripts/vault-py/pipeline/infer-from-wiki.py`
- **职责**: 从 wiki/ 目录已有页面推断新文档的元数据归属
- **输入**: wiki/ 文件系统 + 文档内容
- **输出**: 推断结果

#### Inference-Schema
- **文件**: `scripts/vault-py/pipeline/schema.py`
- **职责**: 推断管线共享数据结构 —— Source/InferredEdge dataclass + JSON 序列化
- **输入**: 无（工具库）
- **输出**: 导出的 dataclass

#### Merge-Inferred
- **文件**: `scripts/vault-py/pipeline/merge-inferred.py`
- **职责**: 合并多个推断源的输出，按优先级裁决冲突，生成最终 frontmatter 建议
- **输入**: 多个推断结果
- **输出**: 合并后的 frontmatter 建议

#### Pipeline-Quick-Check — 一键验证管线: extract → sync → validate
- **文件**: `scripts/vault-py/check-arch.sh`
- **职责**: 三阶段快速验证（extract → sync → validate），退出码即结果，不依赖 Pipeline-Runner 全管道
- **输入**: 无
- **输出**: 通过/失败 + 退出码

#### Pipeline-Smoke
- **文件**: `scripts/vault-py/content/pipeline-smoke.py`
- **职责**: 逐阶段验证 pipeline 可运行并产出有效数据，CI 或部署前快速诊断
- **输入**: 无（自包含）
- **输出**: 各阶段 pass/fail 报告

#### Schema-Loader
- **文件**: `scripts/vault-runtime/schema_loader.py`
- **职责**: 加载 TheSchema 全部 yaml（enums/ontology/versions/dependencies），为图谱抽取与约束校验提供类型定义
- **输入**: `TheSchema/*.yaml`、contracts/theschema.registry.json 登记的唯一形态源
- **输出**: Python dict（模块注册表、本体定义、版本注册表）

#### Vault-Paths
- **文件**: `scripts/vault-runtime/kb_paths.py`
- **职责**: KB_VAULT 路径约定，兼容旧环境变量，所有 Python 脚本的路径入口
- **输入**: 环境变量
- **输出**: vault_roots 路径元组

### A. 知识源上下文（cheese vault 侧 git hook，进版本控制，符号链接到 .git/hooks/post-commit）

#### Vault-Backup-Health-Check（备份健测 post-commit hook）
- **文件**: `scripts/vault-runtime/vault-backup-health-hook.sh`
- **职责**: SPEC-011-W11 WP5·备份健测——提交后非阻塞 push，push 失败写 stalled 文件

### ADR008 D39（layers 为架构层唯一权威）+ T8/T10 生产者侧收口 + W1 消费者侧闭环

#### Layer-SSOT-Checker (防回退 + layers 完整性 + 消费者侧闭环)
- **文件**: `scripts/quality/check-layer-ssot.mjs`
- **职责**: 断言退役键 arch_layers / architecture_projection.layers 不回流、layers[] 每项有合法 id+label，

### B. 逻辑中枢上下文 (Pipeline Context)

#### Backwrite-Frontmatter
- **文件**: `scripts/vault-py/pipeline/backwrite-frontmatter.py`
- **职责**: 存量文章 frontmatter 反向回写 — 将图谱对齐结果物理写入 Obsidian .md 文件
- **输入**: master_graph.json, vault .md 文件
- **输出**: 修改后的 .md 文件 + .pre-align-bak 备份

#### Board-Cache-Syncer
- **文件**: `scripts/vault-py/pipeline/sync-board-enums.py`
- **职责**: 读取 enums.yaml modules 段，生成 `_enums-cache.md` 供 Board 页面 DataviewJS 动态查询
- **输入**: `TheSchema/enums.yaml`
- **输出**: `raw/boards/_enums-cache.md`

#### Constraint-Validator
- **文件**: `scripts/vault-py/graph/validate_graph.py`
- **职责**: 校验 master_graph.json 节点/边是否符合 ontology.yaml；检查管道契约（I/O 声明、主权冲突、阶段漂移）；健康度审计（SA 漂移、图谱覆盖率）
- **输入**: `master_graph.json` + `ontology.yaml`
- **输出**: 校验报告（ERROR 即终止管道）

#### Constraint-Validator (Health)
- **文件**: `scripts/vault-py/pipeline/pipeline-check.py`
- **职责**: 校验 master_graph.json 节点/边是否符合 ontology.yaml；检查管道契约（I/O 声明、主权冲突、阶段漂移）；健康度审计（SA 漂移、图谱覆盖率）
- **输入**: `master_graph.json` + `ontology.yaml`
- **输出**: 校验报告（ERROR 即终止管道）

#### Graph-Extractor
- **文件**: `scripts/vault-py/graph/extract_graph.py`
- **职责**: 扫描 Vault 全文，执行 R1-R5 五条晋升规则，产出全量物理图谱。R5 Plate 三轴门控在此实现
- **输入**: Fact-Store (entities, concepts, documents, enums.yaml)
- **输出**: `master_graph.json`（原子写入：tmp + rename）

#### Graph-Status
- **文件**: `scripts/vault-py/graph/graph-status.py`
- **职责**: 统计图谱节点数、连接数、待审核数，写入 `graph-status.md` 供 Obsidian 仪表盘渲染
- **输入**: `master_graph.json`
- **输出**: `wiki/graph-status.md`

#### Pipeline-Runner
- **文件**: `scripts/vault-runtime/pipeline-runner.py`
- **职责**: 按 Stage 0-7 顺序执行全管道，每阶段独立门控，断链即停。内置 SA 新鲜度检查和自动重试
- **输入**: 用户触发（`--force` / `--incremental` / `--dry-run` / `--diagnostic`）
- **输出**: 各阶段门控通过/失败，Stage 7 自动写 memory

#### Semantic-Projector
- **文件**: `scripts/vault-runtime/generate-sa.py`
- **职责**: 读取 master_graph.json，过滤 `arch_component: true` 节点，按 `SA_VALID_LAYERS` 投影为 UI 专用的逻辑架构组件列表；同步写入 `architecture_layout.json`
- **输入**: `master_graph.json`
- **输出**: `semantic_architecture.json` + `architecture_layout.json`

### Canvas

#### Entity-Compliance API
- **文件**: `src/features/entity-compliance/entity-compliance-api.ts`
- **职责**: 封装源文档校验列表查询的前端 HTTP 调用。
- **输入**: EntityCheckParams 与 API envelope
- **输出**: EntityCheckData Promise

#### Entity-Compliance Store
- **文件**: `src/features/entity-compliance/entity-compliance-store.ts`
- **职责**: 管理源文档校验筛选、分页、加载和错误状态。
- **输入**: 用户筛选操作与 Entity-Compliance API 响应
- **输出**: Zustand 源文档校验视图状态与 actions

#### Entity-Compliance Types — from OpenAPI contract
- **文件**: `src/features/entity-compliance/entity-compliance-types.ts`
- **职责**: 导出源文档校验页面使用的契约类型与查询参数类型。
- **输入**: 生成的 OpenAPI TypeScript components
- **输出**: 源文档校验 TypeScript 类型别名

### Canvas（仅测试使用，禁止生产 import）

#### Entity-Rule-Tester (对标 ESLint RuleTester)
- **文件**: `scripts/quality/__tests__/helpers/entity-rule-tester.cjs`
- **职责**: 测试专用单条规则断言工具——生产唯一入口是 service.checkEntityCompliance(runAllDiagnostics)，
- **输入**: frontmatter 对象 / body 字符串 + ruleId + 可选 ruleSet/indexes
- **输出**: 单条诊断 { ruleId, field, severity, passed, message, hint, currentValue, ... }（legacy finding 形态）

### E2E scripts only — never imported by server/

#### E2E-Stack（e2e 自起受控服务栈）
- **文件**: `scripts/e2e/lib/e2e-server.mjs`
- **职责**: 复用域 runtime-scope 波1（PR-120）——e2e 不再搭常驻服务：harness 自起 API＋Vite，
- **输出**: startE2EStack({ vaultPath }) → { apiBase, baseUrl, env, stop() }

### E2E scripts only — never imported by server/；只读消费 server/shared/vault-id.cjs（纯函数单源）

#### E2E-Env-Guard（e2e 物理隔离守卫）
- **文件**: `scripts/e2e/lib/e2e-env.mjs`
- **职责**: SPEC-011 WP1——强制 e2e 脚本只能运行在 fixture vault，禁止写入真实 vault。
- **输出**: requireE2EVault()（入口守卫）；resolveE2EVaultPath()（fixture 路径解析）；

### E2E（self-managed server——本流需要在流程中途重启 server，故不经共享栈）

#### Persistence-F2-Replay-Journey（第 6 条 e2e 流——持久层全旅程）
- **文件**: `scripts/e2e/persistence-journey.e2e.mjs`
- **职责**: SPEC-012 增量防线（PR-062）：⑤类回执链与③类耐久性的 e2e 级常设执法——
- **输入**: VAULT_PATH（fixture，e2e 守卫强制）；自管临时 KB_DATA_DIR＋独占端口 18110
- **输出**: 五阶段全过 exit 0；任一阶段失败 exit 1（run-all/baseline 汇总消费）

### Onboarding（WP-021；WP-009 续篇）

#### First-Run
- **文件**: `scripts/first-run.mjs`
- **职责**: `npm run dev` 的首次启动接线——没有可用知识库时问一句位置（带默认值）即建，复用 vault-init；
- **输入**: 仓根 .env（经 server/shared/env-load.cjs 的 loadEnvFile 单源解析，显式环境变量优先）＋ VAULT_PATH 目录存在性
- **输出**: 三态判定；需要建库时调用 scripts/vault-init.mjs 导出的 main()（骨架/.env/git 全由它落，本模块零新落点）

### PR-025 阶段 3 门禁 + 关账回归；范式参照 check-layer-ssot.test.mjs

#### check-theme-tokens 的门禁回归测试（PR-025 关闭卡回归固化位置）
- **文件**: `scripts/quality/__tests__/check-theme-tokens.test.mjs`
- **职责**: 钉住主题门禁的执法活性——先红后绿形态。

### Pipeline

#### Component-Doc-Generator
- **文件**: `scripts/vault-py/pipeline/gen-system-components.py`
- **职责**: 扫描所有 # Component: / // Component: 头部元数据, 自动生成 system-components.md 的组件描述段
- **输入**: .claude/scripts/, 架构图系统/scripts/, 架构图系统/src/, 架构图系统/electron/
- **输出**: 知识库/TheSchema/system-components.md（组件描述段替换）

#### Data-Chain-Checker — schema-driven JSON/SQLite/SA/layout verifier.
- **文件**: `scripts/quality/check-data-chain.mjs`
- **职责**: 校验 master、SQLite、SA、layout 与向量索引的数据链一致性。
- **输入**: Vault 路径、master_graph、SQLite、SA、layout 与 vector-cache
- **输出**: JSON 质量报告与进程退出码

#### Document-Index-Validator
- **文件**: `scripts/vault-py/pipeline/validate-document-index.py`
- **职责**: 只读校验 master_graph.json 与 SQLite document_index 的行集合、字段和路径边界。
- **输入**: $KB_DATA_DIR/staging/master_graph.json + master_graph.db（SPEC-012 wave-2 迁库）
- **输出**: missing_rows/orphan_rows/field_mismatches/unsafe_paths JSON 与退出码

#### Entity-Readiness-CLI
- **文件**: `scripts/quality/check-entity-readiness.mjs`
- **职责**: 为直接运行 Pipeline 提供与 HTTP API 同源的入图资格门控。
- **输入**: --vault <Vault root>
- **输出**: readiness JSON；ready=0，blocker=2，执行错误=3

#### Relation-Expectation-Validator
- **文件**: `scripts/vault-py/rules/validate-relation-expectations.py`
- **职责**: 验证 UI 已确认关系在 master_graph connections 中形成预期类型与方向。
- **输入**: relation_write_expectations.json + master_graph.json
- **输出**: 验证 JSON；成功时可消费已验证期望

### Quality Gate

#### Contract-Hygiene-Checker — 契约健康度门禁（ADR-003 / SPEC-003 WP3）。
- **文件**: `scripts/quality/check-contract-hygiene.mjs`
- **职责**: 常驻检查 OpenAPI 契约的单源纪律：零引用 Schema 清零 + 内联重复检测。
- **输入**: contracts/http-api.openapi.json
- **输出**: JSON 报告 + 进程退出码（违例非零）

### Quality Gate。静态扫描口径与 check-error-codes 同族；运行时另有 http-app onRoute fail-closed 兜底。

#### Contract-Route-Parity-Checker（PR-085 第 1 步 · ADR-010 · 复用域 api-contract 缺口「openapi↔后端实现漂移断言」）
- **文件**: `scripts/quality/check-contract-route-parity.mjs`
- **职责**: 看守「契约操作 ⇄ 注册路由」双向完备：
- **输入**: server/main.cjs（装配的 routes 模块清单）、server/routes/*.cjs 字面注册、contracts/retired-routes.json、
- **输出**: `contract_route_parity=ok ...` 或 `contract_route_parity=FAIL violations=N`（exit 1）

### SPEC-005 §3.2；先例=schema-manager-view.test.tsx（mock store 形态）

#### EntityGrowthCards Tests（SPEC-005 A2 前端层）
- **文件**: `src/test/entity-growth-cards.test.tsx`
- **职责**: 候选卡呈现（次数/样例/按钮）+ 裁定动作分发（create/link-existing）+
- **输入**: EntityGrowthCards + vitest mocks
- **输出**: vitest 断言

### SPEC-005 §3.2；样式与裁定交互沿用 SchemaDiscoveryTab 卡片先例（不另起设计）

#### EntityGrowthCards（ADR-007 A2/A3：实体生长候选卡——Steward Queue 实体类卡片）
- **文件**: `src/features/schema-manager/EntityGrowthCards.tsx`
- **职责**: 呈现文章提及产出的实体候选（次数/样例），承载裁定动作：
- **输入**: discovery 响应 entityCandidates/orphanEntities + absorb 通道（field=entity）
- **输出**: 候选卡区块组件

### SPEC-007 §3.3；先例=entity-growth-cards.test.tsx

#### VocabularyProfileSection Tests（SPEC-007 §3.3 前端层）
- **文件**: `src/test/vocabulary-profile-section.test.tsx`
- **职责**: 词表画像区呈现（计数/阶段徽章/死词标记）+ 阈值旋钮交互（变更触发重取）+ 空维度不渲染。
- **输入**: VocabularyProfileSection + vitest 内联 profile
- **输出**: vitest 断言

### SPEC-007 §3.3；样式沿用 EntityGrowthCards 卡片先例；类型从 openapi 契约投影（单源）。

#### VocabularyProfileSection（ADR-007 波2 · SPEC-007 §3.3：词表画像区——Steward Queue 词表类）
- **文件**: `src/features/schema-manager/VocabularyProfileSection.tsx`
- **职责**: 呈现五维度（layer/category/subdomain/module/tag）使用计数+阶段徽章（Seed/Growing/Verified）
- **输入**: discovery 响应 vocabularyProfile + onThresholdChange（触发 ?verifiedThreshold=N 重取）
- **输出**: 词表画像区块组件

### SPEC-008 §3.3；先例=vocabulary-profile-section.test.tsx。

#### RulesChannelSection Tests（SPEC-008 §3.3 前端层）
- **文件**: `src/test/rules-channel-section.test.tsx`
- **职责**: 信号卡渲染/立规动作分发/台账只读（存量 sealed 无切换入口）/退役入口。
- **输入**: RulesChannelSection + vitest mocks（api 层 mock）
- **输出**: vitest 断言

### SPEC-008 §3.3；术语（设计 §10）：Policy registry / enforcement mode。

#### RulesChannelSection（ADR-007 波3 · SPEC-008 §3.3：规则通道——Steward Queue 规则类+台账）
- **文件**: `src/features/schema-manager/RulesChannelSection.tsx`
- **职责**: ①规则候选信号卡（issueKind×ruleId 聚类，count≥2）+「立为规则」（携信号预填 propose）
- **输入**: discovery.ruleCandidates + GET/POST /api/rules/lifecycle
- **输出**: 规则通道区块组件

### Sync

#### Dev-Log-Integrity-Guard
- **文件**: `scripts/quality/check-dev-log.mjs`
- **职责**: 开发日志事件流完整性门禁（CLI / 编排层）。
- **输入**: docs/dev-log/entries/*.jsonl、contracts/dev-log.schema.json
- **输出**: stdout 计数报告；非零退出 = 事件流不合法

#### Dev-Log-Ledger-Pure-Logic
- **文件**: `scripts/quality/shared/dev-log-ledger.mjs`
- **职责**: check-dev-log.mjs 的纯校验逻辑（无 CLI、无报告、无退出码）。

#### Problem-Board-Generator (v2 · ECharts 动态管道 + 卡片抽屉)
- **文件**: `scripts/problem-board/generate-board.mjs`
- **职责**: 问题处理看板 HTML 生成器（数据源=parse-register.mjs 单源解析登记簿）。

#### Problem-Register-Integrity-Guard
- **文件**: `scripts/quality/check-problem-register.mjs`
- **职责**: 问题表条目结构门禁（问题处理流程固化·门禁 1，2026-09-29）。
- **输入**: docs/plans/problem-register.md
- **输出**: stdout 报告；非零退出 = 条目结构不合法

#### Problem-Register-Parser
- **文件**: `scripts/problem-board/parse-register.mjs`
- **职责**: 登记簿条目解析器——问题处理看板（scripts/problem-board/）与门禁

### Sync（CI 可跑；无 vault 依

#### Runtime-Scope-Reverse-Scan-Gate（运行时作用域域门禁——波4 立项，PR-124/rule-governance 转 gating 的执法面）
- **文件**: `scripts/quality/check-runtime-scope.mjs`
- **职责**: 复用域 runtime-scope 四条规则的机器执法：
- **输入**: contracts/runtime-scope.json；scripts/vault-py|vault-runtime|quality＋server 源面；scripts/test-node.mjs；.githooks/pre-commit
- **输出**: stdout runtime_scope=ok|FAIL violations=N；非零退出＝违规

### Unknown

#### Dev-Log-Responsibility-Matrix-Renderer
- **文件**: `scripts/quality/shared/dev-log-responsibility-matrix.mjs`
- **职责**: 统一责任矩阵（角色 × 职能域）的 Vault 投影 renderer（#1890）。

#### Dev-Log-Role-Registry
- **文件**: `scripts/quality/shared/dev-log-roles.mjs`
- **职责**: 角色身份与辖区功能总结的唯一事实源。

#### Domain-Registry-Hygiene-Guard（领域注册表门禁——TALOS 分表形态）
- **文件**: `scripts/quality/check-domain-registry.mjs`
- **职责**: 两张领域注册表（reuse-domains.json＋data-domains.json，2026-10-14 拆表批自

#### First-Run-Test
- **文件**: `scripts/__tests__/first-run.test.mjs`
- **职责**: WP-021 首次启动接线测试——①纯单元三态判定；③真实集成：真 vault-init（真 git init/真骨架/真 .env）

#### Frozen-Artifact-Throat-Guard（冻结产物读侧唯一咽喉执法门禁）
- **文件**: `scripts/quality/check-frozen-artifact-throat.mjs`
- **职责**: PR-084 建立——冻结产物（derived-index artifacts 槽）读取必经注册制咽喉
- **输入**: contracts/frozen-artifacts.registry.json；server/**；server/shared/persistence/graph-artifact-ingest.cjs
- **输出**: stdout frozen_artifact_throat

#### Null-Segment-Guard Tests（数据域治理批 A6——红绿夹具）
- **文件**: `scripts/quality/__tests__/null-segment-guard.test.mjs`
- **职责**: 反例①rogue 写方 doc.set("<null段>") 被报（含文件:行号）；
- **输入**: shared/null-segment-guard.mjs 纯函数
- **输出**: node:test 断言

#### Parse-Register-SelfTest
- **文件**: `scripts/problem-board/__tests__/parse-register.test.mjs`
- **职责**: problem-board 解析器测试——真实登记簿集成态 + 字段语义单元 + 产物自检。

#### Problem-Register-Guard-SelfTest
- **文件**: `scripts/quality/__tests__/check-problem-register.test.mjs`
- **职责**: 门禁 1 反例自测（问题处理流程固化，2026-09-29）。

#### Schema-Writers-Sovereignty-Guard（Schema 规则数据域写主权门禁）
- **文件**: `scripts/quality/check-schema-writers.mjs`
- **职责**: domain-registry schema-rules-data 域的写主权对账执法（SPEC-009-W9 §三；
- **输入**: contracts/data-domains.json（2026-10-14 拆表批——原 domain-registry.json 按 kin

#### Taxonomy-Growth-Guard（分类矩阵生长观察器 · ADR-006 硬结构）
- **文件**: `scripts/quality/check-taxonomy-growth.mjs`
- **职责**: 让 subdomain×category 矩阵"从存量事实中长出来"——观察期计量组合分布，
- **输入**: VAULT_PATH 环境变量（缺省 skip，同 check-layer-ssot 约定）：
- **输出**: --audit 输出组合分布

#### TheSchema-Writer-Scan（check:schema-writers 检查面⑨的纯函数面——写者反向对账）
- **文件**: `scripts/quality/shared/theschema-writer-scan.mjs`
- **职责**: 实存写者 ⊆ 登记写者 ∪ 通道豁免。data-domains schema-rules-data.write_protocol 声明

#### Theme-Baseline（W0-3 · 契约「存量收敛条款」的执法件）
- **文件**: `scripts/quality/shared/theme-baseline.mjs`
- **职责**: 主题门禁存量基线的加载与棘轮对账——

#### Theme-CSS-Graph（W0-3 · 契约 A2：门禁执法面扩到 CSS 图）
- **文件**: `scripts/quality/shared/theme-css-graph.mjs`
- **职责**: 收集主题门禁的 CSS 执法面，两条通道——

#### Theme-Contract（结构审计合并批 2026-10-20）
- **文件**: `scripts/quality/check-theme-contract.mjs`
- **职责**: 视觉主题契约单门禁——token 卫生＋词表消费两面一台（原 theme-token-hygiene 与

#### Theme-Mix-Report（W0-5 · 契约 A7：新颜色角色三模式验收的机算件）
- **文件**: `scripts/quality/theme-mix-report.mjs`
- **职责**: 对 color-mix 派生角色计算 light/dark/warm 三模式实际值与对卡片底的对比比——
- **输出**: stdout 三模式表格（hex + 对卡片底 CR）；--json 出 JSON（供测试/台账引用）

#### Theme-Token-Hygiene-Guard（PR-025 阶段 3）
- **文件**: `scripts/quality/check-theme-tokens.mjs`
- **职责**: 前端主题契约的机器执法。检查面六项（docs/design/theme-contract.md 五禁令 + 显示模式 PR 补充）：

#### Theme-Vocab-Guard（PR-025 留账 2：配方自检能力固化）
- **文件**: `scripts/quality/check-theme-vocab.mjs`
- **职责**: 主题词汇表与定义的双向对账——「词表↔定义」缺失的实证（上会话配方自检

#### UsageBadgesStrip Tests（§3.3.1 实施项②）
- **文件**: `src/test/usage-badges-strip.test.tsx`
- **职责**: B 域使用徽章——画像数据呈现/无数据静默/维度隔离

#### Validation-Parity-Guard（校验规则一致性对账门禁）
- **文件**: `scripts/quality/check-validation-parity.mjs`
- **职责**: SPEC-011 WP6 建立；SPEC-022 波 C 收缩——Python 校验器退役后双侧对账面（③④⑤py 半）退役，
- **输入**: contracts/validation-rules.json；server/shared/enums-loader.cjs；
- **输出**: stdout va

#### check-interaction-state 的门禁回归测试（第二落地批，2026-10-21）
- **文件**: `scripts/quality/__tests__/check-interaction-state.test.mjs`
- **职责**: 钉住三检查面活性——基线绿；裸 loading、同前缀配对、本地五态字面量三探针各自必红；孤立 busy 布尔不误伤。

#### check-navigation 的门禁回归测试（读侧收编批，2026-10-21）
- **文件**: `scripts/quality/__tests__/check-navigation.test.mjs`
- **职责**: 钉住三检查面的执法活性——基线绿；直写/裸读/裸订阅三种探针各自必红。

#### check-recipe-usage 的门禁回归测试（结构收口尾批 V1——原零测试补齐）
- **文件**: `scripts/quality/__tests__/check-recipe-usage.test.mjs`
- **职责**: 钉住配方六检查的执法活性——先红后绿（无红面证明的执法器可静默失效）。

#### check-schema-shape 的门禁回归测试（SCHEMA-IA-001 批16）
- **文件**: `scripts/quality/__tests__/check-schema-shape.test.mjs`
- **职责**: 钉住候选单源执法活性——基线绿；候选键外泄两探针（表达式值/变量值）各自必红；

#### check-table-usage 的门禁回归测试（A2+B 活性门禁批）
- **文件**: `scripts/quality/__tests__/check-table-usage.test.mjs`
- **职责**: 钉住表格用法三道闸的执法活性——先红后绿。

#### check-term-copy 的门禁回归测试（term-copy 切片一批，2026-10-21）
- **文件**: `scripts/quality/__tests__/check-term-copy.test.mjs`
- **职责**: 钉住状态词执法活性——基线绿；字符串字面量／JSX 文本／ASCII 省略号漂移三探针各自必红；完整句不误伤。

#### check-theme-vocab 的门禁回归测试（vocab 固化批）
- **文件**: `scripts/quality/__tests__/check-theme-vocab.test.mjs`
- **职责**: 钉住词汇对账门禁的执法活性——先红后绿。

#### check-ui-kit 的门禁回归测试（ui-kit 棘轮基线批 2026-10-21；同日二次扩面 input）
- **文件**: `scripts/quality/__tests__/check-ui-kit.test.mjs`
- **职责**: 钉住双标签棘轮活性——基线绿；新文件原生 button／input、分标签存量膨胀、基线僵尸各自必红；计数下降不拦。

#### theme-mix-report 的回归测试（W0-5 · 契约 A7）
- **文件**: `scripts/quality/__tests__/theme-mix-report.test.mjs`
- **职责**: 钉住三模式实算的正确性——六值与 2026-10-15 体检报告手算值对齐

### repo data 目录（与 Node sqlite-adapter 同库：WAL＋busy_timeout 跨进程并发安全）

#### _runtime_state_db
- **文件**: `scripts/vault-runtime/_runtime_state_db.py`
- **职责**: SPEC-012 WP-A 管线三件套的 Python 侧持久化——runtime-state.db（repo 侧 data/，SQLite）。
- **输入**: 环境变量 KB_DATA_DIR（服务端 spawn 注入，与 KB_VAULT 同款先例）
- **输出**: load_stage/save_stage/clear_stage、insert_run_summary、read_pipeline_version/upsert_pipeline_version

### repo 根（脚本位置锚定）

#### Check-Vault-Write-Destinations
- **文件**: `scripts/quality/check-vault-write-destinations.mjs`
- **职责**: SPEC-012 F1 写通道目的地执法的 CI 面——契约良构＋棘轮（allowedPermanent/migrationWhitelist
- **输入**: contracts/vault-write-destinations.json、git HEAD 版本、server/**/*.cjs 源码
- **输出**: vault_write_destinations=ok|FAIL（exit 0/1）

### repo 根（脚本位置锚定）。扫描豁免：__tests__（夹具路径字面量合法）、整行注释、

#### Check-Article-Lifecycle
- **文件**: `scripts/quality/check-article-lifecycle.mjs`
- **职责**: SPEC-013 文章生命周期路径角色契约的静态执法面——契约良构＋server 侧裸拼四族路径
- **输入**: contracts/article-lifecycle.json（+schema 形态断言）、server/**/*.cjs 源码
- **输出**: article_lifecycle=ok|FAIL（exit 0/1）

### repo 根（脚本位置锚定；vault 侧运行时状态检查，与 check-schema-writers 面⑥同族）

#### Check-Vault-Observation-Exit
- **文件**: `scripts/quality/check-vault-observation-exit.mjs`
- **职责**: SPEC-012 WP-B ④类迁出后的反向断言门禁——contracts/observation-domain.json 声明
- **输入**: contracts/observation-domain.json；VAULT_PATH 指向的 vault 文件系统
- **输出**: vault_observation_exit=ok|FAIL（exit 0/1）

### theschema-roles.json 段级纪律——null 段=只读账（lifecycle/category_map/subdomain_layer_map

#### Null-Segment-Guard（数据域治理批 A6——check:schema-writers 检查面⑧的纯函数面）
- **文件**: `scripts/quality/shared/null-segment-guard.mjs`
- **职责**: edited_by_tab=null 且非 reserved 的 enums 段（页面不可编辑段）的越权直写检测。

### 先例=check-layer-ssot.test.mjs（spawnSync 临时目录形态）

#### Taxonomy-Growth-Guard Tests
- **文件**: `scripts/quality/__tests__/check-taxonomy-growth.test.mjs`
- **职责**: 验证 ADR-006 生长框架三态——观察期（矩阵未配置=ok）、立契期（矩阵执法+基线豁免）、audit 全景；
- **输入**: check-taxonomy-growth.mjs + 临时 vault fixture
- **输出**: node:test 断言

### 先例=check-taxonomy-growth.test.mjs（spawnSync 临时目录形态）

#### Schema-Writers-Guard Tests — 检查面⑥ vault git 洁净度（SPEC-010-W10 WP4）
- **文件**: `scripts/quality/__tests__/check-schema-writers-surface6.test.mjs`
- **职责**: 验证 ⑥面：干净 vault=clean 提示；脏文件=WARN（过渡期软告警不计 FAIL）；
- **输入**: check-schema-writers.mjs + 临时 vault fixture（git init）
- **输出**: node:test 断言

### 数据源与 Python 同源：resolved-domains.json（必填集）＋enums.yaml（经 normalizeEnums

#### Article-Validator-Service
- **文件**: `scripts/vault-runtime/article-validator-lib.cjs`
- **职责**: 文章校验语义唯一实现（SPEC-022 波 A）——逐规则镜像 validate-article.py 现行为，
- **输入**: vaultPath（KB 根——知识库/ 的父目录）＋目标文章文件
- **输出**: {file, valid, errors, warnings}（消息文本与 Python 逐字对齐，除登记变更）＋五模式

### 设计文档 §3.3.1（2026-10-09 勘误版）——B 域加只读使用徽章，编辑权不动（手编=正确形态）。

#### UsageBadgesStrip（§3.3.1 实施项②：B 域结构编辑器的只读使用徽章——治"编辑是盲的"）
- **文件**: `src/features/schema-manager/UsageBadgesStrip.tsx`
- **职责**: 在 domains/layers 等结构编辑器顶部呈现该维度词表健康概览
- **输入**: discovery 响应 vocabularyProfile.dimensions[dimension]
- **输出**: 一行徽章条（无数据静默 null——画像未加载不阻塞编辑）

### 非产品代码——不被任何运行时 require；fastify 依赖随 PR-085 第 1 步 ADR-010 accepted 后才进 package.json。

#### Fastify-Integration-Probe（PR-085 第 0 步 · 外部组件开工前现场勘探）
- **文件**: `scripts/probes/fastify-integration-probe.mjs`
- **职责**: 以真实契约样本实证「Fastify 5.x ＋ 项目 Ajv2020 实例」的集成契约，为 SPEC-024 提供可复跑证据。
- **输入**: contracts/http-api.openapi.json（唯一契约事实源）；fastify（隔离安装，见「复跑」）；ajv（主树 node_modules）
- **输出**: 逐项 ✓/✗ 判定 ＋ 结论 JSON（stdout）；任一 ✗ → exit 1

<!-- GENERATED_COMPONENTS_END -->
