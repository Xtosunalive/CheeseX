#!/usr/bin/env python3
# @component: 图谱抽取质量评分器（WP-097 / PR-234）——纯比较器，不跑管线不碰 vault
# @inputs: --graph <master_graph.json 路径> --truth <truth.json 路径> [--omit-edge "from|to|type"] [--json]
# @outputs: stdout（人读摘要或 --json 全量）；退出码 0=跑通（评分高低不是失败）1=输入错误
# @context: 测量仪非门禁（playbook 数据域执法定位）——只测不拦；真值清单见 truth.json _meta（draft 待 Master 签收）
#   节点匹配键＝id；边匹配键＝(from, to, relationType) 三元组。P=precision（抽出的对了多少）R=recall（应抽的抽到多少）F1=调和平均。
import argparse
import json
import sys


def metrics(expected: set, actual: set):
    tp = len(expected & actual)
    fp = len(actual - expected)
    fn = len(expected - actual)
    p = tp / (tp + fp) if (tp + fp) else None
    r = tp / (tp + fn) if (tp + fn) else None
    f1 = (2 * p * r / (p + r)) if (p is not None and r is not None and p + r) else None
    return {"tp": tp, "fp": fp, "fn": fn,
            "precision": round(p, 4) if p is not None else None,
            "recall": round(r, 4) if r is not None else None,
            "f1": round(f1, 4) if f1 is not None else None}


def main() -> int:
    parser = argparse.ArgumentParser(description="图谱抽取质量评分器（测量仪）")
    parser.add_argument("--graph", required=True, help="master_graph.json 路径")
    parser.add_argument("--truth", required=True, help="truth.json 路径")
    parser.add_argument("--omit-edge", dest="omit_edge", default=None,
                        help='消融用：从真值侧剔除一条边 "from|to|relationType"（验收判据能红）')
    parser.add_argument("--json", dest="as_json", action="store_true", help="输出机器可读 JSON")
    args = parser.parse_args()

    try:
        graph = json.load(open(args.graph, encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        print(f"graph_eval: 图产物不可读（{args.graph}）：{error}", file=sys.stderr)
        return 1
    try:
        truth = json.load(open(args.truth, encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        print(f"graph_eval: 真值清单不可读（{args.truth}）：{error}", file=sys.stderr)
        return 1

    truth_edges = truth.get("edges") or []
    if args.omit_edge:
        parts = tuple(args.omit_edge.split("|"))
        if len(parts) != 3:
            print("graph_eval: --omit-edge 须为 from|to|relationType 三段", file=sys.stderr)
            return 1
        before = len(truth_edges)
        truth_edges = [e for e in truth_edges if (e.get("from"), e.get("to"), e.get("relationType")) != parts]
        if len(truth_edges) == before:
            print(f"graph_eval: --omit-edge 未命中真值边：{args.omit_edge}", file=sys.stderr)
            return 1

    actual_nodes = {str(n.get("id")) for n in (graph.get("nodes") or []) if n.get("id") is not None}
    actual_edges = {(str(c.get("from")), str(c.get("to")), str(c.get("relationType")))
                    for c in (graph.get("connections") or []) if c.get("from") and c.get("to")}
    # 逐条判定档位明细层（Q1 裁决并入：方案评估卡-判卷明细与引文证据-2026-11-04.md）
    # 档位沿用 precision/recall 族标准含义，不自造新词：
    #   hit               真值三元组被原样抽出（＝真阳性；同一真值集下 hit 数＝TP，与 P/R 口径一致）
    #   type_mismatch     端点对被抽出但关系类型不符
    #   endpoint_mismatch 同源同类型出边存在但目标端漂移
    #   missing           以上皆无（漏抽）
    pair_types = {}
    source_type_targets = {}
    for c in (graph.get("connections") or []):
        if not (c.get("from") and c.get("to")):
            continue
        f, t, rt = str(c.get("from")), str(c.get("to")), str(c.get("relationType"))
        pair_types.setdefault((f, t), set()).add(rt)
        source_type_targets.setdefault((f, rt), set()).add(t)
    expected_nodes = {str(n["id"]) for n in truth.get("nodes") or [] if n.get("id")}
    expected_edges = {(str(e["from"]), str(e["to"]), str(e["relationType"]))
                      for e in truth_edges if e.get("from") and e.get("to")}

    verdicts = []
    verdict_counts = {"hit": 0, "type_mismatch": 0, "endpoint_mismatch": 0, "missing": 0}
    for e in truth_edges:
        f, t, rt = str(e.get("from")), str(e.get("to")), str(e.get("relationType"))
        pair_found = pair_types.get((f, t), set())
        same_source_targets = source_type_targets.get((f, rt), set())
        if rt in pair_found:
            v = "hit"
        elif pair_found:
            v = "type_mismatch"
        elif same_source_targets:
            v = "endpoint_mismatch"
        else:
            v = "missing"
        verdict_counts[v] += 1
        verdicts.append({
            "from": f, "to": t, "relationType": rt, "verdict": v,
            "found": sorted(pair_found) if pair_found else (sorted(same_source_targets) if v == "endpoint_mismatch" else []),
        })

    node_metrics = metrics(expected_nodes, actual_nodes)
    edge_metrics = metrics(expected_edges, actual_edges)

    missing_nodes = sorted(expected_nodes - actual_nodes)
    extra_nodes = sorted(actual_nodes - expected_nodes)
    missing_edges = sorted(expected_edges - actual_edges)
    extra_edges = sorted(actual_edges - expected_edges)

    result = {
        "graph": args.graph,
        "truth": args.truth,
        "truth_status": (truth.get("_meta") or {}).get("status"),
        "omitted_edge": args.omit_edge,
        "nodes": node_metrics,
        "edges": edge_metrics,
        "missing_nodes": missing_nodes,
        "extra_nodes": extra_nodes,
        "missing_edges": ["|".join(e) for e in missing_edges],
        "extra_edges": ["|".join(e) for e in extra_edges],
        "edge_verdicts": verdict_counts,
        "verdicts": verdicts,
    }

    if args.as_json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(f"节点  P={node_metrics['precision']} R={node_metrics['recall']} F1={node_metrics['f1']}"
              f"（tp={node_metrics['tp']} fp={node_metrics['fp']} fn={node_metrics['fn']}）")
        print(f"关系  P={edge_metrics['precision']} R={edge_metrics['recall']} F1={edge_metrics['f1']}"
              f"（tp={edge_metrics['tp']} fp={edge_metrics['fp']} fn={edge_metrics['fn']}）")
        vc = result["edge_verdicts"]
        print(f"档位  hit={vc['hit']} type_mismatch={vc['type_mismatch']} "
              f"endpoint_mismatch={vc['endpoint_mismatch']} missing={vc['missing']}"
              f"（合计={sum(vc.values())}＝真值边数；hit＝真阳数，与 P/R 口径一致）")
        for label, items in (("缺节点", missing_nodes), ("多节点", extra_nodes),
                             ("缺关系", result["missing_edges"]), ("多关系", result["extra_edges"])):
            if items:
                print(f"{label} {len(items)}：{'；'.join(items[:8])}{'…' if len(items) > 8 else ''}")
        if result.get("truth_status"):
            print(f"真值状态：{result['truth_status']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
