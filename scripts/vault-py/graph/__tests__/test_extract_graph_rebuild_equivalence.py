"""WP-215 批2——重建等价性对拍（验收标准 1/3 夹具级证据）。

层级＝纯单元（临时 vault＋信封夹具；不触真库）。两轮「独立抽取运行」对拍：
每轮之间身份映射 save＋新实例（模拟跨进程重建），断言改名/移动后
**节点身份不变、既有边端点不变、抽取输出面端点自洽（零悬空）**。
拼名形态下这三条全红——本套件即差分自证。
"""
import os
import sys
import tempfile
from pathlib import Path

_HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_HERE))

import extract_graph as eg  # noqa: E402
from identity_map import IdentityMap  # noqa: E402
from _vocab_fixture import install_doc_envelope, install_vocab_envelope  # noqa: E402


def _install_doc(root):
    """物化文档信封并强制重载——信封缓存按路径判重，同路径重物化不会被
    _doc_envelope 感知（两轮重建对拍必须各自拿到当轮信封，否则第二轮吃
    第一轮的陈旧信封＝假绿）。"""
    install_doc_envelope(root)
    eg._DOC_ENVELOPE_STATE["path"] = None


def _fresh_vault(monkeypatch, prefix):
    """每测试独立 vault（口径同 test_extract_graph_missing_component_identity）。"""
    root = tempfile.mkdtemp(prefix=prefix)
    knowledge = Path(root, "知识库")
    knowledge.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("KB_VAULT", root)
    monkeypatch.setattr(eg, "VAULT_ROOT", root)
    monkeypatch.setattr(eg, "VAULT", str(knowledge))
    (knowledge / "wiki" / "articles").mkdir(parents=True, exist_ok=True)
    (knowledge / "wiki" / "overview").mkdir(parents=True, exist_ok=True)
    return root, knowledge


def _fresh_map(monkeypatch, tmp_path):
    """每测试独立身份映射（防 _STAGING 跨测试串号）。"""
    m = IdentityMap(str(tmp_path))
    monkeypatch.setattr(eg, "IDENTITY_MAP", m)
    return m


def _rotate_map(monkeypatch):
    """模拟跨进程重建：落盘＋新实例读回。"""
    eg.IDENTITY_MAP.save()
    monkeypatch.setattr(eg, "IDENTITY_MAP", IdentityMap(str(Path(eg.IDENTITY_MAP.path).parent)))


def _product_and_version_ids(nodes, edges):
    pids = [n["id"] for n in nodes if "Product" in n.get("labels", [])]
    vids = [n["id"] for n in nodes if "ProductVersion" in n.get("labels", [])]
    return pids, vids, edges


def test_产品改名经别名声明_身份与版本随稳_边端点不变(monkeypatch, tmp_path):
    """验收标准 1 夹具级对拍：注册表改名＋别名声明后重建——
    product/version 节点同号、APPLIES_TO/HAS_VERSION 端点不变、输出面零悬空。"""
    root, knowledge = _fresh_vault(monkeypatch, "eg-equ-a-")
    _fresh_map(monkeypatch, tmp_path)
    article = knowledge / "wiki" / "articles" / "art-001.md"
    article.write_text(
        "---\ntitle: 测试文章\narticle_id: art-001\nproduct: 旧名\nversion: \"1.0\"\n---\n正文\n",
        encoding="utf-8",
    )
    install_vocab_envelope(root, {
        "versions": "products:\n  旧名:\n    versions:\n      - id: \"1.0\"\n        label: \"1.0\"\n        status: draft\n",
        "enums": "domains: {}\nsubdomains: {}\n",
    })
    _install_doc(root)
    nodes1, edges1, *_ = eg.extract_document_nodes(set(), {}, {})
    pids1, vids1, _ = _product_and_version_ids(nodes1, edges1)
    assert len(pids1) == 1 and len(vids1) == 1, (pids1, vids1)

    _rotate_map(monkeypatch)

    # 改名＝注册表换键＋别名声明＋文章 product 字段改新名（常见顺序：文章先改）
    article.write_text(
        "---\ntitle: 测试文章\narticle_id: art-001\nproduct: 新名\nversion: \"1.0\"\n---\n正文\n",
        encoding="utf-8",
    )
    install_vocab_envelope(root, {
        "versions": "products:\n  新名:\n    versions:\n      - id: \"1.0\"\n        label: \"1.0\"\n        status: draft\n",
        "enums": "domains: {}\nsubdomains: {}\narchitecture_projection:\n  product_aliases:\n    旧名: 新名\n",
    })
    _install_doc(root)
    nodes2, edges2, *_ = eg.extract_document_nodes(set(), {}, {})
    pids2, vids2, _ = _product_and_version_ids(nodes2, edges2)
    assert len(pids2) == 1 and len(vids2) == 1, (pids2, vids2)

    assert pids2[0] == pids1[0], f"改名后 product 必须同号（拼名形态下是新号——差分）：{pids1}→{pids2}"
    assert vids2[0] == vids1[0], f"product 保号则版本身份随稳：{vids1}→{vids2}"
    assert eg.IDENTITY_MAP.data["renames"], "改名线性必须在册"
    assert eg.IDENTITY_MAP.data["renames"][-1]["from"] == "旧名"

    node_ids2 = {n["id"] for n in nodes2}
    for e in edges2:
        assert e["source"] in node_ids2 and e["target"] in node_ids2, (
            f"抽取输出面端点必须自洽（验收标准 3 本包份）：{e}"
        )


