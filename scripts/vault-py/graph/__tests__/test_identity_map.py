"""WP-215（PR-339／D-1 B／D-2 B／D-3 A）——身份映射纯单元测试。

层级＝纯单元（tmpdir，不触真库）。判据形状随既有 house law：
每条负断言配正对照；改名迁移必须「同 id」断言（差分自证——旧拼名形态下
改名必产生新号，本套件断言的是同一号）。
"""
import json
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_HERE))

from identity_map import IdentityMap, sha16_of  # noqa: E402


def _fresh(tmp_path):
    return IdentityMap(str(tmp_path))


def test_首见铸造并持久复用(tmp_path):
    """首见铸 UUIDv4，落盘重载后同号——身份不随进程漂移。"""
    m = _fresh(tmp_path)
    id1 = m.product_id("产品甲")
    assert id1 and id1 != "product-产品甲", "拼名形态必须被替换（差分自证）"
    m.save()
    m2 = IdentityMap(str(tmp_path))
    assert m2.product_id("产品甲") == id1, "重载后必须同号（持久复用）"


def test_别名改名迁移同一身份不换号(tmp_path):
    """D-1 B 核心：旧名在册、新名缺位、via 名给出 → 同 id 迁移＋renamedFrom 线性。"""
    m = _fresh(tmp_path)
    id1 = m.product_id("旧名")
    m.save()

    id2 = m.product_id("新名", via_name="旧名")
    assert id2 == id1, "改名迁移必须同一身份号（拼名形态下这里是新号——本断言即差分）"
    assert m.data["products"]["新名"]["renamedFrom"] == "旧名"
    assert "旧名" not in m.data["products"], "旧键移除——别名解析恒先于查询，旧名不再直查"
    assert m.data["renames"][-1] == {"from": "旧名", "to": "新名", "at": m.data["renames"][-1]["at"]}


def test_无via信号不迁移照常铸造(tmp_path):
    """负对照：新名缺 via（旧名信号）→ 正常铸造新号，不猜改名。"""
    m = _fresh(tmp_path)
    id1 = m.product_id("旧名")
    id2 = m.product_id("新名")
    assert id2 != id1, "无改名信号不得迁移（fail-closed：歧义不猜）"


def test_注册表显式身份最高权威(tmp_path):
    """D-3 A「人给就沿用」：registry_identity 在场即用它，并同步进映射保单一事实。"""
    m = _fresh(tmp_path)
    id1 = m.product_id("产品甲")
    id2 = m.product_id("产品甲", registry_identity="explicit-001")
    assert id2 == "explicit-001" and id2 != id1, "人给身份必须压过铸造身份"
    assert m.data["products"]["产品甲"]["id"] == "explicit-001"


def test_文档同内容精确迁移(tmp_path):
    """D-2 B：路径变更＋sha16 精确匹配 → 同 id 迁移，migratedFrom 可观测。"""
    m = _fresh(tmp_path)
    id1, _ = m.doc_id("知识库/old.md", sha16_of("aaaabbbbccccdddd"))
    m.save()
    id2, moved_from = m.doc_id(
        "知识库/new.md", sha16_of("aaaabbbbccccdddd"), current_paths={"知识库/new.md"}
    )
    assert id2 == id1, "同内容移动必须保号"
    assert moved_from == "知识库/old.md"
    assert "知识库/old.md" not in m.data["docs"]


def test_旧路径仍在册不迁移(tmp_path):
    """负对照：旧路径本轮仍在（没真移动）→ sha16 撞上也不迁（防双路径同身份）。"""
    m = _fresh(tmp_path)
    id1, _ = m.doc_id("知识库/a.md", sha16_of("aaaabbbbccccdddd"))
    id2, moved = m.doc_id("知识库/b.md", sha16_of("aaaabbbbccccdddd"), current_paths={"知识库/a.md", "知识库/b.md"})
    assert moved == "" and id2 != id1, "在册路径必须被排除出迁移候选"


def test_内容也变不猜迁移(tmp_path):
    """歧义（移动＋改内容）＝新身份，不猜——fail-closed；幽灵清理归 PR-337。"""
    m = _fresh(tmp_path)
    id1, _ = m.doc_id("知识库/a.md", sha16_of("aaaabbbbccccdddd"))
    id2, moved = m.doc_id("知识库/b.md", sha16_of("ffff000011112222"), current_paths={"知识库/b.md"})
    assert moved == "" and id2 != id1


