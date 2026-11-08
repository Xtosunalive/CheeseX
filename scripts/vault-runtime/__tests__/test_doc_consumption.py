"""WP-155：doc_consumption 消费件测试——两层组织。

1. 纯单元：parse_frontmatter 与 extract_graph.parse_frontmatter 逐输入对拍（双源语义钉）；
   knowledge_prefix／to_knowledge_rel 键位换算；iter_documents 前缀过滤。
2. 真实集成：ensure_doc_envelope 经真实 node 子进程物化（tmp vault 夹具）＋node 不可达
   fail-closed（零回落——DocEnvelopeError 而非静默自读）。
"""
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path

import pytest

_TESTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(_TESTS_DIR.parent))
sys.path.insert(0, str(_TESTS_DIR.parent.parent / "vault-py" / "graph"))

import doc_consumption
from doc_envelope import ENVELOPE_VERSION, DocEnvelope, DocEnvelopeError


# extract_graph import 期即 fail-closed 装载文档信封（WP-117 批2）——对拍 import 前先备一份
# 最小合法空信封（setdefault：环境已有真信封不覆盖）。
def _bootstrap_graph_import_envelope():
    payload = {
        "envelope_version": ENVELOPE_VERSION,
        "generated_at": "2026-11-09T00:00:00.000Z",
        "vault_fingerprint": {"file_count": 0, "total_bytes": 0},
        "documents": [],
    }
    probe = Path(tempfile.mkdtemp(prefix="doc-consumption-probe-")) / "doc-envelope.json"
    probe.write_text(json.dumps(payload), encoding="utf-8")
    os.environ.setdefault("DOC_ENVELOPE_PATH", str(probe))


_bootstrap_graph_import_envelope()
from extract_graph import parse_frontmatter as graph_parse_frontmatter  # noqa: E402


def _make_doc(rel, fm_text, body):
    text = fm_text + body
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    return {"path": rel, "fmText": fm_text, "body": body, "sha256": digest, "sha16": digest[:16]}


def _payload(docs):
    return {
        "envelope_version": ENVELOPE_VERSION,
        "generated_at": "2026-11-09T00:00:00.000Z",
        "vault_fingerprint": {"file_count": len(docs), "total_bytes": sum(len(d["fmText"] + d["body"]) for d in docs)},
        "documents": docs,
    }


# ── 纯单元：parse_frontmatter 双源对拍 ──

@pytest.mark.parametrize(
    "fm_text,body",
    [
        ("---\ntitle: x\n---\n", "\n\n正文\n"),          # 标准有块
        ("", "无 frontmatter。\n"),                        # 无块（信封空串形态）
        ("---\n---\n", "空块正文"),                        # 空块 → {}
        ("---\ntitle: x\n", ""),                           # 仅一处定界（不足三段）
        ("------\nfoo\n---\n", "六连短横"),                # 自重叠边界
        ("---\na: [1,\n---\n", "坏 YAML"),                 # safe_load 抛 YAMLError
    ],
)
def test_parse_frontmatter_matches_graph_implementation(fm_text, body):
    """双源语义钉：共享件与 extract_graph 版（WP-117 批2）逐输入同输出。"""
    assert doc_consumption.parse_frontmatter(fm_text, body) == graph_parse_frontmatter(fm_text, body)


def test_parse_frontmatter_none_is_explicit():
    assert doc_consumption.parse_frontmatter("", "x") is None
    assert doc_consumption.parse_frontmatter("---\na: [1,\n---\n", "") is None


# ── 纯单元：键位换算 ──

def test_knowledge_prefix_and_strip():
    vault = os.sep + "tmp" + os.sep + "vlt"
    knowledge = os.path.join(vault, "知识库")
    assert doc_consumption.knowledge_prefix(vault, knowledge) == "知识库/"
    assert doc_consumption.to_knowledge_rel("知识库/wiki/entities/a.md", "知识库/") == "wiki/entities/a.md"
    assert doc_consumption.to_knowledge_rel("outside/other.md", "知识库/") is None  # 语料外显式态


def test_iter_documents_prefix_filter_stable_order():
    envelope = DocEnvelope(_payload([
        _make_doc("知识库/wiki/entities/b.md", "---\ntitle: b\n---\n", ""),
        _make_doc("知识库/wiki/entities/a.md", "", "无块"),
        _make_doc("知识库/raw/precleaned/c.md", "---\ntitle: c\n---\n", ""),
        _make_doc("zz-outside.md", "", "库外"),
    ]))
    pairs = list(doc_consumption.iter_documents(envelope, prefixes=("知识库/wiki/entities/",)))
    assert [rel for rel, _ in pairs] == ["知识库/wiki/entities/a.md", "知识库/wiki/entities/b.md"]
    all_pairs = list(doc_consumption.iter_documents(envelope))
    assert [rel for rel, _ in all_pairs] == sorted(rel for rel, _ in all_pairs)


# ── 真实集成：ensure 物化（真实 node 子进程）──

def test_ensure_materializes_envelope_with_real_node(tmp_path, monkeypatch):
    """层级＝真实集成：真实 vault 目录＋真实 node 子进程物化，产物可读且文档在册。"""
    knowledge = tmp_path / "知识库"
    (knowledge / "wiki" / "entities").mkdir(parents=True)
    (knowledge / "wiki" / "entities" / "comp.md").write_text(
        "---\ntitle: comp\narch_component: true\n---\n\n依赖::[[dep]]\n", encoding="utf-8"
    )
    monkeypatch.delenv("DOC_ENVELOPE_PATH", raising=False)
    out = doc_consumption.ensure_doc_envelope(str(tmp_path))
    assert os.environ.get("DOC_ENVELOPE_PATH") == out
    assert Path(out).is_file()
    envelope = doc_consumption.load_for_vault(str(tmp_path))
    assert "知识库/wiki/entities/comp.md" in envelope.paths()


def test_ensure_fails_closed_when_node_unreachable(tmp_path, monkeypatch):
    """层级＝故障形态：node 不可达 → DocEnvelopeError 显式失败，零回落自读。"""
    monkeypatch.delenv("DOC_ENVELOPE_PATH", raising=False)
    monkeypatch.setenv("PATH", "")
    with pytest.raises(DocEnvelopeError, match="DOC_ENVELOPE_MATERIALIZE_FAILED"):
        doc_consumption.ensure_doc_envelope(str(tmp_path))


def test_ensure_short_circuits_on_existing_env(monkeypatch):
    """拉起链同份语义：DOC_ENVELOPE_PATH 已设（runner／server 注入）→ 短路不重物化。"""
    monkeypatch.setenv("DOC_ENVELOPE_PATH", "/tmp/nonexistent-just-pass-through.json")
    assert doc_consumption.ensure_doc_envelope("/anywhere") == "/tmp/nonexistent-just-pass-through.json"
