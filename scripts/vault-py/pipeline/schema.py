# Component: Inference-Schema
# @responsible: 推断管线共享数据结构 —— Source/InferredEdge dataclass + JSON 序列化
# @inputs: 无（工具库）
# @outputs: 导出的 dataclass
# @context: A. 知识源上下文 (Vault Context)
"""推断管线共享数据结构 — Source/InferredEdge dataclass + JSON 序列化。

4 个 infer-* / merge-* 脚本的共享契约。所有推断脚本输出统一 JSON 格式。
"""

from __future__ import annotations
# W2 迁仓闭包（SPEC-025 C1/C12）：kb_paths/schema_loader 解析自仓内 vault-runtime（A 类事实源）；同族脚本同目录。
# PR-132：自举先于导入＋锚在目录（原 65aee107 版两病齐发：导入在前、_H 锚文件 parents[1] 差一层）
import sys as _sys
from pathlib import Path as _Path
_HERE = _Path(__file__).resolve().parent
for _dep in (_HERE, _HERE.parents[1] / "vault-runtime"):
    _s = str(_dep)
    if _s not in _sys.path:
        _sys.path.insert(0, _s)
from write_gateway import write_text_atomic, append_line, write_bytes_atomic
from vocab_envelope import load_envelope  # WP-054 E-B：扩展件经信封（自举后导入——顺序面合规）

import json
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum

from kb_paths import vault_roots

__all__ = [
    "Source", "InferredEdge", "METHODS",
    "source_to_dict", "edge_to_dict", "edges_to_json",
    "load_entity_names", "load_aliases",
    "INTERMEDIATES_DIR",
]


class _Methods(Enum):
    ENTITY_WIKILINK = "entity_wikilink"
    BODY_MATCH = "body_match"
    ALIAS_MATCH = "alias_match"
    WIKI_WIKILINK = "wiki_wikilink"
    MODULE_WIKILINK = "module_wikilink"
    DEPS_YAML = "deps_yaml"
    ENUMS_YAML = "enums_yaml"
    SYSTEM_COMPONENTS = "system_components"
    MODULE_GROUP = "module_group"


METHODS = _Methods
VAULT_ROOT, KNOWLEDGE_ROOT = vault_roots()
INTERMEDIATES_DIR = os.path.join(VAULT_ROOT, ".pipeline", "intermediates")


@dataclass
class Source:
    """Provenance 来源记录（per D-48）。"""
    file: str
    method: str
    timestamp: str = ""
    section: str | None = None
    confidence: float = 0.0
    line_number: int | None = None

    def __post_init__(self):
        if not self.timestamp:
            self.timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass
class InferredEdge:
    """推断边（per D-40）。"""
    source: str
    target: str
    type: str = "REFERENCES"
    confidence: float = 0.0
    properties: dict = field(default_factory=dict)

    def __post_init__(self):
        if "sources" not in self.properties:
            self.properties["sources"] = []


def source_to_dict(s: Source) -> dict:
    d = {"file": s.file, "method": s.method, "timestamp": s.timestamp}
    if s.section is not None:
        d["section"] = s.section
    d["confidence"] = s.confidence
    if s.line_number is not None:
        d["line_number"] = s.line_number
    return d


def edge_to_dict(e: InferredEdge) -> dict:
    return {
        "source": e.source,
        "target": e.target,
        "type": e.type,
        "confidence": e.confidence,
        "properties": {
            "sources": [source_to_dict(s) for s in e.properties.get("sources", [])],
        },
    }


def edges_to_json(edges: list[InferredEdge], path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    data = [edge_to_dict(e) for e in edges]
    write_text_atomic(path, json.dumps(data, indent=2, ensure_ascii=False))


_DOC_ENV_CACHE = None  # WP-117 批3：信封惰性缓存（None＝未载）


def load_entity_names(vault_root: str | None = None) -> dict[str, str]:
    root = vault_root or VAULT_ROOT
    entity_dir = os.path.join(root, "知识库", "wiki", "entities")
    if not os.path.isdir(entity_dir):
        return {}
    names = {}
    # WP-117 批3：文档供给收进信封——entities 顶层 .md 清单与全文均经信封（惰性载入＋缓存：
    # 不读文档的 schema 消费者不受 DOC_ENVELOPE_PATH 影响；信封不可用即 raise＝供给面问题，
    # 与「空实体集返回 {}」（空数据态）分型）。全文＝fmText＋body 逐字节还原原文件，
    # 哑切分与 ^id: 正则语义逐字保持。
    global _DOC_ENV_CACHE
    if _DOC_ENV_CACHE is None:
        from doc_envelope import load_doc_envelope as _lde
        _DOC_ENV_CACHE = _lde()
    prefix = "知识库/wiki/entities/"
    for rel in sorted(
        r for r in _DOC_ENV_CACHE.paths()
        if r.startswith(prefix) and r.endswith(".md") and "/" not in r[len(prefix):]
    ):
        hit = _DOC_ENV_CACHE.get_document(rel)
        if hit["state"] != "present":
            continue
        content = hit["value"]["fmText"] + hit["value"]["body"]
        if content.startswith("---"):
            parts = content.split("---", 2)
            fm = parts[1] if len(parts) >= 3 else ""
            m_id = re.search(r'^id:\s*"?([^"\n]+)"?', fm, re.MULTILINE)
            eid = m_id.group(1).strip() if m_id else ""
        else:
            eid = ""
        stem = os.path.splitext(rel.rsplit("/", 1)[-1])[0]
        name = re.sub(r"^\d{2,4}-", "", stem).strip()
        names[name] = eid if eid else name
    return names


def load_aliases(vault_root: str | None = None) -> dict[str, str]:
    # WP-054 E-B（SPEC-049 X3）：entity-aliases 经信封取件——软缺件语义逐字保持
    # （缺件→{}；非串值滤除由信封装载降级完成——schema 收口面同引擎）。信封缺件是显式状态。
    try:
        envelope = load_envelope()
    except Exception:
        return {}
    if not envelope.has("entity-aliases"):
        return {}
    data = envelope.doc("entity-aliases")
    if isinstance(data, dict):
        return {k: v for k, v in data.items() if isinstance(v, str)}
    return {}
