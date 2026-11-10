#!/usr/bin/env python3
# Component: Constraint-Validator (Health)
# @responsible: 校验 master_graph.json 节点/边是否符合本体；检查管道契约（I/O 声明、主权冲突、阶段漂移）；健康度审计（SA 漂移、图谱覆盖率）
# @inputs: `master_graph.json` + 词表（enums/dependencies，经信封——WP-049 L3 起零词表文件直读）
# @outputs: 校验报告（ERROR 即终止管道）
# @context: B. 逻辑中枢上下文 (Pipeline Context)
# contract: reads master_graph.json, semantic_architecture.json, 词表 enums/dependencies（经信封）
"""
管道诊断工具 — 健康度检查 + 数据审计
  python3 pipeline-check.py health                     # 全量管道健康报告
  python3 pipeline-check.py health --json              # JSON 输出
  python3 pipeline-check.py health --check staleness   # 仅 SA 漂移检查
  python3 pipeline-check.py health --check coverage    # 仅图谱覆盖率
  python3 pipeline-check.py audit                      # 以 entity 为事实源的 8 项审计
"""

# W2 迁仓闭包（SPEC-025 C1/C12）：kb_paths/schema_loader 解析自仓内 vault-runtime（A 类事实源）；同族脚本同目录。
import sys as _sys
from pathlib import Path as _Path
_HERE = _Path(__file__).resolve().parent
for _dep in (_HERE, _HERE.parents[1] / "vault-runtime"):
    _s = str(_dep)
    if _s not in _sys.path:
        _sys.path.insert(0, _s)
import json
import os
import re
import sys
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone

import yaml

from kb_paths import vault_roots, normalize_vault_cli, staging_path

VAULT, KNOWLEDGE = vault_roots()
IMPORTED = os.path.join(KNOWLEDGE, "raw", "imported")
PRECLEANED = os.path.join(KNOWLEDGE, "raw", "precleaned")
ARCHIVE = os.path.join(KNOWLEDGE, "raw", "archive")
DRAFTS = os.path.join(KNOWLEDGE, "raw", "drafts")
ENTITIES = os.path.join(KNOWLEDGE, "wiki", "entities")
MASTER_GRAPH = staging_path("master_graph.json")
SA = staging_path("sa/semantic_architecture.json")
LAYOUT = staging_path("sa/architecture_layout.json")

VALID_LAYERS = {
    "external", "gateway", "application", "service",
    "cloud-native", "data-lake", "foundation",
    "crosscutting", "open", "intelligence"
}

REQUIRED_ARCH_FIELDS = [
    "architecture-node-id", "arch_layer", "arch_category",
    "arch_subdomain", "arch_since", "arch_until", "module"
]

SCRIPTS = os.path.join(KNOWLEDGE, ".claude", "scripts")
sys.path.insert(0, SCRIPTS)


# ── shared utilities ──────────────────────────────────

def parse_version_tuple(v):
    if not v or not str(v).strip():
        return None
    try:
        return tuple(int(x) for x in str(v).strip().split("."))
    except (ValueError, TypeError):
        return None


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


_DOC_ENV_CACHE = None  # WP-117 批3：信封惰性缓存（None＝未载）


def _doc_env():
    """WP-117 批3：文档信封惰性载入（供给面缺失即 raise——与空实体集分型）。"""
    global _DOC_ENV_CACHE
    if _DOC_ENV_CACHE is None:
        from doc_envelope import load_doc_envelope as _lde
        _DOC_ENV_CACHE = _lde()
    return _DOC_ENV_CACHE


