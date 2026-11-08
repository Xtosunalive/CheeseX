#!/usr/bin/env python3
# Component: Merge-Inferred
# @responsible: 合并多个推断源的输出，按优先级裁决冲突，生成最终 frontmatter 建议
# @inputs: 多个推断结果
# @outputs: 合并后的 frontmatter 建议
# @context: A. 知识源上下文 (Vault Context)
# contract: writes merged_edges.json
"""REL-04: 多源推断合并去重 — 三路信号合并，去重 + 冲突检测 + 优先级裁决。

用法:
  python3 merge-inferred.py --body body_edges.json --wiki wiki_edges.json --config config_edges.json --output merged_edges.json
  python3 merge-inferred.py --body /tmp/body.json --wiki /tmp/wiki.json --output /tmp/merged.json
"""

from __future__ import annotations
# W2 迁仓闭包（SPEC-025 C1/C12）：kb_paths/schema_loader 解析自仓内 vault-runtime（A 类事实源）；同族脚本同目录。
import sys as _sys
from pathlib import Path as _Path
_HERE = _Path(__file__).resolve().parent
for _dep in (_HERE, _HERE.parents[1] / "vault-runtime"):
    _s = str(_dep)
    if _s not in _sys.path:
        _sys.path.insert(0, _s)

import argparse
import json
import os
import sys
from datetime import datetime, timezone

LOG_PREFIX = "[Merge]"

# D-28 优先级：entity_wikilink(1.0) > deps_yaml(0.7) > body_match(0.7) > system_components(0.6) >
#             wiki_wikilink(0.5) > alias_match(0.5) > enums(0.4) > module_group(0.3)
METHOD_PRIORITY = {
    "entity_wikilink": 10,
    "deps_yaml": 9,
    "body_match": 8,
    "system_components": 7,
    "wiki_wikilink": 6,
    "alias_match": 5,
    "module_wikilink": 4,
    "enums_yaml": 3,
    "module_group": 2,
}


def _best_method(edges: list[dict]) -> str | None:
    best = None
    best_prio = -1
    for e in edges:
        for s in e.get("properties", {}).get("sources", []):
            m = s.get("method", "")
            prio = METHOD_PRIORITY.get(m, 0)
            if prio > best_prio:
                best_prio = prio
                best = m
    return best


