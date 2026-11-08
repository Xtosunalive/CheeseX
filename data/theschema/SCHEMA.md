# 企业知识库 Schema

> 定义四层分类体系、页面规范和更新规则
> v2.2 — 2026-08-17

---

## 一、四层分类体系总览

```
┌──────────────────────────────────────────────────────┐
│ 第一层：架构治理层 — category-path                    │
│ 管领域划分、架构对接、归档治理、lint 校验              │
├──────────────────────────────────────────────────────┤
│ 第二层：业务元数据 — 5 个独立字段                     │
│ product / module / version / article_type / doc-type  │
│ 管资产标准化、业务筛选、报表统计                       │
├──────────────────────────────────────────────────────┤
│ 第三层：柔性检索标签 — tags                           │
│ 管横向聚合、场景标记、灵活搜索                        │
├──────────────────────────────────────────────────────┤
│ 第四层：生命周期管控                                  │
│ status / review-cycle / updated / expires             │
│ 管时效、归档、合规审计                                │
└──────────────────────────────────────────────────────┘

核心原则：
1. 每条信息只归属一处，永不字段重叠
2. 每层职责隔离，互不替代
3. 所有枚举字段闭合受控，禁止自由文本
```

---

## 二、第一层：架构治理层

### 2.1 category-path

格式：`{domain}.{subdomain}`，全小写 ASCII（点分两段式）。

> **注意**：冒号三段式 `{domain}:{subdomain}:{topic}` 已废弃（`validate-article.py` 强制点分两段式）。`topic` 段不再写入 category-path，主题区分由文件名 + 检索标签承担。
> `ops:troubleshoot:*` 与 `troubleshoot:*` 属于历史排错口径，不得写入新文章。

各级值均为闭合枚举，定义在 `enums.yaml` 中。

- `domain`：必须来自 `enums.yaml.domains`
- `subdomain`：必须来自对应 `enums.yaml.subdomains[domain]`（以 enums.yaml 为准，本节速查表非穷举）

#### domain（6 值，固定）

| domain | 说明 |
|--------|------|
| `ref` | 参考资料（entity/source/overview 均用此域） |
| `ops` | 运维操作 |
| `concept` | 方法/理论 |
| `product` | 产品域 |
| `meta` | 知识库元内容 |
| `arch` | 架构 |

#### subdomain（闭合枚举，按 domain 分组）

**ref（参考资料）— 按内容类型：**

| subdomain | 说明 |
|-----------|------|
| `architecture` | 架构图文档 |
| `component` | 组件实体页 |
| `other` | 待归类 |
| `overview` | 总览页 |
| `product` | 产品实体页 |
| `source` | 来源摘要页 |

**ops（运维操作）— 按运维活动类型：**

| subdomain | 说明 |
|-----------|------|
| `backup` | 备份恢复 |
| `config` | 配置变更 |
| `deploy` | 部署安装 |
| `maintain` | 日常维护 |
| `monitor` | 监控巡检 |
| `network` | 网络 |
| `storage` | 存储管理 |
| `ticketing` | 工单 |
| `upgrade` | 升级迁移 |

**concept（概念）— 按内容类型：**

| subdomain | 说明 |
|-----------|------|
| `comparison` | 对比分析 |
| `method` | 方法论/操作概念 |

**meta（元内容）— 按内容类型：**

| subdomain | 说明 |
|-----------|------|
| `doc` | 文档/规范 |
| `index` | 索引页 |
| `log` | 操作日志 |
| `query` | 查询结果页 |
| `reference` | 参考资料 |
| `todo` | 待办项 |

**product（产品域）：**

| subdomain | 说明 |
|-----------|------|
| `anybackup` | AnyBackup 产品 |
| `anyrobot` | AnyRobot 产品 |
| `anyshare` | AnyShare 产品 |
| `general` | 跨产品/通用 |

**arch（架构）：**

| subdomain | 说明 |
|-----------|------|
| `architecture` | 架构定义 |

#### topic（已废弃）

旧三段式的第三段。新规则不再写入 topic 段，此小节仅保留说明。

#### 规则

- 点分两段式 `{domain}.{subdomain}`，全小写 ASCII
- domain 和 subdomain 必须使用 enums.yaml 中的法定值
- 主题区分由文件名 + 检索标签承担
- `raw/imported/` 和 `raw/archive/` 可省略 category-path

#### 按目录默认值