def test_文档移动同内容_身份随迁_零悬空(monkeypatch, tmp_path):
    """验收标准 1/3 的文档半边：无 article_id 文档移动（内容不变）重建后同号。"""
    root, knowledge = _fresh_vault(monkeypatch, "eg-equ-b-")
    _fresh_map(monkeypatch, tmp_path)
    note = knowledge / "wiki" / "overview" / "move-note.md"
    note.write_text("---\ntitle: 搬迁笔记\n---\n正文原样\n", encoding="utf-8")
    install_vocab_envelope(root)
    _install_doc(root)
    nodes1, _e1, *_ = eg.extract_document_nodes(set(), {}, {})
    docs1 = {n["id"]: n for n in nodes1 if "Document" in n.get("labels", [])}
    assert len(docs1) == 1, docs1
    d1 = next(iter(docs1))
    assert not d1.startswith("doc-"), f"fallback 必须走身份映射（拼名退役——差分）：{d1}"

    _rotate_map(monkeypatch)

    moved = knowledge / "wiki" / "overview" / "moved-note.md"
    moved.write_text("---\ntitle: 搬迁笔记\n---\n正文原样\n", encoding="utf-8")
    note.unlink()
    _install_doc(root)
    nodes2, _e2, *_ = eg.extract_document_nodes(set(), {}, {})
    docs2 = {n["id"]: n for n in nodes2 if "Document" in n.get("labels", [])}
    assert len(docs2) == 1 and next(iter(docs2)) == d1, f"同内容移动必须保号：{d1}→{list(docs2)}"
    moved_key = next(k for k, v in eg.IDENTITY_MAP.data["docs"].items() if v["id"] == d1)
    assert eg.IDENTITY_MAP.data["docs"][moved_key]["renamedFrom"] == "wiki/overview/move-note.md"


def test_别名预迁移幂等且无在册旧名时无操作(monkeypatch, tmp_path):
    """apply_alias_renames 负对照：新名已在册（迁过）→ 幂等无操作；旧名不在册 → 无操作。"""
    _fresh_vault(monkeypatch, "eg-equ-c-")
    m = _fresh_map(monkeypatch, tmp_path)
    id1 = m.product_id("旧名")
    m.apply_alias_renames({"旧名": "新名"})
    assert m.product_id("新名") == id1, "首迁保号"
    m.apply_alias_renames({"旧名": "新名"})
    assert m.product_id("新名") == id1, "重放幂等"
    assert len(m.data["renames"]) == 1, "线性不重复记账"
    m.apply_alias_renames({"不在册": "别的新名"})
    assert m.product_id("别的新名") != id1 and "不在册" not in m.data["products"], "无在册旧名即无操作"
