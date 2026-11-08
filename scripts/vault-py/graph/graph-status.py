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
# Component: Graph-Status
# @responsible: 统计图谱节点数、连接数、待审核数，写入 `graph-status.md` 供 Obsidian 仪表盘渲染
# @inputs: `master_graph.json`
# @outputs: `wiki/graph-status.md`
# @context: B. 逻辑中枢上下文 (Pipeline Context)
# contract: writes graph-status.md
# contract: reads master_graph.json, semantic_architecture.json
"""
图数据库状态仪表盘生成器
读取 master_graph.json + semantic_architecture.json，生成 Obsidian 可读的 graph-status.md。

用法:
  python3 graph-status.py                      # 打印摘要到 stdout
  python3 graph-status.py --write              # 写入 知识库/wiki/graph-status.md
  python3 graph-status.py --json               # JSON 输出（供其他脚本消费）
"""

import json
import os
import sys
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone

# W1 迁仓闭包（SPEC-025 C1/C12）：kb_paths 解析自仓内 vault-runtime（A 类事实源）——graph/ 同款引导；
# PR-132：与头部自举重复（同插 scripts/vault-runtime）且原内联 __file__.resolve().parents[1] 差一层——头部已覆盖，此块退役
from kb_paths import vault_roots, normalize_vault_cli, staging_path

VAULT_ROOT, KNOWLEDGE = vault_roots()
# SPEC-012 wave-2 漏改点收口：主图真身已迁 repo 侧 data/staging（旧 .ledger 位自 wave-2 起无写者）
MASTER_JSON = staging_path("master_graph.json")
SA_JSON = staging_path("sa/semantic_architecture.json")  # PR-082：SA 派生通用槽（无产品段）
STATUS_MD = os.path.join(KNOWLEDGE, "wiki", "graph-status.md")

# ── 与 enums 的对齐（硬编码引用，避免循环依赖） ──
ARCH_LAYERS_ORDER = [
    "cloud-native", "foundation", "data-lake", "gateway",
    "application", "crosscutting", "intelligence", "external", "open",
]

LAYER_LABELS = {
    "cloud-native": "云原生层",
    "foundation": "基础层",
    "data-lake": "数据湖层",
    "gateway": "网关层",
    "application": "应用层",
    "crosscutting": "横切层",
    "intelligence": "智能层",
    "external": "外部依赖",
    "open": "开放层",
}


def load_graph():
    with open(MASTER_JSON) as f:
        return json.load(f)


def load_sa():
    if os.path.exists(SA_JSON):
        with open(SA_JSON) as f:
            return json.load(f)
    return None


def compute_stats(graph, sa):
    nodes = graph.get("nodes", [])
    connections = graph.get("connections", [])

    # 节点分类
    node_categories = Counter(n.get("category", "其他") for n in nodes)
    node_count = len(nodes)
    edge_count = len(connections)

    # 边类型分布
    edge_types = Counter(
        c.get("relationType", c.get("type", "UNKNOWN")) for c in connections
    )

    # 审核状态
    review_status = Counter(c.get("reviewStatus", "unreviewed") for c in connections)

    # 孤立节点 (入度+出度=0)
    degree = Counter()
    for c in connections:
        degree[c["from"]] += 1
        degree[c["to"]] += 1
    orphan_nodes = [n["id"] for n in nodes if degree[n["id"]] == 0]

    # 版本节点统计
    version_nodes = [n for n in nodes if n.get("category") == "版本"]
    version_ids = {n["id"] for n in version_nodes}

    # SA 统计
    sa_stats = {}
    if sa:
        sa_stats["components"] = len(sa.get("components", []))
        sa_stats["dependencies"] = len(sa.get("dependencies", []))
        sa_stats["layers"] = len(sa.get("layers", []))
        sa_stats["crosscutting"] = len(sa.get("crosscutting", []))
        sa_stats["product"] = sa.get("product", "?")
        sa_stats["updated_at"] = sa.get("updatedAt", "?")

    # 文件时间
    mtime = datetime.fromtimestamp(os.path.getmtime(MASTER_JSON), tz=timezone.utc)

    return {
        "node_count": node_count,
        "edge_count": edge_count,
        "node_categories": dict(node_categories.most_common()),
        "edge_types": dict(edge_types.most_common(15)),
        "review_status": dict(review_status),
        "orphan_nodes": orphan_nodes,
        "orphan_count": len(orphan_nodes),
        "version_node_count": len(version_nodes),
        "degree_distribution": dict(Counter(degree.values()).most_common(10)),
        "sa_stats": sa_stats,
        "last_extraction": mtime.strftime("%Y-%m-%d %H:%M UTC"),
        "last_extraction_iso": mtime.isoformat(),
    }


