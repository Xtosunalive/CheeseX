#!/usr/bin/env python3
# W1 迁仓闭包（SPEC-025 C1/C12）：kb_paths 解析自仓内 vault-runtime（A 类事实源）。
# PR-132：write_gateway 同住 vault-runtime——自举必须先于导入（65aee107 曾把导入插在自举前＋shebang 粘连）
import sys as _sys
from pathlib import Path as _Path
_HERE = _Path(__file__).resolve().parent  # PR-110：文件级 parents 少一层（graph/ → vault-py），实际目标在 scripts/vault-runtime
_d = str(_HERE.parents[1] / "vault-runtime")
if _d not in _sys.path:
    _sys.path.insert(0, _d)
from write_gateway import write_text_atomic, append_line, write_bytes_atomic
# Component: Constraint-Validator
# @responsible: 校验 master_graph.json 节点/边是否符合本体；检查管道契约（I/O 声明、主权冲突、阶段漂移）；健康度审计（SA 漂移、图谱覆盖率）
# @inputs: `master_graph.json` + 词表（enums/ontology，经信封——WP-138 R1 起零词表文件直读）
# @outputs: 校验报告（ERROR 即终止管道）
# @context: B. 逻辑中枢上下文 (Pipeline Context)
# contract: reads master_graph.json, semantic_architecture.json
"""
知识图谱关系合理性校验脚本
分析边权重分布、识别弱边、弱连接节点、跨域异常、本体合规性。

用法:
  python3 validate_graph.py                  # 全量校验
  python3 validate_graph.py --threshold 0.3  # 自定义弱边阈值
  python3 validate_graph.py --fix            # 输出修复建议
  python3 validate_graph.py --ontology       # 额外做本体合规校验
"""

import json
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime

from kb_paths import vault_roots, ledger_dir, staging_path

VAULT_ROOT, VAULT = vault_roots()
WEAK_THRESHOLD = 0.3
POORLY_CONNECTED_THRESHOLD = 2  # fewer than N strong edges → poorly connected

_enums_cache = None


def _load_arch_enums():
    """架构分类与关系类型（WP-049 L3：经 schema_loader→词表信封取数）。

    WP-138 R1 起，本文件的词表消费已全部走信封：分类侧读 enums（本函数），对齐
    值域矩阵读 ontology（_load_align_ontology）。PR-257 手抄 10 条矩阵已删——其中
    ROUTES_TO/PROTECTS/CONTAINS/MANAGES 在任何单源零命中，正是跨语言手抄值域分叉
    的病灶位；信封缺件时得到空集（显式空，不再伪装成已知全集）。"""
    global _enums_cache
    if _enums_cache is not None:
        return _enums_cache
    import schema_loader
    enums = schema_loader.load_the_schema("enums")[0] or {}
    proj = enums.get("architecture_projection", {})
    canonical = set(enums.get("arch_categories", []))
    aliases = proj.get("category_aliases", {})
    _enums_cache = {
        "categories": canonical | set(aliases.values()),
        "relation_types": set(proj.get("projected_relation_types", [])),
    }
    return _enums_cache


def _get_arch_categories():
    return _load_arch_enums()["categories"]


def _get_arch_relation_types():
    return _load_arch_enums()["relation_types"]


_align_ontology_cache = None


def _align_type_categories(type_ids, node_types):
    """关系条目 source/target_types（节点类型 ID 列表）→ 端点类别集合。

    node_types 取自同源现役定义；未定义 ID / 缺 category 字段的条目防御性跳过
    （单源现况下不可达，宁可收窄也不猜）。"""
    categories = set()
    for type_id in type_ids or []:
        definition = node_types.get(type_id)
        category = definition.get("category") if isinstance(definition, dict) else None
        if isinstance(category, str) and category:
            categories.add(category)
    return categories


