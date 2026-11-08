#!/usr/bin/env python3
# Component: Dashboard-Data-Generator
# @responsible: 扫描项目文件系统 + git 状态 + Python import 依赖 + Obsidian 插件信息，生成 `dashboard_data.json` 供 Project-Dashboard 消费
# @inputs: Vault 文件系统、git 历史、CLAUDE.md、插件 manifest、Python 脚本
# @outputs: `dashboard_data.json`
# @context: A. 知识源上下文 (Vault Context)
# contract: writes dashboard_data.json
"""从 master_graph.json 生成看板拓扑数据（dashboard_data.json）。

用法:
  python3 generate_dashboard_data.py
  python3 generate_dashboard_data.py --output /path/to/dashboard_data.json
"""

# W2 迁仓闭包（SPEC-025 C1/C12）：kb_paths/schema_loader 解析自仓内 vault-runtime（A 类事实源）；同族脚本同目录。
# PR-132：write_gateway 同住 vault-runtime——自举必须先于导入（65aee107 曾把导入插在自举前＝必炸）
import sys as _sys
from pathlib import Path as _Path
_HERE = _Path(__file__).resolve().parent
for _dep in (_HERE, _HERE.parents[1] / "vault-runtime"):
    _s = str(_dep)
    if _s not in _sys.path:
        _sys.path.insert(0, _s)
from write_gateway import write_text_atomic, append_line, write_bytes_atomic
import json
import os
import sys
from collections import defaultdict

from kb_paths import vault_roots


def resolve_master_path():
    explicit = (os.environ.get("MASTER_GRAPH_PATH") or "").strip()
    if explicit:
        return os.path.expanduser(explicit)
    vault_root, _ = vault_roots()
    return os.path.join(vault_root, ".ledger", "master_graph.json")


CATEGORY_COLORS = {
    "终端": "#94a3b8", "服务": "#06b6d4", "存储": "#d97706", "基础设施": "#6366f1",
    "安全": "#f43f5e", "板块": "#f97316", "概念": "#a78bfa", "产品": "#22c55e",
    "版本": "#eab308", "域": "#8b5cf6", "文档": "#ec4899",
}


def graph_topology_summary(data):
    nodes = data.get("nodes", [])
    conns = data.get("connections", data.get("edges", []))

    node_index = {n["id"]: n for n in nodes}
    degrees = defaultdict(int)
    for c in conns:
        src, tgt = c.get("from", ""), c.get("to", "")
        if src:
            degrees[src] += 1
        if tgt:
            degrees[tgt] += 1

    cat_counts = defaultdict(int)
    for n in nodes:
        cat_counts[n.get("category", "其他")] += 1

    edge_type_counts = defaultdict(int)
    for c in conns:
        edge_type_counts[c.get("relationType", "CONNECTS_TO")] += 1

    hub_nodes = sorted(
        [{"id": n["id"], "label": n.get("label", ""), "category": n.get("category", ""),
          "degree": degrees.get(n["id"], 0)} for n in nodes],
        key=lambda x: x["degree"], reverse=True,
    )[:15]

    # 轻量拓扑（≤300 边，取 weight 最高的边）
    top_edges = sorted(conns, key=lambda c: c.get("confidence", 0.5), reverse=True)[:300]
    edge_ids = set()
    topo_edges = []
    topo_node_ids = set()
    for c in top_edges:
        eid = f"{c.get('from','')}-{c.get('to','')}-{c.get('relationType','')}"
        if eid in edge_ids:
            continue
        edge_ids.add(eid)
        topo_edges.append({
            "source": c.get("from", ""),
            "target": c.get("to", ""),
            "type": c.get("relationType", "CONNECTS_TO"),
        })
        topo_node_ids.add(c.get("from", ""))
        topo_node_ids.add(c.get("to", ""))

    topo_nodes = []
    for nid in topo_node_ids:
        if nid not in node_index:
            continue
        n = node_index[nid]
        topo_nodes.append({
            "id": n["id"],
            "label": n.get("label", ""),
            "category": n.get("category", "其他"),
            "degree": degrees.get(n["id"], 0),
        })

    return {
        "node_count": len(nodes),
        "edge_count": len(conns),
        "category_counts": dict(sorted(cat_counts.items())),
        "edge_type_counts": dict(sorted(edge_type_counts.items())),
        "hub_top15": hub_nodes,
        "topology": {"nodes": topo_nodes, "edges": topo_edges},
    }


def main():
    master_path = resolve_master_path()
    if not os.path.exists(master_path):
        print(f"[dashboard-data] master_graph.json 不存在: {master_path}", file=sys.stderr)
        sys.exit(1)

    with open(master_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    summary = graph_topology_summary(data)

    output = sys.argv[2] if len(sys.argv) > 2 and sys.argv[1] == "--output" else os.path.join(
        os.path.dirname(master_path), "dashboard_data.json"
    )
    os.makedirs(os.path.dirname(output), exist_ok=True)
    write_text_atomic(output, json.dumps(summary, ensure_ascii=False, indent=2))

    print(f"[dashboard-data] 写入 {output} — 节点={summary['node_count']} 边={summary['edge_count']} "
          f"拓扑节点={len(summary['topology']['nodes'])} 拓扑边={len(summary['topology']['edges'])} hub={len(summary['hub_top15'])}")


if __name__ == "__main__":
    main()
