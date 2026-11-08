---
title: TheSchema
date: 2026-05-02
tags:
- Architecture
- 知识管理
status: 有效
category-path: meta.doc
review-cycle: 365d
updated: 2026-08-17
---

# TheSchema — 知识库权威规则源

> 本文件是 wiki/ 页面体系的唯一权威规则定义。所有 SKILL 必须以此为基准，冲突时以此为准。
> 枚举值定义在 `enums.yaml`、`ontology.yaml`，本文件只引用不重复。
>
> **注意**：`category-path` 现为**点分两段式** `domain.subdomain`（`validate-article.py` 强制）。冒号三段式 `domain:subdomain:topic` 已废弃。

## 一、目录与用途

```
知识库/
  raw/                      # 原始素材与加工中间态
    imported/               #   外部导入的原始文件（只读，仅用户可写；永不删除）
    precleaned/              #   standardize-article 输出的标准知识文章（一等来源）
    drafts/                  #   AI 产出草稿区（含 投稿/ = Web 上传写入，用户投递区）
    archive/                 #   已处理原始文件归档（投稿|本地草稿|<kind>/）
    boards/                  #   板块缓存（_enums-cache.md，sync-board-enums.py 自动维护）
  wiki/                      # 知识成品层
    entities/                #   实体页：产品、组件、服务、技术栈（arch_component: true 即架构节点唯一事实源）
    concepts/                #   概念页：方法论、流程、通用技术概念
    sources/                 #   摘要页：每个原始资料的提炼摘要
    overview/                #   总览页：主题总览、跨页面综合
    comparisons/             #   对比页：两个或多个事物的对比
    articles/                #   标准文章快照 <article_id>/<sha256>.md（0o444 只读，不可变）
    upgrades/                #   升级经验/程序相关
    queries/                 #   查询记录
    todo/                    #   待办事项（实体/概念）
    index.md                 #   快速索引（可自动生成）
    log.md                   #   操作日志
    graph-status.md          #   图谱状态页
  Attachments/               # 图片定居目录（仅 wikilink 嵌入，禁 ![alt](path)）
  TheSchema/                 # 本目录 — 只读参考
    TheSchema.md             #   本文
    enums.yaml               #   枚举注册表（domains/subdomains/modules/tags/lifecycle/category_map）
    ontology.yaml            #   本体定义（node_types/relation_types/inference_rules/constraints）
    SCHEMA.md                #   四层分类体系详细说明
    entity-frontmatter-schema.md  # Entity 页面架构字段规范
    AI_CONCEPT.md            #   组件/依赖/版本生命周期核心概念（AI 必读）
    dependencies.yaml        #   集中式版本依赖矩阵
    component-index.json     #   组件索引（规则 10：查组件先走索引，禁全项目扫描）
    versions.yaml            #   版本注册表
    DATA-DICTIONARY.md       #   数据字典
    KNOWLEDGE_SCENARIOS.md   #   标准场景与 category-path/doc-type 组合
    article_associations.yaml #  文章关联定义
    entity-disambiguation.md / entity-disambiguation-design.md  # 实体消歧
    interaction-contracts.md #   交互契约
    system-components.md     #   系统组件说明
    history/                 #   历史快照
  architecture/              # 架构图生成物 + 版本管理（节点由 wiki/entities/ 决定，规则 11-13）
  data/                      # 数据文件（如 customer-names.md 脱敏参考表）
  upgrade-programs/          # 升级程序
  .claude/                   # 流水线脚本（scripts/）与方案（plans/）
```

> 运行时契约数据（`master_graph.json`/`master_graph.db`/准入清单等）在 **vault 根 `.ledger/`**，不在 `知识库/` 下。

### 前端读写路径全景（7 组）

Vault 根 = `VAULT_PATH`（`/Users/example/Obsidian Vault Bare Test`）。以下为前端/系统实际读写的全部路径（已排除测试残留；`anybackup.md`、根级 `master_graph.json` 仅测试引用）。

#### A. `.ledger/` — 系统状态目录（**全部系统写入，非用户维护**）

