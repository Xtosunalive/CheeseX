"""Local process integration for Wiki inference and its real input envelopes."""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(SCRIPTS / "vault-runtime" / "__tests__"))
from _vocab_fixture import install_doc_envelope, install_vocab_envelope


@pytest.mark.parametrize("active,expected", [("AnyShare", 1), ("FixtureProduct", 1), ("", 0)])
def test_wiki_inference_uses_current_product(tmp_path, monkeypatch, active, expected):
    for key in ("VOCAB_ENVELOPE_PATH", "DOC_ENVELOPE_PATH"):
        monkeypatch.delenv(key, raising=False)
    knowledge = tmp_path / "知识库"
    docs = knowledge / "raw/precleaned"
    entities = knowledge / "wiki/entities"
    docs.mkdir(parents=True)
    entities.mkdir(parents=True)
    product_name = active or "FixtureProduct"
    for name, product in (("Source", product_name), ("Target", product_name), ("Foreign", "Other"),
                          ("10-Ambiguous", product_name), ("20-Ambiguous", "Other")):
        (entities / f"{name}.md").write_text(f"---\nproduct: {product}\n---\n", encoding="utf-8")
    for name, product in (("in-scope", "FP"), ("foreign", "Other")):
        (docs / f"{name}.md").write_text(
            f'---\nproduct: "{product}"\nmodule: Source\n---\n[[Target]] [[Foreign]] [[Ambiguous]]\n', encoding="utf-8")
    vocab = install_vocab_envelope(str(tmp_path), {"enums": {"architecture_projection": {
        "product": active, "version": "v1" if active else "", "product_aliases": {"FP": product_name}
    }}})
    doc = install_doc_envelope(str(tmp_path))
    output = tmp_path / "edges.json"

    for _ in range(2):
        result = subprocess.run(
            [sys.executable, str(SCRIPTS / "vault-py/pipeline/infer-from-wiki.py"), "--output", str(output)],
            env={**os.environ, "KB_VAULT": str(tmp_path), "KB_DATA_DIR": str(tmp_path / "data"),
                 "VOCAB_ENVELOPE_PATH": str(vocab), "DOC_ENVELOPE_PATH": str(doc)},
            capture_output=True, text=True, timeout=20,
        )
        assert result.returncode == 0, (result.stdout, result.stderr)
        edges = json.loads(output.read_text(encoding="utf-8"))
        assert len(edges) == expected, edges
        if edges:
            assert edges[0]["target"] == "Target"


def test_body_context_uses_product_configuration(tmp_path, monkeypatch):
    for key in ("VOCAB_ENVELOPE_PATH", "DOC_ENVELOPE_PATH"):
        monkeypatch.delenv(key, raising=False)
    entities = tmp_path / "知识库/wiki/entities"
    entities.mkdir(parents=True)
    (entities / "Source.md").write_text("## 概述\nFixtureProduct 客户端\n", encoding="utf-8")
    (entities / "客户端.md").write_text("# 客户端\n", encoding="utf-8")
    doc = install_doc_envelope(str(tmp_path))
    output = tmp_path / "edges.json"
    for product, expected in (("FixtureProduct", 1), ("", 0)):
        vocab = install_vocab_envelope(str(tmp_path), {"enums": {"architecture_projection": {
            "product": product, "version": "v1" if product else ""
        }}})
        result = subprocess.run(
            [sys.executable, str(SCRIPTS / "vault-py/pipeline/infer-from-body.py"), "--output", str(output)],
            env={**os.environ, "KB_VAULT": str(tmp_path), "KB_DATA_DIR": str(tmp_path / "data"),
                 "VOCAB_ENVELOPE_PATH": str(vocab), "DOC_ENVELOPE_PATH": str(doc)},
            capture_output=True, text=True, timeout=20,
        )
        assert result.returncode == 0, (result.stdout, result.stderr)
        edges = json.loads(output.read_text(encoding="utf-8"))
        assert len(edges) == expected, edges
        if edges:
            assert edges[0]["target"] == "客户端"
