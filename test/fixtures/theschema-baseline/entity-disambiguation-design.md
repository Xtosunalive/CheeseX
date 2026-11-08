# Entity 名称消歧设计（规模触发参考）

> **状态：规模触发参考，非当前落地方案。** 当前 vault 4 个 entity、0 别名实例、0 title 冲突实例，本设计的完整三层防御/aliases 字段/消歧页/F02c-F18 均为过度设计。当前只修 §1.2 的 title 静默覆盖 bug（见 `entity-disambiguation.md`）。本文档在以下阈值触发时启用。
>
> **触发阈值**：
> - **aliases 字段**：第一个 entity 在 frontmatter 写 `aliases:` 时
> - **title 冲突三层防御**：第一次 `extract_graph.py` 报 title 冲突时
> - **消歧页**：第一次出现真实同名 entity（两个 entity 共享 title）时
> - **F02c/F18**：aliases 字段被使用后
>
> **关联**：`entity-disambiguation.md`（当前落地方案，只修 title 静默覆盖 bug）、[[entity-frontmatter-schema]]、[[AI_CONCEPT]]、[[DATA-DICTIONARY]]
>
> **设计哲学**：ID ≠ Name。`architecture-node-id` 是永久唯一的身份标识，`title` / `aliases` 是允许重复的名称层。同名异义问题本质是"Name 层怎么管"，不碰 ID 层。本设计对齐 Wiki/知识图谱系统的三层共识架构：
> - **写入层**（声明时强制）：作者声明 `title` / `aliases` 时拦截冲突，对应 Wikidata (label, description) 唯一约束、schema.org `alternateName`。
> - **解析层**（构建时拒绝猜测）：`name_to_id` 查表，冲突项不注册、留 unresolved，对应 MediaWiki red link。
> - **阅读层**（人工消歧）：消歧页给人读，不参与解析，对应 Wikipedia disambiguation page。

## 一、问题

### 1.1 多对一（同义名无映射）

同一 entity 有多个名称，当前 `name_to_id` 只注入文件名 + title，别名无法解析。

```
码元 / 令牌 / access-token → 都指 token entity
  name_to_id["码元"] → None ❌
  name_to_id["令牌"] → None ❌
  name_to_id["token"] → "token" ✅（仅当文件名或 title 完全匹配）
```

> **当前状态**：vault 内无 `aliases` 字段使用（`grep "^aliases:" wiki/entities/` 零命中），4 个 entity 均无别名声明。本问题为潜在需求，优先级 P2，待真实别名场景出现时触发。

### 1.2 一对多（title 冲突静默覆盖）

两个 entity 共享同一 title，后者覆盖前者，无告警。

```python
# extract_graph.py:2037-2040 — 当前逻辑
name_to_id[title] = aid   # 先写入 auth-token
name_to_id[title] = aid   # 后被 crypto-token 覆盖，auth-token 的映射丢失
# ⚠️ 没有告警，静默错误
```

> **当前状态**：4 个 entity 的 title（API Gateway / Auth Service / MySQL / Search Service）互不冲突。本问题为潜在 bug，但 `validate-entity.py:189` 的 `check_id_uniqueness` 只查 `architecture-node-id` 重复，不查 title 重复——管道和 CLI gate 双盲。优先级 P1，是本设计唯一有代码改动的解析层项。

---

## 二、方案

### 2.1 `aliases` 字段（解决多对一）

**Schema 定义**（追加到 `entity-frontmatter-schema.md` 身份段）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `aliases` | list[string] | 否 | 实体的同义名称，注入 `name_to_id` 用于 wikilink 解析 |

约束：

- 每个别名全 vault 唯一，不得与已有 architecture-node-id / title / aliases 冲突
- 别名不建议为裸英文单词（避免跨域歧义）

> **D6 全 vault 唯一定理**：alias 唯一性范围是全 vault，不做域内唯一。理由：wikilink `[[token]]` 不携带 domain 上下文，解析层无法判断该连哪个域的 token——domain 是文档属性，不是 wikilink 属性，一个安全文档可以引用 AI token，域内唯一会连错。Wikipedia 的全局唯一 + 消歧页模型已验证：同名异义靠命名约定（`auth-token` vs `ai-token`）和消歧页解决，不靠命名空间隔离。限定词（`LLM token` / `鉴权 token`）是作者主动的命名约定，不是系统允许的域内重复。