| 路径 | 读写 | 内容 | 性质 |
| --- | --- | --- | --- |
| `master_graph.json` | 读写 | 派生主图（实体/关系全量） | 🔄 可重建 |
| `anomaly-work-items.json` | 读写 | 待处理问题 ledger | 🔄 可重建（有状态） |
| `article-upload-tasks.json` | 读写 | 投稿任务 ledger | 🔄 可重建（有状态） |
| `article-manifests/**/*.json` | 写 | 文章图谱映射 | 🔄 可重建 |
| `extract_manifest.json` | 读写 | 抽取清单 | 🔄 可重建 |
| `current/` | 写 | 当前 Release 指针 | 🔄 可重建 |
| `proposal-artifacts/relation-candidate-rejections/*.json` | 写 | 关系候选拒绝审计 | 🔒 审计证据 |
| `backups/articles\|entities/` | 写 | 备份 | 🔒 保留 |
| `dashboard_data.json`、`pipeline-runs.json`、`pipeline_state.json`、`pipeline_version.json` | 写 | 运行状态 | 🔄 可丢弃 |
| `formal-schema-release.json`、`inference_rule_conflicts.json`、`relation_write_expectations.json`、`review_actions.json` | 写 | 各域状态 | 🔄 可重建 |

#### B. `知识库/TheSchema/` — **Schema 权威源**（用户+系统，经 Schema Proposal 写）

`ontology.yaml`、`enums.yaml`、`dependencies.yaml`、`versions.yaml`、`article_associations.yaml`（读为主，Proposal 写）＋ `history/ontology\|enums/`（历史）、`releases/`（Schema Release）

#### C. `知识库/raw/` — 内容输入区

- `drafts/投稿/` — **Web 上传写入**（用户投递区）
- `drafts/` — 本地 Skill 草稿（读）
- `precleaned/` — 标准文章候选（读写）
- `archive/投稿\|本地草稿\|<kind>/` — 归档（写）
- `imported/` — 导入（写）

#### D. `知识库/wiki/` — **正式内容权威**

- `entities/*.md` — 实体事实页（**写回**，人工+系统）
- `articles/<article_id>/<sha256>.md` — 标准文章快照（写，`0o444` 只读权限，**不可变**）

#### E. `知识库/architecture/<product>/<version>/` — 派生投影

`semantic_architecture.json`（读写）、`architecture-version.snapshot.json`（发布快照，写）、`architecture_layout.json`（读）

#### F. `知识库/.claude/scripts/` — 管道脚本

`pipeline-runner.py`、`promote-article.py`、`validate-article.py`（执行）

#### G. Vault 根 — **无生产读写**（仅测试残留）

## 二、Wiki 页面类型与 Frontmatter Schema

> 所有页面必填字段随页面类型而定；`article_id` 为文章类必填（准入系统生成）。`category-path` 一律点分两段式 `domain.subdomain`，合法值来自 `enums.yaml` subdomains 段。

### 2.1 Entity 页面（`wiki/entities/*.md`）

代表产品、组件、技术栈等**具体事物**。是架构组件的唯一事实源。

```yaml
---
title: 实体名                        # 必填，与文件名一致
date: YYYY-MM-DD                     # 必填
tags:                                # 必填，至少1个，来自 enums.yaml tags 白名单
  - 分类标签
status: 有效                          # 必填：制定中 | 有效 | 已归档
category-path: ref.component         # L1 架构治理（entity 用 ref: 域；点分两段式）
review-cycle: 365d                   # 必填：30d | 90d | 180d | 365d | never
updated: YYYY-MM-DD                  # 必填

# ── 仅架构组件（arch_component: true）需以下字段 ──
architecture-node-id: mysql          # 全局唯一组件 ID（kebab-case）
architecture_node_id: mysql          # 兼容写法，工具链同时识别
arch_component: true                 # 标记为架构组件
arch_layer: data-lake                # 架构层级（合法值见 enums.yaml 别名/归一化）
arch_category: 存储                  # 业务分类（见 enums.yaml category_map）
arch_subdomain: database             # 子域
arch_since: "6.0"                    # 引入版本
arch_until: ""                       # 废弃版本（""=当前仍存在）
module:                              # 文章 module 匹配名
  - MySQL
  - 数据库
---
```

> 说明：`architecture-node-id` 是作者侧主写法，`architecture_node_id` 是工具链兼容写法。字段定义以 `entity-frontmatter-schema.md` 为权威，`arch_layer`/`arch_category` 合法值由 `enums.yaml` 集中声明并归一化。

Body 结构：
```markdown
# 实体名

## 概述
（一句话说明）

## 关联实体
依赖::[[目标组件]]
连接到::[[目标组件]]
存储于::[[目标组件]]
相关::[[目标实体]]

## 来源
- [[来源文章]]
```