def build_markdown(stats):
    """生成 graph-status.md 内容。"""
    s = stats
    sa = s.get("sa_stats", {})

    lines = [
        "---",
        "title: 图数据库状态",
        "date: " + datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "tags:",
        "  - 仪表盘",
        "  - 图谱",
        "  - 自动生成",
        "status: 有效",
        "category-path: meta:doc",
        "review-cycle: 7d",
        "updated: " + datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "---",
        "",
        f"> 自动生成于 {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}，每次 `extract_graph --apply` 后刷新。",
        "",
        "## 总览",
        "",
        f"| 指标 | 值 |",
        f"|------|-----|",
        f"| 全图节点 | **{s['node_count']}** |",
        f"| 全图边 | **{s['edge_count']}** |",
        f"| 孤立节点 | **{s['orphan_count']}** |",
        f"| 版本节点 | **{s['version_node_count']}** |",
        f"| 上次抽取 | {s['last_extraction']} |",
    ]

    if sa:
        lines += [
            f"| 架构组件 (SA) | **{sa.get('components', '?')}** |",
            f"| 架构依赖 (SA) | **{sa.get('dependencies', '?')}** |",
            f"| 架构层 (SA) | **{sa.get('layers', '?')}** |",
        ]

    # 节点分类
    lines += [
        "",
        "## 节点分类",
        "",
        "| 类别 | 数量 |",
        "|------|------|",
    ]
    for cat, count in s["node_categories"].items():
        lines.append(f"| {cat} | {count} |")

    # 边类型
    lines += [
        "",
        "## 边类型分布",
        "",
        "| 类型 | 数量 |",
        "|------|------|",
    ]
    for etype, count in s["edge_types"].items():
        lines.append(f"| {etype} | {count} |")

    # 审核状态
    lines += [
        "",
        "## 审核状态",
        "",
        "| 状态 | 数量 |",
        "|------|------|",
    ]
    for status, count in s["review_status"].items():
        lines.append(f"| {status} | {count} |")
    pending = sum(v for k, v in s["review_status"].items() if k not in ("approved", "rejected"))
    if pending > 0:
        lines.append(f"| **待审核合计** | **{pending}** |")

    # 孤立节点
    if s["orphan_nodes"]:
        lines += [
            "",
            f"## 孤立节点 ({s['orphan_count']} 个，入度+出度=0)",
            "",
        ]
        for nid in s["orphan_nodes"][:30]:
            lines.append(f"- `{nid}`")
        if s["orphan_count"] > 30:
            lines.append(f"- ... 及其他 {s['orphan_count'] - 30} 个")

    # 健康度指标
    orphan_pct = round(s["orphan_count"] / s["node_count"] * 100, 1) if s["node_count"] else 0
    pending_pct = round(pending / s["edge_count"] * 100, 1) if s["edge_count"] else 0

    lines += [
        "",
        "## 健康度指标",
        "",
        f"| 指标 | 当前值 | 阈值 | 状态 |",
        f"|------|--------|------|------|",
        f"| 孤立节点率 | {orphan_pct}% | < 10% | {'✅' if orphan_pct < 10 else '⚠️'} |",
        f"| 待审核边率 | {pending_pct}% | < 5% | {'✅' if pending_pct < 5 else '⚠️'} |",
        f"| 架构组件数 | {sa.get('components', '?')} | ≥ 30 | {'✅' if sa.get('components', 0) >= 30 else '⚠️'} |",
    ]

    # 行动项
    lines += [
        "",
        "## 行动项",
        "",
    ]
    if orphan_pct >= 10:
        lines.append(f"- [ ] 清理孤立节点（当前 {s['orphan_count']} 个）")
    if pending_pct >= 5:
        lines.append(f"- [ ] 审核待确认边（当前 {pending} 条）")
    if s["orphan_count"] > 0:
        lines.append(f"- [ ] 检查孤立节点是否需要补充关联")
    if not sa:
        lines.append("- [ ] 生成 `semantic_architecture.json`（运行 `extract_graph --apply`）")
    if not any([orphan_pct >= 10, pending_pct >= 5, s["orphan_count"] > 0]):
        lines.append("- 暂无紧急行动项 ✅")

    return "\n".join(lines)


def main():
    global MASTER_JSON, SA_JSON, STATUS_MD
    parser = argparse.ArgumentParser(description="图数据库状态仪表盘")
    parser.add_argument("--write", action="store_true", help="写入 graph-status.md")
    parser.add_argument("--json", action="store_true", help="JSON 输出")
    parser.add_argument("--vault", default="", help="Obsidian 仓库根；可传 …/知识库。默认 KB_VAULT")
    args = parser.parse_args()

    vr, kb = normalize_vault_cli(args.vault) if args.vault.strip() else (VAULT_ROOT, KNOWLEDGE)
    MASTER_JSON = staging_path("master_graph.json")
    SA_JSON = staging_path("sa/semantic_architecture.json")  # --vault 分支同槽（staging 落点单源，不随 vault 参数漂移）
    STATUS_MD = os.path.join(kb, "wiki", "graph-status.md")

    graph = load_graph()
    sa = load_sa()
    stats = compute_stats(graph, sa)

    if args.json:
        print(json.dumps(stats, ensure_ascii=False, indent=2))
    elif args.write:
        md = build_markdown(stats)
        write_text_atomic(STATUS_MD, md)
        print(f"✅ 已写入 {STATUS_MD}")
        print(f"   节点: {stats['node_count']}  边: {stats['edge_count']}  孤立: {stats['orphan_count']}")
    else:
        # Print summary
        s = stats
        print(f"═" * 45)
        print(f"图数据库状态 — {s['last_extraction']}")
        print(f"═" * 45)
        print(f"节点: {s['node_count']}  边: {s['edge_count']}")
        print(f"孤立节点: {s['orphan_count']}  版本节点: {s['version_node_count']}")
        print(f"分类: {dict(s['node_categories'])}")
        print(f"边类型: {dict(s['edge_types'])}")
        print(f"审核: {dict(s['review_status'])}")
        if s['sa_stats']:
            print(f"SA: {s['sa_stats']['components']} 组件, {s['sa_stats']['dependencies']} 依赖")
        print()
        print("使用 --write 写入 graph-status.md  |  --json 输出 JSON")


if __name__ == "__main__":
    main()