```yaml
# 正确示例
aliases:
  - 令牌
  - 码元
  - ai-token
```

**`extract_graph.py` Step 0 注入逻辑**（在 `name_to_id[title] = aid` 之后追加）：

```python
# alias → name_to_id 注入
aliases = fm.get("aliases", [])
if isinstance(aliases, list):
    for a in aliases:
        a_clean = a.strip()
        if a_clean and a_clean not in name_to_id:
            name_to_id[a_clean] = aid
        elif name_to_id.get(a_clean) != aid:
            _alias_conflicts.append({
                "alias": a_clean,
                "claimed_by": [aid],               # 别名声明者
                "blocked_claimer": [name_to_id[a_clean]],  # 已占用者
                "severity": "blocker",
            })
            # 不注册冲突项 — 宁可 unresolved，也不错连
```

> **D2 alias 冲突结构**：`aliasConflicts` 与 `titleConflicts` 分开报，结构区分对等冲突 vs 别名撞占用。`titleConflicts.claimed_by` 是两个 entity 对等抢同一 title；`aliasConflicts.claimed_by` 是别名声明者，`blocked_claimer` 是被占用的 title/alias owner。修复动作不同：title 冲突改其中一个 title，alias 冲突改 alias 或加限定词。
>
> **D3 不做命中日志**：不记录"哪些别名被解析命中"。当前规模无别名实例，命中日志是规模相关需求，且 `name_to_id` 本身即证据。冲突列表已覆盖错误情况，正常命中不需单独日志。规模触发再考虑。

### 2.2 `name_to_id` 冲突检测（解决一对多）

**修改 `extract_graph.py` Step 0** — title 注入从覆盖改为冲突检测：

```python
# 文件名 → id（文件名天然唯一，保持不变）
name_to_id[fname.replace(".md", "")] = aid

# title 注入：覆盖 → 冲突检测
title = fm.get("title", "")
if title:
    existing = name_to_id.get(title)
    if existing and existing != aid:
        _title_conflicts.append({
            "name": title,
            "claimed_by": [existing, aid],
            "severity": "blocker",
        })
        # 不注册冲突项 — 连先到者一并移除，两个都不留。
        # 只拒绝后者会让 name_to_id[title] 保留先到者，[[title]] 仍连错对象（见 entity-disambiguation.md v1.1 修正）。
        name_to_id.pop(title, None)
    else:
        name_to_id[title] = aid
```

**效果**：

```
冲突前: name_to_id["Token"] = "auth-token"  → 被 crypto-token 覆盖 → 静默
冲突后: name_to_id["Token"] = 不注册 → unresolved_wikilinks 告警 → Blockers 清零
```

> **D1 输出落地点**：`_title_conflicts` / `_alias_conflicts` 必须写入 `master_graph` 顶层字段 `titleConflicts` / `aliasConflicts`，与现有 `unresolvedWikilinks`（`extract_graph.py:2326`、`:2653`）同结构同通道。不落 stderr——stderr 只给人看，机器消费不了，CLI gate 和合规面板都读不到。冲突信息是管道自身告警，不是合规面板消费的产物，放 master_graph 语义正确。
>
> **D2 分开报**：title 冲突和 alias 冲突分两个列表，结构见 §2.1。
>
> **责任方定位**：解析层是兜底检测，不是第一道闸门。title/alias 唯一性的主闸门在写入层（`validate-entity.py` 提交前 gate），见 §2.3b。解析层只在写入层漏过时兜底，并把冲突暴露到 master_graph 供下游对账。

### 2.3 写入层三层防御（D5）

同名异义的写入层校验分三道闸门，工业实践共识是"写入时强制 + 事后检测"：

| 层 | 责任方 | 时机 | 严重度 | 状态 |
|----|--------|------|--------|------|
| **a. CLI gate（主）** | `validate-entity.py` | 提交前 `--changed` | ERROR | 新增检查，见 §2.3a |
| **b. 合规面板（预检）** | `entity-compliance-service.cjs`（已实现 V1） | 编辑后 Web 预检 | BLOCKER | 已实现 F01-F17+B01-B04+F02b，需扩展 F02c/F18，见 §2.3b |
| **c. 管道兜底** | `extract_graph.py` | 跑图时 | master_graph 告警 | 已在 §2.1/§2.2 覆盖 |