def _load_align_ontology():
    """对齐值域矩阵（WP-138 R1：单源 ontology 词表，经 schema_loader→信封取数）。

    只取 semantic_role＝architecture_skeleton 的现役关系——run_alignment 对齐的是架构
    拓扑面，与 validate_architecture_projection 的 projected 白名单同面（现况单源
    六条：DEPENDS_ON/STORES_IN/INDEXES/BACKS_UP/ENCRYPTS/CONNECTS_TO）；端点值域取
    同条目 source_types/target_types 经 node_types[].category 折算。PR-257 手抄矩
    阵的 10 条＝6 条真（此处按单源重建）＋4 条幻影（零命中，随抄本消失）。
    信封缺件＝空文档（WP-049 契约 fail-open）→ 空矩阵：一切关系判「未知」走
    CONNECTS_TO 降档待人工确认；关系在册但端点约束缺失 → 空集域值（判定如实降 0.3）。"""
    global _align_ontology_cache
    if _align_ontology_cache is not None:
        return _align_ontology_cache
    import schema_loader
    node_types = schema_loader.ontology_node_types()
    matrix = {}
    for rt, rule in schema_loader.ontology_relation_types().items():
        if not isinstance(rule, dict):
            continue
        if rule.get("semantic_role") != "architecture_skeleton":
            continue
        matrix[rt] = (
            _align_type_categories(rule.get("source_types"), node_types),
            _align_type_categories(rule.get("target_types"), node_types),
        )
    _align_ontology_cache = matrix
    return _align_ontology_cache


def _align_validate(align_ontology, rt, fc, tc):
    """单条连接的对齐判定（分档语义 WP-138 R1 保持不变，矩阵改单源供给）：

    LINKS_TO/TAGGED_WITH 外部导入特例 0.5；不在册关系 False「未知关系类型」；
    端点类别缺失 0.4；双向命中 1.0；不命中 0.3 并附逐端问题说明。"""
    if rt in ("LINKS_TO", "TAGGED_WITH"):
        return True, 0.5, "外部导入关系"
    if rt not in align_ontology:
        return False, 0.0, f"未知关系类型 {rt}"
    if not fc or not tc:
        return True, 0.4, "实体缺少类别"
    domain, range_ = align_ontology[rt]
    from_ok = fc in domain
    to_ok = tc in range_
    if from_ok and to_ok:
        return True, 1.0, ""
    problems = []
    if not from_ok: problems.append(f"{fc} 不在 {rt} domain")
    if not to_ok: problems.append(f"{tc} 不在 {rt} range")
    return True, 0.3, "; ".join(problems)


def load_graph():
    graph_path = staging_path("master_graph.json")
    try:
        with open(graph_path, encoding="utf-8") as f:
            graph = json.load(f)
        nodes = graph["nodes"]
        connections = graph["connections"]
        if not isinstance(nodes, list) or not isinstance(connections, list):
            raise ValueError("nodes 和 connections 必须是数组")
        if any(not isinstance(node["id"], str) or not node["id"] for node in nodes):
            raise ValueError("节点必须有非空字符串 id")
        edges = [
            {"source": conn["from"], "target": conn["to"], "type": conn["relationType"],
             "properties": conn.get("properties", {})}
            for conn in connections
        ]
        if any(not all(isinstance(edge[key], str) and edge[key] for key in ("source", "target", "type"))
               or not isinstance(edge["properties"], dict) for edge in edges):
            raise ValueError("连接的端点和关系类型必须是非空字符串，properties 必须是对象")
    except (OSError, KeyError, TypeError, ValueError) as error:
        print(f"❌ 图谱产物不可用: {graph_path}（{error}）", file=sys.stderr)
        return None, None
    return nodes, edges


