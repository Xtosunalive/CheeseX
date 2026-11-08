#!/usr/bin/env python3
"""文档信封消费件（WP-155——SPEC-084 §二.3/§六「分类域另批」余量批）。

classify／generate-sa 等人工或管线调起工具的文档面统一（validate_classification 已于 WP-156 退役删除）
经本件消费信封（ADR-016 §二装载入口：Python 不读 vault .md）。三件事：

1. ensure_doc_envelope(vault_root)——信封缺失时自动物化（照 pipeline-runner
   _ensure_doc_envelope 先例：调同目录 dump-doc-envelope.mjs，产物落
   <vault>/.ledger/doc-envelope.json，失败显式抛错零回落）；
2. load_for_vault(vault_root)——ensure＋load_doc_envelope 一步到位；
3. parse_frontmatter(fm_text, body)——信封口径解析，与 extract_graph.parse_frontmatter
   （WP-117 批2）语义逐字对齐：无块/不足三段/坏 YAML → None；空块 → {}；返回 (fm, body)。
   对拍钉在 vault-runtime/__tests__/test_doc_consumption.py（双源注记：extract_graph 版
   保留在图域不动本件，消费方 None 分支的净行为＝原文件口径的跳过/空 fm 分支，等价）。

工作包合同：docs/work-packages/WP-155.json。
"""
from __future__ import annotations

import os
import subprocess

import yaml

from doc_envelope import DocEnvelope, DocEnvelopeError, load_doc_envelope

_MATERIALIZER_TIMEOUT = 120


def ensure_doc_envelope(vault_root, out_path=None):
    """DOC_ENVELOPE_PATH 已设即原样返回；未设则物化一次并注入 env。

    失败形态全部显式抛 DocEnvelopeError（调用方不得回落自读 .md——fail-closed 纪律）：
    - 物化工具缺席（dump-doc-envelope.mjs 不在本件同目录）
    - node 不可执行
    - 物化器退出码非零
    """
    existing = os.environ.get("DOC_ENVELOPE_PATH")
    if existing:
        return existing
    dump = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dump-doc-envelope.mjs")
    if not os.path.isfile(dump):
        raise DocEnvelopeError(
            f"DOC_ENVELOPE_MATERIALIZE_TOOL_MISSING: 物化工具缺席（{dump}）——"
            "文档经 Node 侧 doc-envelope-materializer 递入，Python 不读 vault .md"
        )
    resolved_out = out_path or os.path.join(vault_root, ".ledger", "doc-envelope.json")
    os.makedirs(os.path.dirname(resolved_out), exist_ok=True)
    try:
        result = subprocess.run(
            ["node", dump, "--vault", vault_root, "--out", resolved_out],
            capture_output=True,
            text=True,
            timeout=_MATERIALIZER_TIMEOUT,
        )
    except FileNotFoundError as error:
        raise DocEnvelopeError(
            f"DOC_ENVELOPE_MATERIALIZE_FAILED: node 不可执行（{error}）——显式失败，不回落自读"
        ) from error
    except subprocess.TimeoutExpired as error:
        raise DocEnvelopeError(
            f"DOC_ENVELOPE_MATERIALIZE_FAILED: 物化超时（>{_MATERIALIZER_TIMEOUT}s）——显式失败，不回落自读"
        ) from error
    if result.returncode != 0:
        raise DocEnvelopeError(
            f"DOC_ENVELOPE_MATERIALIZE_FAILED: dump-doc-envelope exit {result.returncode}\n"
            f"{(result.stderr or '')[-800:]}"
        )
    os.environ["DOC_ENVELOPE_PATH"] = resolved_out
    return resolved_out


def load_for_vault(vault_root):
    """ensure＋load：人工 CLI 与管线拉起链共用的取信封入口。管线链（pipeline-runner／
    server spawn）已注入 DOC_ENVELOPE_PATH 时 ensure 直接短路，信封与链上其他工具同份。"""
    ensure_doc_envelope(vault_root)
    return load_doc_envelope()


def parse_frontmatter(fm_text, body):
    """信封口径 frontmatter 解析——与 extract_graph.parse_frontmatter 语义逐字对齐。

    - fm_text 不以 --- 起头（含空串＝无块）→ None
    - 哑切分 ---（maxsplit=2）不足三段 → None（信封口径不可达，防御保留）
    - yaml.safe_load(parts[1]) 失败 → None；解析为 None（空块）→ {}
    返回 (fm, body)。原文件口径的编码容错链由 Node 物化承担（SPEC-084 §八口径）。
    """
    if not fm_text.startswith("---"):
        return None
    parts = fm_text.split("---", 2)
    if len(parts) < 3:
        return None
    try:
        fm = yaml.safe_load(parts[1]) or {}
    except yaml.YAMLError:
        return None
    return fm, body


def knowledge_prefix(vault_root, knowledge_root):
    """信封键（vault 相对 posix）到知识库相对键的公共前缀（如 ``知识库/``）。

    信封 path 键相对 vault_root（Obsidian 仓库根，runner 物化口径）；消费方的既有 rel
    语义相对 knowledge_root（``vault_root/知识库``，kb_paths.vault_roots 第二元）。
    键位换算集中本件一次完成，消费方 rel 与改造前逐字同值。"""
    rel = os.path.relpath(knowledge_root, vault_root)
    rel = rel.replace(os.sep, "/").strip("/")
    if not rel or rel == ".":
        return ""
    return rel + "/"


def to_knowledge_rel(envelope_rel, prefix):
    """信封键 → 知识库相对 rel。前缀不匹配（语料外的信封件）→ None 显式态，
    消费方分支处置，不得当库内文件用。"""
    if prefix and envelope_rel.startswith(prefix):
        return envelope_rel[len(prefix):]
    return None


def iter_documents(envelope, prefixes=None):
    """按 path 前缀过滤遍历信封文档（稳定序＝path 排序）。prefixes 为 None 即全量；
    str 入参归一为单前缀（裸串会被逐字符迭代——恒真过滤，WP-155 对拍实录的坑，防御钉死）。
    yields (rel, doc)——rel＝信封契约键（vault 相对 posix），doc＝成员闭集。"""
    if isinstance(prefixes, str):
        prefixes = (prefixes,)
    for rel in envelope.paths():
        if prefixes is not None and not any(rel.startswith(prefix) for prefix in prefixes):
            continue
        found = envelope.get_document(rel)
        if found["state"] != "present":
            continue
        yield rel, found["value"]


__all__ = [
    "DocEnvelope",
    "DocEnvelopeError",
    "ensure_doc_envelope",
    "iter_documents",
    "knowledge_prefix",
    "load_for_vault",
    "parse_frontmatter",
    "to_knowledge_rel",
]
