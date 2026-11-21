"""WP-215 接线层测试——extract_graph 身份构造函数的稳定性与迁移接线。

层级＝纯单元（conftest 临时 vault；不触真库）。
- _product_id：拼名形态退役，走 IDENTITY_MAP（铸造/复用/迁移接线）
- _version_id：确定性派生（product 稳定身份＋版本值），product 迁移后版本随稳
- node_id_for_file：退役空壳（NotImplementedError 防回潮）
改名迁移的完整语义（renamedFrom/renames 线性/旧键移除）在
test_identity_map.py 已单元覆盖；本件测的是 extract_graph 把 via_name 与
canonical 正确传进映射层（接线差分）。
"""
import os
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_HERE))

import extract_graph as eg  # noqa: E402
from identity_map import IdentityMap  # noqa: E402


def test_product_id走映射铸造且复用():
    """_product_id 首见铸造、复调用同号——不再依赖产品名拼写。"""
    id1 = eg._product_id("某产品")
    id2 = eg._product_id("某产品")
    assert id1 == id2, "同规范名必须同号"
    assert not id1.startswith("product-"), "拼名形态必须退役（差分自证）"


def test_product_id接线传递via名触发迁移():
    """接线差分：解析器给出 canonical（新名）而原文（via）是旧名时，映射层迁移同号。

    模拟真实链路＝product_aliases 声明改名后 resolve_product_identity 把旧名解析成
    新规范名；extract_graph 必须把原文作为 via 名传入（信号面）。monkeypatch 只替
    解析器返回值，不触注册表装载。"""
    m = eg.IDENTITY_MAP
    old_id = m.product_id("旧产品名")

    original = eg.schema_loader.resolve_product_identity

    def fake_resolve(raw):
        if str(raw).strip() == "旧产品名":
            return {"canonical": "新产品名", "registered": True, "reserved": False}
        return original(raw)

    eg.schema_loader.resolve_product_identity = fake_resolve
    try:
        wired_id = eg._product_id("旧产品名")
    finally:
        eg.schema_loader.resolve_product_identity = original

    assert wired_id == old_id, "改名经别名解析后必须同一身份号（拼名形态下是新号——差分）"
    assert m.data["products"]["新产品名"]["renamedFrom"] == "旧产品名"


def test_version_id随product稳定且确定性派生():
    """版本身份＝(product 稳定身份, 版本值) 确定性派生：同输入同号、零持久化。"""
    v1a = eg._version_id("某产品", "1.0")
    v1b = eg._version_id("某产品", "1.0")
    v2 = eg._version_id("某产品", "2.0")
    assert v1a == v1b, "同 product+版本必须同号"
    assert v2 != v1a, "不同版本必须异号"
    assert not v1a.startswith("version-"), "拼名形态必须退役（差分自证）"


def test_version_id在product改名迁移后随稳():
    """改名迁移后 pid 不变 → 版本身份跟着不变（验收标准 1 的版本半边）。"""
    m = eg.IDENTITY_MAP
    v_before = eg._version_id("某产品", "1.0")
    m.product_id("某产品", via_name=None)  # 幂等：确保在册
    id_before = m.product_id("某产品")
    # 直接以迁移语义改写（与 test_identity_map 迁移同款），版本身份必须随稳
    m.product_id("某产品改名后", via_name="某产品")
    assert m.product_id("某产品改名后") == id_before, "迁移必须保号"
    v_after = eg._version_id("某产品改名后", "1.0")
    assert v_after == v_before, "product 保号则版本身份必须随稳"


def test_node_id_for_file已退役():
    """拼名 fallback 撤销——调用即显式错（防历史调用回潮隐匿）。"""
    import pytest

    with pytest.raises(NotImplementedError):
        eg.node_id_for_file("知识库/x.md")


def test_不同产品异号(tmp_path):
    """正对照：不同规范名各自铸造异号（映射不串号）。"""
    m = IdentityMap(str(tmp_path))
    a = m.product_id("产品A")
    b = m.product_id("产品B")
    assert a != b