def validate_architecture_projection():
    semantic_path = staging_path("sa/semantic_architecture.json")
    layout_path = staging_path("sa/architecture_layout.json")
    try:
        with open(semantic_path, encoding="utf-8") as f:
            semantic = json.load(f)
        components = semantic["components"]
        dependencies = semantic["dependencies"]
        layers = semantic["layers"]
        if any(not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows)
               for rows in (components, dependencies, layers)):
            raise ValueError("components、dependencies 和 layers 必须是对象数组")
        layout = {"nodes": {}, "groups": {}}
        if os.path.exists(layout_path):
            with open(layout_path, encoding="utf-8") as f:
                layout = json.load(f)
        if any(not isinstance(layout[key], dict) for key in ("nodes", "groups")):
            raise ValueError("布局的 nodes 和 groups 必须是对象")
    except (OSError, KeyError, TypeError, ValueError) as error:
        print(f"❌ 架构投影不可用: {semantic_path}（{error}）", file=sys.stderr)
        return 1

    component_ids = {c.get("id") for c in components}
    layer_ids = {l.get("id") for l in layers}

    invalid_categories = [c for c in components if c.get("category") not in _get_arch_categories()]
    leaked_relations = [d for d in dependencies if str(d.get("relationType", "CONNECTS_TO")).upper() not in _get_arch_relation_types()]
    dangling = [
        d for d in dependencies
        if d.get("from") not in component_ids or d.get("to") not in component_ids
    ]
    layout_leakage = [
        c for c in components
        if any(k in c for k in ("x", "y", "width", "height", "w", "h"))
    ]
    layout_drift = [
        *[f"node:{nid}" for nid in (layout.get("nodes") or {}) if nid not in component_ids],
        *[f"group:{gid}" for gid in (layout.get("groups") or {}) if gid not in layer_ids],
    ]

    print("=== 架构投影契约校验 ===\n")
    print(f"组件: {len(components)}  依赖: {len(dependencies)}  层级: {len(layers)}")
    print(f"布局节点: {len(layout.get('nodes') or {})}  布局分组: {len(layout.get('groups') or {})}")
    print(f"非法分类: {len(invalid_categories)}")
    print(f"图谱关系泄漏: {len(leaked_relations)}")
    print(f"悬空依赖: {len(dangling)}")
    print(f"语义中混入布局字段: {len(layout_leakage)}")
    print(f"布局漂移: {len(layout_drift)}")

    if invalid_categories:
      print("\n非法分类样例:")
      for c in invalid_categories[:10]:
          print(f"  {c.get('id')}: {c.get('category')}")
    if leaked_relations:
      print("\n图谱关系泄漏样例:")
      for d in leaked_relations[:10]:
          print(f"  {d.get('from')} -> {d.get('to')} [{d.get('relationType')}]")
    if dangling:
      print("\n悬空依赖样例:")
      for d in dangling[:10]:
          print(f"  {d.get('from')} -> {d.get('to')} [{d.get('relationType')}]")

    blockers = len(invalid_categories) + len(leaked_relations) + len(dangling) + len(layout_leakage) + len(layout_drift)
    return 1 if blockers else 0


def analyze_weights(edges):
    """Analyze weight distribution by edge type."""
    by_type = defaultdict(list)
    for e in edges:
        w = e.get("properties", {}).get("weight", 0.5)
        by_type[e["type"]].append(w)

    print("=== 边权重分布 ===\n")
    for etype in sorted(by_type):
        weights = by_type[etype]
        avg = sum(weights) / len(weights)
        weak = sum(1 for w in weights if w < WEAK_THRESHOLD)
        strong = sum(1 for w in weights if w >= 0.7)
        print(f"  {etype:15s}  count={len(weights):4d}  avg={avg:.2f}  "
              f"strong(≥0.7)={strong}  weak(<{WEAK_THRESHOLD})={weak}")
    print()
    return by_type


