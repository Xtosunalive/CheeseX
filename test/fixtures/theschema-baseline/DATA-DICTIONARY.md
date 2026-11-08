# 企业知识库数据字典

> v2.1 — 2026-05-01  
> 覆盖 AnyShare / AnyBackup / AnyRobot 产品线知识管理系统的完整数据模型

---

## 一、系统架构概览

```
┌─────────────────────────────────────────────────────────┐
│                    知识文章 (Markdown)                    │
│                  四层 Frontmatter 元数据                   │
└────────────────────────┬────────────────────────────────┘
                         │ extract_graph.py
                         ▼
┌─────────────────────────────────────────────────────────┐
│              知识图谱 (15 种边类型)                        │
│   ┌──────────┐   ┌──────────┐   ┌──────────────────┐   │
│   │ 组件节点  │◄──│ 文档节点  │──►│ 概念/版本/产品节点 │   │
│   │ (System) │   │(Document)│   │ (Concept/Ver...) │   │
│   └──────────┘   └──────────┘   └──────────────────┘   │
└────────────────────────┬────────────────────────────────┘
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
   ┌──────────┐  ┌───────────┐  ┌───────────┐
   │ 架构图系统 │  │ Obsidian   │  │ 双引擎检索 │
   │ (Electron)│  │ Dataview   │  │ Graph+向量 │
   └──────────┘  └───────────┘  └───────────┘
```

**核心设计原则**：
1. 每条信息只归属一处，永不字段重叠
2. 所有枚举字段闭合受控，禁止自由文本
3. 文章 frontmatter 是唯一事实源，图数据由此派生

### 1.1 Frontmatter 在数据模型中的角色

每篇知识文章携带 **14 个 frontmatter 字段**，按职责划分为四层。这不是简单的"元数据标签"——它是整个系统的**数据契约层**，扮演三个角色：

```
                     ┌─────────────────────────────┐
                     │     Frontmatter (14 字段)     │
                     │  人写 → 机读 → 图派生 → 检索   │
                     └────────────┬────────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          ▼                       ▼                       ▼
   ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
   │  角色一: 骨架  │      │  角色二: 路由  │      │  角色三: 治理  │
   │  图结构的唯一   │      │  检索和过滤的   │      │  质量和时效的   │
   │  事实源        │      │  多维入口       │      │  自动化闸门     │
   └──────────────┘      └──────────────┘      └──────────────┘
```

**角色一：图结构的唯一事实源**

frontmatter 中的 7 个字段直接映射为知识图谱的节点和边：

| frontmatter 字段 | 驱动的图操作 |
|------------------|-------------|
| `module` | 创建 `DOCUMENTS` 边 → System 节点，锚定文档归属的架构组件 |
| `product` | 创建/匹配 Product 节点 + `APPLIES_TO` 边 |
| `version` | 创建/匹配 ProductVersion 节点 + `APPLIES_TO` 边 + `USES` 边 |
| `category-path` | 创建 `BELONGS_TO` 边 → Subdomain → BusinessDomain 节点链 |
| `tags` | 创建 `MENTIONS` 边 → Concept 节点；`排错指南` 时额外创建 `HAS_SYMPTOM` 边 |
| `article_type` | 判定是否触发 `HAS_SYMPTOM` 边生成（值为 `排错指南` 时） |
| （body wikilinks） | 创建 `REFERENCES` 边 → 被引用的任意节点 |

提取器（`extract_graph.py`）**不创造事实，只翻译事实**——它读取 frontmatter，将字段值按规则映射为图节点和边。这意味着任何人修改 frontmatter 后运行提取，图谱自动同步，无需手动维护图数据库。

**角色二：检索和过滤的多维入口**

frontmatter 的枚举字段构成了一个正交的筛选维度矩阵。以 Obsidian Dataview 或双引擎检索为例：

```dataview
TABLE module, version, quality
FROM "raw/precleaned"
WHERE article_type = "排错指南"
  AND product = "AnyShare"
  AND doc-type = "运维手册"
SORT quality DESC
```

四个维度（`product` × `article_type` × `doc-type` × `module`）正交组合，可以在不打开文件的情况下完成"找出所有 AnyShare 7.0 版本中 MySQL 相关的排错文档"这类跨维度查询。

**角色三：质量和时效的自动化闸门**

第四层生命周期字段（`status`, `review-cycle`, `updated`, `expires`）独立于内容和图谱，管控文档的**治理状态**：

- `status: 已归档` → 文档从活跃知识库降权，图谱中降低边权重但不删除
- `review-cycle` + `updated` → 计算审查到期日，到期文档进入待审队列
- `expires` → 硬过期，文档从检索结果中移除（图谱节点保留用于历史追溯）
- `quality` → 质量阈值过滤（如检索时只返回 quality ≥ 5 的结果）

**四层分工总览**：

| 层级 | 字段数 | 字段 | 职责 | 消费方 |
|------|:----:|------|------|--------|
| 基础标识 | 2 | `title`, `date` | 文档身份 | 全系统 |
| 第一层 | 1 | `category-path` | 架构治理、领域归类 | 图: `BELONGS_TO` 边 |
| 第二层 | 6 | `product`, `module`, `version`, `article_type`, `doc-type`, `quality` | 资产标准化、图结构派生、质量管控 | 图: 5 种边 + SQLite 索引 + Dataview 筛选 |
| 第三层 | 1 | `tags` | 横向聚合、场景标记、灵活检索 | 图: `MENTIONS` + `HAS_SYMPTOM` 边 + 向量检索 |
| 第四层 | 4 | `status`, `review-cycle`, `updated`, `expires` | 时效管控、合规审计 | 审查调度 + 检索降权/过滤 |

