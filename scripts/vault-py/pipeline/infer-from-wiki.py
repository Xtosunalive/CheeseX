#!/usr/bin/env python3
# Component: Infer-From-Wiki
# @responsible: 从 wiki/ 目录已有页面推断新文档的元数据归属
# @inputs: wiki/ 文件系统 + 文档内容
# @outputs: 推断结果
# @context: A. 知识源上下文 (Vault Context)
"""REL-02: Wiki 文章交叉引用推断 — 扫描 precleaned 文章 wikilink 推断关系。

用法:
  python3 infer-from-wiki.py --mode full --output wiki_edges.json
  python3 infer-from-wiki.py --mode quick --files article1.md article2.md --output wiki_edges.json
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

from schema_loader import architecture_projection, resolve_product_identity

from schema import (
    INTERMEDIATES_DIR, METHODS, InferredEdge, Source,
    edges_to_json, load_entity_names,
)

LOG_PREFIX = "[Infer:wiki]"
EXCLUDED_PREFIXES = ("wiki/index", "wiki/queries/", "wiki/todo/")

# W3 迁仓：vault 根解析对齐 kb_paths 纪律——KB_VAULT env 优先；__file__ 上溯仅为 vault 旧位布局兜底
VAULT_ROOT = os.environ.get("KB_VAULT") or os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
PRECLEANED_DIR = os.path.join(VAULT_ROOT, "知识库", "raw", "precleaned")

# WP-117 批3（SPEC-084 §二.3）：文档供给收进信封——零回落（同 infer-from-body 模式）。
from doc_envelope import DocEnvelopeError, load_doc_envelope as _load_doc_envelope

try:
    _DOC_ENV = _load_doc_envelope()
except (DocEnvelopeError, ValueError, OSError) as _e:
    print(f"{LOG_PREFIX} ERROR: 文档信封不可用（{_e}）——物化指引："
          "server/shared/doc-envelope-materializer.cjs writeDocEnvelope，或 e2e/dump-doc-envelope.mjs",
          file=sys.stderr)
    sys.exit(1)


def _doc_full_text(rel: str):
    """信封取文档全文（fmText＋body 逐字节还原原文件——G1 等价抽查钉）；absent → None。"""
    hit = _DOC_ENV.get_document(rel)
    if hit["state"] != "present":
        return None
    doc = hit["value"]
    return doc["fmText"] + doc["body"]


def _extract_frontmatter_value(body: str, key: str) -> str | None:
    """Extract a frontmatter field value (strips [[ ]])."""
    m = re.search(rf"^{key}:[ \t]*(.*)$", body, re.MULTILINE)
    if not m:
        return None
    val = m.group(1).strip().strip("'\"").strip("[]").strip()
    return val if val else None


def _parse_wikilinks(text: str) -> list[str]:
    """Extract [[target]] targets from text."""
    return [m.group(1) for m in re.finditer(r'\[\[([^\]]+)\]\]', text)]


def scan_precleaned(precleaned_files: list[str], mode: str) -> list[InferredEdge]:
    projection = architecture_projection()
    configured_product = (projection.get("product") or "").strip()
    configured_version = (projection.get("version") or "").strip()
    if bool(configured_product) != bool(configured_version):
        raise ValueError("架构投影的 product 和 version 必须同时配置")
    if not configured_product:
        print(f"{LOG_PREFIX} 无挂载产品，跳过文章引用推断")
        return []
    active_product = resolve_product_identity(configured_product)["canonical"]
    all_names = set(load_entity_names(product=active_product))

    edges: list[InferredEdge] = []
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    for rel in precleaned_files:
        # WP-117 批3：全文＝fmText＋body（逐字节还原原文件），正则解析语义逐字保持。
        text = _doc_full_text(rel)
        if text is None:
            print(f"  {LOG_PREFIX} WARNING: 文件不在信封内: {rel}", file=sys.stderr)
            continue
        body = text

        vrel = rel

        # D-17：只推断当前产品范围内的文章。
        fm, main_body = "", body
        if body.startswith("---"):
            parts = body.split("---", 2)
            if len(parts) == 3:
                _, fm, main_body = parts
        product = _extract_frontmatter_value(fm, "product")
        if resolve_product_identity(product)["canonical"] != active_product:
            continue

        # Page→Entity mapping from module frontmatter
        module_entity = _extract_frontmatter_value(fm, "module")
        if not module_entity or module_entity not in all_names:
            continue

        # Collect wikilinks from frontmatter (module_wikilink, conf=0.8) — exclude module/product keys
        fm_excluded = set()
        for key in ("module", "product"):
            val = _extract_frontmatter_value(fm, key)
            if val:
                fm_excluded.add(val)

        fm_wikilinks = [wl for wl in _parse_wikilinks(fm) if wl not in fm_excluded and wl in all_names]
        for target in fm_wikilinks:
            if target == module_entity:
                continue
            edges.append(InferredEdge(
                source=module_entity, target=target, type="REFERENCES", confidence=0.8,
                properties={"sources": [Source(
                    file=vrel, method="module_wikilink", timestamp=ts,
                    section="frontmatter", confidence=0.8,
                )]},
            ))

        # Scan body wikilinks (wiki_wikilink, conf=0.5) with line_number
        body_lines = main_body.split("\n")
        section = None
        for i, line in enumerate(body_lines, start=1):
            # Track current ## section
            sec_m = re.match(r'^##\s+(.+)$', line)
            if sec_m:
                section = sec_m.group(1).strip()
                continue

            for target in _parse_wikilinks(line):
                if target in fm_excluded:
                    continue
                if target == module_entity:
                    continue
                if target not in all_names:
                    continue
                edges.append(InferredEdge(
                    source=module_entity, target=target, type="REFERENCES", confidence=0.5,
                    properties={"sources": [Source(
                        file=vrel, method="wiki_wikilink", timestamp=ts,
                        section=section, confidence=0.5, line_number=i,
                    )]},
                ))

    return _deduplicate(edges)


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
    p = argparse.ArgumentParser(description="REL-02: Wiki 文章交叉引用推断")
    p.add_argument("--mode", choices=("full", "quick"), default="full")
    p.add_argument("--files", nargs="*", default=[])
    p.add_argument("--output", default=os.path.join(INTERMEDIATES_DIR, "wiki_edges.json"))
    args = p.parse_args()

    if args.mode == "full":
        # WP-117 批3：precleaned 顶层 .md 改信封过滤（原 os.listdir 顶层口径）；
        # EXCLUDED_PREFIXES 判据平移：对预期 rel（知识库/raw/precleaned/<f>）与对信封 rel
        # 同串同判（rel 即该串）。
        prefix = "知识库/raw/precleaned/"
        args.files = sorted(
            rel for rel in _DOC_ENV.paths()
            if rel.startswith(prefix) and rel.endswith(".md")
            and "/" not in rel[len(prefix):]
            and not any(rel.startswith(pfx) for pfx in EXCLUDED_PREFIXES)
        )
    elif not args.files:
        print(f"{LOG_PREFIX} ERROR: --mode quick 需要 --files", file=sys.stderr)
        sys.exit(1)

    # Apply exclusion filter to quick mode files too（quick 传入即信封 rel，同串同判）
    args.files = [
        f for f in args.files
        if not any(f.startswith(pfx) for pfx in EXCLUDED_PREFIXES)
    ]

    print(f"{LOG_PREFIX} 扫描 {len(args.files)} precleaned 文件 ...")
    edges = scan_precleaned(args.files, args.mode)
    print(f"{LOG_PREFIX} 提取 {len(edges)} 条边")

    edges_to_json(edges, args.output)
    print(f"{LOG_PREFIX} → {args.output}")


if __name__ == "__main__":
    main()