def find_weak_edges(nodes, edges, threshold):
    """Find edges below weight threshold."""
    node_map = {n["id"]: n for n in nodes}
    weak = []
    for e in edges:
        w = e.get("properties", {}).get("weight", 0.5)
        if w < threshold:
            src_name = _node_name(node_map, e["source"])
            tgt_name = _node_name(node_map, e["target"])
            weak.append((w, e["type"], src_name, tgt_name, e["source"], e["target"]))
    weak.sort()

    print(f"=== 弱边（weight < {threshold}，共 {len(weak)} 条）===\n")
    for w, etype, src, tgt, _, _ in weak[:30]:
        print(f"  {w:.2f}  {etype:12s}  {src[:30]:30s} → {tgt[:30]}")
    if len(weak) > 30:
        print(f"  ... 还有 {len(weak) - 30} 条")
    print()
    return weak


def find_poorly_connected(nodes, edges):
    """Find nodes with only weak edges or very few connections."""
    node_map = {n["id"]: n for n in nodes}

    # Count strong edges per node
    strong_degree = defaultdict(int)
    total_degree = defaultdict(int)
    for e in edges:
        w = e.get("properties", {}).get("weight", 0.5)
        total_degree[e["source"]] += 1
        total_degree[e["target"]] += 1
        if w >= 0.5:
            strong_degree[e["source"]] += 1
            strong_degree[e["target"]] += 1

    orphan = []
    weakly = []
    for n in nodes:
        nid = n["id"]
        sd = strong_degree.get(nid, 0)
        td = total_degree.get(nid, 0)
        labels = n.get("labels", [])
        name = n.get("properties", {}).get("name", nid)

        if td == 0:
            orphan.append((name, labels, nid))
        elif sd < POORLY_CONNECTED_THRESHOLD and "Document" not in labels and "Subdomain" not in labels:
            weakly.append((name, labels, sd, td, nid))

    print(f"=== 孤立节点（0 条边，共 {len(orphan)} 个）===\n")
    for name, labels, _ in orphan[:20]:
        print(f"  [{', '.join(labels)}] {name}")
    if len(orphan) > 20:
        print(f"  ... 还有 {len(orphan) - 20} 个")
    print()

    print(f"=== 弱连接节点（强边 < {POORLY_CONNECTED_THRESHOLD}，非 Document，共 {len(weakly)} 个）===\n")
    for name, labels, sd, td, _ in weakly[:20]:
        print(f"  [{', '.join(labels)}] {name}  (强边={sd}, 总边={td})")
    if len(weakly) > 20:
        print(f"  ... 还有 {len(weakly) - 20} 个")
    print()

    return orphan, weakly


def find_cross_domain_issues(nodes, edges):
    """Find MENTIONS/REFERENCES edges between nodes in unrelated domains."""
    node_map = {n["id"]: n for n in nodes}
    node_domains = {}
    for n in nodes:
        nid = n["id"]
        labels = n.get("labels", [])
        props = n.get("properties", {})
        if "BusinessDomain" in labels:
            node_domains[nid] = nid
        elif "Subdomain" in labels:
            cp = props.get("category_path_prefix", "")
            node_domains[nid] = cp.split(":")[0] if cp else "?"
        elif "System" in labels or "Module" in labels:
            cp = str(props.get("category_path", "")).strip("\"'")
            node_domains[nid] = cp.split(":")[0] if cp else "?"
        elif "Concept" in labels:
            node_domains[nid] = "concept"
        elif "Document" in labels:
            cp = str(props.get("category_path", "")).strip("\"'")
            node_domains[nid] = cp.split(":")[0] if cp else "?"

    issues = []
    for e in edges:
        if e["type"] not in ("MENTIONS", "REFERENCES"):
            continue
        w = e.get("properties", {}).get("weight", 0.5)
        if w >= 0.5:
            continue
        src_domain = node_domains.get(e["source"], "?")
        tgt_domain = node_domains.get(e["target"], "?")
        # Flag if both have known domains and they differ
        if (src_domain not in ("?", "concept") and
                tgt_domain not in ("?", "concept") and
                src_domain != tgt_domain):
            src_name = _node_name(node_map, e["source"])
            tgt_name = _node_name(node_map, e["target"])
            issues.append((w, e["type"], src_name, tgt_name, src_domain, tgt_domain))

    if issues:
        issues.sort()
        print(f"=== 跨域弱关联（共 {len(issues)} 条）===\n")
        for w, etype, src, tgt, sd, td in issues[:20]:
            print(f"  {w:.2f}  {etype}  {src[:25]} ({sd}) → {tgt[:25]} ({td})")
        if len(issues) > 20:
            print(f"  ... 还有 {len(issues) - 20} 条")
        print()
    return issues


