"""WP-031 拓扑缺口豁免闭环——抽取侧测试。层级：纯单元（临时 vault 结构＋函数级断言）。

验证对象：
  ① _frontmatter_exempt_rules 宽容读（字符串单值/非串项忽略/去空白）
  ② extract_entity_nodes：自建节点 exempt_rules 随 props 入图；is_system 分支收集为 node_exemptions
  ③ 主流程 merge 以本次文档扫描为准（删规则→清残留，防旧图陈旧豁免）
"""
import os
import sys
import tempfile
from pathlib import Path

_TMP = tempfile.mkdtemp(prefix="eg-exempt-")
(_T := Path(_TMP) / "知识库").mkdir(parents=True, exist_ok=True)
os.environ["KB_VAULT"] = _TMP
os.environ.setdefault("KB_DATA_DIR", str(Path(_TMP) / "data"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from _vocab_fixture import install_doc_envelope

import extract_graph as eg  # noqa: E402


def test_frontmatter_exempt_rules_tolerant_read():
    assert eg._frontmatter_exempt_rules({"exempt_rules": ["a", " b ", ""]}) == ["a", "b"]
    assert eg._frontmatter_exempt_rules({"exempt_rules": "isolated_entity"}) == ["isolated_entity"]
    assert eg._frontmatter_exempt_rules({"exempt_rules": [1, None, "x"]}) == ["1", "x"]
    assert eg._frontmatter_exempt_rules({}) == []
    assert eg._frontmatter_exempt_rules({"exempt_rules": {"bad": "shape"}}) == []


def _fresh_vault(monkeypatch, prefix):
    """每测试独立 vault——避免共享临时目录的顺序耦合（实录教训）。"""
    root = tempfile.mkdtemp(prefix=prefix)
    Path(root, "知识库").mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("KB_VAULT", root)
    monkeypatch.setattr(eg, "VAULT", root)
    monkeypatch.setattr(eg, "VAULT_ROOT", root)
    ents = Path(root) / "wiki" / "entities"
    ents.mkdir(parents=True, exist_ok=True)
    return root, ents


def test_entity_node_carries_exemptions(monkeypatch):
    _root, ents = _fresh_vault(monkeypatch, "eg-exempt-a-")
    (ents / "svc-a.md").write_text(
        "---\ntitle: A\nexempt_rules:\n  - isolated_entity\n  - low_confidence\n---\n正文",
        encoding="utf-8",
    )
    (ents / "svc-b.md").write_text("---\ntitle: B\n---\n正文", encoding="utf-8")
    install_doc_envelope(_root)  # WP-117 批2：文档面经信封供给（写面完成后物化）

    nodes, edges, deps, unresolved, exemptions = eg.extract_entity_nodes(set(), {})
    by_name = {n["properties"]["name"]: n for n in nodes}
    # 红队修正后：自建节点豁免也走 node_exemptions 单通道（props 直写会被主流程 merge 误删）
    assert "exempt_rules" not in by_name["svc-a"]["properties"]
    assert exemptions == {"entity-svc-a": ["isolated_entity", "low_confidence"]}


def test_is_system_branch_collects_exemptions(monkeypatch):
    """is_system 分支（节点他处创建）→ exemptions dict 由主流程收尾 merge。"""
    _root, ents = _fresh_vault(monkeypatch, "eg-exempt-b-")
    (ents / "legacy.md").write_text(
        "---\narchitecture-node-id: sys:x\nexempt_rules: [cross_domain_ref]\n---\n正文",
        encoding="utf-8",
    )

    install_doc_envelope(_root)
    nodes, _edges, _deps, _unresolved, exemptions = eg.extract_entity_nodes({"sys:x"}, {})
    assert nodes == []  # is_system 且未晋升 → 不自建节点
    assert exemptions == {"sys:x": ["cross_domain_ref"]}


def test_early_return_arity():
    """entities 目录缺失 → 5 元返回（WP-031 前为 3 元潜伏炸点——主流程 4 元解构，顺手修正）。"""
    monkey_dir = tempfile.mkdtemp(prefix="eg-empty-")
    import extract_graph as mod
    old = mod.VAULT
    mod.VAULT = os.path.join(monkey_dir, "nonexistent")
    try:
        # WP-117 批2：目录缺失形态＝信封过滤空清单（各根前缀过滤下无文档命中），同形 5 元返回
        result = mod.extract_entity_nodes(set(), {})
        assert len(result) == 5
        assert result[4] == {}
    finally:
        mod.VAULT = old