| 目录 | category-path 规则 | review-cycle |
|------|-------------------|-------------|
| wiki/entities/ | `ref.product` 或 `ref.component` | 365d |
| wiki/concepts/ | `concept.method` | 180d |
| wiki/sources/ | `ref.source` | 180d |
| wiki/overview/ | `ref.overview` | 180d |
| wiki/comparisons/ | `concept.comparison` | 365d |
| wiki/queries/ | `meta.query` | never |
| wiki/todo/ | `meta.todo` | never |
| raw/precleaned/ | 按 article_type + module 派生 | 90d/180d |
| raw/archive/ | 省略 | never |
| architecture/ | `ref.architecture` | 365d |

---

## 三、第二层：业务元数据

> 6 个独立 Frontmatter 字段，全部闭合枚举（version 为格式校验，quality 为可选评分）。
> 属于知识资产标准元数据，必须独立字段，不能压进 tags。

### 3.1 product — 产品线

| 值 | 说明 |
|----|------|
| `AnyShare` | 企业级文档云平台 |
| `AnyBackup` | 企业级备份平台 |
| `AnyRobot` | 智能运维平台 |
| `通用` | 跨产品/通用技术 |

### 3.2 module — 所属模块

> frontmatter 中使用 wikilink 格式：`"[[模块名]]"`，关联 wiki 实体页。
> 
> **module 完整列表（闭合枚举，54 个值）定义在 `enums.yaml` 的 `modules` 段**，含每个模块的 `subdomain`、`system`（架构节点 ID）、`since`/`until` 版本范围。以下为常用 module 示例：

| module 值 | enums subdomain | 对应架构节点 |
|-----------|-----------------|-------------|
| `[[ECMS集群]]` | cluster | ecms-cluster |
| `[[Content服务]]` | content-management | sap智能内容管理 |
| `[[OSS网关]]` | object-storage-gw | oss-gateway |
| `[[MySQL]]` | backup | mysql |
| `[[OpenSearch]]` | search-engine | opensearch |
| `[[认证服务]]` | auth | oauth2-ui |
| `[[Ceph]]` | storage | ceph-eceph |
| `[[Kubernetes]]` | workload | workload-orchestration |
| … | … | （共 54 个，完整列表见 enums.yaml） |

**module ↔ subdomain 映射规则**：
- 当 category-path domain 为 `ops` 时，subdomain 表示运维活动类型；`module` 表示产品/架构模块，两者是正交维度
- 校验脚本（validate-article.py / validate_classification.py）检查 category-path 的点分两段式格式与 domain/subdomain 闭合枚举，不把 `modules[*].subdomain` 强行等同于 `category-path` subdomain

### 3.3 version — 产品版本

> 格式校验，非枚举（新版本持续发布）

**合法格式：**
- 单版本：`X.Y` 或 `X.Y.Z.W`（如 `7.0`、`7.0.6.4`）
- 版本范围：`X.Y.Z.W → A.B.C.D`（如 `7.0.4.8 → 7.0.5.6`）

**禁止：**
- 自由文本描述
- 粘贴配置内容
- 空值 `null`（应使用 `需补充`）

### 3.4 article_type — 内容体裁

> 回答：这篇文章用来解决什么问题

| 值 | 说明 |
|----|------|
| `排错指南` | 故障排查步骤 |
| `常见问题` | FAQ |
| `标准问答` | 标准化问答对 |
| `场景规范` | 特定场景操作规范 |
| `巡检方案` | 定期巡检流程 |
| `方案设计` | 技术方案设计 |
| `升级经验` | 跨版本升级、迁移、踩坑与回退（版本相关操作复盘） |
| `最佳实践` | 可复用约定、推荐配置、明确禁忌与取舍 |
| `产品简介` | 产品功能概览 |

> **标准场景与推荐 `category-path` / `doc-type` 组合**见 **[KNOWLEDGE_SCENARIOS.md](./KNOWLEDGE_SCENARIOS.md)**。

### 3.5 doc-type — 文档载体类型

> 回答：这篇文章属于哪本手册/成套资料
> 替代旧 `type` 字段（已废弃）

| 值 | 说明 |
|----|------|
| `用户手册` | 面向用户的操作手册 |
| `部署指南` | 安装部署文档 |
| `配置手册` | 配置参数说明 |
| `运维手册` | 日常运维操作 |
| `技术文档` | 通用技术文档 |
| `测试报告` | 测试验证结果 |
| `导航索引` | 索引/目录页 |
| `巡检手册` | （待补充说明） |