> **D5 三层防御**：方案原版只在管道兜底（c 层），漏了写入时强制。`validate-entity.py` 是提交前主 gate（CLAUDE.md §八："修改 entity 后必须运行 `validate-entity.py --changed`，ERROR 清零后方可提交"），绕过它只放 Web 面板会出现：作者编辑后不跑面板直接提交，alias 冲突漏过。三层都查同名异义，c 层是最后防线。

#### 2.3a CLI gate（主闸门，新增）

`validate-entity.py` 的 `check_id_uniqueness`（`:189`）当前只查 `architecture-node-id` 重复。扩为 `check_name_uniqueness`，加 title 和 alias 维度：

```python
def check_name_uniqueness():
    # 现有：architecture-node-id 重复检查（保持）
    id_map = defaultdict(list)
    title_map = defaultdict(list)
    alias_map = defaultdict(list)
    for fname in os.listdir(ENTITIES_DIR):
        if not fname.endswith(".md"):
            continue
        fm, _ = parse_frontmatter(os.path.join(ENTITIES_DIR, fname))
        aid = fm.get("architecture-node-id", "")
        title = fm.get("title", "")
        aliases = fm.get("aliases", []) if isinstance(fm.get("aliases", []), list) else []
        if aid:
            id_map[aid].append(fname)
        if title:
            title_map[title].append(fname)
        for a in aliases:
            alias_map[a.strip()].append(fname)
    # id 重复（现有）
    for aid, files in id_map.items():
        if len(files) > 1:
            errors.append(f"architecture-node-id 重复: '{aid}' → {', '.join(files)}")
    # title 重复（新增）
    for title, files in title_map.items():
        if len(files) > 1:
            errors.append(f"title 重复: '{title}' → {', '.join(files)}")
    # alias 冲突（新增）：alias 撞他人 id/title/alias
    all_names = set(id_map) | set(title_map)
    for alias, files in alias_map.items():
        if len(files) > 1:
            errors.append(f"alias 被多 entity 声明: '{alias}' → {', '.join(files)}")
        if alias in all_names:
            errors.append(f"alias 撞占已有 id/title: '{alias}' → {', '.join(files)}")
```

#### 2.3b 合规面板（预检，已实现 V1，需扩展）

合规面板已在 `/Users/example/架构图系统-rebuild/electron/services/` 实现 V1，规则序列 F01–F17 + B01–B04 + F02b。本设计在其基础上扩展两条规则：

| 规则 | 检测内容 | 严重度 |
|------|---------|:--:|
| F02c | title 与其它 entity 的 architecture-node-id / title / aliases 冲突 | blocker |
| F18 | aliases 中任一值与其它 entity 的 architecture-node-id / title / aliases 冲突 | blocker |

**现有代码基线**（已核实，`entity-compliance-service.cjs`）：
- `buildEntityIndexes`（`:41`）已实现，返回 `{ ids, titleLookup, filenameLookup, duplicateIds }`
- F02b（`:92`）已实现，检测 `architecture-node-id` 重复，用 `duplicateIds` Set
- `resolveTarget`（`entity-compliance-body-rules.cjs:21`）已实现 wikilink 解析，查 `ids` / `titleLookup` / `filenameLookup`，含去空格容错，**但不查 aliasLookup**
- `titleLookup` 写入（`:65`）是 `if (title && !titleLookup[title])` **先到先得，不报冲突**——title 冲突静默覆盖问题在合规面板里复现，F02c 正是修这个

**扩展点**（在已实现代码上加，非新建）：
- `buildEntityIndexes` 签名扩为 `{ ids, titleLookup, filenameLookup, aliasLookup, duplicateIds, titleConflicts, aliasConflicts }`——`aliasLookup` 从 `fm.aliases` 构建，`titleConflicts`/`aliasConflicts` 在写入时检测而非先到先得
- `resolveTarget` 加查 `indexes.aliasLookup`，让 `[[别名]]` 在 B02 解析时命中
- 新增 `checkF02c` / `checkF18`，挂进 `checkEntityCompliance` 的 `allFindings`（`:83`），与 F02b 同组（identity）
- F02c 复用 F02b 的 `duplicateIds` 模式：`titleConflicts` Set + 遍历检测

