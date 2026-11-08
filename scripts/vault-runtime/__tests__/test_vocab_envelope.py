"""WP-049 L3a（SPEC-044 C2）：词表信封接收器单元测试——版本/指纹校验 fail-closed、
三态六形与 Node vocabLookup 同构、env 解析与缺路径显式指引。层级＝纯单元（无子进程）。"""
import json
import os
import sys
import tempfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from vocab_envelope import ENVELOPE_VERSION, VocabEnvelope, VocabEnvelopeError, load_envelope


def base_payload():
    return {
        "envelope_version": ENVELOPE_VERSION,
        "source_fingerprint": {"enums": "a" * 64},
        "generated_at": "2026-10-31T00:00:00Z",
        "files": {
            "enums": {
                "layer_aliases": {"旧层A": "", "旧层B": [], "旧层C": ["正式C"]},
                "domains": {},
            }
        },
    }


def test_valid_payload_roundtrip_and_names():
    env = VocabEnvelope(base_payload())
    assert env.names() == ["enums"]
    assert env.has("enums") and not env.has("ontology")
    assert env.fingerprint("enums") == "a" * 64


@pytest.mark.parametrize("mutation, fragment", [
    ({"envelope_version": 2}, "VERSION_MISMATCH"),
    ({"source_fingerprint": None}, "source_fingerprint 缺失"),
    ({"source_fingerprint": {"enums": "zz"}}, "不是 sha256"),
    ({"files": None}, "files 缺失"),
    ({"source_fingerprint": {"enums": "a" * 64}, "files": {}}, "有指纹无载荷"),
])
def test_invalid_payloads_fail_closed(mutation, fragment):
    payload = base_payload()
    payload.update(mutation)
    with pytest.raises(VocabEnvelopeError, match=fragment):
        VocabEnvelope(payload)


def test_lookup_six_states_mirror_node():
    env = VocabEnvelope(base_payload())
    look = lambda k: env.lookup("enums", "layer_aliases", k)["state"]
    assert look("旧层A") == "empty-string"
    assert look("旧层B") == "empty-collection"
    assert look("旧层C") == "present"
    assert look("不存在") == "key-absent"
    assert env.lookup("enums", "不存在的映射", "k")["state"] == "map-absent"
    assert env.lookup("ontology", "m", "k")["state"] == "file-missing"


def test_lookup_non_map_raises():
    env = VocabEnvelope(base_payload())
    env._files["enums"]["scalar_map"] = 42
    with pytest.raises(VocabEnvelopeError, match="不是映射"):
        env.lookup("enums", "scalar_map", "k")


def test_doc_missing_raises_with_available_names():
    env = VocabEnvelope(base_payload())
    with pytest.raises(VocabEnvelopeError, match="ontology.*现有：enums"):
        env.doc("ontology")


def test_load_envelope_env_resolution_and_missing_path(monkeypatch, tmp_path):
    payload = base_payload()
    envelope_file = tmp_path / "env.json"
    envelope_file.write_text(json.dumps(payload), encoding="utf-8")
    monkeypatch.setenv("VOCAB_ENVELOPE_PATH", str(envelope_file))
    assert load_envelope().fingerprint("enums") == "a" * 64

    monkeypatch.delenv("VOCAB_ENVELOPE_PATH", raising=False)
    with pytest.raises(VocabEnvelopeError, match="VOCAB_ENVELOPE_PATH 未设置"):
        load_envelope()
    with pytest.raises(VocabEnvelopeError, match="dump-vocab-envelope"):
        load_envelope()

    explicit = tmp_path / "explicit.json"
    explicit.write_text(json.dumps(payload), encoding="utf-8")
    assert load_envelope(str(explicit)).has("enums")


def test_load_envelope_bad_json_fail_closed(tmp_path):
    bad = tmp_path / "bad.json"
    bad.write_text("{oops", encoding="utf-8")
    with pytest.raises(VocabEnvelopeError, match="不是合法 JSON"):
        load_envelope(str(bad))