### 3.6 quality — 质量评分

> 可选字段，0-10 整数评分，用于知识资产质量管控。**规划中：当前校验脚本（validate_article.py / validate_classification.py）尚未强制检查此字段。**

| 值 | 说明 |
|----|------|
| `0-10` | 整数评分，10 为最高质量 |
| （省略） | 未评分 |

**评分参考：**
- 9-10：经多人验证、步骤完整、有截图
- 7-8：经单人验证、步骤完整
- 5-6：内容正确但缺少验证或截图
- 0-4：草稿/待补充/信息过时

---

## 四、第三层：柔性检索标签

### 4.1 tags 定位

tags 不再承载标准业务属性，只做：
- 技术组件标签（MySQL、Ceph、Kubernetes…）
- 技术概念标签（系统备份与升级、Linux性能排查…）
- 领域标签（部署、运维、排障、存储…）
- 场景标记、关键字、跨维度补充检索

### 4.2 tags 与业务字段的语义边界

当标签名与 module/product 同名时，语义不同：

| 维度 | 含义 | 举例 |
|------|------|------|
| `module: "[[MySQL]]"` | 文档归属于 MySQL 模块 | 排错文档的主题模块 |
| `tags: [MySQL]` | 文档内容涉及 MySQL 技术 | 任何提到 MySQL 的文档 |

| 维度 | 含义 | 举例 |
|------|------|------|
| `product: AnyShare` | 文档的产品归属 | 文档属于 AnyShare 产品线 |
| ~~`tags: [AnyShare]`~~ | **已移除** | 产品名不再作为标签 |

**规则：**
- 产品名（AnyShare/AnyBackup/AnyRobot）由 product 字段唯一承载，不进入 tags
- 组件标签（MySQL/Ceph/Kubernetes 等）允许同时在 tags 和 module 中出现，但语义不同
- tags 表达"内容涉及"，module 表达"文档归属"

**tags 不再承载的内容：**

| 移除内容 | 移至 |
|---------|------|
| 产品名（AnyShare） | product 字段（唯一） |
| 文档体裁（排错指南） | article_type 字段 |

### 4.3 标签分类法

所有标签必须在此分类法中定义（5 组，定义在 `enums.yaml` 的 `tags` 字段中）。禁止使用未在分类法中的标签。

#### 4.3.1 标签白名单

> **标签完整列表（闭合枚举，5 组，70+ 个值）定义在 `enums.yaml` 的 `tags` 字段中**，含 `架构与产品`、`领域标签`、`运维操作`、`技术栈`、`知识管理` 五个分组。

新增标签需先在 `enums.yaml` 中注册，再通过 CI 校验。禁止使用未注册标签（`待分类` 除外）。

### 4.4 标签使用规则

1. 每个页面至少 1 个标签
2. 禁止使用未在分类法中定义的标签（`待分类` 除外）
3. 新增标签需先在此分类法中注册
4. tags 不重复存储已在 product/module/version/article_type/doc-type 中表达的信息

---

## 五、第四层：生命周期管控

| 字段 | 类型 | 合法值 | 说明 |
|------|------|--------|------|
| `status` | 枚举 | `制定中` / `有效` / `已归档` | 文档状态 |
| `review-cycle` | 枚举 | `30d` / `90d` / `180d` / `365d` / `never` | 审查周期 |
| `updated` | 日期 | YYYY-MM-DD | 最后审查日期 |
| `expires` | 日期 | YYYY-MM-DD（可选） | 过期日期，省略为常青内容 |

**计算规则：**
- 审查到期 = `updated` + `review-cycle` 天数
- 文档过期 = `expires` 日期到达
- 任一条件满足应触发人工审查

---

## 六、废弃字段

| 旧字段 | 处理 | 替代 | 影响范围 |
|--------|------|------|---------|
| `category` | deprecated，不再写入新文档 | category-path | ~66 篇 precleaned |
| `type` | deprecated，统一为 doc-type | doc-type | ~87 篇 |
| `article_type` | 保留 | — | — |

> 存量文档的旧字段在数据治理阶段逐步清理，不影响现有数据。

---

## 七、Frontmatter 完整模板