> 共 14 个字段。其中 7 个直接驱动图结构生成，4 个管控生命周期，3 个（`title`, `date`, `doc-type`）提供标识和分类上下文。

---

## 二、Frontmatter 字段规范

### 2.1 基础标识

| 字段 | 类型 | 必填 | 说明 |
|------|------|:--:|------|
| `title` | string | ● | 页面标题，必须与文件名一致 |
| `date` | YYYY-MM-DD | ● | 创建日期 |

### 2.2 第一层：架构治理

| 字段 | 类型 | 必填 | 说明 |
|------|------|:--:|------|
| `category-path` | 枚举组合 | ● | `{domain}:{subdomain}:{topic}` |

**domain（6 值）：**

| 值 | 说明 | 子域数 |
|----|------|:----:|
| `ref` | 参考资料（entity/source/overview 均用此域） | 6 |
| `ops` | 运维操作 | 9 |
| `concept` | 方法/理论 | 2 |
| `product` | 产品域 | 4 |
| `meta` | 知识库元内容 | 6 |
| `arch` | 架构 | 1 |

**subdomain（按 domain 分组，共 28 个）：**

| domain | subdomain | 说明 |
|--------|-----------|------|
| ref | architecture | 架构图文档 |
| ref | component | 组件实体页 |
| ref | other | 待归类 |
| ref | overview | 总览页 |
| ref | product | 产品实体页 |
| ref | source | 来源摘要页 |
| ops | backup | 备份恢复 |
| ops | config | 配置变更 |
| ops | deploy | 部署安装 |
| ops | maintain | 日常维护 |
| ops | monitor | 监控巡检 |
| ops | network | 网络 |
| ops | storage | 存储管理 |
| ops | ticketing | 工单 |
| ops | upgrade | 升级迁移 |
| concept | comparison | 对比分析 |
| concept | method | 方法论/操作概念 |
| meta | doc | 文档/规范 |
| meta | index | 索引页 |
| meta | log | 操作日志 |
| meta | query | 查询结果页 |
| meta | reference | 参考资料 |
| meta | todo | 待办项 |
| product | anybackup | AnyBackup 产品 |
| product | anyrobot | AnyRobot 产品 |
| product | anyshare | AnyShare 产品 |
| product | general | 跨产品/通用 |
| arch | architecture | 架构定义 |

### 2.3 第二层：业务元数据（6 字段）

#### product — 产品线

| 值 | 说明 |
|----|------|
| `AnyShare` | 企业级文档云平台 |
| `AnyBackup` | 企业级备份平台 |
| `AnyRobot` | 智能运维平台 |
| `通用` | 跨产品/通用技术 |

#### module — 所属模块

类型：wikilink 枚举。53 个可选值，通过 `"[[模块名]]"` 关联 wiki 实体页。

核心模块（部分）：

| 值 | 对应架构节点 |
|----|-------------|
| `[[MySQL]]` | mysql |
| `[[Ceph]]` | ceph-eceph |
| `[[Kubernetes]]` | kubernetes, docker |
| `[[ECMS集群]]` | ecms-cluster |
| `[[OSS网关]]` | oss-gateway |
| `[[Content服务]]` | content-service |
| `[[OpenSearch]]` | opensearch |
| `[[认证服务]]` | access-control |
| `[[Office Online]]` | office-online |
| `[[Calico]]` | calico |
| `[[麒麟OS]]` | os-support |

> 完整 53 值列表见 `TheSchema/enums.yaml` modules 段

#### version — 产品版本

| 约束 | 说明 |
|------|------|
| 合法格式 | `X.Y` 或 `X.Y.Z.W` |
| 范围格式 | `X.Y.Z.W → A.B.C.D` |
| 禁止 | 自由文本、粘贴配置内容 |
| 缺省值 | 空字符串（触发版本待审核流程） |

#### article_type — 内容体裁

回答"这篇文章用来解决什么问题"。7 个闭合枚举值：

| 值 | 说明 |
|----|------|
| `排错指南` | 故障排查步骤（现象→定位→处置→验证） |
| `常见问题` | FAQ 问答 |
| `场景规范` | 特定场景操作规范 |
| `巡检方案` | 定期巡检流程 |
| `方案设计` | 技术方案设计 |
| `升级经验` | 跨版本升级、迁移、踩坑与回退 |
| `最佳实践` | 可复用约定、推荐配置、明确禁忌与取舍 |

#### doc-type — 文档载体类型

回答"属于哪本手册/成套资料"。8 个闭合枚举值：

| 值 | 说明 |
|----|------|
| `用户手册` | 面向用户的操作手册 |
| `部署指南` | 安装部署文档 |
| `配置手册` | 配置参数说明 |
| `运维手册` | 日常运维操作 |
| `巡检手册` | 定期巡检操作手册 |
| `技术文档` | 通用技术文档 |
| `测试报告` | 测试验证结果 |
| `导航索引` | 索引/目录页 |

#### quality — 质量评分

| 约束 | 说明 |
|------|------|
| 类型 | 整数 0-10 |
| 必填 | 否（可选字段） |
| 9-10 | 经多人验证、步骤完整、有截图 |
| 7-8 | 经单人验证、步骤完整 |
| 5-6 | 内容正确但缺少验证或截图 |
| 0-4 | 草稿/待补充/信息过时 |