> **对原版方案的事实修正**：原版称"与现有 `duplicateIds`（F02b）共用索引结构"——**正确**，F02b 确实存在（`:92`）。原版引用的 `entity-compliance-frontmatter-rules.cjs` **也确实存在**（`/Users/example/架构图系统-rebuild/electron/services/entity-compliance-frontmatter-rules.cjs`），F01-F17 在其中。原版唯一不准确的是"待面板 V1 实现时并入"——面板 V1 已实现，是扩展不是新建。

---

## 三、同名异义操作流程

### 3.1 作者建两个同名 entity

```
1. 创建 ai-token.md
     title: "AI Token"
     aliases: ["码元", "LLM token"]

2. 创建 auth-token.md
     title: "Auth Token"
     aliases: ["令牌", "鉴权令牌"]

   → 两者 title 不同 → CLI gate check_name_uniqueness 通过 / 面板 F02c 通过
   → 两者 aliases 无交集 → CLI gate 通过 / 面板 F18 通过
```

### 3.2 歧义词不出现在 aliases 中

如果双方都声称 `token` 作为 alias：

```
ai-token.md    aliases: ["码元", "token"]
auth-token.md  aliases: ["令牌", "token"]
               → CLI gate ERROR: alias 被多 entity 声明 'token'
               → 面板 F18 BLOCKER: "token" 被两个 entity 同时声明
```

**处理**：各自从 aliases 中去掉裸 `token`，改用限定词（`LLM token` / `鉴权 token`）。裸词 `token` 不自动解析，文档中必须用精确名称。

### 3.3 Concept 导航页（消歧入口，按需创建）

> **D7 消歧页标记**：消歧页放 `wiki/concepts/`，frontmatter 加 `disambiguation: true`。`extract_concept_nodes`（`extract_graph.py:984`）见此标记跳过 Concept 节点创建，但仍解析 body wikilink 作为 REFERENCES 边——消歧页指向各实体是合法引用。无此标记会被当普通概念节点进 master_graph，污染概念索引。
>
> **D8 消歧规则不参与解析**：消歧页中的"消歧规则"是纯人读文本，解析层不读、不执行。wikilink 必须指具体 entity，不指消歧页。理由：wikilink `[[token]]` 不携带 domain 上下文，domain 是文档属性不是 wikilink 属性，按域自动消歧会连错（一个安全文档可引用 AI token）。Wikipedia 明确拒绝消歧页参与解析。
>
> **D9 按需创建，不预建**：消歧页是 title 冲突的修复手段之一，不是预防手段。当前 vault 0 同名实例，不预建模板。当 §2.2 的 `titleConflicts` 输出真实冲突、且作者确认两个 title 都想保留时，才创建消歧页。另一个修复手段是"改其中一个 title"（Wikipedia 的自然消歧优先级最高）。下方示例仅作格式说明，当前不实际创建 `wiki/concepts/token.md`。

消歧页格式（按需创建时参照）：

```markdown
---
title: Token
disambiguation: true
---

Token 是跨域重载术语，在系统中对应两个架构组件：

| 上下文 | 组件 | ID |
|--------|------|-----|
| AI / LLM / 模型 | [[ai-token]] | `ai-token` |
| 认证 / 鉴权 / 登录 | [[auth-token]] | `auth-token` |

## 消歧规则（人读，不参与解析）

- 文档 domain 在"安全"下 → Token 指 auth-token
- 文档 domain 在"AI"下 → Token 指 ai-token
- 无法确定 → 联系文档作者
```

### 3.4 历史文章修复

```
extract_graph 全量执行
  → 收集所有 unresolved_wikilinks
    → 按 source_file 的 category-path 分桶
      → 运维按域批量确认目标 entity
        → 回写历史文章 wikilink（[[Token]] → [[ai-token]] 或 [[auth-token]]）
```

> **执行入口缺口**：当前 `extract_graph.py` 产出 `unresolvedWikilinks` 列表，但无按 `category-path` 分桶聚合的现成工具。本流程需新增一个分桶脚本或归入 `manage-knowledge-base` / `graph-pipeline` SKILL，不在本设计范围内。`titleConflicts` / `aliasConflicts` 输出后，同样需一个消费入口把冲突分桶呈现给运维。

---

## 四、改动清单

按风险分级重排（风险标准见 `架构图系统-rebuild/docs/standards/decision-framework.md`）。每项标注风险级和该走的判据。P0 高风险走全套，P1/P2 中风险走子集，P3 低风险只跑测试。