def find_docs_without_module(nodes, edges):
    """Find Document nodes missing a DOCUMENTS edge."""
    doc_ids_with_docs = set()
    for e in edges:
        if e["type"] == "DOCUMENTS":
            doc_ids_with_docs.add(e["source"])

    missing = []
    for n in nodes:
        if "Document" not in n.get("labels", []):
            continue
        if n["id"] not in doc_ids_with_docs:
            fp = n.get("properties", {}).get("file_path", "")
            # wiki/sources, wiki/todo, wiki/queries are aggregate pages — no single module
            if fp.startswith("wiki/sources/") or fp.startswith("wiki/todo/") or fp.startswith("wiki/queries/"):
                continue
            name = n.get("properties", {}).get("title", n["id"])
            cp = n.get("properties", {}).get("category_path", "")
            missing.append((name, cp, n["id"]))

    if missing:
        print(f"=== 文档节点缺少 DOCUMENTS 边（共 {len(missing)} 个）===\n")
        for name, cp, _ in missing[:20]:
            print(f"  {name[:40]:40s}  category-path={cp}")
        if len(missing) > 20:
            print(f"  ... 还有 {len(missing) - 20} 个")
        print()
    return missing


def _node_name(node_map, nid):
    n = node_map.get(nid)
    if n:
        return n.get("properties", {}).get("name", nid)
    return nid


def _auto_fix(nodes, edges):
    """Auto-fix safe issues: remove empty stub pages with 0 edges."""
    edge_endpoints = set()
    for e in edges:
        edge_endpoints.add(e["source"])
        edge_endpoints.add(e["target"])

    removed = 0
    for n in nodes:
        if n["id"] in edge_endpoints:
            continue
        labels = n.get("labels") or []
        if "Concept" in labels:
            prefix = "知识库/wiki/concepts/"
        elif "Entity" in labels or "System" in labels:
            prefix = "知识库/wiki/entities/"
        else:
            continue
        # 只考虑图节点自身标注的源文档，同名不能建立删除依据。
        rel = (n.get("properties") or {}).get("file_path") or ""
        if not isinstance(rel, str) or not rel.startswith(prefix):
            continue
        filename = rel[len(prefix):]
        if not filename.endswith(".md") or "/" in filename or "\\" in filename:
            continue
        fp = os.path.join(VAULT_ROOT, rel)
        if os.path.realpath(fp) != os.path.join(os.path.realpath(VAULT_ROOT), rel):
            continue

        # WP-117 批3：占位页内容改信封供给（fmText＋body 逐字节还原原文件）；删除与
        # human_edit_guard 写保护面不在文档读取射程，保持文件系统操作（guard 自读原文）。
        # WP-117 红队 P2-6：坏信封不崩整个校验——本段是可选自动修复（degraded 性质），信封
        # 不可用即打印物化指引并跳过返回；只有主校验路径才 fail-closed 硬退。
        from doc_envelope import DocEnvelopeError, load_doc_envelope as _lde
        try:
            _env = _lde()
        except (DocEnvelopeError, ValueError, OSError) as _envelope_error:
            print(
                "⚠️ 自动修复段跳过：文档信封不可用（"
                f"{_envelope_error}）\n"
                "  物化指引：node scripts/vault-runtime/dump-doc-envelope.mjs --vault <库根>"
                "（vault-runtime 拉起 docEnvelope:true 自动物化）；主校验结果不受影响。"
            )
            return 0
        hit = _env.get_document(rel)
        if hit["state"] != "present":
            continue
        content = hit["value"]["fmText"] + hit["value"]["body"]
        # PR-284：生长模板初始 status 改取词表盖章缺省（灰度）后，「status: 制定中」不再是
        # 占位页指纹——识别改锚模板自带的占位标记句（legacy 制定中模板与新缺省模板同含此句）。
        if "（自动创建的占位页面，待补充内容）" not in content or content.count("\n") >= 25:
            continue
        from human_edit_guard import check_delete, HumanEditConflict

        try:
            check_delete(fp)
        except HumanEditConflict as error:
            print(f"⚠️ 跳过（人改保护）: {rel}——{error}")
            continue
        os.remove(fp)
        print(f"✅ 自动修复: 删除空占位页 {rel}")
        removed += 1

    if removed > 0:
        print(f"✅ 自动修复完成: 清理 {removed} 个空占位页")
    return 0