### 2.4 第三层：检索标签

| 字段 | 类型 | 必填 | 说明 |
|------|------|:--:|------|
| `tags` | list[string] | ● | 至少 1 个，受控白名单 |

**标签分类法（5 组，定义在 `enums.yaml` tags 段）：**

| 组     | 示例                                   | 语义         |
| ----- | ------------------------------------ | ---------- |
| 架构与产品 | `架构`, `Ceph`, `Architecture`, `架构图`  | 架构图与产品线关联  |
| 领域标签  | `安全`, `存储`, `网络`, `数据库`, `搜索`        | 跨模块的领域分类   |
| 运维操作  | `运维`, `排障`, `性能`, `备份`, `升级`, `部署`   | 运维动作分类     |
| 技术栈   | `Kubernetes`, `Java`, `Linux`, `OOM` | 技术组件/语言/平台 |
| 知识管理  | `knowledge`, `meta`                  | 知识库元标签     |

**语义边界规则**：tags 表达"内容涉及"，module 表达"文档归属"。同一个词在 tags 和 module 中的语义不同，不重复承载 product/article_type 已锁定的信息。

> 完整标签白名单见 `TheSchema/SCHEMA.md` §4.3

### 2.5 第四层：生命周期

| 字段             | 类型         | 必填  | 值                                         | 说明           |
| -------------- | ---------- | :-: | ----------------------------------------- | ------------ |
| `status`       | 闭合枚举       |  ●  | `制定中` / `有效` / `已归档`                      | 文档状态         |
| `review-cycle` | 闭合枚举       |  ●  | `30d` / `90d` / `180d` / `365d` / `never` | 审查周期         |
| `updated`      | YYYY-MM-DD |  ●  | —                                         | 最后审查日期       |
| `expires`      | YYYY-MM-DD |     | —                                         | 过期日期，省略=常青内容 |

**计算规则**：审查到期 = `updated` + `review-cycle` 天数；文档过期 = `expires` 日期到达。任一条件触发人工审查。

### 2.6 Frontmatter 完整模板

```yaml
---
# 基础
title: 标题（与文件名一致）
date: 2026-05-01

# 第一层：架构治理
category-path: ops:storage:mysql-oom

# 第二层：业务元数据
product: AnyShare
module: "[[MySQL]]"
version: 7.0.6.4
article_type: 排错指南
doc-type: 运维手册
quality: 8

# 第三层：检索标签
tags: [MySQL, OOM, 数据库, 排障]

# 第四层：生命周期
status: 有效
review-cycle: 90d
updated: 2026-05-01
expires: 2027-05-01
---
```

---

## 三、图节点类型

共 10 种节点类型：

| 节点类型 | 域 | 说明 | 可发出的边 |
|----------|----|------|-----------|
| **System** | 服务 | 架构组件（审定） | DEPENDS_ON, DOCUMENTS, REFERENCES, RELATED, USES, HAS_VERSION |
| **Document** | 文档 | 知识文章 | DOCUMENTS, REFERENCES, MENTIONS, APPLIES_TO, BELONGS_TO, HAS_SYMPTOM |
| **Entity** | 服务 | 知识库实体页 | BELONGS_TO, REFERENCES, DOCUMENTS |
| **Concept** | 概念 | 概念/术语/现象 | REFERENCES, DOCUMENTS, MENTIONS |
| **Module** | 服务 | 知识库模块分组 | BELONGS_TO, REFERENCES, DOCUMENTS |
| **BusinessDomain** | 域 | 业务域（ops 等） | BELONGS_TO |
| **Subdomain** | 域 | 子域（deploy 等） | BELONGS_TO |
| **Product** | 产品 | 产品线 | HAS_VERSION, APPLIES_TO |
| **ProductVersion** | 版本 | 产品版本号 | USES, APPLIES_TO, HAS_VERSION |
| **Team** | 其他 | 团队/组织 | REFERENCES |

---

## 四、图边类型（15 种）

### 4.1 文档关联类（Document 节点发出）

Document 节点可发出 6 种边，是知识图谱中连接数最多的节点类型。

| 边类型 | 源 → 目标 | 权重 | 说明 | 生成方式 |
|--------|----------|:--:|------|----------|
| **DOCUMENTS** | Document → System/Entity/Concept/Module | 0.9 | 文档归属某组件/模块 | frontmatter `module` 字段映射 |
| **REFERENCES** | Document → 任意 | 0.4 | 正文 wikilink 引用 | 解析 body 中 `[[...]]` |
| **MENTIONS** | Document → Concept/System | 0.2 | 正文提及某概念 | 关键词在 body 中的密度匹配 |
| **APPLIES_TO** | Document → Product/ProductVersion | 0.9 | 文档适用于某产品/版本 | frontmatter `product` + `version` |
| **BELONGS_TO** | Document → BusinessDomain/Subdomain | 0.8 | 文档归类到子域 | frontmatter `category-path` |
| **HAS_SYMPTOM** | Document → Concept | 0.7 | 排错文档描述某故障现象 | `article_type="排错指南"` 时 tags 匹配 Concept 节点 |

### 4.2 组件架构类（System/Entity 节点发出）

