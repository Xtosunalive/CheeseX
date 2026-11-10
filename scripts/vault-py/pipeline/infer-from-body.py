#!/usr/bin/env python3
# Component: Infer-From-Body
# @responsible: 从文档正文内容推断 product / module / article_type 等业务元数据
# @inputs: 标准化文档 .md
# @outputs: 推断结果（供 Merge-Inferred 汇总）
# @context: A. 知识源上下文 (Vault Context)
"""REL-01: Entity 正文依赖提取 — 扫描 entity 正文段落，匹配组件名/别名。

用法:
  python3 infer-from-body.py --mode full --output body_edges.json
  python3 infer-from-body.py --mode quick --files entity1.md entity2.md --output body_edges.json
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
import os
import re
import sys
from datetime import datetime, timezone

from schema_loader import architecture_projection, products

from schema import (
    INTERMEDIATES_DIR, METHODS, InferredEdge, Source,
    edges_to_json, load_entity_names, load_aliases,
)

LOG_PREFIX = "[Infer:body]"
BLACKLIST = {"客户端", "主模块", "访问控制"}
CONTEXT_KEYWORDS = {"ECMS", "OSS"}

VAULT_ROOT = os.environ.get("KB_VAULT") or os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))  # W3 迁仓：env 优先（kb_paths 同源纪律），__file__ 上溯兜底
ENTITY_DIR = os.path.join(VAULT_ROOT, "知识库", "wiki", "entities")

# WP-117 批3（SPEC-084 §二.3）：文档供给收进信封——零回落（缺失/版本/形态异常即退，
# 报错附物化指引；doc-envelope-materializer writeDocEnvelope 或 e2e/dump 工具物化）。
from doc_envelope import DocEnvelopeError, load_doc_envelope as _load_doc_envelope

try:
    _DOC_ENV = _load_doc_envelope()
except (DocEnvelopeError, ValueError, OSError) as _e:
    print(f"{LOG_PREFIX} ERROR: 文档信封不可用（{_e}）——物化指引："
          "server/shared/doc-envelope-materializer.cjs writeDocEnvelope，或 e2e/dump-doc-envelope.mjs",
          file=sys.stderr)
    sys.exit(1)


def _doc_full_text(rel: str):
    """信封取文档全文（fmText＋body 逐字节还原原文件文本——G1 等价抽查钉）。
    absent → None（调用方按原「文件不存在」分支处理）。"""
    hit = _DOC_ENV.get_document(rel)
    if hit["state"] != "present":
        return None
    doc = hit["value"]
    return doc["fmText"] + doc["body"]


def scan_entities(entity_files: list[str], mode: str) -> list[InferredEdge]:
    entity_names = load_entity_names()
    aliases = load_aliases()
    product_aliases = architecture_projection().get("product_aliases") or {}
    context_keywords = CONTEXT_KEYWORDS | products() | set(product_aliases) | set(product_aliases.values())
    all_names = set(entity_names.keys()) | set(aliases.keys())

    edges: list[InferredEdge] = []
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    for rel in entity_files:
        # WP-117 批3：entity_files＝信封内知识库相对路径（POSIX）；全文＝fm_text＋body
        #（逐字节还原原文件——G1 等价抽查钉），正则语义与原 f.read() 全文扫描逐字一致。
        text = _doc_full_text(rel)
        if text is None:
            print(f"  {LOG_PREFIX} WARNING: 文件不在信封内: {rel}", file=sys.stderr)
            continue
        body = text

        entity_name = _extract_entity_name(rel)
        vrel = rel

        # Step 1: 显式 wikilink — confidence=1.0, DEPENDS_ON 或 REFERENCES
        for m in re.finditer(r'^(?:-\s+)?(\S+)::\[\[([^\]]+)\]\]', body, re.MULTILINE):
            link_type_raw = m.group(1)
            target_name = m.group(2)
            if target_name not in all_names:
                continue
            canonical = aliases.get(target_name, target_name)
            rel_type = "DEPENDS_ON" if link_type_raw in ("依赖", "depends_on", "DEPENDS_ON") else "REFERENCES"
            section = _containing_section(body, m.start())
            edges.append(InferredEdge(
                source=entity_name, target=canonical, type=rel_type, confidence=1.0,
                properties={"sources": [Source(
                    file=vrel, method="entity_wikilink", timestamp=ts,
                    section=section, confidence=1.0,
                )]},
            ))

        # Step 2: 正文名称匹配 — confidence=0.7 — only ## 概述 / ## 关联实体
        for section_name in ("概述", "关联实体"):
            section_text = _extract_section(body, section_name)
            if not section_text:
                continue
            for name in sorted(entity_names.keys(), key=len, reverse=True):
                if name == entity_name:
                    continue
                if name not in section_text:
                    continue
                if _is_blacklisted(name, section_text, context_keywords):
                    continue
                edges.append(InferredEdge(
                    source=entity_name, target=name, type="REFERENCES", confidence=0.7,
                    properties={"sources": [Source(
                        file=vrel, method="body_match", timestamp=ts,
                        section=section_name, confidence=0.7,
                    )]},
                ))

        # Step 3: 别名匹配 — confidence=0.5
        for alias, canonical in aliases.items():
            if canonical == entity_name:
                continue
            for section_name in ("概述", "关联实体"):
                section_text = _extract_section(body, section_name)
                if section_text and alias in section_text and canonical not in section_text:
                    edges.append(InferredEdge(
                        source=entity_name, target=canonical, type="REFERENCES", confidence=0.5,
                        properties={"sources": [Source(
                            file=vrel, method="alias_match", timestamp=ts,
                            section=section_name, confidence=0.5,
                        )]},
                    ))

    return _deduplicate(edges)


def _extract_entity_name(fpath: str) -> str:
    stem = os.path.splitext(os.path.basename(fpath))[0]
    return re.sub(r"^\d{2,4}-", "", stem).strip()


def _extract_section(body: str, heading: str) -> str | None:
    m = re.search(rf'^##\s*{re.escape(heading)}\s*\n(.*?)(?=\n##\s|\Z)', body, re.DOTALL | re.MULTILINE)
    return m.group(1).strip() if m else None


def _containing_section(body: str, pos: int) -> str | None:
    section = None
    for m in re.finditer(r'^##\s+(.+)$', body, re.MULTILINE):
        if m.start() <= pos:
            section = m.group(1).strip()
        else:
            break
    return section


def _is_blacklisted(name: str, context: str, context_keywords: set[str]) -> bool:
    if name not in BLACKLIST:
        return False
    idx = context.index(name)
    before = context[max(0, idx - 50):idx]
    after = context[idx + len(name):idx + len(name) + 50]
    return not any(kw in before + after for kw in context_keywords if kw)


def _deduplicate(edges: list[InferredEdge]) -> list[InferredEdge]:
    best: dict[tuple[str, str], InferredEdge] = {}
    for e in edges:
        key = (e.source, e.target)
        if key not in best or e.confidence > best[key].confidence:
            best[key] = e
        elif e.confidence == best[key].confidence:
            best[key].properties.setdefault("sources", []).extend(
                e.properties.get("sources", [])
            )
    return list(best.values())


def main():
    p = argparse.ArgumentParser(description="REL-01: Entity 正文依赖提取")
    p.add_argument("--mode", choices=("full", "quick"), default="full")
    p.add_argument("--files", nargs="*", default=[])
    p.add_argument("--output", default=os.path.join(INTERMEDIATES_DIR, "body_edges.json"))
    args = p.parse_args()

    if args.mode == "full":
        # WP-117 批3：entities 顶层 .md 清单改信封过滤（原 os.listdir 顶层口径——不下钻子目录）。
        prefix = "知识库/wiki/entities/"
        args.files = sorted(
            rel for rel in _DOC_ENV.paths()
            if rel.startswith(prefix) and rel.endswith(".md") and "/" not in rel[len(prefix):]
        )
    elif not args.files:
        print(f"{LOG_PREFIX} ERROR: --mode quick 需要 --files", file=sys.stderr)
        sys.exit(1)

    print(f"{LOG_PREFIX} 扫描 {len(args.files)} entity 文件 ...")
    edges = scan_entities(args.files, args.mode)
    print(f"{LOG_PREFIX} 提取 {len(edges)} 条边")

    edges_to_json(edges, args.output)
    print(f"{LOG_PREFIX} → {args.output}")


if __name__ == "__main__":
    main()