类型化关系 wikilink 见 [三、链接规范](#三链接规范)，关系类型全集以 `ontology.yaml` `relation_types` 为准。

### 2.2 Concept 页面（`wiki/concepts/*.md`）

代表方法论、流程、**通用技术概念**。

```yaml
---
title: 概念名
date: YYYY-MM-DD
tags:
  - 分类标签
status: 有效
category-path: concept.method
review-cycle: 365d
updated: YYYY-MM-DD
---
```

Body 结构：
```markdown
# 概念名

## 概述

## 操作方法 / 适用场景 / 注意事项

## 典型案例
- [[案例]]

## 关联实体
- [[实体]]

## 关联概念
- [[概念]]

## 来源
- [[来源文章]]
```

### 2.3 Source 页面（`wiki/sources/*.md`）

每个原始资料的**摘要页**。从 `raw/imported/` 或 `raw/precleaned/` 提炼。

```yaml
---
title: 摘要标题
date: YYYY-MM-DD
tags:
  - 标签
status: 有效
category-path: ref.source
review-cycle: 180d
updated: YYYY-MM-DD
product: AnyShare                    # 可选，产品线
module: [[模块名]]                   # 可选，wikilink 指向 entity
version: "X.Y.Z"                     # 可选，明确版本号（无则留空）
article_type: 排错指南               # 可选（precleaned 必填）
doc-type: 运维手册                   # 可选（precleaned 必填）
---
```

### 2.4 Overview 页面（`wiki/overview/*.md`）

主题总览或跨页面综合。

```yaml
---
title: 总览标题
date: YYYY-MM-DD
tags:
  - 分类标签
status: 有效
category-path: ref.overview
review-cycle: 90d
updated: YYYY-MM-DD
---
```

### 2.5 标准知识文章（`raw/precleaned/` 与 `wiki/articles/`）

由 `standardize-article` 输出，`validate-article.py` 校验闸门。

```yaml
---
article_id: <准入系统生成>           # 必填，唯一标识
title: 文章标题
date: YYYY-MM-DD
tags:
  - 标签
status: 有效
category-path: ops.deploy            # 点分两段式，合法值见 enums.yaml
review-cycle: 90d
updated: YYYY-MM-DD
product: AnyShare                    # 4 值枚举
module: "[[ECMS集群]]"               # wikilink，33 个法定值（enums.yaml modules 段）
version: "7.0.6.4"                   # X.Y 或 X.Y.Z.W 或范围
article_type: 排错指南               # 9 值枚举
doc-type: 运维手册                   # 8 值枚举
quality: 8                           # 可选，0-10
---
```

## 三、链接规范

### 3.1 双向链接原则

每创建一个新页面，必须建立双向 wikilink：
- 摘要页 → 实体/概念页（关联章节）
- 实体/概念页 → 摘要页（来源章节）
- 实体页 ↔ 概念页（互相关联）
- 所有新页面 → index.md

### 3.2 Wikilink 格式

```
[[页面名]]                          # 基本 wikilink
依赖::[[目标实体]]                   # 类型化关系（仅 entity 页面用）
[[页面名#章节]]                      # 锚点链接
```

类型化关系类型全集（`ontology.yaml` `relation_types`，label_cn）：

`依赖` `文档说明` `引用` `提及` `归属` `适用于` `拥有版本` `现象` `使用` `相关` `备份于` `存储于` `连接到` `索引于` `加密` `关联板块`

### 3.3 断链规则

- `[[wikilink]]` 指向不存在的页面 → 创建 stub 页或修复链接
- 禁止保留断链进入主分支

## 四、管道管线

```
                            ┌──────────────────┐
                            │   raw/imported/  │ (原始文件)
                            └────────┬─────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
     standardize-article      manage-knowledge-base   用户手动
     SKILL                    SKILL §3
              │                      │                      │
              ↓                      ↓                      ↓
     raw/precleaned/          wiki/sources/           wiki/entities/
     (标准知识文章)            (摘要页)                 wiki/concepts/
              │                      │                 (实体/概念页)
              │ Step 1.5+Step 9      │                      │
              │ (匹配实体/概念，      │                      │
              │  反向更新来源)        │                      │
              └──────────────────────┴──────────────────────┘
                                     │
                                     ↓
                      pipeline-runner.py（图谱管道唯一入口，G3）
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        ↓                            ↓                            ↓
 extract_graph.py          generate-sa.py                 validate-entity.py
 (R1-R5 提升规则)          (entity → semantic + layout)   (校验闸门，ERROR=0)
        ↓                            ↓
 .ledger/master_graph.json  architecture/AnyShare/master/
 (Vault↔Pipeline 契约)       semantic_architecture.json + architecture_layout.json
        ↓
 .ledger/master_graph.db（SQLite 镜像）
```

> 管道入口统一为 `pipeline-runner.py`（CLAUDE.md G3）。`extract_graph.py --apply`、`npm run sync`、`sync-semantic-architecture.py` 均已废弃。`master_graph.json` 在 vault 根 `.ledger/`。

**主要管线分工**：
- `standardize-article`：原始文件 → 标准文章（precleaned/），Step 1.5 自动匹配 wiki 实体/概念，Step 9 反向更新"来源"章节
- `manage-knowledge-base` §3：直接建 wiki 页面体系（sources + entities + concepts），不走标准化流程
- 全自动摄取（路由 J）、版本审核（路由 K）：见 CLAUDE.md 路由表

## 五、分类体系速查

完整定义见 `SCHEMA.md` 和 `enums.yaml`。

```
L1 category-path: domain.subdomain  (架构治理；点分两段式)
L2 业务字段:     product + module + version + article_type + doc-type
L3 tags:         标签白名单 (enums.yaml tags/)
L4 生命周期:     status + review-cycle + updated + expires
```

### 5.1 Domain 速查

| domain | 说明 |
|--------|------|
| `ref` | 参考资料（entity/source/overview 均用此域） |
| `ops` | 运维操作 |
| `concept` | 方法/理论 |
| `product` | 产品域 |
| `meta` | 知识库元内容 |
| `arch` | 架构 |

### 5.2 Module 速查

完整列表见 `enums.yaml` modules 段（**33 个** module，含 subdomain/system/since/until）。以 enums.yaml 为准，此处不硬编码。

### 5.3 Tags 白名单

定义在 `enums.yaml` tags 段。5 组：`架构与产品` `领域标签` `运维操作` `技术栈` `知识管理`。

## 六、操作规则

### 6.1 创建新页面
1. 确定页面类型（entity / concept / source / overview / article）
2. 查重：检查 `wiki/{type}/` 下是否已有同名页面
3. 存在 → 追加来源 + 更新内容
4. 不存在 → 使用对应模板创建
5. 建立双向链接
6. 更新 `index.md`
7. 追加 `log.md`

### 6.2 修改页面
1. 不改变 `title`（除非重命名文件）
2. 更新 `updated` 日期
3. 追加新来源到"来源"章节（去重）

### 6.3 禁止
- 禁止编造原文没有的信息
- 禁止在 source 摘要中添加原文没有的链接
- 禁止修改用户原始意图
- 禁止保留断链

## 七、AI 执行工作流

```
用户指令 → CLAUDE.md 路由 → SKILL → 按固定模板执行
                                 → 写入 wiki/ + 双向链接 + 更新 index
                                 → 追加 log.md
```

### 典型触发 → 路由映射

| 用户说 | 路由到 |
|--------|--------|
| "处理 raw/ 下的文件" | manage-knowledge-base §3 |
| "从这份资料提取 wiki 摘要" | manage-knowledge-base §3 |
| "创建 wiki 页面" | manage-knowledge-base §3 |
| "扩展知识图谱 / 审核图谱关系 / 扩展 Schema" | manage-kg（路由 D） |
| "整理成知识文章" | standardize-article |
| "标准化输出" | standardize-article |
| "检查知识库健康度" | manage-knowledge-base §9 |
| "扫描 frontmatter" | validate_classification.py |
| "生成 Mermaid 依赖图" | manage-knowledge-base §3.9 |
| "以 X 为中心生成架构图" | obsidian-graph-architecture-integration（路由 G1/G2） |
| "同步图谱 / 跑管道" | graph-pipeline（路由 G3，pipeline-runner.py） |

## 八、提交前校验闸门

```
修改 entity / dependencies.yaml → validate-entity.py --changed → ERROR=0 方可提交
修改 precleaned 标准文章         → validate-article.py          → 合规方可提交
修改 wiki/ 页面                → validate_classification.py    → 0 问题方可提交
```

标准库健康度 = **0 ERROR + 0 WARNING**（详见 `AI_CONCEPT.md` §10）。

---

*v2.0 — 2026-08-17*