| 边类型 | 源 → 目标 | 权重 | 版本化 | 说明 |
|--------|----------|:--:|:--:|------|
| **DEPENDS_ON** | System/Entity/Module → System | 1.0 | ● | A 运行时依赖 B |
| **CONNECTS_TO** | System/Entity → System/Entity | 0.7 | ● | A 网络连接到 B |
| **STORES_IN** | System/Entity → System/Entity | 0.8 | ● | A 数据存储于 B |
| **BACKS_UP** | System/Entity → System/Entity | 0.7 | ● | A 备份到 B |
| **INDEXES** | System/Entity → System/Entity | 0.6 | ● | A 对 B 建立索引 |
| **ENCRYPTS** | System/Entity → System/Entity | 0.6 | ● | A 加密 B 的数据 |
| **USES** | ProductVersion → System | 0.9 | ● | 某版本使用了某组件 |

### 4.3 组织归属类

| 边类型 | 源 → 目标 | 权重 | 说明 |
|--------|----------|:--:|------|
| **BELONGS_TO** | Subdomain → BusinessDomain | 0.8 | 子域归属到域 |
| **HAS_VERSION** | Product → ProductVersion | 1.0 | 产品拥有的版本 |

### 4.4 兜底

| 边类型 | 源 → 目标 | 权重 | 说明 |
|--------|----------|:--:|------|
| **RELATED** | 任意 → 任意 | 0.3 | 通用关联（需人工审核确认类型） |

---

## 五、Entity 页面字段（架构组件定义）

Entity 页面（`wiki/entities/*.md`）是架构组件的唯一事实源。`arch_component: true` 时：

| 字段                       | 类型     | 必填  | 说明                                                                               |
| ------------------------ | ------ | :-: | -------------------------------------------------------------------------------- |
| `title`                  | string |  ●  | 显示名                                                                              |
| `architecture-node-id`   | string |  ●  | 全局唯一组件 ID（kebab-case）。作者侧建议保留连字符；工具链同时兼容 `architecture_node_id`，审计/同步/修复会按同一实体处理 |
| `arch_component`         | bool   |  ●  | 标记为架构组件                                                                          |
| `arch_layer`             | enum   |  ●  | 架构层级（声明值来自 `enums.yaml` 的 `architecture_projection.layers` + `architecture_projection.layer_aliases`）                  |
| `arch_category`          | enum   |  ●  | 业务分类：`服务` / `存储` / `基础设施` / `安全` / `终端`                                          |
| `arch_subdomain`         | string |  ●  | 子域 slug                                                                          |
| `arch_since`             | string |  ●  | 引入版本                                                                             |
| `arch_until`             | string |  ●  | 废弃版本（空 = 当前有效）                                                                   |
| `module`                 | list   |  ●  | 文章 module 匹配名列表                                                                  |
| `status`                 | enum   |  ●  | `有效` / `已归档` / `制定中`                                                             |
| `arch_version_overrides` | list   |     | 版本间属性差异覆盖                                                                        |

**arch_layer 声明与归一化规则：**

- `enums.yaml` 的 `architecture_projection` 段集中声明 `layers` 和 `layer_aliases`
- `sync-semantic-architecture.py`、`audit-arch-components.py`、`validate-entity.py` 均按该表做归一化/校验
- 作者侧可继续写别名，治理层会统一折算到规范层

| 值 | 含义 | 颜色 |
|----|------|:--:|
| `external` | 外部系统 | gray |
| `gateway` | 网关层（别名 → `foundation`） | slate |
| `application` | 应用层 | teal |
| `service` | 服务层（别名 → `cloud-native`） | cyan |
| `cloud-native` | 云原生基础设施 | slate |
| `data-lake` | 数据湖 | amber |
| `foundation` | 基础层 | indigo |
| `crosscutting` | 横切安全 | rose |
| `open` | 开放平台 | indigo |
| `intelligence` | 智能层 | purple |
| `data` | 旧写法别名 → `data-lake` | amber |
| `platform` | 旧写法别名 → `cloud-native` | slate |
| `infra` | 旧写法别名 → `cloud-native` | slate |
| `security` | 旧写法别名 → `crosscutting` | rose |

---

## 六、存储与运行时

| 存储 | 格式 | 用途 |
|------|------|------|
| `master_graph.json` | JSON | 完整图拓扑（nodes + connections） |
| `master_graph.db` | SQLite | 结构化索引（document_index 表存 frontmatter_json） |
| `vector-cache.json` | JSON | Obsidian 插件生成的文档向量 |
| `AnyShare.architecture.json` | JSON | 架构图系统的视觉 + 知识图谱数据 |

**查询引擎**：
- `graph_query_api.py` — NetworkX 图查询（stats, impact, coverage, path, search, trace）
- `dual_query_api.py` — 双引擎检索（图遍历 + 向量相似度）
- `vector_bridge.py` — 图节点 ↔ 向量缓存的桥接层

**诊断与修复引擎**：
- `check_consistency.py` — 跨存储一致性校验：`master_graph.json` ↔ SQLite ↔ `vector-cache.json`
- `repair-arch-contract.py` — 架构契约治理：`architecture-node-id` → `architecture_node_id` + frontmatter 必填字段补全（`--bootstrap`）
- `audit-arch-components.py` — 架构组件治理审计：声明矛盾、layer 预演树、Frontmatter 输出/修订建议（只读）
- `check-data-chain.mjs` — 跨 master / semantic / layout / API / SQLite 一致性一体校验
- `health-report.mjs` — 聚合以上检查 + 悬边/重复 id 检测，供 Electron `/api/system/self-check` 调用

---

## 七、CLI 工具与维护命令全集

> 知识库端脚本位于 `.claude/scripts/`，架构图端脚本位于 `架构图系统/scripts/`。
> 所有工具通过 `python3 <script>` 直接调用。

