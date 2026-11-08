# AnyShare 组件与依赖概念定义（AI 必读）

## 1. 组件（Component）

每个 `wiki/entities/*.md` 文件代表一个组件，其 frontmatter 包含：

| 字段 | 说明 | 示例 |
|------|------|------|
| `architecture-node-id` | 全局唯一 ID（不透明串，不限字符形状；只判有无值） | `mysql` |
| `arch_component` | `true` = 此 entity 是架构组件 | `true` |
| `arch_layer` | 架构层级（10 个合法值） | `data-lake` |
| `arch_since` | 组件从哪个版本开始存在（semver） | `"7.0.0"` |
| `arch_until` | 组件到哪个版本结束（不含），`""` = 当前仍存在 | `""` |

> 版本生命周期由人定义，默认 `arch_until: ""`（当前版本生效）。

## 2. 依赖关系（Dependency）

依赖关系有**两个独立维度**：**拓扑连线**（谁和谁有关系）与**版本信息**（哪个版本区间有效）。

- **拓扑连线**：由 entity 页面的类型化 wikilink 定义（唯一来源，YAML 不再创建新边）。
- **版本信息**：YAML 富化 wikilink 边的 `since/until`，YAML 优先；无 YAML 的边为骨架语义（无版本约束）。

### 2.1 类型化 wikilink → 架构关系（拓扑定义）

在 entity 页面正文中使用中文前缀声明关系：

```markdown
依赖::[[Kubernetes]]
连接::[[MySQL]]
关联::[[OpenSearch]]
存储::[[Ceph]]
```

**完整映射表**（定义于 `enums.yaml` 的 `architecture_projection.wikilink_type_labels`）：

| 中文前缀 | English alias | 架构关系类型 | 语义 |
|---------|---------------|-------------|------|
| `依赖` | `depends_on` | `DEPENDS_ON` | 运行时强依赖，A 不可无 B |
| `连接` | `connects` | `CONNECTS_TO` | 组件间网络连接 |
| `关联` | `related` | `RELATED` | 业务/逻辑关联，需人工审核确认具体含义 |
| `存储` | `stores` | `STORES_IN` | 数据持久化到存储组件 |
| `备份` | `backs_up` | `BACKS_UP` | 备份目标 |
| `索引` | `indexes` | `INDEXES` | 数据索引关系 |
| `加密` | `encrypts` | `ENCRYPTS` | 加密服务依赖 |

> **注意**：`关联` 和 `related` 均映射到 `RELATED`。如需新增更细的关系类型，先在 `ontology.yaml` 定义完整 domain/range，再加入 `enums.yaml` 映射。

### 2.2 YAML 集中式版本表（版本信息补充）

定义在 `TheSchema/dependencies.yaml`：

```yaml
dependencies:
  - source: mysql
    target: xtrabackup
    type: BACKS_UP
    since: "7.0.0"
    until: "7.3.0"   # 不含
```

**YAML 的角色是富化（enrich），而非替换：**
- entity wikilink 已有 `source → target` 边 + YAML 有对应条目 → YAML 的 `since/until` 写入该边，覆盖骨架版本
- entity wikilink 已有边但 YAML 无对应条目 → 边保留，无版本约束（骨架语义："源和目标都活着时有效"）
- YAML 有条目但无对应 `依赖::` wikilink → ERROR，管道阻断（须补 wikilink 或删除 YAML 条目）

### 2.3 显式标注（最高优先级）

在 wikilink 后加 `@effective(since=, until=)`：

```markdown
依赖::[[xtrabackup]] @effective(since=7.0.0, until=7.2.0)
```

此标注的版本信息**覆盖** YAML 中的同名条目。

## 3. 解析与合并规则

1. 读取所有组件，获取其 `arch_since`/`arch_until`
2. 从 entity 正文提取 wikilink 边（拓扑定义），计算骨架有效期 = `[max(src.since, tgt.since), min(src.until, tgt.until))`
3. 从 `dependencies.yaml` 读取版本信息，匹配已有 wikilink 边进行富化
4. 合并，优先级：

```
@effective(since=, until=)  >  dependencies.yaml  >  骨架自然有效期
     (最高优先)                   (版本富化)           (默认)
```