def load_entity_pages():
    entities = {}
    # WP-117 批3（SPEC-084 §二.3）：entities 顶层 .md 改信封供给——fm 哑切分＋safe_load
    # 与 body 切点语义逐字保持（全文＝fmText＋body 逐字节还原原文件）。
    prefix = "知识库/wiki/entities/"
    for rel in sorted(
        r for r in _doc_env().paths()
        if r.startswith(prefix) and r.endswith(".md") and "/" not in r[len(prefix):]
    ):
        hit = _doc_env().get_document(rel)
        if hit["state"] != "present":
            continue
        content = hit["value"]["fmText"] + hit["value"]["body"]
        fname = rel.rsplit("/", 1)[-1]
        fm = {}
        body = content
        if content.startswith("---"):
            parts = content.split("---", 2)
            if len(parts) >= 3:
                try:
                    fm = yaml.safe_load(parts[1]) or {}
                except yaml.YAMLError:
                    pass
                body = parts[2]
        entities[fname] = {"frontmatter": fm, "body": body, "path": rel}
    return entities


def extract_wikilinks(body):
    pattern = re.compile(r'^(?:-\s*)?(\S+)::\[\[([^\]]+)\]\]', re.MULTILINE)
    results = []
    for m in pattern.finditer(body):
        results.append((m.group(1), m.group(2)))
    return results


def count_files_by_ext(directory):
    counts = Counter()
    if not os.path.exists(directory):
        return counts, 0
    total = 0
    for root, dirs, files in os.walk(directory):
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        for f in files:
            if f.startswith('.') or f.endswith('.json'):
                continue
            ext = os.path.splitext(f)[1].lower()
            counts[ext or '(无扩展名)'] += 1
            total += 1
    return counts, total


# ── health check ──────────────────────────────────────

def health_stage1_backlog():
    imported_counts, imported_total = count_files_by_ext(IMPORTED)
    precleaned_counts, precleaned_total = count_files_by_ext(PRECLEANED)
    archive_counts, archive_total = count_files_by_ext(ARCHIVE)
    drafts_counts, drafts_total = count_files_by_ext(DRAFTS)
    processed_total = precleaned_total + archive_total
    return {
        "imported_total": imported_total,
        "imported_breakdown": dict(imported_counts),
        "precleaned_total": precleaned_total,
        "archive_total": archive_total,
        "drafts_total": drafts_total,
        "processed_total": processed_total,
        "backlog": imported_total,
        "process_ratio": round(processed_total / max(imported_total + processed_total, 1) * 100, 1),
    }


def health_stage2_coverage():
    if not os.path.exists(MASTER_GRAPH):
        return {"error": "master_graph.json 不存在"}
    with open(MASTER_GRAPH) as f:
        graph = json.load(f)
    doc_ids = set()
    for node in graph.get("nodes", []):
        nid = node.get("id", "")
        if nid.startswith("doc-"):
            doc_ids.add(nid)
    precleaned_files = []
    # WP-117 红队 P1-2：名单面改信封供给（原 os.walk(PRECLEANED) 只收文件名不读内容——信封
    # paths 过滤即可；盘上改名/隐藏骗不过名单面）。dot 起头目录段剪枝对齐原 walk dirs[:] 口径。
    prefix = "知识库/raw/precleaned/"
    for rel in _doc_env().paths():
        if not (rel.startswith(prefix) and rel.endswith(".md")):
            continue
        rest = rel[len(prefix):]
        if any(seg.startswith(".") for seg in rest.split("/")[:-1]):
            continue
        precleaned_files.append(os.path.splitext(rest.rsplit("/", 1)[-1])[0])
    in_graph = 0
    not_in_graph = []
    for fname in precleaned_files:
        clean = fname.lower().replace(' ', '-').replace('_', '-')
        found = any(clean in did or did.endswith(f'-{clean}') for did in doc_ids)
        if found:
            in_graph += 1
        else:
            not_in_graph.append(fname)
    total = len(precleaned_files)
    return {
        "precleaned_total": total, "in_graph": in_graph,
        "not_in_graph": len(not_in_graph),
        "coverage_pct": round(in_graph / max(total, 1) * 100, 1),
        "orphan_articles": not_in_graph[:30],
    }