### 7.1 核心提取与生成

| 工具 | 位置 | 用途 | 关键参数 |
|------|------|------|----------|
| `extract_graph.py` | 知识库 | 全量知识图谱提取：``KB_VAULT``=Obsidian 仓库根（``kb_paths.py``）；扫描 ``知识库/`` → 解析 frontmatter + wikilink → 写入 Vault 根 ``.ledger/master_graph.json`` + SQLite ``document_index`` | `--apply` `--incremental` `--validate` `--create-stubs` `--force` |
| `generate-sa.py` | 知识库 | 从 entity 页面 + `dependencies.yaml` 生成 `semantic_architecture.json` | `--apply` |
| `project_architecture.py` | 知识库 | 从 `master_graph.json` 生成架构投影候选列表（新组件发现） | — |
| `sync-semantic-architecture.py` | 架构图 | 委托入口：entity → `semantic_architecture.json` + `architecture_layout.json`，保留已有节点坐标 | `--apply` |
| `sync.sh` | 架构图 | 一键同步：抽取图谱数据 → 刷新架构图，封装完整管线 | — |

### 7.2 校验闸门（CI 管线）

| 工具 | 位置 | 用途 | 严重级别 |
|------|------|------|:--:|
| `validate-article.py` | 知识库 | 文章提交前校验：必填字段（title, module, product, article_type, doc-type）、枚举合法性、标签白名单、`validation_status` 盖章 | ERROR / WARNING |
| `validate-entity.py` | 知识库 | entity 页面 + dependency 变更预检：`arch_layer`/`arch_category` 合法性、节点 ID 唯一性、依赖端点存在性 | ERROR 必须清零 |
| `validate_classification.py` | 知识库 | 四层分类标签校验：`category-path` domain/subdomain 必须在 `enums.yaml` 闭合枚举内 | ERROR |
| `validate_graph.py` | 知识库 | 图关系合理性校验：边端点有效性、BELONGS_TO 链完整性、孤立节点检测 | WARNING |
| `audit-arch-components.py` | 架构图 | 架构组件声明审计：`arch_component` 矛盾、`arch_layer` 预演树、Frontmatter 输出/修订建议 | 信息 |
| `check-quality-gate.sh` | 架构图 | PR 合并前质量闸门：检查图数据库质量阈值，退出码 0=通过 1=不通过 | 阻断 |
| `check-data-chain.mjs` | 架构图 | 数据链路完整性检查：master → semantic → layout → API → SQLite/vector 一致性，投影校验 | 阻断 |
| `health-report.mjs` | 架构图 | 聚合 master 完整性（悬边/重复id）+ semantic 断链 + check-data-chain 综合健康报告 | 信息 |

### 7.3 枚举与分类管理

| 工具 | 用途 | 主要子命令 |
|------|------|-----------|
| `kb-enum.py` | 闭合枚举值一键管理：新增 `doc-type`/`article_type`/`product` 时同步 3-5 个关联文件 | `add <field> <value> [--dry-run]` `list [field]` |
| `classify.py` | 统一分类管理 CLI：entity ↔ module ↔ system 映射维护 + 待审核文档批量归类 | `entity list/map/unmap/suggest/apply/modules/module-add` `pending [--apply] [--sources-only]` |
| `fix_tags.py` | 标签治理：批量修复不在白名单的标签值 | — |

**`classify.py` 子命令详解：**

```bash
classify.py entity list               # 列出所有实体映射状态
classify.py entity list --unmapped    # 只列出未映射的实体
classify.py entity suggest            # 基于关键词自动建议映射
classify.py entity map <id> <module>  # 建立实体 → module 映射
classify.py entity unmap <id>         # 解除映射
classify.py entity apply --confirm    # 批量写入建议映射
classify.py entity modules            # 列出已有 module
classify.py entity module-add <name> <system> <subdomain>  # 新增 module
classify.py pending                   # 预览待审核文档归类建议（92 条关键词规则）
classify.py pending --apply           # 写入 frontmatter
```

### 7.4 文章生命周期

| 工具 | 用途 | 关键参数 / 前置条件 |
|------|------|----------|
| `kb-convert.py` | 原始文件批量转换入口：扫描目录 → 按格式分类统计 → 生成批处理清单 → 可选预提取 MHT 文本 | `kb convert <目录> [--preprocess] [--json] [--dry-run]` |
| `promote-article.py` | 人工确认后文章定居：`drafts/` → `precleaned/`，原始文件 → `archive/` | `validation_status` 存在且非 failed，或 `validation_override: true` |

**完整转换链路：**

```
  ① kb convert <目录>                   扫描 + 清单 + 预提取
  ② standardize-article (AI)           逐文件标准化 → drafts/
  ③ 人工 review drafts/                 确认内容、修正 frontmatter
  ④ promote-article.py <drafts/xxx.md>  → precleaned/ 定居, 原始文件归档
  ⑤ extract_graph.py --apply            入图: Document 节点 + 关联边
```

支持 10 种原始格式：PDF, DOCX, XLSX, CSV, PPTX, MHT, MD, TXT, HTML, EML

### 7.5 实体与架构维护

| 工具 | 用途 |
|------|------|
| `ensure-architecture-entity.py` | 确保每篇知识文章的 `module` 所引用的 entity 页面存在且 frontmatter 字段完整 |
| `repair-arch-contract.py` | 架构契约治理：① `architecture-node-id` → `architecture_node_id` 全库迁移（master_graph + md） ② `--bootstrap` 补全 frontmatter 必填字段 |
| `migrate-semantic-architecture.mjs` | semantic_architecture.json 格式迁移：保留既有节点坐标，合并审定默认布局 |