| 优先级 | 来源 | 说明 |
|--------|------|------|
| 1 | entity 文件 `@effective(since=, until=)` | 精确覆盖，最高优先 |
| 2 | `dependencies.yaml` | 为已有 `依赖::` wikilink 边提供版本 since/until；无对应 wikilink 的 YAML 条目触发 ERROR |
| 3 | 骨架边自动计算 | 组件生命周期交集，无版本声明时的默认值 |

**边始终来自 wikilink（拓扑层）**。YAML 只提供版本信息（`since`/`until`），不替换边本身。同一 `(from, to, type)` 对，YAML 有对应条目则用 YAML 版本区间覆盖骨架有效期；无 YAML 条目则 wikilink 边原样保留（无版本约束）。`@effective` 标注的版本区间覆盖 YAML 中的同名条目。

## 4. 维护者工作

- **日常**：无需编辑任何依赖声明
- **版本发布时**：编辑 `dependencies.yaml`，增删改版本区间；更新组件的 `arch_until`（标记废弃）
- **生成架构投影**：`npm run sync:architecture` 或 `python3 generate-sa.py --apply`（后者委托统一同步脚本）
- **查询特定版本**：`python3 generate-sa.py --version "7.4.0"`

## 5. 版本过滤

查询时只输出满足 `validFrom <= version < validUntil` 的边。

## 6. 示例

### 示例 1：骨架依赖自然有效期

```
MySQL:  arch_since=6.0, arch_until=""
Xtrabackup: arch_since=7.0.0, arch_until=""

骨架依赖: 依赖::[[Xtrabackup]]
→ validFrom = max(6.0, 7.0.0) = 7.0.0
→ validUntil = min(∞, ∞) = ∞
→ 在 [7.0.0, ∞) 内有效
```

### 示例 2：版本依赖覆盖

```yaml
# dependencies.yaml
dependencies:
  - source: mysql
    target: xtrabackup
    type: BACKS_UP
    since: "7.0.0"
    until: "7.3.0"
```

```
YAML 条目富化同名骨架边（提供版本区间）：
→ validFrom = 7.0.0, validUntil = 7.3.0
→ 在 [7.0.0, 7.3.0) 内有效，7.3.0+ 版本无此依赖
```

### 示例 3：@effective 最高优先

```
MySQL.md 正文:
依赖::[[xtrabackup]] @effective(since=7.0.0, until=7.2.0)

dependencies.yaml 中同名条目被覆盖：
→ validFrom = 7.0.0, validUntil = 7.2.0
→ 即使 YAML 说 validUntil=7.3.0，也以 @effective 为准
```

## 7. 与文章标准化流程的关系

文章标准化流程和依赖版本管理是**两层独立管道**，在 entity 页面自然交汇。

```
standardize-article                     dependency system
      ↓                                        ↓
  文章 frontmatter                         entity 页面（唯一事实源）
  module: "[[MySQL]]"                      typed wikilink（拓扑定义）
  version: "7.0.6"                         @effective 标注（版本覆盖）
      ↓                                        ↓
  extract_graph.py ──→ master_graph.json ←── dependencies.yaml（版本富化）
      ↓                                        ↓
  文章 → entity 的                      sync-semantic-architecture.py
  DOCUMENTS 边                                  ↓
                                    semantic_architecture.json
                                      + architecture_layout.json
```

| 管道 | 输入 | 输出 | 边类型 |
|------|------|------|--------|
| 文章标准化 | 文章 frontmatter `module` | DOCUMENTS 边 | 文章 ↦ entity |
| 依赖系统 | entity wikilink + YAML | 10 种架构关系边 | entity ⇄ entity |

- **文章标准化**：为每篇文章补全 `module` 字段，将文章挂载到对应 entity 组件。例如 `module: MySQL` 使文章出现在 MySQL 的"关联文档"列表中。
- **依赖版本管理**：entity 页面中的 typed wikilink 定义拓扑（`依赖::`、`连接::`、`存储::` 等），`dependencies.yaml` 为边提供版本区间（`since`/`until`），`@effective` 标注可在 entity 页面精确覆盖版本信息。

**两者独立维护，在 entity 页面自然交汇**：
- 在 MySQL.md 中，既能看到挂载的文章（DOCUMENTS 边），也能看到 MySQL 的依赖关系（DEPENDS_ON、CONNECTS_TO 等边）。
- 修改文章分类不影响依赖系统，反之亦然。

