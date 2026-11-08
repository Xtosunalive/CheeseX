# Entity 名称消歧 — 当前落地方案

> **状态：已落地（2026-07-07）。** title 静默覆盖 bug 已修（`extract_graph.py:2040`），不做 aliases/三层防御/消歧页/F02c-F18。
>
> **规模触发时**：aliases 字段、三层防御、消歧页、F02c/F18 等完整设计见 `entity-disambiguation-design.md`，在以下阈值触发时启用——第一个 entity 写 `aliases:`、第一次 title 冲突、第一次真实同名 entity。
>
> **关联**：`entity-disambiguation-design.md`（规模触发参考）、[[entity-frontmatter-schema]]

---

## 一、问题

### 1.2 一对多（title 冲突静默覆盖）

两个 entity 共享同一 title，后者覆盖前者，无告警。

```python
# extract_graph.py:2037-2040 — 当前逻辑
name_to_id[fname.replace(".md", "")] = aid
name_to_id[title] = aid   # 先写入 auth-token
name_to_id[title] = aid   # 后被 crypto-token 覆盖，auth-token 的映射丢失
# ⚠️ 没有告警，静默错误
```

**当前状态**：4 个 entity 的 title（API Gateway / Auth Service / MySQL / Search Service）互不冲突，0 个真实冲突实例。但 `extract_graph.py:2040` 的静默覆盖是真 bug——一旦未来出现同名 title，后者覆盖前者，`unresolved_wikilinks` 不会告警（因为 `name_to_id` 里有值，只是值错了），连接会指向错误的 entity。

**为什么不触发完整设计**：4 个 entity、0 冲突，三层防御（CLI gate + 合规面板 + 管道兜底）和 aliases 字段都是为 0 实例造的基础设施。只修这一个 bug，12 行代码。

---

## 二、方案

### 2.2 title 冲突检测（唯一改动）

**修改 `extract_graph.py` Step 0** — title 注入从覆盖改为冲突检测：

```python
# 文件名 → id（文件名天然唯一，保持不变）
name_to_id[fname.replace(".md", "")] = aid

# title 注入：覆盖 → 冲突检测
title = fm.get("title", "")
if title:
    existing = name_to_id.get(title)
    if existing and existing != aid:
        # 冲突：连先到者一并移除，两个都不注册。
        # 只拒绝后者会让 name_to_id[title] 保留先到者，[[title]] 仍连错对象。
        # 两个都不留 → wikilink 解析落 unresolved → 现有 unresolvedWikilinks 告警通道可见。
        print(f"  [WARN] title 冲突: '{title}' 被 {existing} 和 {aid} 同时声明，未注册（两个 entity 都不连）", file=sys.stderr)
        name_to_id.pop(title, None)  # 移除先到者的映射，两个都不留
    else:
        name_to_id[title] = aid
```

**效果**：

```
冲突前: name_to_id["Token"] = "auth-token"  → 被 crypto-token 覆盖 → 静默错连
冲突后: name_to_id["Token"] = 不注册 → wikilink 解析时落 unresolved → 现有 unresolvedWikilinks 告警
```

**为什么 stderr 而不是 master_graph 字段**：4 个 entity、0 冲突的场景下，冲突是异常情况，stderr 告警给人看就够。不写 `titleConflicts`/`aliasConflicts` 到 master_graph——没有消费方（合规面板读 frontmatter 自己算，不读 master_graph；P3 分桶工具待触发不预建），写了是死字段。规模触发时（真实冲突频繁），再升级到 master_graph 字段 + 消费工具。

**为什么只改管道不改 CLI gate**：`validate-entity.py` 的 `check_id_uniqueness` 确实不查 title 重复，但 4 个 entity 不会冲突，CLI gate 加 title 检查是防御 0 实例的问题。规模触发时（真实同名 title 出现），再按 `entity-disambiguation-design.md` §2.3a 加 CLI gate。

---

## 三、改动清单

| 文件 | 改动 | 行数 |
|------|------|:--:|
| `extract_graph.py` Step 0（`:2040`） | title 注入：覆盖 → 冲突检测 + stderr 告警 | ~6 |

**就这一个文件，一处改动。** 不碰 schema、不碰 CLI gate、不碰合规面板、不碰 master_graph 字段、不碰消歧页。

---

## 四、验收标准

- [ ] 两个 entity 共享同一 title → `name_to_id` 不注册该 title → wikilink 落 `unresolvedWikilinks` → 现有告警通道可见
- [ ] stderr 打印 `[WARN] title 冲突` + 两个 entity id
- [ ] 无 title 冲突时（当前 4 个 entity），行为不变，`name_to_id` 正常注入
- [ ] 现有 `unresolvedWikilinks` 机制不受影响（冲突 title 的 wikilink 走 unresolved 通道，和目标不存在时的 unresolved 行为一致）

---

## 五、不做的事（规模触发时再做）

以下均在 `entity-disambiguation-design.md`，当前不做：

- **不做 aliases 字段**：0 实例，YAGNI。第一个 entity 写 `aliases:` 时再做。
- **不做三层防御**：CLI gate + 合规面板 + 管道兜底，4 个 entity 不需要。第一次 title 冲突时再做。
- **不做消歧页**：0 同名 entity。第一次真实同名时再做。
- **不做 F02c/F18**：合规面板扩展，0 aliases 使用时不做。aliases 被使用后再做。
- **不做 master_graph 的 titleConflicts/aliasConflicts 字段**：没有消费方，写了是死字段。规模触发时再做。
- **不做工业实践对照**：Wikidata/MediaWiki/Wikipedia 架构对齐，4 个 entity 不需要。规模触发时参考 design 文档。

---

## 六、为什么从 v2.1 缩到最小

v2.1 为 0 实例的问题设计了三层防御、9 个决策点、7 个消费者清单、工业实践对照表。每一步单独看合理，叠在一起是为 0 个实例造基础设施。判定依据：

| 维度 | v2.1 | 最小方案 |
|------|------|----------|
| 改动文件数 | 7 个消费者（schema/管道/CLI/面板/contract/master_graph/concept_nodes） | 1 个（extract_graph.py） |
| 改动行数 | P0 ~45 行 + P1 ~14 行 + P2 ~60 行 | ~6 行 |
| 防御层数 | 3 层（CLI gate + 面板 + 管道） | 1 层（管道 stderr） |
| 消费方 | master_graph 字段 + 面板 + 分桶工具 | stderr（给人看） |
| 触发条件 | 0 实例就全做 | 真实冲突才升级 |

完整设计（三层防御、aliases、消歧页、F02c/F18、工业实践对照）保留在 `entity-disambiguation-design.md`，不删，规模触发时启用。

---

*v1.1 — 2026-07-07（已落地：§2.2 代码块修正为"两个都不留"，与效果说明/验收标准一致；原 v1.0 代码块为"先到先得"会导致冲突 title 仍连先到者，不满足验收标准 §四-1）*
*v1.0 — 2026-07-07（从 v2.1 缩到最小 bug 修复，完整设计移至 entity-disambiguation-design.md）*