### 7.6 图查询与诊断

| 工具 | 位置 | 用途 |
|------|------|------|
| `graph_query_api.py` | 架构图 | NetworkX 图查询 API：stats / impact / coverage / path / search / trace |
| `graph_query.py` | 知识库 | 同上，精简版 CLI |
| `graph_context.py` | 知识库 | 图关系语义注入层：为 LLM 检索提供图上下文 |
| `graph-status.py` | 知识库 | 图数据库状态仪表盘：节点/边数、待审核数、质量指标 |
| `dual_query_api.py` | 架构图 | 双引擎检索：Graph 遍历 + 向量相似度协同 |
| `vector_bridge.py` | 架构图 | 图节点 ↔ 向量缓存桥接 |
| `check_consistency.py` | 架构图 | 跨存储一致性：`master_graph.json` ↔ SQLite ↔ `vector-cache.json` 三端 key 对齐 |

### 7.7 管道健康与测试

| 工具 | 位置 | 用途 | 子命令 |
|------|------|------|--------|
| `pipeline-check.py` | 知识库 | 管道诊断：健康度检查 + 数据审计 | `health [--json] [--check staleness\|coverage]` `audit` |
| `pipeline-smoke.py` | 知识库 | 管线冒烟测试：逐阶段验证 extract/validate/promote/graph 可运行并产出有效数据 | `[--apply] [--stage extract,validate,...]` 退出码 0=通过 |

### 7.8 文件监控与链接维护

| 工具 | 用途 | 子命令 |
|------|------|--------|
| `wikilink.py` | Wikilink 完整性：图边验证 + 断链扫描 | `check [--apply]` — 图边 ↔ wikilink 一致性; `scan [--apply] [--scope wiki\|precleaned\|all]` — 断链扫描；`--apply` 默认 stub 写入 `wiki/_stubs/`，`--stub-target legacy|entities|concepts` 可选 |
| `vault_watcher.py` | 独立文件监控守护进程：检测 vault 中 .md 变更 → 自动触发 `extract_graph.py --apply --incremental` | — |
| `todo-flow.py` | Wiki 待办任务管理：`wiki/todo/` 下任务增删改查和状态流转 | — |

### 7.9 运行时守护

| 工具 | 位置 | 用途 |
|------|------|------|
| `electron-daemon.sh` | 架构图 | Electron 应用守护：start / stop / status / restart，端口冲突自动清理 |
| `sync.sh` | 架构图 | 一键同步：抽取图谱 + 刷新架构图，封装全管线 |
| `check-quality-gate.sh` | 架构图 | PR 质量闸门：检查图数据库质量阈值 |

### 7.10 辅助工具

| 工具 | 位置 | 用途 |
|------|------|------|
| `extract_mht.py` | 知识库 | 提取 .mht 文件为纯文本 |
| `embedding_client.py` | 架构图 | 嵌入 API 客户端：OpenAI 兼容接口，默认 GLM 模型 |
| `architecture_constants.py` | 架构图 | 审定架构图共享常量：node layout / layer / wikilink type map / category aliases |
| `schema_loader.py` | 知识库 | 枚举注册表加载器：统一从 `enums.yaml` + `ontology.yaml` 读取，所有脚本共用 |
| `architecture-contract.mjs` | 架构图 | JS 版架构常量/契约定义（ARCHITECTURE_CATEGORIES / ARCHITECTURE_RELATION_TYPES），Node 端 mjs 脚本共用 |
| `resolve-data-paths.mjs` | 架构图 | 双仓库数据链路径解析：默认 master / semantic / layout 路径推导，被其他 .mjs 脚本共用 |
| `seed-ci-data-chain.mjs` | 架构图 | CI 工作区 fixture 写入：最小 master_graph.json + SQLite，供一致性检查通过 |
| `validate-architecture-projection.mjs` | 架构图 | 架构投影校验：semantic ↔ layout 分类/依赖/漂移/重叠检测，被 check-data-chain 内部调用 |

### 7.11 数据链路巡检

| 工具 | 位置 | 用途 |
|------|------|------|
| `check-data-chain.mjs` | 架构图 | 数据链路完整性一体校验：master ↔ semantic ↔ layout ↔ API ↔ SQLite/vector 一致性；退出码 0=通过 |
| `health-report.mjs` | 架构图 | 聚合深度健康报告：master 完整性（悬边/重复id）+ semantic 断链 + 全链路投影校验，供 Electron `/api/system/self-check` |
| `validate-architecture-projection.mjs` | 架构图 | 架构投影校验库：分类合规 / 依赖完整性 / 布局漂移与重叠检测 |
| `check_consistency.py` | 架构图 | 跨存储一致性：`master_graph.json` ↔ SQLite `master_graph.db` ↔ `vector-cache.json` 三端 key 对齐 |

---

## 八、本体权威保障机制

> 本体 = 枚举定义（enums.yaml）+ 关系类型定义（ontology.yaml）+ 字段规范（SCHEMA.md）。
> 以下说明系统如何保证"定义一次，处处一致，违规可发现"。

### 8.1 权威层级