### P0 — 高风险（管道核心 + CLI gate，走 N1-N6 + M1-M4 + H8 + 全部 Q）

改 `name_to_id` 注入逻辑（管道变换核心）+ 加 `aliases` 字段消费者（CLI gate）。N6 跨仓库：vault 侧改动。

| 判据 | 状态 |
|------|------|
| N1 真实需求 | ✅ `extract_graph.py:2040` 静默覆盖是真 bug，`validate-entity.py` 不查 title 是真盲区 |
| N3 派生同步 | ✅ 消费者清单见 §四末尾 |
| N4 向后兼容 | ✅ 加冲突检测分支，现有注入不变 |
| N6 跨仓库 | ✅ vault 侧 `extract_graph.py` + `validate-entity.py`，不碰 rebuild |
| M1 派生同步 | ✅ 见消费者清单 |
| M2 三层防御 | ✅ CLI gate（主）+ 管道兜底，面板层在 P2 |
| M3 可观测 | ✅ `titleConflicts`/`aliasConflicts` 写 master_graph，不静默 |
| M4 向后兼容 | ✅ 加字段/加分支，现有行为不变 |

| 文件 | 改动 | 行数 |
|------|------|:--:|
| `extract_graph.py` Step 0 | title 注入：覆盖 → 冲突检测；alias 注入；`_title_conflicts`/`_alias_conflicts` 写入 `master_graph.titleConflicts`/`aliasConflicts` | ~20 |
| `validate-entity.py` | `check_id_uniqueness` → `check_name_uniqueness`，加 title 重复 + alias 冲突检查（§2.3a） | ~25 |

**落地后必跑**：Q1（`validate-entity.py --changed` ERROR 清零）+ Q6（标准库健康度）。

### P1 — 中风险（schema 字段 + concept_nodes 标记，走 N1 + N3 + N4 + Q1 + Q6）

加 `aliases` 字段（数据模型变更，向后兼容）+ `disambiguation: true` 标记。

| 判据 | 状态 |
|------|------|
| N1 真实需求 | ✅ aliases 是 P0 冲突检测的前置（CLI gate 要读 aliases）；disambiguation 标记是 D7 |
| N3 派生同步 | ✅ schema → extract_graph（P0 已含）→ validate-entity（P0 已含）→ 合规面板（P2）|
| N4 向后兼容 | ✅ 可选字段，现有 entity 无 aliases 不报错 |
| N5 不开新面板 | ✅ 不涉及面板 |

| 文件 | 改动 | 行数 |
|------|------|:--:|
| `entity-frontmatter-schema.md` | 身份段新增 `aliases` 字段定义（D4，紧跟 title/architecture-node-id） | ~8 |
| `extract_graph.py` `extract_concept_nodes` | 识别 `disambiguation: true`，跳过 Concept 节点创建但保留 REFERENCES 边（D7） | ~6 |

**落地后必跑**：Q1 + Q6。不走 H8（字段定义不是校验逻辑，不需要三层防御）。

### P2 — 中风险（合规面板扩展，走 N1 + N4 + H2 + H5 + Q2 + Q4）

扩展已实现 V1 的合规面板，加 F02c/F18 + aliasLookup。N6 跨仓库：rebuild 侧改动。

| 判据 | 状态 |
|------|------|
| N1 真实需求 | ✅ titleLookup 先到先得是 §1.2 bug 在 rebuild 侧的复现 |
| N4 向后兼容 | ✅ `EntityIndexes` 加键不破契约（不在 OpenAPI），`resolveTarget` 加 fallback 不改现有 5 路 |
| H2 契约防腐 | ⚠️ `ComplianceFinding` 复用现有 schema，新 `ruleId` 是加枚举值不改结构，仍需 `api-validate.py` 校验 |
| H5 记录 REQUIREMENTS | ⚠️ 落地时追加 `REQUIREMENTS.md` #45 |
| H8 三层防御 | ✅ 面板是预检层（P0 CLI gate 是主，P0 管道是兜底） |
| M4 向后兼容 | ✅ 加 `aliasLookup`/`titleConflicts`/`aliasConflicts` 键，现有 `ids`/`titleLookup`/`filenameLookup`/`duplicateIds` 不变 |