# ── alignment mode (was align_graph_data.py) ────────────

def run_alignment():
    """对齐 master_graph.json 到 ontology 体系：推断关系类型、补齐 confidence、分离拓扑/wiki 层。"""
    MASTER_PATH = os.path.join(ledger_dir(VAULT_ROOT), "master_graph.json")  # PR-243 批B：单源
    if not os.path.exists(MASTER_PATH):
        print(f"❌ 文件不存在: {MASTER_PATH}")
        return 1

    with open(MASTER_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    nodes = data.get("nodes", [])
    conns = data.get("connections", [])
    node_cat = {n["id"]: n.get("category", "") for n in nodes}

    is_apply = "--apply" in sys.argv
    print(f"📊 输入: {len(nodes)} 节点, {len(conns)} 连接")
    print(f"模式: {'✅ 执行' if is_apply else '🔍 预览 (--dry-run)'}\n")

    # 分类连接
    arch_conns, wiki_conns, other_conns = [], [], []
    for c in conns:
        fc = node_cat.get(c.get("from", ""), "")
        tc = node_cat.get(c.get("to", ""), "")
        if fc in _get_arch_categories() and tc in _get_arch_categories():
            arch_conns.append(c)
        elif fc in _get_arch_categories() or tc in _get_arch_categories():
            wiki_conns.append(c)
        else:
            other_conns.append(c)

    print(f"  架构拓扑关系: {len(arch_conns)}")
    print(f"  Wiki 引用关系: {len(wiki_conns)}")
    print(f"  其他关系: {len(other_conns)}\n")

    # 推断架构拓扑关系
    unchanged = 0
    new_conns = []
    stats = Counter()
    align_ontology = _load_align_ontology()

    for c in arch_conns:
        fc = node_cat.get(c.get("from", ""), "")
        tc = node_cat.get(c.get("to", ""), "")
        old_rt = c.get("relationType", "REFERENCES")
        if old_rt in align_ontology:
            _, conf, reason = _align_validate(align_ontology, old_rt, fc, tc)
            new_c = {**c, "confidence": conf}
            # K-P1-3（2026-09-10 修复）：移除自动批准（conf>=0.8 → approved）。
            # 类型合规不等于内容可信；审批状态必须来自人工裁决账本，不能由脚本推断。
            new_c["reviewStatus"] = "pending"
            if conf < 0.8:
                new_c["reviewReason"] = reason
            new_conns.append(new_c)
            unchanged += 1
            stats[f"保留 {old_rt}"] += 1
        else:
            _, conf, _ = _align_validate(align_ontology, "CONNECTS_TO", fc, tc)
            new_c = {**c, "relationType": "CONNECTS_TO", "confidence": 0.6,
                     "reviewStatus": "pending",
                     "reviewReason": f"原 {old_rt} 需人工确认语义"}
            new_conns.append(new_c)
            stats[f"{old_rt} → CONNECTS_TO (pending)"] += 1

    for c in wiki_conns:
        new_conns.append({**c, "relationType": "LINKS_TO", "confidence": 0.5,
                         "reviewStatus": "pending", "reviewReason": "Wiki 引用层关系（待人工确认）"})
        stats["Wiki → LINKS_TO"] += 1

    for c in other_conns:
        new_conns.append({**c, "relationType": "LINKS_TO", "confidence": 0.5,
                         "reviewStatus": "pending", "reviewReason": "Wiki 内部引用（待人工确认）"})
        stats["Wiki 内部 → LINKS_TO"] += 1

    # 修正节点类别
    fixed_nodes = 0
    for n in nodes:
        if n.get("category") == "其他":
            n["category"] = "概念"
            fixed_nodes += 1

    print("📈 推断结果:")
    for k, v in stats.most_common(20):
        print(f"  {k}: {v}")
    print(f"\n  架构关系保留: {unchanged}")
    print(f"  架构关系→CONNECTS_TO: {len(arch_conns) - unchanged}")
    print(f"  节点类别修正: {fixed_nodes}\n")

    rt_dist = Counter(c.get("relationType", "?") for c in new_conns)
    print("📋 推断后关系类型分布:")
    for k, v in rt_dist.most_common():
        print(f"  {k}: {v}")

    rs_dist = Counter(c.get("reviewStatus", "?") for c in new_conns)
    print(f"\n📋 审核状态分布:")
    for k, v in rs_dist.most_common():
        print(f"  {k}: {v}")

    if is_apply:
        backup_path = MASTER_PATH + ".bak"
        if not os.path.exists(backup_path):
            with open(MASTER_PATH, "r", encoding="utf-8") as f:
                write_text_atomic(backup_path, f.read())
            print(f"\n💾 备份: {backup_path}")
        data["nodes"] = nodes
        data["connections"] = new_conns
        data["alignedAt"] = datetime.now().isoformat()
        data["alignmentVersion"] = "ontology-v1"
        write_text_atomic(MASTER_PATH, json.dumps(data, ensure_ascii=False, indent=2))
        print(f"✅ 已写入: {MASTER_PATH}")
    else:
        print(f"\n💡 使用 --apply 执行写入")
    return 0


def _label_text(node):
    return ",".join(str(label) for label in (node.get("labels") or []))


def check_ontology_compliance(nodes, edges, schema_loader_module):
    """本体合规校验（ADR-014 §5.2.5：坏引用逐边降级，不中断整轮）。

    单条边的端点标签归一失败（已定义但不可归一的坏链/非现役终点）只记该边错误并继续，
    其余边照常校验——不得因一条坏边抛错吞掉整轮结果与校验总结。
    """
    errors = []
    warnings = []
    node_by_id = {n["id"]: n for n in nodes}
    for edge in edges:
        etype = edge.get("type", "")
        src_node = node_by_id.get(edge.get("source"))
        tgt_node = node_by_id.get(edge.get("target"))
        if not src_node or not tgt_node:
            continue
        try:
            src_label = schema_loader_module.infer_node_type_from_labels(src_node.get("labels", []))
            tgt_label = schema_loader_module.infer_node_type_from_labels(tgt_node.get("labels", []))
            valid, warn, err = schema_loader_module.validate_relation(src_label, tgt_label, etype)
        except ValueError as error:
            errors.append((etype, _label_text(src_node), _label_text(tgt_node), f"端点标签归一失败: {error}"))
            continue
        if err:
            errors.append((etype, src_label, tgt_label, warn))
        elif not valid:
            warnings.append((etype, src_label, tgt_label, warn))
    return errors, warnings


def main():
    threshold = WEAK_THRESHOLD
    if "--threshold" in sys.argv:
        idx = sys.argv.index("--threshold")
        if idx + 1 < len(sys.argv):
            threshold = float(sys.argv[idx + 1])

    show_fix = "--fix" in sys.argv
    auto_fix = "--auto-fix" in sys.argv

    if "--mode" in sys.argv:
        idx = sys.argv.index("--mode")
        if idx + 1 < len(sys.argv) and sys.argv[idx + 1] == "alignment":
            return run_alignment()

    if "--architecture-projection" in sys.argv:
        return validate_architecture_projection()

    nodes, edges = load_graph()
    if nodes is None:
        return 1

    if "--structural" in sys.argv:
        node_ids = {node["id"] for node in nodes}
        if len(node_ids) != len(nodes):
            print("❌ 主图有重复节点标识", file=sys.stderr)
            return 1
        dangling = next((edge for edge in edges if edge["source"] not in node_ids or edge["target"] not in node_ids), None)
        if dangling:
            print(f"❌ 主图存在悬空连接: {dangling['source']} → {dangling['target']}", file=sys.stderr)
            return 1

    # Auto-fix mode: only run fixable checks, apply safe fixes silently
    if auto_fix:
        return _auto_fix(nodes, edges)

    print(f"知识图谱关系合理性校验\n"
          f"{'='*50}\n"
          f"节点: {len(nodes)}  边: {len(edges)}  弱边阈值: {threshold}\n")

    # 1. Weight distribution
    analyze_weights(edges)

    # 2. Weak edges
    weak = find_weak_edges(nodes, edges, threshold)

    # 3. Poorly connected nodes
    orphan, weakly = find_poorly_connected(nodes, edges)

    # 4. Cross-domain issues
    cross = find_cross_domain_issues(nodes, edges)

    # 5. Documents without module link
    docs_missing = find_docs_without_module(nodes, edges)

    # 6. Ontology compliance (only with --ontology flag)
    ont_errors = []
    ont_warnings = []
    if "--ontology" in sys.argv or "--structural" in sys.argv:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__)))
        import schema_loader as sl
        ont_errors, ont_warnings = check_ontology_compliance(nodes, edges, sl)
        if ont_errors or ont_warnings:
            print(f"=== 本体合规校验 ===\n")
            if ont_errors:
                print(f"  ❌ 错误 ({len(ont_errors)}):\n")
                for etype, sl, tl, msg in ont_errors[:15]:
                    print(f"    {etype:15s} {sl:12s} → {tl:12s}  {msg}")
            if ont_warnings:
                print(f"  ⚠️  警告 ({len(ont_warnings)}):\n")
                for etype, sl, tl, msg in ont_warnings[:15]:
                    print(f"    {etype:15s} {sl:12s} → {tl:12s}  {msg}")
            print()

    # Summary
    high = len(weak) + len(orphan) + len(cross) + len(ont_errors)
    mid = len(weakly) + len(docs_missing) + len(ont_warnings)
    print(f"{'='*50}")
    print(f"校验总结：高优 {high}  中优 {mid}")
    print(f"  高优: 弱边 {len(weak)} + 孤立 {len(orphan)} + 跨域异常 {len(cross)} + 本体错误 {len(ont_errors)}")
    print(f"  中优: 弱连接 {len(weakly)} + 缺模块链接 {len(docs_missing)} + 本体警告 {len(ont_warnings)}")

    if show_fix:
        print(f"\n=== 修复建议 ===\n")
        if weak:
            print(f"1. 清理 {len(weak)} 条弱边（weight < {threshold}）：")
            print(f"   方案: 在 extract_graph.py 中提高 MENTIONS 关键词匹配最小长度，")
            print(f"   或过滤掉仅出现 1 次的关键词匹配")
        if orphan:
            print(f"2. 处理 {len(orphan)} 个孤立节点：")
            print(f"   方案: 检查是否为占位页面，补充关联信息或归档")
        if docs_missing:
            print(f"3. 补齐 {len(docs_missing)} 个文档的 module 字段：")
            print(f"   方案: 在 frontmatter 中补充 module 映射")

    if "--structural" in sys.argv:
        return int(bool(ont_errors))
    return int((high + mid) > 0)


if __name__ == "__main__":
    sys.exit(main())
