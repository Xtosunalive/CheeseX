# 标准场景规格（与五层目标对齐）

> 将业务目标映射到 **闭合 frontmatter + 目录约定**，供 `standardize-article`、`validate_classification.py` 与图谱抽取共用同一套口径。  
> 配套枚举：`TheSchema/enums.yaml`（`article_types` / `doc_types` / `domains` / `subdomains`）。

---

## 一、系统目标与本字段的对应关系

| 业务目标 | 主要靠哪些元数据落地 |
|----------|----------------------|
| 1. AnyShare 技术架构清晰显现 | `category-path` 中 `ref:architecture:*`、`architecture-node-id`（实体页）、架构侧 `npm run sync` |
| 2. 不同来处经验挂在不同「板块」 | `category-path` 的 **domain + subdomain**（板块）；`module` 对齐架构模块 |
| 3. **标准场景**（升级 / 排错 / 最佳实践等） | **`article_type`（体裁）** + **`doc-type`（载体）** + 推荐 `category-path` |
| 4. 碎片 → 标准知识文章 | `standardize-article` 全流程 + 下文「必填章节」 |
| 5. 抽取图谱素材 | 标准化产出进入 `wiki/sources` 等可晋升路径；`version`、`module`、`architecture-node-id` 支撑边与属性 |

---

## 二、三层不要混用

| 层次 | Frontmatter / 结构 | 回答的问题 |
|------|-------------------|------------|
| **板块（从哪来、放哪类运营域）** | `category-path`=`domain:subdomain:topic`（topic 语义 slug，lint 见 `validate_classification.py`） | 这类内容在知识库**哪条导航轴**下 |
| **标准场景 / 体裁** | `article_type` | 读者拿这篇**干什么**（排错、升级复盘、可复制做法…） |
| **成品形态** | `doc-type` | 这篇在**哪套出版物**里出现（运维手册、技术文档…） |

`tags` 只做横向检索补充，**不替代** `article_type`。

---

## 三、标准场景矩阵（主规格）

下列 **「推荐组合」** 为默认；若内容确实跨界，以本体裁 `article_type` 为准，再选最接近的 `doc-type` / `category-path`。

| 标准场景（业务用语） | `article_type` | 推荐 `doc-type` | 推荐 `category-path` | 派生规则 |
|---------------------|----------------|-----------------|----------------------------|----------|
| **跨版本升级经验**（含踩坑、顺序、回退） | `升级经验` | `运维手册` 或 `技术文档` | `ops:upgrade:{topic}` | topic 取升级对象或版本范围 slug |
| **排错指南**（现象→定位→验证；**含 OVIP/强制入主/主从/数据库多步核查**） | `排错指南` | `运维手册` 或 `技术文档` | `ops:{subdomain}:{topic}` | subdomain 必须来自 `enums.yaml`，按故障域选 `network/storage/maintain/...`，不得写 `troubleshoot` |
| **最佳实践**（可复用约定、禁忌、推荐默认值） | `最佳实践` | `技术文档` 或 `运维手册` | `concept:method:{topic}` 或 `ops:{subdomain}:{topic}` | 偏方法论用 `concept:method`，偏操作用 `ops:config/maintain` 等 |
| **FAQ / 零散问答** | `常见问题` | `用户手册` 或 `技术文档` | `ops:maintain:{topic}` 或 `ref:source:{topic}` | 维护问答走 ops，来源摘要走 ref |
| **按场景的操作步骤（非故障）** | `场景规范` | `运维手册` 或 `配置手册` | `ops:{subdomain}:{topic}` | subdomain 从 `deploy/config/maintain/...` 中选 |
| **例行巡检** | `巡检方案` | `运维手册` | `ops:monitor:{topic}` | topic 取巡检对象 slug |
| **架构 / 模块设计方案** | `方案设计` | `技术文档` | `ref:architecture:{topic}` 或 `concept:method:{topic}` | 架构资料走 ref，方法论走 concept |

**版本字段**：升级类、`升级经验` 类文章必须尽量填 **`version`** 或 **`version-range`**（原文无则 `version: ""` + `remarks`，见 `standardize-article`）；否则图谱 `HAS_VERSION` 等边可能缺失。

---

## 四、`article_type` → 正文必填章节（标准化约束）

Agent 执行 `standardize-article` 时，在成套产品模板之内，须保证下列**最小章节语义**存在（标题可与模板用语一致或等价）。

| `article_type` | 必填语义（最小集合） |
|------------------|----------------------|
| `升级经验` | 适用范围与版本；前置条件；升级路径（顺序）；验证；回退或应急；已知风险 |
| `排错指南` | 现象；影响范围；定位步骤；根因与处置；验证（复现消失）；预防 |
| `最佳实践` | 适用场景；推荐做法（可执行的）；禁止项；取舍说明；参考链接 |
| `常见问题` | 问题描述；原因（若原文有）；解决步骤；备注 |
| `场景规范` | 场景说明；操作步骤（与原文等量同序）；注意事项 |
| `巡检方案` | 巡检对象；周期；检查项；阈值或判定；记录方式 |
| `方案设计` | 背景与目标；方案要点；架构或数据流（若原文有）；风险与未决 |

---

## 五、图谱参与规则（目标 1 + 5）

| 内容类型 | 是否强依赖 `architecture-node-id` | 说明 |
|----------|-------------------------------------|------|
| `wiki/entities/*.md`（架构实体页） | 是（治理项） | 与架构图节点对齐，抽图主素材 |
| `升级经验` / `排错指南` / `最佳实践` 等运营文 | 否（常见） | 通过 **`module`**、`tags`、wikilink 与实体关联；抽图时多为文档节点或后续扩展关系 |
| `ref:product` / `ref:component` | 按实体治理 | 已有 `category-path` 与 module 枚举对齐 |

**约定**：能确定归属组件时，在正文「关联知识」中 **wikilink** 到对应实体页，便于 `extract_graph` 与人工审核收敛。

---

## 六、与校验脚本的关系

- `python3 .claude/scripts/validate_classification.py`：校验 `article_type`、`doc-type`、`category-path` 均在 `enums.yaml` 闭合枚举内。  
- 新增体裁 **`升级经验`**、**`最佳实践`** 已写入 `enums.yaml`，无需魔法字符串。  
- `standardize-article` 内 **article_type 映射**已扩展，与上表一致。

---

## 七、修订记录

| 日期 | 变更 |
|------|------|
| 2026-05-01 | 初版：`KNOWLEDGE_SCENARIOS.md`；`article_types` 增加 `升级经验`、`最佳实践`；对齐 SCHEMA / skill |