| 文件 | 改动 | 行数 |
|------|------|:--:|
| `entity-compliance-service.cjs`（已实现 V1） | 扩 `buildEntityIndexes` 签名加 `aliasLookup`/`titleConflicts`/`aliasConflicts`；`resolveTarget` 加查 `aliasLookup`；新增 `checkF02c`/`checkF18`（§2.3b）。**F02c 已落地**：`duplicateTitles` + `checkF02c` 对称 F02b，在 `checkEntityCompliance` 内（需 `indexes`，不在 frontmatter-rules）。F18 待规模触发 | ~20 |
| `entity-compliance-service.test.cjs` | 加 F02c 测试用例（**已落地**）；F18/aliasLookup 测试待规模触发（H6） | ~30 |

**落地后必跑**：Q2（`api-validate.py --check-routes --check-envelope --strict`）+ Q3（`tsc --noEmit`）+ Q4（`vitest run`）。

### P3 — 低风险（消歧页 + 分桶脚本，走 Q3 + Q4）

消歧页是加 concept 页，不改契约不改数据模型不改校验逻辑。按 N2 规模匹配，当前 0 同名实例，**待触发不预建**。

| 判据 | 状态 |
|------|------|
| N1 真实需求 | ❌ 当前 0 同名实例，待 `titleConflicts` 输出真实冲突时触发 |
| N2 规模匹配 | ❌ 4 entity，不预建（YAGNI） |
| N4 向后兼容 | ✅ `disambiguation: true` 是可选标记，P1 的 `extract_concept_nodes` 识别它 |

| 文件 | 改动 | 行数 |
|------|------|:--:|
| `wiki/concepts/` | title 冲突真实发生且作者选择保留双 title 时，按需创建消歧页（D9，当前不建） | — |
| 新增分桶脚本或 SKILL 归入 | 消费 `unresolvedWikilinks`/`titleConflicts`/`aliasConflicts`，按 category-path 分桶呈现（§3.4 执行入口） | — |

**落地后必跑**：Q3 + Q4（仅触发时）。不走 N1-N6（不改契约不改数据模型）、不走 M1-M4（低风险不查成熟度标志）、不走 H8（不是校验逻辑）。

### 消费者清单（N3 派生同步，M1 成熟度）

`aliases` 字段的 7 个消费者，P0/P1/P2 必须全覆盖：

| 消费者 | 仓库 | P 级 | 改动 | 适配方式 | 破坏现有? |
|--------|------|:--:|------|----------|:--:|
| `entity-frontmatter-schema.md` | vault | P1 | 加 `aliases` 字段定义 | 加可选字段 | 否 |
| `extract_graph.py` Step 0 | vault | P0 | 加 alias 注入 + title 冲突检测 | 加分支，现有注入不变 | 否（修 §1.2 bug） |
| `extract_graph.py` `extract_concept_nodes` | vault | P1 | 识别 `disambiguation: true` | 加 if 跳过节点 | 否 |
| `validate-entity.py` | vault | P0 | `check_name_uniqueness` 加 title/alias 维度 | 加维度，现有 id 检查不变 | 否 |
| `buildEntityIndexes` | rebuild | P2 | 加 `aliasLookup`/`titleConflicts`/`aliasConflicts` 键 | 加键，现有键不变 | 否 |
| `resolveTarget` | rebuild | P2 | 加 `aliasLookup` fallback | 加第 6 路，现有 5 路不变 | 否 |
| `checkEntityCompliance` + `checkF02c`/`checkF18` | rebuild | P2 | 挂新规则 | 加 `allFindings.push`，现有 F01-F17 不变 | 否 |
| `master_graph.json` | vault | P0 | 加 `titleConflicts`/`aliasConflicts` 字段 | 加字段，现有字段不变 | 否 |

**全表"否"**——纯向后兼容适配。这是方案能安全落地的根本原因。

> **与原版差异**：原版 P0 把合规面板改动列为"待 V1 实现"——实际 rebuild 仓库已实现 V1（F01-F17+B01-B04+F02b），是扩展不是新建。原版 P0 的合规面板改动降为 P2（扩展已有代码），原版漏了 `validate-entity.py` CLI gate（D5 主闸门），现补为 P0。原版引用的 `entity-compliance-frontmatter-rules.cjs` 确实存在（rebuild 仓库），F01-F17 在其中。
>
> **风险分级依据**：`架构图系统-rebuild/docs/standards/decision-framework.md`。P0 高风险（改管道核心 + CLI gate，走全套判据），P1/P2 中风险（schema 字段 / 面板扩展，走子集），P3 低风险（消歧页，只跑测试）。判据深度和风险成正比，不每个改动都走 22 个判据。