def test_在册路径直查不迁移(tmp_path):
    """正对照：路径没动 → 直查同号（迁移逻辑不影响常态）。"""
    m = _fresh(tmp_path)
    id1, _ = m.doc_id("知识库/a.md", sha16_of("aaaabbbbccccdddd"))
    id2, moved = m.doc_id("知识库/a.md", sha16_of("aaaabbbbccccdddd"), current_paths={"知识库/a.md"})
    assert id2 == id1 and moved == ""


def test_save只在dirty时落盘(tmp_path):
    """预览语义：未 dirty 不产生文件；dirty 才原子落盘。"""
    m = _fresh(tmp_path)
    m.save()
    assert not (tmp_path / "identity_map.json").exists(), "无变更不得写盘"
    m.product_id("产品甲")
    m.save()
    data = json.loads((tmp_path / "identity_map.json").read_text(encoding="utf-8"))
    assert data["products"]["产品甲"]["id"]


# ── 红队复核必修项回归（WP-215 批5，2026-11-22） ──

def test_R1_损坏账本fail_closed拒跑(tmp_path):
    """红队 R1：文件在但解析失败/形状非法 → IdentityMapCorrupt 拒跑，禁止静默重铸。"""
    import pytest
    from identity_map import IdentityMapCorrupt
    truncated = tmp_path / "identity_map.json"
    truncated.write_text('{"version": 1, "products": {"A": {"id": "abc"', encoding="utf-8")
    with pytest.raises(IdentityMapCorrupt):
        IdentityMap(str(tmp_path))
    bad_shape = tmp_path / "identity_map.json"
    bad_shape.write_text('{"version": 1, "products": {"A": {"id": 424242}}, "docs": {}, "renames": []}', encoding="utf-8")
    with pytest.raises(IdentityMapCorrupt):
        IdentityMap(str(tmp_path))


def test_R1_删除账本等于全新库_照常铸造(tmp_path):
    """红队 R1 边界如实记：文件不存在＝全新库（与「删除账本」不可区分）——首见铸造，不拒跑。"""
    m = _fresh(tmp_path)
    assert m.product_id("产品甲"), "空库首铸必须可用"


def test_R3_别名迟到窗口按声明方向合并(tmp_path, capsys):
    """红队 R3：两侧都在册异号 → 按声明方向合并（新名继承旧号）＋stderr 大声告警，禁静默双号。"""
    m = _fresh(tmp_path)
    old_id = m.product_id("旧名")
    new_id = m.product_id("新名")  # 迟到场景：文章先改新名铸了新号
    assert new_id != old_id
    m.apply_alias_renames({"旧名": "新名"})  # 别名后到
    assert m.product_id("新名") == old_id, "按声明方向合并＝新名继承旧号（差分自证：静默并存实现这里必红）"
    assert "旧名" not in m.data["products"], "旧键移除，双号不并存"
    assert m.data["products"]["新名"].get("lateArrival") is True
    assert "IDENTITY_ALIAS_LATE_ARRIVAL" in capsys.readouterr().err, "必须大声告警（零信号＝违反 R3 修法）"


def test_R4_路径命中内容变更_身份保持且指纹更新留痕(tmp_path, capsys):
    """红队 R4：路径命中但 sha16 变更（原位编辑）→ 身份保持＋sha16 更新＋stderr 留痕（静默继承不可接受）。"""
    m = _fresh(tmp_path)
    id1, _ = m.doc_id("知识库/a.md", sha16_of("aaaabbbbccccdddd"))
    id2, moved = m.doc_id("知识库/a.md", sha16_of("ffff000011112222"), current_paths={"知识库/a.md"})
    assert id2 == id1 and moved == "", "原位编辑身份必须保持"
    assert m.data["docs"]["知识库/a.md"]["sha16"] == sha16_of("ffff000011112222"), "指纹必须随内容更新"
    assert "IDENTITY_DOC_CONTENT_CHANGED" in capsys.readouterr().err, "必须留痕（静默＝R4 本犯）"
