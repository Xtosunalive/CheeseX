"""PR-095 出生章测试——断言政策 decision_mode 驱动 reviewStatus 初值。

层级：纯单元（政策表直喂纯函数）＋破坏实验（政策翻转→同边重新入队）。
对照真实政策源：data/theschema/ontology.yaml relation_types[].assertion_policies。
"""
import os
import sys
import tempfile
from pathlib import Path

# 模块级 vault 解析（kb_paths.vault_roots）要求 <KB_VAULT>/知识库 存在——先建临时结构再 import
_TMP = tempfile.mkdtemp(prefix="eg-stamp-")
(_T := Path(_TMP) / "知识库").mkdir(parents=True, exist_ok=True)
os.environ["KB_VAULT"] = _TMP
os.environ.setdefault("KB_DATA_DIR", str(Path(_TMP) / "data"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import extract_graph as eg  # noqa: E402

# 政策样本按 ontology.yaml 真实形状构造（decision_mode/source_kind 取现役值）
POLICIES = {
    "BELONGS_TO": [
        {"source_kind": "category_path", "decision_mode": "deterministic"},
        {"source_kind": "auto-discovered", "decision_mode": "deterministic"},
        {"source_kind": "plate-aggregation", "decision_mode": "deterministic"},
    ],
    "HAS_VERSION": [
        {"source_kind": "version_registry", "decision_mode": "deterministic"},
        {"source_kind": "version-inference", "decision_mode": "deterministic"},
    ],
    "DOCUMENTS": [
        {"source_kind": "article_association", "decision_mode": "inherit_source_approval"},
        {"source_kind": "article-association-override", "decision_mode": "inherit_source_approval"},
    ],
    "MENTIONS": [{"source_kind": "derived", "decision_mode": "derived_only"}],
    "DEPENDS_ON": [
        {"source_kind": "typed_wikilink", "decision_mode": "reviewed"},
        {"source_kind": "entity-wikilink", "decision_mode": "reviewed"},
    ],
    "USES": [{"source_kind": "legacy_graph", "decision_mode": "forbidden"}],
    "REFERENCES": [
        {"source_kind": "wikilink", "decision_mode": "inherit_source_approval"},
        {"source_kind": "document-body", "decision_mode": "inherit_source_approval"},
        {"source_kind": "team-placeholder", "decision_mode": "derived_only"},
        {"source_kind": "multi-source-inference", "decision_mode": "reviewed"},
    ],
}


def test_deterministic_stamp():
    """规则即有效：deterministic 政策边出厂直接派生生效（PR-095 主诉求——结构边不进人裁队列）"""
    assert eg._policy_review_status("BELONGS_TO", {"source": "auto-discovered"}, POLICIES) == "deterministic"
    assert eg._policy_review_status("HAS_VERSION", {"source": "version-inference"}, POLICIES) == "deterministic"


def test_inherit_requires_decision_evidence():
    """继承章必须能指回裁定证据：带 decisionId→inherited_approved；指不回→pending（fail-closed）"""
    override = {"source": "article-association-override", "decisionId": "d-123"}
    assert eg._policy_review_status("DOCUMENTS", override, POLICIES) == "inherited_approved"
    no_evidence = {"source": "article-association-override"}
    assert eg._policy_review_status("DOCUMENTS", no_evidence, POLICIES) == "pending"


def test_fail_closed_everywhere():
    """政策缺失／多政策对不上／reviewed／derived_only／forbidden → 一律 pending"""
    assert eg._policy_review_status("UNKNOWN_TYPE", {"source": "x"}, POLICIES) == "pending"
    # document-mount（前置关联边回退标签）在 DOCUMENTS 两政策中无同名对位 → pending
    assert eg._policy_review_status("DOCUMENTS", {"source": "document-mount"}, POLICIES) == "pending"
    assert eg._policy_review_status("DEPENDS_ON", {"source": "typed_wikilink"}, POLICIES) == "pending"
    assert eg._policy_review_status("MENTIONS", {"source": "keyword-match"}, POLICIES) == "pending"
    assert eg._policy_review_status("USES", {"source": "auto-discovered"}, POLICIES) == "pending"
    # 空政策表（装载失败形态）整体 pending
    assert eg._policy_review_status("BELONGS_TO", {"source": "auto-discovered"}, {}) == "pending"


def test_destructive_flip_requeues():
    """破坏实验：政策 deterministic→reviewed 后同边翻回 pending（重新入待复核队）——政策驱动、可逆执法"""
    flipped = {"BELONGS_TO": [{"source_kind": "auto-discovered", "decision_mode": "reviewed"}]}
    assert eg._policy_review_status("BELONGS_TO", {"source": "auto-discovered"}, flipped) == "pending"
    # 复原后回到派生生效
    assert eg._policy_review_status("BELONGS_TO", {"source": "auto-discovered"}, POLICIES) == "deterministic"


# ── WP-006 第3项：政策拒产闸（derived_only/forbidden ≡ working_projection=never）──

def test_forbids_production_structural_gate():
    """derived_only/forbidden 政策边产线拒产——违规产物物理不出现"""
    assert eg._policy_forbids_production("MENTIONS", {"source": "keyword-match"}, POLICIES) is True
    assert eg._policy_forbids_production("USES", {"source": "auto-discovered"}, POLICIES) is True
    assert eg._policy_forbids_production("REFERENCES", {"source": "team-placeholder"}, POLICIES) is True
    # 非 never 类：照常产出
    assert eg._policy_forbids_production("BELONGS_TO", {"source": "auto-discovered"}, POLICIES) is False
    assert eg._policy_forbids_production("DEPENDS_ON", {"source": "typed_wikilink"}, POLICIES) is False
    # 多政策对不上（REFERENCES auto-discovered 回退标签）≠ 拒产——fail-closed 只盖 pending 不擅删
    assert eg._policy_forbids_production("REFERENCES", {"source": "auto-discovered"}, POLICIES) is False
    # 未知类型/空政策表：不拒（无声明不执法）
    assert eg._policy_forbids_production("UNKNOWN_TYPE", {"source": "x"}, POLICIES) is False
    assert eg._policy_forbids_production("MENTIONS", {"source": "keyword-match"}, {}) is False


def test_destructive_flip_ungates_production():
    """破坏实验：MENTIONS 政策 derived_only→reviewed 后同边恢复产出——拒产闸政策驱动、可逆"""
    flipped = {"MENTIONS": [{"source_kind": "derived", "decision_mode": "reviewed"}]}
    assert eg._policy_forbids_production("MENTIONS", {"source": "keyword-match"}, flipped) is False
    # 复原后回到拒产
    assert eg._policy_forbids_production("MENTIONS", {"source": "keyword-match"}, POLICIES) is True


# ── PR-095 补口：承运边（existing_only 继承的存量边）两道闸 ──────────────────
# 缺陷实证（2026-10-28）：待审核关系 64 条全是结构边，其中 60 条是 WP-005 已停发的
# subdomain→domain BELONGS_TO。它们每次重建都被 existing_only 继承回来、且从不按政策
# 重盖章（政策 deterministic 却停在 pending）→ 重启/重建都无效。

def test_retired_rules_prune_zombie_structural_edges():
    """退役规则表：生产者已停发的关系类型，其存量边不得继承"""
    assert eg._retired_edge_reason({"relationType": "BELONGS_TO", "properties": {"source": "auto-discovered"}})
    assert eg._retired_edge_reason({"type": "USES", "properties": {"source": "auto-discovered"}})
    assert eg._retired_edge_reason({"relationType": "REFERENCES", "properties": {"source": "team-placeholder"}})
    # 现役关系类型与现役来源照常继承
    assert eg._retired_edge_reason({"relationType": "REFERENCES", "properties": {"source": "wikilink"}}) is None
    assert eg._retired_edge_reason({"relationType": "APPLIES_TO", "properties": {"source": "document-frontmatter"}}) is None
    assert eg._retired_edge_reason({"relationType": "HAS_VERSION", "properties": {"source": "version-inference"}}) is None


def test_carried_edge_stamp_is_policy_authoritative():
    """承运边重盖章：旧图 pending 不是定论，政策 deterministic 的存量边直接派生生效"""
    zombie = {"relationType": "BELONGS_TO", "properties": {"source": "auto-discovered", "reviewStatus": "pending"}}
    assert eg._carried_edge_review_status(zombie, POLICIES) == "deterministic"
    # 继承制政策无裁定证据仍 fail-closed（不因「承运」而放宽）
    no_evidence = {"relationType": "APPLIES_TO", "properties": {"source": "document-frontmatter", "reviewStatus": "pending"}}
    assert eg._carried_edge_review_status(no_evidence, POLICIES) == "pending"
    # 政策装载失败（空表）→ 一律 pending
    assert eg._carried_edge_review_status(zombie, {}) == "pending"
