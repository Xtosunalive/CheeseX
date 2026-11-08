"""WP-107 D1（SPEC-046 I3／PR-231）——建图撞键不再 last wins：纯单元函数级断言。

层级＝纯单元（临时 vault 结构只为满足 kb_paths 模块级解析，不触真库）。
判据形状随本仓既有 house law：违规产物物理不产出＋可定位明细；
每条负断言都配正对照（同来源覆盖语义、异 id 正常产出），防"把对的也杀掉"式假绿。
"""
import os
import sys
import tempfile
from pathlib import Path

_TMP = tempfile.mkdtemp(prefix="eg-identity-conflict-")
(Path(_TMP) / "知识库").mkdir(parents=True, exist_ok=True)
os.environ["KB_VAULT"] = _TMP
os.environ.setdefault("KB_DATA_DIR", str(Path(_TMP) / "data"))
_HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_HERE))

import extract_graph as eg  # noqa: E402


def _node(nid, source, label=None):
    return {"id": nid, "label": label or nid, "properties": {"source_file": source}}


def test_同id两来源整批不产出且点名两处():
    """撞键：两个不同文件声明同一身份 → 图上不出现该键，冲突登记点名两处来源。"""
    nodes = [_node("mysql-primary", "wiki/entities/a.md"), _node("mysql-primary", "wiki/entities/b.md")]
    kept, conflicts = eg.dedupe_nodes_keep_conflicts(nodes)
    assert kept == [], "撞键节点必须整批不产出（旧语义 last wins 会保留 1 个——本断言即差分）"
    assert set(conflicts) == {"mysql-primary"}, "冲突字典须登记该键"
    group, sources = conflicts["mysql-primary"]
    assert len(group) == 2 and sources == ["wiki/entities/a.md", "wiki/entities/b.md"], sources


def test_同id同来源仍按覆盖语义保留一个():
    """正对照：同一份文件被两条通道各建一次不算撞键——覆盖语义不许被误杀。"""
    nodes = [_node("mysql-primary", "wiki/entities/a.md"), _node("mysql-primary", "wiki/entities/a.md")]
    kept, conflicts = eg.dedupe_nodes_keep_conflicts(nodes)
    assert conflicts == {}, "同来源不算撞键"
    assert len(kept) == 1 and kept[0]["id"] == "mysql-primary", kept


def test_异id正常全部产出零冲突():
    """正对照：正常库不受影响（否则本判据就成了全图拒产的假红）。"""
    nodes = [_node("a", "wiki/entities/a.md"), _node("b", "wiki/entities/b.md")]
    kept, conflicts = eg.dedupe_nodes_keep_conflicts(nodes)
    assert conflicts == {} and len(kept) == 2, (kept, conflicts)


def test_缺来源标记按标签兜底不逃判():
    """来源取不到时兜底非空——否则两节点都拿空串会被判成"同来源"而静默放过（匿名排除形态）。"""
    nodes = [{"id": "k", "label": "甲"}, {"id": "k", "label": "乙"}]
    kept, conflicts = eg.dedupe_nodes_keep_conflicts(nodes)
    assert set(conflicts) == {"k"}, conflicts
    assert conflicts["k"][1] == sorted(["<无来源标记:甲>", "<无来源标记:乙>"]), conflicts["k"][1]
    assert all(conflicts["k"][1]), "兜底值不得为空——空串会让两节点被判成同来源而静默放过"
    assert kept == []