```
                    ┌──────────────────────┐
                    │    enums.yaml         │  ← 唯一权威源（机器可读）
                    │    ontology.yaml       │
                    └──────────┬───────────┘
                               │
            ┌──────────────────┼──────────────────┐
            ▼                  ▼                  ▼
   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
   │ schema_loader │   │  SCHEMA.md   │   │  CLAUDE.md   │
   │   (Python)    │   │  (人读规范)   │   │  (AI入口)    │
   └──────┬───────┘   └──────────────┘   └──────────────┘
          │
          ▼
   ┌──────────────────────────────────────────────────┐
   │              所有下游消费者                         │
   │  validate-article.py  validate-entity.py          │
   │  validate_classification.py  extract_graph.py     │
   │  generate-sa.py  dual_query_api.py                │
   └──────────────────────────────────────────────────┘
```

**原则**：`enums.yaml` + `ontology.yaml` 是机器可读的权威源。`SCHEMA.md` 是人读的规范文档。两者必须保持一致——`kb enum` CLI 保证同步，CI 校验脚本保证不出现漂移。

### 8.2 变更传播链路

以新增一个 `doc-type` 枚举值 `巡检手册` 为例：

```
  kb enum add doc-type 巡检手册
       │
       ├─→ enums.yaml          doc_types 列表追加        (权威源)
       ├─→ SCHEMA.md           §3.5 表格追加             (人读规范)
       ├─→ CLAUDE.md           doc-type 枚举行追加       (AI路由)
       └─→ enumerations_draft.md  表格追加               (设计草稿)
       
  下游自动生效（无需手动更新）：
       ├─→ validate-article.py     load_enums_doc_types() 动态读取
       ├─→ validate_classification.py  schema_loader.doc_types() 动态读取
       ├─→ extract_graph.py       透传值，无枚举校验（不受影响）
       └─→ schema_loader.py       _REGISTRY 缓存自动失效，下次加载重新读取
```

**关键设计**：所有校验脚本通过 `schema_loader.py` 从 `enums.yaml` **动态加载**枚举值，不硬编码。新增枚举值后校验脚本自动识别新值为合法，存量文档不受影响。

**字段名契约迁移**：`architecture-node-id`（连字符）是历史遗留写法，规范形式为 `architecture_node_id`（下划线）。`graph_query_api.py` / `electron/main.cjs` 均同时兼容两种写法，但治理方向是统一为下划线。使用 `repair-arch-contract.py` 可一键迁移 master_graph 和 markdown 中的旧写法；`check-data-chain.mjs` 和 `repair-arch-contract.py --bootstrap` 均会检测残留。

### 8.3 三道闸门

新文档从创建到入库，经过三道校验闸门：

```
  草稿 ──→ standardize-article skill ──→ validate-article.py ──→ 知识库
                 │                              │
                 │  AI 按模板生成                │  机械校验:
                 │  枚举值必须合法                │  - 必填字段 (ERROR)
                 │  frontmatter 完整              │  - 枚举合法性 (WARNING)
                 │                              │  - 标签白名单 (WARNING)
                 │                              │
                 └────────── 闸门一 ──────────────┘
                            (语义约束)            (机械约束)


  修改 entity/dependency ──→ validate-entity.py ──→ git commit
                                   │
                                   │  ERROR 必须清零:
                                   │  - 架构节点 ID 唯一性
                                   │  - arch_layer 合法性
                                   │  - 依赖关系 source/target 存在性
                                   │
                                   └── 闸门三 (架构约束)


  extract_graph.py --apply ──→ validate_graph()
                                   │
                                   │  图完整性校验:
                                   │  - 边端点有效性 (无悬空引用)
                                   │  - BELONGS_TO 链完整性
                                   │  - 架构节点全覆盖
                                   │
                                   └── 隐式闸门 (图完整性)
```

### 8.4 本体一致性验证矩阵

| 校验点 | 脚本 | 执行时机 | 严重级别 |
|--------|------|----------|:--:|
| frontmatter 必填字段缺失 | `validate-article.py` | 文章提交前 | ERROR |
| `article_type` 值非法 | `validate-article.py` | 文章提交前 | WARNING |
| `doc-type` 值非法 | `validate-article.py` | 文章提交前 | WARNING |
| `product` 值非法 | `validate-article.py` | 文章提交前 | WARNING |
| `module` 值不在枚举中 | `validate-article.py` | 文章提交前 | WARNING |
| `tags` 不在白名单 | `validate-article.py` | 文章提交前 | WARNING |
| `category-path` domain/subdomain 非法 | `validate_classification.py` | 定时 lint | ERROR |
| entity `arch_layer` 非法 | `validate-entity.py` | entity 变更时 | ERROR |
| entity `architecture_node_id` 重复（含旧写法 `architecture-node-id` 残留） | `validate-entity.py` | entity 变更时 | ERROR |
| entity `architecture-node-id` 旧写法残留 | `repair-arch-contract.py` | 定时治理 | WARNING |
| 跨存储 key 不一致 | `check_consistency.py` | 定时 lint | ERROR |
| 数据链路断裂（master / semantic / layout） | `check-data-chain.mjs` | PR 合并前 | 阻断 |
| dependency source/target 不存在 | `validate-entity.py` | dependency 变更时 | ERROR |
| 图边悬空端点 | `extract_graph.py --validate` | 图重建后 | WARNING |
| BELONGS_TO 链断裂 | `extract_graph.py --validate` | 图重建后 | WARNING |

### 8.5 本体演进流程

当需要扩展本体（如新增边类型、新增枚举值、新增字段）时：

