"""WP-117 批2（SPEC-084 §二.1）：文档信封接收器单元测试——版本/形态 fail-closed、
get_document 两态与缺路径显式指引。层级＝纯单元（无子进程、无 vault 依赖）。
形态对齐 test_vocab_envelope.py（vocab_envelope.py 一期纪律镜像）。"""
import hashlib
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from doc_envelope import ENVELOPE_VERSION, DocEnvelope, DocEnvelopeError, get_document, load_doc_envelope


def make_doc(rel, fm_text, body):
    text = fm_text + body
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    return {"path": rel, "fmText": fm_text, "body": body, "sha256": digest, "sha16": digest[:16]}


def base_payload():
    return {
        "envelope_version": ENVELOPE_VERSION,
        "generated_at": "2026-11-05T00:00:00.000Z",
        "vault_fingerprint": {"file_count": 2, "total_bytes": 96},
        "documents": [
            make_doc("笔记.md", "---\ntitle: x\n---\n", "\n\n正文\n"),
            make_doc("plain.md", "", "无 frontmatter。\n"),
        ],
    }


def write_envelope(tmp_path, payload):
    target = tmp_path / "doc-envelope.json"
    target.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return target


def test_valid_payload_roundtrip_and_paths(tmp_path):
    envelope = load_doc_envelope(str(write_envelope(tmp_path, base_payload())))
    assert envelope.paths() == ["plain.md", "笔记.md"]
    assert envelope.vault_fingerprint() == {"file_count": 2, "total_bytes": 96}
    doc = get_document(envelope, "笔记.md")
    assert doc["state"] == "present"
    assert doc["value"]["fmText"] == "---\ntitle: x\n---\n"
    assert doc["value"]["body"] == "\n\n正文\n"


def test_get_document_two_states_zero_fallback():
    envelope = DocEnvelope(base_payload())
    assert get_document(envelope, "plain.md")["state"] == "present"
    absent = get_document(envelope, "不存在.md")
    assert absent == {"state": "absent", "value": None}  # absent 是显式状态，不当空文档用


def test_get_document_rejects_raw_payload_fail_closed():
    with pytest.raises(DocEnvelopeError, match="UNVALIDATED"):
        get_document(base_payload(), "plain.md")  # 绕形态校验直查原始 dict 即 raise


def test_env_resolution_and_missing_path(monkeypatch, tmp_path):
    envelope_file = write_envelope(tmp_path, base_payload())
    monkeypatch.setenv("DOC_ENVELOPE_PATH", str(envelope_file))
    assert load_doc_envelope().paths() == ["plain.md", "笔记.md"]

    monkeypatch.delenv("DOC_ENVELOPE_PATH", raising=False)
    with pytest.raises(DocEnvelopeError, match="DOC_ENVELOPE_PATH 未设置"):
        load_doc_envelope()


@pytest.mark.parametrize("mutation, fragment", [
    ({"envelope_version": 2}, "VERSION_MISMATCH"),
    ({"envelope_version": "1"}, "VERSION_MISMATCH"),
    ({"vault_fingerprint": None}, "vault_fingerprint 缺失"),
    ({"vault_fingerprint": {"file_count": True, "total_bytes": 1}}, "不是非负整数"),
    ({"documents": None}, "documents 缺失"),
    ({"documents": {}}, "不是数组"),
    ({"documents": ["not-a-dict"]}, "不是对象"),
])
def test_invalid_payloads_fail_closed(mutation, fragment):
    payload = base_payload()
    payload.update(mutation)
    with pytest.raises(DocEnvelopeError, match=fragment):
        DocEnvelope(payload)


@pytest.mark.parametrize("key", ["path", "fmText", "body", "sha256", "sha16"])
def test_member_missing_key_fail_closed(key):
    payload = base_payload()
    del payload["documents"][0][key]
    with pytest.raises(DocEnvelopeError, match=f"缺键 {key}"):
        DocEnvelope(payload)


@pytest.mark.parametrize("field, value, fragment", [
    ("sha256", "z" * 64, "sha256 十六进制"),
    ("sha256", "a" * 63, "sha256 十六进制"),
    ("sha16", "a" * 15, "16 位十六进制"),
    ("sha16", "b" * 16, "前 16 位不一致"),
    ("path", 42, "不是字符串"),
    ("fmText", None, "不是字符串"),
])
def test_member_bad_field_fail_closed(field, value, fragment):
    payload = base_payload()
    payload["documents"][0][field] = value
    with pytest.raises(DocEnvelopeError, match=fragment):
        DocEnvelope(payload)


def test_duplicate_path_fail_closed():
    payload = base_payload()
    payload["documents"][1]["path"] = payload["documents"][0]["path"]
    with pytest.raises(DocEnvelopeError, match="路径重复"):
        DocEnvelope(payload)


def test_load_bad_json_and_unreadable_file_fail_closed(tmp_path):
    bad = tmp_path / "bad.json"
    bad.write_text("{oops", encoding="utf-8")
    with pytest.raises(DocEnvelopeError, match="不是合法 JSON"):
        load_doc_envelope(str(bad))
    with pytest.raises(DocEnvelopeError, match="不可读"):
        load_doc_envelope(str(tmp_path / "不存在.json"))