def health_stage3_sa_staleness():
    if not os.path.exists(SA):
        return {"error": "semantic_architecture.json 不存在"}
    sa_stat = os.stat(SA)
    sa_mtime = sa_stat.st_mtime
    sa_time_str = datetime.fromtimestamp(sa_mtime, tz=timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
    with open(SA) as f:
        sa_data = json.load(f)
    sa_components = {c["id"]: c for c in sa_data.get("components", [])}
    stale_entities = []
    fresh_entities = []
    missing_sa_entities = []
    entity_count = 0
    # WP-117 红队 P1-2：entities 清单与全文改信封供给（原 os.listdir(ENTITIES)＋open＋yaml——
    # 盘上改名隐藏文件即从名单面消失＝假绿；信封在册则照查）。fm 切分语义保持原 :229-238 形态
    # （startswith('---')＋find('---', 3) 定位，非 split maxsplit=2 形态），逐字同址。
    prefix = "知识库/wiki/entities/"
    for rel in sorted(
        r for r in _doc_env().paths()
        if r.startswith(prefix) and r.endswith(".md") and "/" not in r[len(prefix):]
    ):
        hit = _doc_env().get_document(rel)
        if hit["state"] != "present":
            continue
        content = hit["value"]["fmText"] + hit["value"]["body"]
        f = rel.rsplit("/", 1)[-1]
        entity_count += 1
        # mtime 非文档内容（stat 元数据，不入信封）——盘上可 stat 则照原语义比对；盘上缺席
        # （改名/删除）新鲜度不可证，从严计待同步（staleness 检查器「不可证即待办」口径）
        try:
            entity_mtime = os.stat(os.path.join(ENTITIES, f)).st_mtime
        except OSError:
            entity_mtime = None
        arch_component = False
        arch_node_id = None
        if content.startswith('---'):
            end = content.find('---', 3)
            if end > 0:
                try:
                    fm = yaml.safe_load(content[3:end])
                    if fm:
                        arch_component = fm.get('arch_component', False)
                        arch_node_id = fm.get('architecture-node-id')
                except Exception:
                    pass
        if not arch_component:
            continue
        if entity_mtime is None or entity_mtime > sa_mtime + 1:
            stale_entities.append({
                "name": f,
                "entity_mtime": datetime.fromtimestamp(entity_mtime, tz=timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
                                if entity_mtime is not None else "盘上缺席（信封在册）",
                "node_id": arch_node_id or os.path.splitext(f)[0],
            })
        else:
            fresh_entities.append(f)
        if arch_node_id and arch_node_id not in sa_components:
            missing_sa_entities.append(f"{f} (node_id: {arch_node_id})")
    staleness_pct = round(len(stale_entities) / max(entity_count, 1) * 100, 1)
    return {
        "sa_updated_at": sa_time_str, "sa_components_count": len(sa_components),
        "entity_count": entity_count, "stale_count": len(stale_entities),
        "fresh_count": len(fresh_entities), "staleness_pct": staleness_pct,
        "stale_entities": stale_entities, "missing_sa_entities": missing_sa_entities,
    }


def health_stage4_layout():
    if not os.path.exists(SA) or not os.path.exists(LAYOUT):
        missing = []
        if not os.path.exists(SA): missing.append("semantic_architecture.json")
        if not os.path.exists(LAYOUT): missing.append("architecture_layout.json")
        return {"error": f"文件缺失: {', '.join(missing)}"}
    sa_mtime = os.stat(SA).st_mtime
    lo_mtime = os.stat(LAYOUT).st_mtime
    sa_time = datetime.fromtimestamp(sa_mtime, tz=timezone.utc)
    lo_time = datetime.fromtimestamp(lo_mtime, tz=timezone.utc)
    drift_seconds = lo_mtime - sa_mtime
    stale = drift_seconds < -5
    with open(LAYOUT) as f:
        layout = json.load(f)
    with open(SA) as f:
        sa_data = json.load(f)
    layout_nodes_dict = layout.get("nodes", {})
    layout_node_ids = set(layout_nodes_dict.keys()) if isinstance(layout_nodes_dict, dict) else {n["id"] for n in layout_nodes_dict}
    sa_component_ids = {c["id"] for c in sa_data.get("components", [])}
    return {
        "sa_time": sa_time.strftime('%Y-%m-%d %H:%M UTC'),
        "layout_time": lo_time.strftime('%Y-%m-%d %H:%M UTC'),
        "drift_seconds": drift_seconds, "stale": stale,
        "sa_component_count": len(sa_component_ids), "layout_node_count": len(layout_node_ids),
        "in_sa_not_layout": sorted(sa_component_ids - layout_node_ids),
        "in_layout_not_sa": sorted(layout_node_ids - sa_component_ids),
    }


def compute_health_score(stages):
    scores = {}
    s1 = stages.get("backlog", {})
    if isinstance(s1, dict) and "process_ratio" in s1:
        scores["stage1_backlog"] = min(s1["process_ratio"], 100)
    s2 = stages.get("graph", {})
    if isinstance(s2, dict) and "coverage_pct" in s2:
        scores["stage2_coverage"] = s2["coverage_pct"]
    s3 = stages.get("staleness", {})
    if isinstance(s3, dict) and "staleness_pct" in s3:
        scores["stage3_sa_freshness"] = 100 - s3["staleness_pct"]
    s4 = stages.get("layout", {})
    if isinstance(s4, dict) and "stale" in s4:
        scores["stage4_layout_sync"] = 0 if s4["stale"] else 100
    overall = round(sum(scores.values()) / max(len(scores), 1), 1) if scores else 0
    return {"overall": overall, "breakdown": scores}


def cmd_health(args):
    stages = {}
    check = getattr(args, 'check', 'all')
    if check in ("backlog", "all"):
        stages["backlog"] = health_stage1_backlog()
    if check in ("coverage", "all"):
        stages["graph"] = health_stage2_coverage()
    if check in ("staleness", "all"):
        stages["staleness"] = health_stage3_sa_staleness()
    if check in ("layout", "all"):
        stages["layout"] = health_stage4_layout()
    health = compute_health_score(stages)

    if args.json:
        print(json.dumps({"health": health, "stages": stages}, ensure_ascii=False, indent=2, default=str))
    else:
        single = args.check != "all"
        if not single:
            print("═" * 60)
            print("🔍 知识管道全周期健康度")
            print("═" * 60)
            print(f"综合评分: {health['overall']}/100")
            for k, v in health['breakdown'].items():
                print(f"  {k}: {v}/100")

        s1 = stages.get("backlog", {})
        if s1:
            print(f"\n━━━ Stage 1: 碎片堆积 ━━━")
            print(f"  imported  : {s1.get('imported_total', '?')} 个, precleaned: {s1.get('precleaned_total', '?')} 篇")
            print(f"  archive   : {s1.get('archive_total', '?')} 个, drafts: {s1.get('drafts_total', '?')} 篇")
            print(f"  处理率    : {s1.get('process_ratio', '?')}%")
            if s1.get('backlog', 0) > 0:
                print(f"  ⚠️  待处理积压: {s1['backlog']} 个文件")

        s2 = stages.get("graph", {})
        if s2 and "error" not in s2:
            print(f"\n━━━ Stage 2: 图谱覆盖率 ━━━")
            print(f"  precleaned: {s2.get('precleaned_total', '?')} 篇, 已入图: {s2.get('in_graph', '?')} 篇")
            print(f"  覆盖率    : {s2.get('coverage_pct', '?')}%")
            if s2.get('orphan_articles'):
                print(f"  未入图文章 (前 10):")
                for name in s2['orphan_articles'][:10]:
                    print(f"    - {name}")

        s3 = stages.get("staleness", {})
        if s3 and "error" not in s3:
            print(f"\n━━━ Stage 3: SA 架构漂移 ━━━")
            print(f"  SA 更新时间: {s3.get('sa_updated_at', '?')}, 组件: {s3.get('sa_components_count', '?')}")
            print(f"  已同步: {s3.get('fresh_count', '?')}, 待同步: {s3.get('stale_count', '?')}")
            if s3.get('stale_entities'):
                print(f"  待同步 entity:")
                for e in s3['stale_entities'][:10]:
                    print(f"    - {e['name']} ({e['entity_mtime']})")

        s4 = stages.get("layout", {})
        if s4 and "error" not in s4:
            print(f"\n━━━ Stage 4: 渲染同步 ━━━")
            print(f"  漂移: {s4.get('drift_seconds', 0):.0f}s — {'⚠️ Layout 落后' if s4.get('stale') else '✅ 同步'}")

        if not single:
            issues = []
            if s1 and s1.get('backlog', 0) > 10:
                issues.append(f"📥 imported/ 积压 {s1['backlog']} 个文件，建议批量标准化")
            if s2 and s2.get('not_in_graph', 0) > 5:
                issues.append(f"📊 {s2['not_in_graph']} 篇文章未入图，运行 extract_graph --apply")
            if s3 and s3.get('stale_count', 0) > 0:
                issues.append(f"🏗️ {s3['stale_count']} 个 entity 变更后 SA 未更新，运行 generate-sa.py --apply")
            if s4 and s4.get('stale'):
                issues.append("🖥️ Layout 与 SA 不同步")
            if issues:
                print(f"\n💡 建议操作:")
                for i in issues:
                    print(f"   {i}")

    sys.exit(0 if health["overall"] >= 70 else 1)


# ── audit ─────────────────────────────────────────────

def cmd_audit(args):
    print("=" * 70)
    print("全链路数据审计（Entity 页面 = 唯一事实源）")
    print("=" * 70)

    entities = load_entity_pages()
    import schema_loader  # WP-049 L3：词表经信封取数
    enums = schema_loader.load_the_schema("enums")[0] or {}
    enums_modules = enums.get("modules", {})

    sa = load_json(SA) if os.path.exists(SA) else None

    issues = []
    dirty = []

    # 1: frontmatter 完整性
    print("\n📋 检查 1: Entity 页面 frontmatter 完整性")
    print("-" * 50)
    incomplete = []
    invalid_layers = []
    for fname, ent in sorted(entities.items()):
        fm = ent["frontmatter"]
        if fm.get("arch_component") is not True:
            continue
        arch_id = fm.get("architecture-node-id", "?")
        missing = [f for f in REQUIRED_ARCH_FIELDS if fm.get(f) is None]
        if missing:
            incomplete.append((fname, arch_id, missing))
        layer = fm.get("arch_layer", "")
        if layer and layer not in VALID_LAYERS:
            invalid_layers.append((fname, arch_id, layer))
    arch_count = sum(1 for e in entities.values() if e["frontmatter"].get("arch_component") is True)
    print(f"  arch_component entity: {arch_count} 个")
    print(f"  frontmatter 完整: {arch_count - len(incomplete)} 个")
    if incomplete:
        print(f"  ⚠️ 缺字段 ({len(incomplete)} 个):")
        for fname, arch_id, missing in sorted(incomplete):
            print(f"     - {fname} ({arch_id}): 缺 {', '.join(missing)}")
        dirty.append(f"{len(incomplete)} 个 entity 页面 frontmatter 不完整")
    if invalid_layers:
        print(f"  ❌ arch_layer 非法 ({len(invalid_layers)} 个):")
        for fname, arch_id, layer in sorted(invalid_layers):
            print(f"     - {fname} ({arch_id}): '{layer}'")
        dirty.append(f"{len(invalid_layers)} 个 entity arch_layer 值非法")
    if not incomplete and not invalid_layers:
        print("  ✅ 全部完整")

    # 2: ID 唯一性
    print("\n🔑 检查 2: architecture-node-id 唯一性")
    print("-" * 50)
    id_map = defaultdict(list)
    for fname, ent in entities.items():
        arch_id = ent["frontmatter"].get("architecture-node-id", "")
        if arch_id:
            id_map[arch_id].append(fname)
    dupes = {aid: files for aid, files in id_map.items() if len(files) > 1}
    if dupes:
        print(f"  ❌ ID 重复 ({len(dupes)} 组):")
        for aid, files in sorted(dupes.items()):
            print(f"     - '{aid}': {', '.join(files)}")
        issues.append(f"{len(dupes)} 组 architecture-node-id 重复")
    else:
        print(f"  ✅ {len(id_map)} 个 ID 均唯一")

    # 3: wikilink 完整性
    print("\n🔗 检查 3: Entity wikilink 引用完整性")
    print("-" * 50)
    ref_targets = set()
    for fname, ent in entities.items():
        fm = ent["frontmatter"]
        aid = fm.get("architecture-node-id", "")
        if aid:
            ref_targets.add(aid)
            ref_targets.add(fm.get("title", ""))
            ref_targets.add(fname.replace(".md", ""))
    broken_links = []
    total_wikilinks = 0
    for fname, ent in entities.items():
        fm = ent["frontmatter"]
        if fm.get("arch_component") is not True:
            continue
        arch_id = fm.get("architecture-node-id", "?")
        wikilinks = extract_wikilinks(ent["body"])
        total_wikilinks += len(wikilinks)
        for link_type, target_name in wikilinks:
            if target_name not in ref_targets:
                broken_links.append((fname, arch_id, link_type, target_name))
    print(f"  wikilink 总数: {total_wikilinks}")
    if broken_links:
        print(f"  ⚠️ 断链 ({len(broken_links)} 个):")
        for fname, arch_id, ltype, target in broken_links[:10]:
            print(f"     - {fname}: {ltype}::[[{target}]] → 目标不存在")
    else:
        print("  ✅ 无断链")

    # 4: enums ↔ entity module 一致性
    print("\n📐 检查 4: 词表 modules（信封）↔ entity module 字段")
    print("-" * 50)
    entity_module_map = {}
    for fname, ent in entities.items():
        fm = ent["frontmatter"]
        if fm.get("arch_component") is not True:
            continue
        arch_id = fm.get("architecture-node-id", "")
        mod_list = fm.get("module", [])
        if isinstance(mod_list, str):
            mod_list = [mod_list]
        for mod_name in mod_list:
            if mod_name:
                entity_module_map[mod_name] = arch_id
    enums_module_systems = {k: v.get("system", "") for k, v in enums_modules.items()}
    only_entity = set(entity_module_map) - set(enums_module_systems)
    only_enums = set(enums_module_systems) - set(entity_module_map)
    mismatched = []
    for mod_name in set(entity_module_map) & set(enums_module_systems):
        if entity_module_map[mod_name] != enums_module_systems[mod_name]:
            mismatched.append((mod_name, entity_module_map[mod_name], enums_module_systems[mod_name]))
    print(f"  entity module: {len(entity_module_map)} 条, enums: {len(enums_module_systems)} 条")
    if only_entity:
        print(f"  ⚠️ 仅在 entity ({len(only_entity)}): {', '.join(sorted(only_entity))}")
    if only_enums:
        print(f"  ⚠️ 仅在 enums ({len(only_enums)}): {', '.join(sorted(only_enums))}")
    if mismatched:
        print(f"  ❌ system 不匹配 ({len(mismatched)})")
    if not only_entity and not only_enums and not mismatched:
        print("  ✅ 完全一致")

    # 5: SA 生成一致性
    print("\n🏗️ 检查 5: SA 生成一致性（generate-sa.py）")
    print("-" * 50)
    if sa is None:
        print("  ⚠️ SA 文件不存在")
    else:
        sa_components = {c["id"]: c for c in sa.get("components", [])}
        entity_arch_ids = set()
        for fname, ent in entities.items():
            fm = ent["frontmatter"]
            if fm.get("arch_component") is not True:
                continue
            entity_arch_ids.add(fm.get("architecture-node-id", ""))
        sa_arch_ids = set(sa_components.keys())
        entity_only = entity_arch_ids - sa_arch_ids
        sa_only = sa_arch_ids - entity_arch_ids
        print(f"  entity 组件: {len(entity_arch_ids)} 个, SA 组件: {len(sa_arch_ids)} 个")
        if entity_only:
            print(f"  ⚠️ 仅在 entity ({len(entity_only)}): {', '.join(sorted(entity_only))}")
            issues.append("SA 缺失 entity 中声明的组件，请运行 generate-sa.py --apply")
        if sa_only:
            print(f"  ⚠️ 仅在 SA ({len(sa_only)}): {', '.join(sorted(sa_only))}")
            issues.append("SA 包含 entity 中不存在的组件")
        if not entity_only and not sa_only:
            print("  ✅ 组件一致")

    # 6: Graph ↔ Entity
    print("\n🔍 检查 6: Graph System 节点 ↔ Entity 页面")
    print("-" * 50)
    try:
        from graph_query import KnowledgeGraph
        kg = KnowledgeGraph()
        graph_systems = {}
        for nid, props in kg._node_props.items():
            labels = props.get("labels", [])
            p = props.get("properties", {})
            if "System" in labels or "ArchitectureComponent" in labels:
                graph_systems[nid] = {"arch_id": p.get("architecture_node_id") or p.get("architecture-node-id", "")}
        entity_arch_ids_all = set()
        for fname, ent in entities.items():
            aid = ent["frontmatter"].get("architecture-node-id", "")
            if aid:
                entity_arch_ids_all.add(aid)
        graph_no_entity = [(nid, gs["arch_id"]) for nid, gs in graph_systems.items()
                          if gs["arch_id"] and gs["arch_id"] not in entity_arch_ids_all]
        print(f"  Graph System 节点: {len(graph_systems)} 个")
        if graph_no_entity:
            print(f"  ⚠️ 图中有但无 entity 页面 ({len(graph_no_entity)}):")
            for nid, aid in sorted(graph_no_entity)[:8]:
                print(f"     - {nid:30s} arch-id={aid}")
        else:
            print("  ✅ 全部对应")
    except Exception:
        print("  ⚠️ 无法加载 KnowledgeGraph")

    # 7: DEPENDS_ON
    print("\n🔄 检查 7: Entity 依赖统计")
    print("-" * 50)
    entity_dep_count = 0
    for fname, ent in entities.items():
        if ent["frontmatter"].get("arch_component") is not True:
            continue
        wikilinks = extract_wikilinks(ent["body"])
        entity_dep_count += sum(1 for lt, _ in wikilinks if lt == "依赖")
    print(f"  Entity 页面 依赖:: wikilink: {entity_dep_count} 条")

    # 8: 文章版本 ↔ 依赖有效期
    print("\n📮 检查 8: 文章版本 ↔ 依赖有效期交叉验证")
    print("-" * 50)
    # WP-049 L3：依赖规则经信封取数——旧 vault 侧路径自 SPEC-023 迁仓后不存在，本检查曾静默空跑；复活为真执行
    from vocab_envelope import load_envelope
    versioned_deps = {}
    if load_envelope().has("dependencies"):
        vd_data = load_envelope().doc("dependencies")
        for entry in vd_data.get("dependencies", []):
            src = entry.get("source", entry.get("from", ""))
            if src:
                versioned_deps.setdefault(src, []).append(entry)
    module_to_system = {}
    for mod_name, mod_data in enums_modules.items():
        sys_id = mod_data.get("system", "")
        if sys_id and sys_id != "null":
            module_to_system[mod_name] = sys_id
    warnings = []
    precleaned_dir = os.path.join(KNOWLEDGE, "raw", "precleaned")
    if os.path.exists(precleaned_dir):
        # WP-117 批3：precleaned 子树 .md 改信封供给（原 os.walk 口径＝前缀过滤全下钻；
        # 全文＝fmText＋body 逐字节还原原文件，fm 哑切分＋safe_load 语义逐字保持）。
        prefix = "知识库/raw/precleaned/"
        for rel in sorted(
            r for r in _doc_env().paths()
            if r.startswith(prefix) and r.endswith(".md")
        ):
                content = None
                hit = _doc_env().get_document(rel)
                if hit["state"] == "present":
                    content = hit["value"]["fmText"] + hit["value"]["body"]
                if content is None:
                    continue
                fpath = rel  # WP-117 批3：rel 即知识库相对路径（POSIX），接续段 rel_path 拼装语义不变
                fm = {}
                if content.startswith("---"):
                    parts = content.split("---", 2)
                    if len(parts) >= 3:
                        try:
                            fm = yaml.safe_load(parts[1]) or {}
                        except yaml.YAMLError:
                            pass
                article_ver = fm.get("version", "")
                article_module = fm.get("module", "")
                if not article_ver or not article_module:
                    continue
                if isinstance(article_module, list):
                    article_module = article_module[0] if article_module else ""
                article_module = str(article_module).strip().replace("[[", "").replace("]]", "")
                if not article_module:
                    continue
                source_system = module_to_system.get(article_module, "")
                if not source_system or source_system not in versioned_deps:
                    continue
                for dep_entry in versioned_deps[source_system]:
                    dep_until = dep_entry.get("until", "")
                    if not dep_until:
                        continue
                    av = parse_version_tuple(article_ver)
                    du = parse_version_tuple(dep_until)
                    if av and du and av >= du:
                        rel_path = fpath.replace(VAULT, "").lstrip("/")
                        warnings.append(f"{rel_path}: version={article_ver} ≥ dep_until={dep_until}")
    if warnings:
        print(f"  ⚠️ 版本可能超出依赖有效期 ({len(warnings)} 条):")
        for w in sorted(warnings)[:15]:
            print(f"     - {w}")
    else:
        print("  ✅ 无矛盾")

    # Summary
    print("\n" + "=" * 70)
    print("审计总结")
    print("=" * 70)
    if issues:
        print(f"\n⚠️ 对齐问题 ({len(issues)}):")
        for i in issues:
            print(f"  - {i}")
    if dirty:
        print(f"\n🧹 脏数据 ({len(dirty)}):")
        for d in dirty:
            print(f"  - {d}")
    if not issues and not dirty:
        print("\n✅ Entity 页面数据干净，所有生成物一致。")


# ── main ──────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="管道诊断工具")
    sub = parser.add_subparsers(dest="cmd", required=True)

    _default_vr, _ = vault_roots()

    p_health = sub.add_parser("health", help="4 阶段管道健康度检查")
    p_health.add_argument("--json", action="store_true", help="JSON 输出")
    p_health.add_argument("--check", choices=["staleness", "backlog", "coverage", "layout", "all"], default="all")
    p_health.add_argument("--vault", default=_default_vr, help="Obsidian 仓库根；可传 …/知识库")

    p_audit = sub.add_parser("audit", help="以 entity 为事实源的 8 项数据审计")
    p_audit.add_argument("--vault", default=_default_vr, help="Obsidian 仓库根；可传 …/知识库")

    args = parser.parse_args()

    global VAULT, KNOWLEDGE, IMPORTED, PRECLEANED, ARCHIVE, DRAFTS
    global ENTITIES
    VAULT, KNOWLEDGE = normalize_vault_cli(args.vault)
    IMPORTED = os.path.join(KNOWLEDGE, "raw", "imported")
    PRECLEANED = os.path.join(KNOWLEDGE, "raw", "precleaned")
    ARCHIVE = os.path.join(KNOWLEDGE, "raw", "archive")
    DRAFTS = os.path.join(KNOWLEDGE, "raw", "drafts")
    ENTITIES = os.path.join(KNOWLEDGE, "wiki", "entities")

    if args.cmd == "health":
        cmd_health(args)
    elif args.cmd == "audit":
        cmd_audit(args)


if __name__ == "__main__":
    main()