```
  1. 提案  ──→  确定变更范围（影响哪些文件/脚本/消费端）
  2. 实施  ──→  kb enum add <field> <value>  (枚举值)
                或手动编辑 ontology.yaml       (边类型/节点类型)
                或手动编辑 SCHEMA.md            (新字段定义)
  3. 同步  ──→  更新 extract_graph.py          (如果需要消费新字段)
                更新 validate_*.py             (如果需要新校验规则)
  4. 验证  ──→  extract_graph.py --apply       (重建图)
                validate-entity.py --changed   (ERROR 清零)
                extract_graph.py --validate    (图完整性)
  5. 发布  ──→  git commit, Electron 自动热加载 master_graph.json
```

**健康度标准**：标准库健康度 = 0 ERROR + 0 WARNING。任何 PR 合并前必须达标。

### 8.6 异常实体检测 → 人工纠正 → 补充入库

文档在初次提取时，可能因 `module` 缺失或无法自动归类而成为"异常实体"。系统提供完整的检测—审核—纠正—入库闭环。

#### 全链路流程

```
 extract_graph.py --apply
       │
       ├─ module 字段缺失        → master_graph.json.pendingReview
       ├─ module 有但 version 缺 → master_graph.json.pendingVersionReview
       └─ wikilink 引用但 entity 页不存在 → extract_graph.py --create-stubs 自动生成占位
              │                                        │
              ▼                                        ▼
    ┌──────────────────────┐              ┌──────────────────────┐
    │  阶段一: 自动建议      │              │  阶段一: 自动补页      │
    │  classify.py pending  │              │  _ensure_entity_stubs │
    │  关键词匹配 → 建议module│              │  生成 wiki/entities/   │
    └────────┬─────────────┘              │  占位.md 文件         │
             │                            └──────────┬───────────┘
             ▼                                       ▼
    ┌──────────────────────┐              ┌──────────────────────┐
    │  阶段二: 人工审核      │              │  阶段二: 人工补充      │
    │  Electron KGPanel     │              │  在 Obsidian 中编辑    │
    │  → 待审核 Tab         │              │  占位 entity 页面      │
    │  显示建议 module       │              │  补全 arch_layer 等    │
    │  人确认/修改/拒绝      │              │  必需字段              │
    └────────┬─────────────┘              └──────────┬───────────┘
             │                                       │
             ▼                                       ▼
    ┌──────────────────────┐              ┌──────────────────────┐
    │  阶段三: 回写生效      │              │  阶段三: 入图生效      │
    │  Electron →           │              │  validate-entity.py   │
    │  写回 frontmatter     │              │  → ERROR 清零         │
    │  module: "[[MySQL]]"  │              │  extract_graph --apply│
    └────────┬─────────────┘              │  → System 节点生成    │
             │                            └──────────────────────┘
             ▼
    ┌──────────────────────┐
    │  阶段四: 定居入库      │
    │  validate-article.py  │
    │  → validation_status  │
    │  promote-article.py   │
    │  drafts/ → precleaned/│
    │  原始文件 → archive/  │
    └──────────────────────┘
```

#### 四个阶段的工具和职责

| 阶段 | 工具 | 触发方 | 输出 | 说明 |
|------|------|:--:|------|------|
| **检测** | `extract_graph.py --apply` | CI / 手动 | `pendingReview` + `pendingVersionReview` 写入 `master_graph.json` | 无 `module` 的文档进入 pendingReview；有 module 但无 `version` 的进入 pendingVersionReview |
| **自动建议** | `classify.py pending` | 手动批量 | 为 pendingReview 文档自动推断 `module` 并写入 frontmatter | 基于文件名+路径+内容关键词的 92 条规则匹配表 |
| **人工审核** | Electron KGPanel | 人 | 在 UI 中确认/修改/拒绝建议的 module，Electron 直接回写 frontmatter | 人判断为准，覆盖自动建议 |
| **回写生效** | `extract_graph.py --apply` | 手动 / WebSocket 触发 | 重建图，新 module 产生 DOCUMENTS 边，文档从 pendingReview 清除 | Electron 保存后自动触发增量重建 |
| **补充实体** | `extract_graph.py --create-stubs` + Obsidian 编辑 | 手动 | 自动生成 `wiki/entities/{name}.md` 占位页 → 人补全字段 | wikilink 引用了不存在的 entity 时自动补页 |
| **定居入库** | `promote-article.py` | 人（审核通过后） | `drafts/` → `raw/precleaned/`，原始文件 → `raw/archive/` | 需 `validation_status` 存在且非 failed |

#### pendingReview 数据结构

存储在 `master_graph.json` 的 `pendingReview` 数组中，Electron KGPanel 直接读取：

```json
{
  "id": "doc-raw-precleaned-01-some-article",
  "file_path": "raw/precleaned/01-排错指南-MySQL连接超时.md",
  "title": "MySQL连接超时排查",
  "product": "AnyShare",
  "suggested_module": null
}
```

#### 实体占位页生成规则

当文档 body 中包含 `[[wikilink]]` 但目标 entity 页面不存在时，`--create-stubs` 自动创建：

```markdown
---
title: 实体名
date: 2026-05-01
tags:
  - 待分类
status: 制定中
---

# 实体名

## 概述
（自动创建的占位页面，待补充内容）

## 来源
## 关联实体
## 关联概念
```

占位页 `status: 制定中`，不会进入 SA 架构图渲染。人工补全 `arch_component: true` 等字段并设为 `status: 有效` 后，下次 `extract_graph --apply` 自动入图。

---

*v2.3 — 2026-05-01 · 新增异常实体检测与纠正入库流程*
