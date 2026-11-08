#!/usr/bin/env python3
"""词表信封接收器（WP-049 L3／SPEC-044 C2；ADR-016 §四-2 裁决「装载收进同一宿主」）。

Python 侧词表消费的唯一入口：只读**信封 JSON**（Node 侧装载入口产出、VOCAB_ENVELOPE_PATH
或显式路径递入），不读任何 TheSchema 词表 yaml——裁决目标态是 Python 代码里不存在词表文件
知识（连文件名都不出现）。坏信封／版本不匹配 fail-closed 显式失败，禁止回落自读。

契约：contracts/vocab-payload-envelope.schema.json（envelope_version＝1；source_fingerprint＝
逐件 sha256 收据；三态在序列化下保持——""／[]／缺键各有其形，lookup 一一区分，与 Node 侧
vocab-load-port.vocabLookup 五态同构）。
"""
from __future__ import annotations

import json
import os

ENVELOPE_VERSION = 1
_FINGERPRINT_LEN = 64


class VocabEnvelopeError(RuntimeError):
    """信封不可用——显式失败，不回落自读。"""


class VocabEnvelope:
    """已校验信封的只读视图。"""

    def __init__(self, payload):
        if not isinstance(payload, dict):
            raise VocabEnvelopeError("VOCAB_ENVELOPE_UNREADABLE: 信封必须是 JSON 对象")
        version = payload.get("envelope_version")
        if version != ENVELOPE_VERSION:
            raise VocabEnvelopeError(
                f"VOCAB_ENVELOPE_VERSION_MISMATCH: 期望 {ENVELOPE_VERSION}，实得 {version!r}——"
                "拒绝消费，不得回落自读（用匹配的 Node 侧重物化信封）"
            )
        fingerprints = payload.get("source_fingerprint")
        if not isinstance(fingerprints, dict):
            raise VocabEnvelopeError("VOCAB_ENVELOPE_UNREADABLE: source_fingerprint 缺失或不是对象")
        for name, digest in fingerprints.items():
            if not isinstance(digest, str) or len(digest) != _FINGERPRINT_LEN or not all(c in "0123456789abcdef" for c in digest):
                raise VocabEnvelopeError(f"VOCAB_ENVELOPE_UNREADABLE: {name} 指纹不是 sha256 十六进制")
        files = payload.get("files")
        if not isinstance(files, dict):
            raise VocabEnvelopeError("VOCAB_ENVELOPE_UNREADABLE: files 缺失或不是对象")
        for name in fingerprints:
            if name not in files:
                raise VocabEnvelopeError(f"VOCAB_ENVELOPE_UNREADABLE: {name} 有指纹无载荷")
        degraded = payload.get("degraded") or {}
        if not isinstance(degraded, dict):
            raise VocabEnvelopeError("VOCAB_ENVELOPE_UNREADABLE: degraded 不是对象")
        for name, receipts in degraded.items():
            if not isinstance(receipts, list):
                raise VocabEnvelopeError(f"VOCAB_ENVELOPE_UNREADABLE: degraded.{name} 不是数组")
        for name, doc in files.items():
            # 红队发现 B（WP-052 复盘）：files 成员非对象 fail-closed——lookup 不得静默并入
            # map-absent 合法态（C2 字面完备性）
            if not isinstance(doc, dict):
                raise VocabEnvelopeError(f"VOCAB_ENVELOPE_UNREADABLE: files.{name} 不是对象")
        self._files = files
        self._fingerprints = fingerprints
        self._degraded = degraded

    def names(self):
        return sorted(self._files.keys())

    def has(self, name):
        return name in self._files

    def try_doc(self, name):
        return self._files.get(name)

    def doc(self, name):
        if name not in self._files:
            raise VocabEnvelopeError(
                f"VOCAB_ENVELOPE_FILE_MISSING: 信封不含 {name}（现有：{', '.join(self.names())}）——"
                "装载侧缺件是显式状态，消费方须分支处置，不得当空表用"
            )
        return self._files[name]

    def fingerprint(self, name):
        return self._fingerprints.get(name)

    def degraded(self, name):
        """装载点形态降级收据（WP-049 L3）：[{path, pathParts}]——pathParts 机器可逆段。"""
        return self._degraded.get(name) or []

    def lookup(self, name, map_key, key):
        """三态查询（与 Node vocabLookup 同构）：file-missing／map-absent／key-absent／
        empty-string／empty-collection／present 六态逐一区分——{旧层: ""} 与 {旧层: []} 与
        缺键不得混同（实证清单 P3 病根）。"""
        if name not in self._files:
            return {"state": "file-missing", "value": None}
        doc = self._files[name]
        if not isinstance(doc, dict) or map_key not in doc or doc[map_key] is None:
            return {"state": "map-absent", "value": None}
        mapping = doc[map_key]
        if not isinstance(mapping, dict):
            raise VocabEnvelopeError(
                f"vocab_envelope.lookup: {name}.{map_key} 不是映射——三态查询只对映射面定义"
            )
        if key not in mapping:
            return {"state": "key-absent", "value": None}
        value = mapping[key]
        if value == "" and isinstance(value, str):
            return {"state": "empty-string", "value": value}
        if isinstance(value, list) and len(value) == 0:
            return {"state": "empty-collection", "value": value}
        return {"state": "present", "value": value}


def load_envelope(path=None):
    """读信封：显式 path 优先，其次 VOCAB_ENVELOPE_PATH（Node 拉起点下发／npm 物化约定）。"""
    resolved = path or os.environ.get("VOCAB_ENVELOPE_PATH")
    if not resolved:
        raise VocabEnvelopeError(
            "VOCAB_ENVELOPE_PATH 未设置且未显式传 path——词表经 Node 侧装载入口递入"
            "（pipeline 拉起自动物化；手工运行先跑 node scripts/vault-runtime/dump-vocab-envelope.mjs）；"
            "Python 不读 TheSchema 词表文件（ADR-016 §四-2 裁决）"
        )
    try:
        with open(resolved, encoding="utf-8") as handle:
            payload = json.load(handle)
    except OSError as error:
        raise VocabEnvelopeError(f"VOCAB_ENVELOPE_UNREADABLE: 信封文件不可读（{resolved}）：{error}") from error
    except json.JSONDecodeError as error:
        raise VocabEnvelopeError(f"VOCAB_ENVELOPE_UNREADABLE: 信封不是合法 JSON：{error}") from error
    return VocabEnvelope(payload)
