#!/usr/bin/env python3
# Component: Infer-From-Config
# @responsible: 从词表（deps/enums，经信封）和分类配置推断文档元数据归属
# @inputs: 词表 dependencies/enums（经信封，非文件直读）+ 文档 frontmatter
# @outputs: 推断结果
# @context: A. 知识源上下文 (Vault Context)
"""REL-03: 配置反向推导 — deps_yaml/enums/system_components/module_group 四源推断。

用法:
  python3 infer-from-config.py --mode full --output config_edges.json
  python3 infer-from-config.py --mode quick --output config_edges.json
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
import re
import sys
import yaml
from datetime import datetime, timezone

from schema import (
    INTERMEDIATES_DIR, METHODS, InferredEdge, Source,
    edges_to_json, load_entity_names,
)

LOG_PREFIX = "[Infer:config]"

VAULT_ROOT = os.environ.get("KB_VAULT") or os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))  # W3 迁仓：env 优先（kb_paths 同源纪律），__file__ 上溯兜底
# WP-049 L3（ADR-016 §四-2）：词表（deps/enums）经 vocab_envelope 取数，不构造词表文件路径
# （WP-138 R1 扫尾：dead 的 theschema_dir 路径构造随抄本删除）；
# PR-245：组件共配推断面已随 component-index.json 整件退役删除（原 WP-061 W-B 读索引）。
PRECLEANED_DIR = os.path.join(VAULT_ROOT, "知识库", "raw", "precleaned")

# WP-117 批3（SPEC-084 §二.3）：文档供给收进信封——零回落（同 infer-from-body 模式）。
import sys as _sysmod
from doc_envelope import DocEnvelopeError, load_doc_envelope as _load_doc_envelope

try:
    _DOC_ENV = _load_doc_envelope()
except (DocEnvelopeError, ValueError, OSError) as _e:
    print(f"{LOG_PREFIX} ERROR: 文档信封不可用（{_e}）——物化指引："
          "server/shared/doc-envelope-materializer.cjs writeDocEnvelope，或 e2e/dump-doc-envelope.mjs",
          file=_sysmod.stderr)
    _sysmod.exit(1)


def _extract_frontmatter_value(body: str, key: str) -> str | None:
    m = re.search(rf'^{key}:\s*\'?\[?\[?([^\]]*?)\]?\]?\'?\s*$', body, re.MULTILINE)
    if not m:
        return None
    val = m.group(1).strip()
    return val if val else None


def infer_deps_yaml(entity_names: dict[str, str]) -> list[InferredEdge]:
    """A. 依赖规则（词表，经信封）→ DEPENDS_ON edges (confidence=0.7)."""
    edges: list[InferredEdge] = []
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    from vocab_envelope import load_envelope
    if not load_envelope().has("dependencies"):
        print(f"  {LOG_PREFIX} WARNING: 词表 dependencies 缺件", file=sys.stderr)
        return edges
    vrel = "vocab:dependencies"  # WP-049 L3：来源标注改逻辑名（数据经信封，无文件路径概念）

    data = load_envelope().doc("dependencies")

    deps = data.get("dependencies", []) if isinstance(data, dict) else []
    all_names = set(entity_names.keys())

    for dep in deps:
        src = dep.get("source", "").strip()
        tgt = dep.get("target", "").strip()
        if not src or not tgt:
            continue
        if src not in all_names:
            print(f"  {LOG_PREFIX} WARNING: deps source '{src}' 不是注册 entity", file=sys.stderr)
        if tgt not in all_names:
            print(f"  {LOG_PREFIX} WARNING: deps target '{tgt}' 不是注册 entity", file=sys.stderr)
        edges.append(InferredEdge(
            source=src, target=tgt, type="DEPENDS_ON", confidence=0.7,
            properties={"sources": [Source(
                file=vrel, method="deps_yaml", timestamp=ts,
                section="dependencies", confidence=0.7,
            )]},
        ))

    return edges


def infer_enums_yaml(entity_names: dict[str, str]) -> list[InferredEdge]:
    """B. 词表 enums — same subdomain entity pairs → REFERENCES (confidence=0.4)."""
    edges: list[InferredEdge] = []
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    from vocab_envelope import load_envelope
    if not load_envelope().has("enums"):
        print(f"  {LOG_PREFIX} WARNING: 词表 enums 缺件", file=sys.stderr)
        return edges
    vrel = "vocab:enums"  # WP-049 L3：来源标注改逻辑名（数据经信封，无文件路径概念）

    data = load_envelope().doc("enums")

    modules = data.get("modules", {})
    subdomain_entities: dict[str, list[str]] = {}
    for mod_name, mod_info in modules.items():
        subdomain = mod_info.get("subdomain", "")
        if not subdomain:
            continue
        if mod_name in entity_names:
            subdomain_entities.setdefault(subdomain, []).append(mod_name)

    for subdomain, ents in subdomain_entities.items():
        if len(ents) < 2:
            continue
        for i in range(len(ents)):
            for j in range(i + 1, len(ents)):
                edges.append(InferredEdge(
                    source=ents[i], target=ents[j], type="REFERENCES", confidence=0.4,
                    properties={"sources": [Source(
                        file=vrel, method="enums_yaml", timestamp=ts,
                        section=f"subdomain:{subdomain}", confidence=0.4,
                    )]},
                ))

    return edges


def infer_module_group(entity_names: dict[str, str]) -> list[InferredEdge]:
    """D. Module 同组 — same-module article co-referenced entities → REFERENCES (confidence=0.3)."""
    edges: list[InferredEdge] = []
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    all_names = set(entity_names.keys())
    module_entities: dict[str, set[str]] = {}

    # WP-117 批3：precleaned 顶层 .md 改信封过滤＋取全文（fmText＋body 逐字节还原原文件；
    # 其哑切分 --- 语义在全文上与原 split("---",2) 同址同形——文本逐字同源）。
    prefix = "知识库/raw/precleaned/"
    for rel in sorted(
        r for r in _DOC_ENV.paths()
        if r.startswith(prefix) and r.endswith(".md") and "/" not in r[len(prefix):]
    ):
        hit = _DOC_ENV.get_document(rel)
        if hit["state"] != "present":
            continue
        body = hit["value"]["fmText"] + hit["value"]["body"]

        module_entity = _extract_frontmatter_value(body, "module")
        if not module_entity or module_entity not in all_names:
            continue

        if body.startswith("---"):
            parts = body.split("---", 2)
            main_body = parts[2] if len(parts) >= 3 else body
        else:
            main_body = body

        found = {n for n in entity_names if n != module_entity and n in main_body}
        if found:
            module_entities.setdefault(module_entity, set()).update(found)

    for module_name, ents in module_entities.items():
        ent_list = sorted(ents)
        if len(ent_list) < 2:
            for e in ent_list:
                edges.append(InferredEdge(
                    source=module_name, target=e, type="REFERENCES", confidence=0.3,
                    properties={"sources": [Source(
                        file=f"raw/precleaned/*/module:{module_name}", method="module_group",
                        timestamp=ts, section="precleaned", confidence=0.3,
                    )]},
                ))
        else:
            for i in range(len(ent_list)):
                for j in range(i + 1, len(ent_list)):
                    edges.append(InferredEdge(
                        source=ent_list[i], target=ent_list[j], type="REFERENCES", confidence=0.3,
                        properties={"sources": [Source(
                            file=f"raw/precleaned/*/module:{module_name}", method="module_group",
                            timestamp=ts, section="precleaned", confidence=0.3,
                        )]},
                    ))

    return edges


def scan_config(entity_names: dict[str, str]) -> list[InferredEdge]:
    print(f"  {LOG_PREFIX} A. deps_yaml ...")
    a = infer_deps_yaml(entity_names)
    print(f"  {LOG_PREFIX}    {len(a)} edges")

    print(f"  {LOG_PREFIX} B. enums_yaml ...")
    b = infer_enums_yaml(entity_names)
    print(f"  {LOG_PREFIX}    {len(b)} edges")

    print(f"  {LOG_PREFIX} D. module_group ...")
    d = infer_module_group(entity_names)
    print(f"  {LOG_PREFIX}    {len(d)} edges")

    return _deduplicate(a + b + d)


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
    p = argparse.ArgumentParser(description="REL-03: 配置反向推导")
    p.add_argument("--mode", choices=("full", "quick"), default="full")
    p.add_argument("--output", default=os.path.join(INTERMEDIATES_DIR, "config_edges.json"))
    args = p.parse_args()

    entity_names = load_entity_names()
    print(f"{LOG_PREFIX} 实体: {len(entity_names)}, mode={args.mode}")

    edges = scan_config(entity_names)
    print(f"{LOG_PREFIX} 总计 {len(edges)} 条边")

    edges_to_json(edges, args.output)
    print(f"{LOG_PREFIX} → {args.output}")


if __name__ == "__main__":
    main()