**对维护者的影响**：无。按各自规则操作即可。交叉验证由 `validate-entity.py --changed` 在提交前执行（见 §9）。

## 8. 交叉验证（validate-entity.py --changed）

当文章 version 与依赖有效期出现明显矛盾时，`validate-entity.py` 的依赖区间检查输出 WARNING：

> 例：文章标注 `module: MySQL, version: 7.4.0`，但 `dependencies.yaml` 中 `mysql → xtrabackup` 的有效期到 7.3.0 为止 → WARNING 提醒检查。

此检查**不修改任何文件**，仅输出警告。维护者收到警告后自行判断是更新文章还是更新依赖表。

## 9. 人为校验流程（Pre-commit Validation Gate）

### 9.1 校验脚本

`python3 .claude/scripts/validate-entity.py` 在提交前运行，拦截明显错误。

```
用法:
  python3 validate-entity.py                  # 全量检查 entity/ + dependencies.yaml
  python3 validate-entity.py file1.md file2.md # 仅检查指定文件
  python3 validate-entity.py --changed         # 检查 git diff 中变更的文件

退出码:
  0 = 通过（含 WARNING 时仍为 0，但需人工复核）
  1 = ERROR（需修复后才能提交）
```

### 9.2 检查项

| # | 检查内容 | 级别 |
|---|---------|------|
| 1.1 | `architecture-node-id` 存在且非空白（不限字符形状——身份为不透明串，见 ADR-016 §二） | ERROR |
| 1.2 | `arch_layer` 存在且为合法值（10 个） | ERROR |
| 1.3 | `arch_category` 和 `arch_subdomain` 不空 | WARNING |
| 1.4 | `arch_since` 格式为 semver | ERROR |
| 1.5 | `arch_since` < `arch_until` | ERROR |
| 1.6 | `module` 字段不空 | WARNING |
| 2 | `architecture-node-id` 全局唯一 | ERROR |
| 3.1 | `dependencies.yaml` 中 source/target 对应的 entity 存在 | ERROR |
| 3.2 | 依赖 type 为合法值（8 种） | ERROR |
| 3.3 | since/until 格式合法 | ERROR |
| 3.4 | since < until | ERROR |
| 3.5 | 依赖区间与 entity 生命周期有交集 | WARNING |
| 3.6 | 同 key 依赖不重复定义 | ERROR |
| — | Entity wikilink 目标可解析 | WARNING |

### 9.3 触发条件

以下场景**必须**运行 `validate-entity.py`：

- 新增/修改/删除 `wiki/entities/*.md` 文件
- 修改 `TheSchema/dependencies.yaml`
- 运行 `npm run sync:architecture` 或 `generate-sa.py --apply` 之后、提交之前

### 9.4 角色定义

| 角色 | 职责 |
|------|------|
| AI (Claude) | 执行修改，修改后自动运行 `validate-entity.py --changed`，ERROR 必须清零 |
| 维护者 (Human) | 复核 WARNING，决定是否补充字段或忽略；提交前确认 0 ERROR |
| 校验脚本 | 机械检查，只输出问题，不自动修改 |

### 9.5 AI 工作流

```
1. 编辑 wiki/entities/ 或 dependencies.yaml
2. 运行 python3 validate-entity.py --changed
3. ERROR 非零 → 修复 → 回到步骤 2
4. ERROR = 0 → 告知维护者 WARNING 数量及内容
5. 维护者确认 → 提交
```

> **原则**：脚本管 ERROR（拦截明显错误），人工管 WARNING（判断业务合理性）。AI 不可自行忽略 ERROR 直接提交。

## 10. 标准库健康度标准（PR Merge Gate）

### 10.1 硬性指标

每次 PR 合并前，以下指标必须全部通过：

| 指标 | 阈值 | 检查方式 |
|------|------|---------|
| validate-entity.py ERROR | **0** | `python3 .claude/scripts/validate-entity.py` |
| validate-entity.py WARNING | **0** | 同上 |
| enums.yaml 孤立模块 | **0** | 所有 module 必须有 arch_component entity 认领 |
| SA/layout 生成一致性 | **通过** | `npm run sync:architecture` 或 `generate-sa.py --apply` 无报错 |
| entity 必填字段完整率 | **100%** | 所有 arch_component entity 含 arch_since/arch_subdomain/arch_category |

### 10.2 定义