```yaml
---
# 基础字段
title: 页面标题（与文件名一致）
date: YYYY-MM-DD
status: 有效

# 第一层：架构治理
category-path: domain.subdomain          # 点分两段式

# 第二层：业务元数据
product: AnyShare                  # 闭合枚举
module: "[[ECMS集群]]"             # 闭合枚举，wikilink 格式
version: 7.0.6.4                   # 格式校验
article_type: 排错指南              # 闭合枚举
doc-type: 运维手册                  # 闭合枚举
quality: 8                          # 可选，0-10 整数评分

# 第三层：检索标签
tags: [MySQL, OOM排查, AS7.0.x]

# 第四层：生命周期
review-cycle: 90d
updated: YYYY-MM-DD
expires: YYYY-MM-DD                # 可选
---
```

**按文档类型精简模板：**

`wiki/entities/` — 省略 product/module/version/article_type/doc-type：
```yaml
---
title: 实体名
date: YYYY-MM-DD
tags: [标签]
status: 有效
category-path: ref.component
review-cycle: 365d
updated: YYYY-MM-DD
---
```

`raw/precleaned/` — 完整五字段：
```yaml
---
title: 标题
date: YYYY-MM-DD
tags: [标签]
status: 有效
category-path: ops.deploy
product: AnyShare
module: "[[ECMS集群]]"
version: 7.0.6.4
article_type: 排错指南
doc-type: 运维手册
quality: 8
review-cycle: 90d
updated: YYYY-MM-DD
expires: YYYY-MM-DD
---
```

---

## 八、文件命名格式

| 目录 | 命名格式 | 示例 |
|------|----------|------|
| wiki/sources/ | `NN-简短描述.md` | `01-OSS网关流式下载参数变更.md` |
| wiki/entities/ | `实体名.md` | `AnyShare.md` |
| wiki/concepts/ | `概念名.md` | `系统备份与升级.md` |
| wiki/comparisons/ | `比较主题.md` | `AnyShare-vs-Nextcloud.md` |
| wiki/queries/ | `YYYY-MM-主题.md` | `2026-04-AS7升级失败排查.md` |
| raw/precleaned/ | `NN-分类标签-主题描述.md` | `01-排错指南-ECMS集群启动失败.md` |

---

## 九、更新规则

### 9.1 页面创建阈值

- **创建新实体页面**：实体在 2+ 个来源中被提及，或在一个来源中是核心内容
- **创建新概念页面**：概念在 2+ 个来源中被提及，或在一个来源中是核心内容
- **不创建页面**：一次性提及、次要细节、超出领域范围的内容

### 9.2 交叉引用规则

- 每个新页面必须链接到至少 2 个其他页面
- 使用 `[[wikilink]]` 语法
- 检查现有页面是否需要回链

### 9.3 索引更新规则

- 每创建新页面，必须更新 `wiki/index.md`
- 每删除或归档页面，必须从 `index.md` 中移除

### 9.4 日志记录规则

- 每次操作后追加到 `wiki/log.md`
- 格式：`- {YYYY-MM-DD HH:mm} | 操作类型 | 摘要`

### 9.5 矛盾处理

当新信息与现有内容冲突时：
1. 检查日期，新来源通常覆盖旧来源
2. 如真正矛盾，同时记录两种观点，注明日期和来源
3. 在 frontmatter 标记：`contradictions: [页面名]`

---

## 十、目录结构

```
知识库/
├── TheSchema/
│   ├── SCHEMA.md          # 本文件
│   └── TheSchema.md       # 目标与边界定义
├── wiki/
│   ├── index.md           # 索引
│   ├── log.md             # 操作日志
│   ├── sources/           # 来源摘要页
│   ├── entities/          # 实体页
│   ├── concepts/          # 概念页
│   ├── comparisons/       # 对比页
│   ├── overview/          # 概览页
│   └── queries/           # 查询结果页
├── architecture/          # 架构图
└── raw/
    ├── imported/          # 原始素材（只读）
    ├── precleaned/        # 标准文章定居区
    ├── drafts/            # 草稿区
    └── archive/           # 归档区
```

---

## 十一、维护责任

- **用户**：提供原始资料，定义领域范围，审查矛盾内容
- **AI**：总结、交叉引用、归档、维护一致性，遵守本 Schema
- **校验脚本**：`.claude/scripts/validate_classification.py`，在新文档写入和定期 lint 时校验四层分类合规性

---

*vSchema v2.0 — 2026-04-26*