---

## 五、验收标准

按三层防御分组：

**写入层（CLI gate，P0）**

- [ ] 两个 entity 共享同一 title → `validate-entity.py --changed` ERROR，提交前拦截
- [ ] 两个 entity 共享同一 alias → `validate-entity.py --changed` ERROR
- [ ] alias 撞他人 architecture-node-id 或 title → `validate-entity.py --changed` ERROR
- [ ] architecture-node-id 重复检查（现有）保持不变

**解析层（管道兜底，P0）**

- [ ] `[[码元]]` → aliases 命中 `ai-token`，生成正确边
- [ ] `[[令牌]]` → aliases 命中 `auth-token`，生成正确边
- [ ] `[[Token]]` 歧义且无 context → unresolved，不生成边
- [ ] title 冲突 → 不注册进 `name_to_id`，写入 `master_graph.titleConflicts`（D1 输出闭环）
- [ ] alias 冲突 → 不注册，写入 `master_graph.aliasConflicts`，结构与 titleConflicts 区分（D2）
- [ ] 全量 extract 无 title 冲突静默覆盖（原版验收项，现可验：`titleConflicts` 字段可见）

**写入层（合规面板，P2，扩展已实现 V1）**

- [ ] 面板 F02c 检测 title 冲突，BLOCKER
- [ ] 面板 F18 检测 alias 冲突，BLOCKER

**阅读层（P3，待触发）**

- [ ] `disambiguation: true` 的 concept 页不进 master_graph 的 Concept 节点，但 REFERENCES 边保留（D7）
- [ ] 消歧页规则文本不被解析层执行（D8）

---

## 六、不做的事

- **不做 LLM 自动消歧**：不在管道中调用 LLM 猜测 `码元` 对应哪个 entity。猜对省一秒，猜错赔一天。工业实践：Entity Disambiguation 系统需上下文，wikilink 不带上下文，构建时消歧信息不足。
- **不做 namespace 目录层**：当前 entity 数量不超过两位数，不需要。如果未来 entity 超过 50+ 且跨域重名频繁，再评估。Wikipedia 用全局唯一 + 消歧页解决，不靠命名空间隔离。
- **不做 context_aliases（按 domain 自动消歧）**：wikilink 不携带 domain 上下文，domain 是文档属性不是 wikilink 属性，按域自动消歧会连错。消歧页规则纯人读，不参与解析（D8）。
- **不做命中日志（D3）**：不记录"哪些别名被解析命中"。当前规模无别名实例，`name_to_id` 本身即证据，冲突列表已覆盖错误情况。规模触发再考虑。
- **不预建消歧页（D9）**：消歧页是 title 冲突的修复手段之一，不是预防手段。当前 0 同名实例，不预建模板。`titleConflicts` 输出真实冲突且作者选择保留双 title 时才创建。

---

## 七、工业实践对照

本设计与 Wiki/知识图谱系统的三层共识架构对照：

| 层 | 本设计 | 工业对应 |
|----|--------|----------|
| ID ≠ Name 地基 | `architecture-node-id` 唯一，`title`/`aliases` 可重复 | Wikidata Q-number / schema.org `@id` / MediaWiki 页面名 |
| 写入层强制 | `validate-entity.py` check_name_uniqueness + 面板 F02c/F18 | Wikidata (label, description) 唯一约束、schema.org `alternateName` |
| 解析层不猜测 | 冲突项不注册，留 unresolved + master_graph 告警 | MediaWiki red link |
| 阅读层人工消歧 | `disambiguation: true` 消歧页，按需创建 | Wikipedia disambiguation page + `{{Disambiguation}}` 模板 |
| 消歧规则不参与解析 | D8 写死，wikilink 指具体 entity | Wikipedia 明确拒绝消歧页参与解析 |
| 全 vault 唯一 | D6，靠命名约定消歧不靠域命名空间 | Wikipedia 全局唯一，Wikidata 仅显式命名空间（语言） |

---

*v2.1 — 2026-07-07（v2.0 基于三层防御 + 工业实践修订；v2.1 纠正合规面板状态：rebuild 仓库已实现 V1，F02b/F01-F17/entity-compliance-frontmatter-rules.cjs 均已存在，方案从"待实现"改为"扩展已有代码"）*
