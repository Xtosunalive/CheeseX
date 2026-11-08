#!/usr/bin/env python3
"""文档信封接收器（WP-117 批2／SPEC-084 §二.1）——vocab_envelope.py 一期纪律镜像。

Python 侧全语料 .md 消费的唯一入口：只读**信封 JSON**（Node 侧 doc-envelope-materializer 产出、
DOC_ENVELOPE_PATH 或显式路径递入），不读任何 vault .md——文档读取权归文档装载入口（ADR-016
§四-2「收窄版，但别忘了做 md 的」）。坏信封／版本不匹配 fail-closed 显式失败，禁止回落自读。

契约（与 Node 侧 buildDocEnvelope 产物一一对应）：envelope_version＝1；documents 成员键闭集
{path, fmText, body, sha256, sha16}——fmText 为含定界符 frontmatter 块原文（无块为空串，语义对齐
extract_graph.parse_frontmatter 无块形态）、body 全文不裁、sha256＝交付文本（utf-8）十六进制指纹、
sha16＝前 16 位；documents 按 path 排序稳定序；vault_fingerprint{file_count, total_bytes}。
fm 的 YAML 解析（safe_load＋编码链语义）由消费批（extract_graph 迁移）承担——本件只管载入、
形态校验与两态查询。
"""
from __future__ import annotations

import json
import os

ENVELOPE_VERSION = 1
_FINGERPRINT_LEN = 64
_SHORT_LEN = 16
_DOC_KEYS = ("path", "fmText", "body", "sha256", "sha16")
_HEX = set("0123456789abcdef")


class DocEnvelopeError(RuntimeError):
    """信封不可用——显式失败，不回落自读。"""


class DocEnvelope:
    """已校验信封的只读视图。"""

    def __init__(self, payload):
        if not isinstance(payload, dict):
            raise DocEnvelopeError("DOC_ENVELOPE_UNREADABLE: 信封必须是 JSON 对象")
        version = payload.get("envelope_version")
        if version != ENVELOPE_VERSION:
            raise DocEnvelopeError(
                f"DOC_ENVELOPE_VERSION_MISMATCH: 期望 {ENVELOPE_VERSION}，实得 {version!r}——"
                "拒绝消费，不得回落自读（用匹配的 Node 侧重物化信封）"
            )
        vault_fingerprint = payload.get("vault_fingerprint")
        if not isinstance(vault_fingerprint, dict):
            raise DocEnvelopeError("DOC_ENVELOPE_UNREADABLE: vault_fingerprint 缺失或不是对象")
        for key in ("file_count", "total_bytes"):
            value = vault_fingerprint.get(key)
            if not isinstance(value, int) or isinstance(value, bool) or value < 0:
                raise DocEnvelopeError(f"DOC_ENVELOPE_UNREADABLE: vault_fingerprint.{key} 不是非负整数")
        documents = payload.get("documents")
        if not isinstance(documents, list):
            raise DocEnvelopeError("DOC_ENVELOPE_UNREADABLE: documents 缺失或不是数组")
        seen_paths = set()
        for index, doc in enumerate(documents):
            # vocab 红队发现 B 同款（WP-052 复盘）：成员非对象 fail-closed——不得静默并入 absent 合法态
            if not isinstance(doc, dict):
                raise DocEnvelopeError(f"DOC_ENVELOPE_UNREADABLE: documents[{index}] 不是对象")
            for key in _DOC_KEYS:
                if key not in doc:
                    raise DocEnvelopeError(f"DOC_ENVELOPE_UNREADABLE: documents[{index}] 缺键 {key}")
                if not isinstance(doc[key], str):
                    raise DocEnvelopeError(f"DOC_ENVELOPE_UNREADABLE: documents[{index}].{key} 不是字符串")
            digest = doc["sha256"]
            if len(digest) != _FINGERPRINT_LEN or not set(digest) <= _HEX:
                raise DocEnvelopeError(f"DOC_ENVELOPE_UNREADABLE: documents[{index}].sha256 不是 sha256 十六进制")
            short = doc["sha16"]
            if len(short) != _SHORT_LEN or not set(short) <= _HEX:
                raise DocEnvelopeError(f"DOC_ENVELOPE_UNREADABLE: documents[{index}].sha16 不是 16 位十六进制")
            if short != digest[:_SHORT_LEN]:
                raise DocEnvelopeError(f"DOC_ENVELOPE_UNREADABLE: documents[{index}].sha16 与 sha256 前 16 位不一致")
            rel = doc["path"]
            if rel in seen_paths:
                raise DocEnvelopeError(f"DOC_ENVELOPE_UNREADABLE: documents 路径重复：{rel}")
            seen_paths.add(rel)
        self._documents = documents
        self._by_path = {doc["path"]: doc for doc in documents}
        self._vault_fingerprint = vault_fingerprint

    def paths(self):
        return sorted(self._by_path)

    def vault_fingerprint(self):
        return dict(self._vault_fingerprint)

    def get_document(self, relpath):
        """两态查询（present/absent）——零回落：absent 是显式状态，消费方分支处置，
        不得当空文档用（vocab lookup 六态纪律的两态版）。"""
        if relpath in self._by_path:
            return {"state": "present", "value": self._by_path[relpath]}
        return {"state": "absent", "value": None}


def get_document(envelope, relpath):
    """两态查询入口（模块级契约形态）：只接受已校验 DocEnvelope——原始 dict 必须先过
    load_doc_envelope／DocEnvelope 校验，绕过校验直查即 raise（零回落）。"""
    if not isinstance(envelope, DocEnvelope):
        raise DocEnvelopeError(
            "DOC_ENVELOPE_UNVALIDATED: get_document 只接受已校验 DocEnvelope（先 load_doc_envelope）——"
            "不得绕形态校验直查原始 dict"
        )
    return envelope.get_document(relpath)


def load_doc_envelope(path=None):
    """读信封：显式 path 优先，其次 DOC_ENVELOPE_PATH（Node 拉起点下发／vault-runtime docEnvelope 选项）。"""
    resolved = path or os.environ.get("DOC_ENVELOPE_PATH")
    if not resolved:
        raise DocEnvelopeError(
            "DOC_ENVELOPE_PATH 未设置且未显式传 path——文档经 Node 侧物化信封递入"
            "（vault-runtime 拉起 docEnvelope 选项自动物化）；Python 不读 vault .md（ADR-016 §四-2 裁决）"
        )
    try:
        with open(resolved, encoding="utf-8") as handle:
            payload = json.load(handle)
    except OSError as error:
        raise DocEnvelopeError(f"DOC_ENVELOPE_UNREADABLE: 信封文件不可读（{resolved}）：{error}") from error
    except json.JSONDecodeError as error:
        raise DocEnvelopeError(f"DOC_ENVELOPE_UNREADABLE: 信封不是合法 JSON：{error}") from error
    return DocEnvelope(payload)