- **标准库** = `wiki/entities/*.md` + `TheSchema/dependencies.yaml` + `TheSchema/enums.yaml`（modules 段）
- **健康** = 0 ERROR + 0 WARNING + enums 与 entity 完全对齐 + SA/layout 可正常生成
- **不健康阻塞合并** = 存在 ERROR，或 enums 有无人认领的 module

### 10.3 恢复流程

当标准库不健康时：

```
1. 运行 validate-entity.py --all → 诊断报告
2. 分类处理：ERROR 立即修复，WARNING 补字段或确认
3. enums 孤模块：确认删除 / 创建 entity stub / 补 module 字段
4. 重复直到 0 ERROR 0 WARNING
5. npm run sync:architecture → 确认 SA/layout 与 arch_component entity 一致
6. 提交
```

### 10.4 参考基线

当前（2026-05-03）标准库基线：
- arch_component entity: 40 个
- enums.yaml modules: 53 条
- dependencies.yaml: 9 条
- SA 组件: 36 个，依赖: 36 条（DEPENDS_ON: 10, CONNECTS_TO: 22, STORES_IN: 1）
- 健康度: ✅ 0 ERROR 0 WARNING

## 11. 文章提交前校验闸门（validate-article.py + promote-article.py）

### 11.1 设计理念

AI 产出物**不直接写入 precleaned/**。先入 `raw/drafts/`，带校验标记，人在 Obsidian 中 review 后执行提升。

```
AI 产出 → drafts/ (+ validate stamp) → 人 review → promote → precleaned/
```

**人的工作台 = Obsidian 中的 `raw/drafts/` 目录**。校验结果嵌入 frontmatter，在 Obsidian 中直接可见。

### 11.2 流程

1. **AI 产出** → 写入 `raw/drafts/{文件名}.md`
2. **校验标记** → `python3 validate-article.py --stamp <drafts/xxx.md>`
   - 执行 10 项机械规则检查
   - 将 `validation_status`、`validation_errors`、`validation_warnings`、`validation_summary` 写入 frontmatter
3. **人工 review** → 在 Obsidian 中打开文章，查看校验标记
4. **确认提升** → `python3 promote-article.py <drafts/xxx.md>`
   - 复制到 `raw/precleaned/`
   - 归档原始文件到 `raw/archive/{产品线}/`
   - 删除 drafts/ 草稿

### 11.3 校验字段（嵌入 frontmatter）

| 字段 | 说明 | 示例 |
|------|------|------|
| `validation_status` | `passed` / `warnings` / `failed` | `warnings` |
| `validation_errors` | ERROR 数量 | `0` |
| `validation_warnings` | WARNING 数量 | `1` |
| `validation_summary` | 摘要（最多 3 条） | `WARN(1): wikilink [[客户端]] 目标文件不存在` |
| `validation_override` | 强制通过标记（人手动添加） | `true` |

### 11.4 检查项

| # | 检查内容 | 级别 |
|---|---------|------|
| 1 | frontmatter 必填字段: title, module, product, article_type, doc-type | ERROR |
| 2 | module 值在 enums.yaml modules 列表中存在 | ERROR |
| 3 | version 格式: X.Y / X.Y.Z / X.Y.Z.W 或范围 | ERROR |
| 4 | title 与文件名一致性 | WARNING |
| 5 | tags 字段非空 | WARNING |
| 6 | 正文 [[wikilink]] 目标文件存在 | WARNING |
| 7 | 图片引用路径规范 | WARNING |
| 8 | status/doc-type/article_type 枚举合法性 | WARNING |

### 11.5 promote 规则

| validation_status | validation_override | 行为 |
|-------------------|---------------------|------|
| `passed` | — | 允许提升 |
| `warnings` | — | 允许提升 |
| `failed` | 未设置 | **拒绝提升**（需修复或加 override） |
| `failed` | `true` | 允许提升（强制通过） |

### 11.6 与 validate-entity.py 的关系

| | validate-entity.py | validate-article.py | promote-article.py |
|---|---|---|---|
| 对象 | 标准库（entity + deps） | 单篇产出文章 | drafts/ 中的文章 |
| 执行者 | AI | AI | **人** |
| 时机 | 修改 entity/deps 后 | 文章写入 drafts/ 后 | review 完成后 |
| 结果 | 0 ERROR | JSON + frontmatter stamp | 移入 precleaned/ + 归档 |