def _load_edges(filepath: str | None, label: str) -> list[dict]:
    if not filepath or not os.path.isfile(filepath):
        print(f"  {LOG_PREFIX} {label}: 文件不存在 → 空数组", file=sys.stderr)
        return []
    try:
        with open(filepath, encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            print(f"  {LOG_PREFIX} {label}: {len(data)} edges")
            return data
        print(f"  {LOG_PREFIX} WARNING: {label} 格式异常(非数组)，跳过", file=sys.stderr)
        return []
    except Exception as e:
        print(f"  {LOG_PREFIX} WARNING: {label} 读取失败: {e}，跳过", file=sys.stderr)
        return []


def merge(body_edges: list[dict], wiki_edges: list[dict], config_edges: list[dict]) -> list[dict]:
    all_edges = body_edges + wiki_edges + config_edges

    groups: dict[tuple[str, str], list[dict]] = {}
    for e in all_edges:
        key = (e.get("source", ""), e.get("target", ""))
        if not key[0] or not key[1]:
            continue
        groups.setdefault(key, []).append(e)

    merged: list[dict] = []
    conflicts = 0

    for (src, tgt), group in groups.items():
        all_sources = []
        types = set()
        # C8/R5（SPEC-027）：缺省不伪造 0.0——仅当至少一个来源真的给了置信度才携带该键（保 missing 语义）
        has_conf = any("confidence" in e and e["confidence"] is not None for e in group)
        max_conf = 0.0

        for e in group:
            types.add(e.get("type", "REFERENCES"))
            c = e.get("confidence")
            if c is not None and c > max_conf:
                max_conf = c
            for s in e.get("properties", {}).get("sources", []):
                all_sources.append(s)

        if len(types) == 1:
            final_type = next(iter(types))
            final_conf = max_conf
            needs_review = False
        else:
            # D-29: 冲突 — 优先级高者胜出，置信度×0.8
            best_edge = None
            best_prio = -1
            for e in group:
                for s in e.get("properties", {}).get("sources", []):
                    prio = METHOD_PRIORITY.get(s.get("method", ""), 0)
                    if prio > best_prio:
                        best_prio = prio
                        best_edge = e
            final_type = best_edge.get("type", "REFERENCES") if best_edge else "REFERENCES"
            final_conf = round(max_conf * 0.8, 2)
            needs_review = True
            conflicts += 1
            print(f"  {LOG_PREFIX} CONFLICT: ({src} → {tgt}) types={types}, "
                  f"winner={final_type}, conf={max_conf}→{final_conf}", file=sys.stderr)

        merged.append({
            "source": src,
            "target": tgt,
            "type": final_type,
            **({"confidence": final_conf} if has_conf else {}),
            "properties": {
                "sources": all_sources,
                "needs_manual_review": needs_review,
            },
        })

    if conflicts:
        print(f"  {LOG_PREFIX} {conflicts} 冲突需要人工审核", file=sys.stderr)
    return merged


def _trajectory_dir():
    """轨迹落点（runtime-scope 域登记解析器，V01 修复）：PIPELINE_TRAJECTORIES_DIR ＞
    ARCH_REPO/data/governance（起链必传——python-bridge 白名单注入服务所在仓）；两者皆缺席即
    RuntimeError（写路径不允许按脚本位置猜）。外层 _append_trajectory 的 fail-open 包装不变（D5：轨迹失败不阻断主链路）。"""
    _override = os.environ.get("PIPELINE_TRAJECTORIES_DIR")
    if _override:
        return _Path(_override)
    _arch = os.environ.get("ARCH_REPO")
    if _arch:
        return _Path(_arch) / "data" / "governance"
    raise RuntimeError(
        "轨迹目录未解析：export PIPELINE_TRAJECTORIES_DIR 或 ARCH_REPO"
        "（runtime-scope 规则 no_implicit_fallback_on_write——不再按 __file__ 位置猜仓根）"
    )


def _append_trajectory(inputs, merged):
    """D5（SPEC-025 C5）裁定轨迹——三源推断合并是关系裁定的汇总点：输入三源计数＋词表版本锚＋输出边数/方法分布。
    append-only 落 data/governance/pipeline-trajectories.jsonl；失败不阻断主链路。"""
    import hashlib as _h
    try:
        # WP-049 L3：词表版本锚＝信封指纹（sha256 收据，与旧「哈希词表文件」等值同源）
        try:
            from vocab_envelope import load_envelope as _load_vocab_envelope
            _vocab = (_load_vocab_envelope().fingerprint("enums") or "missing")[:16]
        except Exception:
            _vocab = "missing"
        methods = {}
        for e in merged:
            m = (e.get("method") or e.get("inference_method") or "unknown") if isinstance(e, dict) else "unknown"
            methods[m] = methods.get(m, 0) + 1
        # 波5：写原语收口 write_gateway（append_line）——本文件自此零写原语（⑤面 allow 摘除示范）
        from write_gateway import append_line as _append_line
        _append_line(_trajectory_dir() / "pipeline-trajectories.jsonl",
                     json.dumps({"ts": datetime.now(timezone.utc).isoformat(), "tool": "merge-inferred.py", "action": "merge",
                                 "vocab_sha16": _vocab, "inputs": inputs, "outputs": {"edges": len(merged), "methods": methods}},
                                ensure_ascii=False) + "\n")
    except Exception as _e:
        print(f"{LOG_PREFIX} ⚠️ 轨迹写入失败（不阻断）: {_e}", file=sys.stderr)


def main():
    p = argparse.ArgumentParser(description="REL-04: 多源推断合并去重")
    p.add_argument("--body", default="", help="body_edges.json 路径")
    p.add_argument("--wiki", default="", help="wiki_edges.json 路径")
    p.add_argument("--config", default="", help="config_edges.json 路径")
    p.add_argument("--output", required=True, help="merged_edges.json 输出路径（'-' 表示 stdout pipe）")
    p.add_argument("--stdout", action="store_true", help="同时输出到 stdout（pipe 模式）")
    args = p.parse_args()

    print(f"{LOG_PREFIX} 加载三源推断结果 ...", file=sys.stderr)

    body = _load_edges(args.body or None, "body")
    wiki = _load_edges(args.wiki or None, "wiki")
    config = _load_edges(args.config or None, "config")

    merged = merge(body, wiki, config)
    _append_trajectory({"body": len(body), "wiki": len(wiki), "config": len(config)}, merged)
    merged_json = json.dumps(merged, indent=2, ensure_ascii=False)
    print(f"{LOG_PREFIX} 合并: {len(body)}+{len(wiki)}+{len(config)} → {len(merged)} 条唯一边", file=sys.stderr)

    # Pipe mode: output to stdout (captured by pipeline-runner)
    if args.stdout or args.output == "-":
        sys.stdout.write(merged_json)
        sys.stdout.flush()
        if args.output == "-":
            return

    # 波5：产物整文件原子写经 write_gateway——本文件零写原语
    from write_gateway import write_text_atomic
    write_text_atomic(args.output, merged_json)

    print(f"{LOG_PREFIX} → {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
