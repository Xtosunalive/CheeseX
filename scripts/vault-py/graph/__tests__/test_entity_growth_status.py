"""PR-284 回归：实体生长模板初始 status 消费词表盖章缺省（四值状态机单源），
legacy 三值经 legacy_status_map 归一后再进健康灯聚合。层级：函数级单元（信封供数）
＋本地 CLI 进程集成，均使用独立临时数据。"""
import json
import os
import subprocess
import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path

import pytest

# 模块级 vault 解析（kb_paths.vault_roots）要求 <KB_VAULT>/知识库 存在——先建临时结构再 import 被测模块
_TMP = tempfile.mkdtemp(prefix="eg-growth-")
(_T := Path(_TMP) / "知识库").mkdir(parents=True, exist_ok=True)
os.environ["KB_VAULT"] = _TMP
os.environ.setdefault("KB_DATA_DIR", str(Path(_TMP) / "data"))
_HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_HERE))
sys.path.insert(0, str(_HERE.parents[1] / "vault-runtime"))
sys.path.insert(0, str(_HERE.parents[1] / "vault-runtime" / "__tests__"))

from _vocab_fixture import install_doc_envelope, install_vocab_envelope  # noqa: E402

import extract_graph as eg  # noqa: E402
import schema_loader  # noqa: E402

# 与仓内主源 data/theschema/enums.yaml lifecycle 段同形（受控四值＋盖章缺省＋legacy 映射）
LIFECYCLE = {
    "status": ["灰度", "在线", "退役", "已驳回"],
    "default_status": "灰度",
    "legacy_status_map": {"制定中": "灰度", "有效": "在线", "已归档": "退役"},
}
FOUR_VALUES = set(LIFECYCLE["status"])


@pytest.fixture
def growth_vault(tmp_path, monkeypatch):
    """临时知识库根＋带 lifecycle 的词表信封；extract_graph.VAULT 指到临时根。"""
    knowledge = tmp_path / "知识库"
    (knowledge / "wiki/entities").mkdir(parents=True)
    install_vocab_envelope(str(tmp_path), {"enums": {"lifecycle": dict(LIFECYCLE)}})
    monkeypatch.setattr(eg, "VAULT", str(knowledge))
    yield knowledge
    schema_loader.reset_envelope_cache()


def test_growth_stub_status_hits_four_controlled_values(growth_vault):
    """PR-284 验收：生长产物 status 命中四受控值，且＝盖章缺省（非 legacy 三值）。"""
    eg._ensure_entity_stubs({"NewEntity": "entity-new"})
    page = growth_vault / "wiki/entities/NewEntity.md"
    assert page.is_file()
    status_lines = [ln for ln in page.read_text(encoding="utf-8").splitlines()
                    if ln.startswith("status:")]
    assert len(status_lines) == 1
    value = status_lines[0].split(":", 1)[1].strip()
    assert value in FOUR_VALUES
    assert value == LIFECYCLE["default_status"]


def test_growth_stub_missing_default_fails_loud(tmp_path, monkeypatch):
    """写路径 fail-closed：词表缺 lifecycle.default_status＝硬错，不回落猜 legacy 值。"""
    install_vocab_envelope(str(tmp_path))  # 最小信封（无 lifecycle 段）
    (tmp_path / "知识库/wiki/entities").mkdir(parents=True)
    monkeypatch.setattr(eg, "VAULT", str(tmp_path / "知识库"))
    try:
        with pytest.raises(RuntimeError, match="default_status"):
            eg._ensure_entity_stubs({"NewEntity": "entity-new"})
    finally:
        schema_loader.reset_envelope_cache()


@pytest.mark.parametrize("status,expected", [
    # legacy 三值经 legacy_status_map 归一（制定中→灰度／有效→在线／已归档→退役）
    ("制定中", "yellow"), ("有效", "green"), ("已归档", "red"),
    # 四受控值直判（已驳回＝驳族群，与退役同红——reject 主轨落退役、独立值已驳回）
    ("灰度", "yellow"), ("在线", "green"), ("退役", "red"), ("已驳回", "red"),
    ("", "green"),
])
def test_health_normalizes_legacy_and_four_values(growth_vault, status, expected):
    assert eg._health_from_statuses([status], [""]) == expected


def test_health_expiry_behavior_preserved(growth_vault):
    past = (date.today() - timedelta(days=5)).isoformat()
    soon = (date.today() + timedelta(days=10)).isoformat()
    assert eg._health_from_statuses(["在线"], [past]) == "red"     # 已过期
    assert eg._health_from_statuses(["在线"], [soon]) == "yellow"  # 30 天内到期
    assert eg._health_from_statuses(["在线"], [""]) == "green"


def test_auto_fix_recognizes_new_default_stub(tmp_path, monkeypatch):
    """生长模板改缺省值后，占位页识别锚模板标记句：新缺省模板可清，无标记句的人写页保留。"""
    monkeypatch.delenv("DOC_ENVELOPE_PATH", raising=False)
    knowledge = tmp_path / "知识库"
    entities = knowledge / "wiki/entities"
    entities.mkdir(parents=True)
    # 新缺省模板形态占位页（status=灰度＋模板标记句）
    stub = entities / "Stub-Entity.md"
    stub.write_text(
        "---\nstatus: 灰度\n---\n\n# Stub-Entity\n\n## 概述\n\n（自动创建的占位页面，待补充内容）\n",
        encoding="utf-8")
    # 人手写短页：无模板标记句——即便 status 是 legacy 值也不构成占位删除依据
    hand = entities / "HandWritten.md"
    hand.write_text("---\nstatus: 制定中\n---\n\n# HandWritten\n\n人写的短页。\n", encoding="utf-8")
    data = tmp_path / "data"
    graph = data / "staging/master_graph.json"
    graph.parent.mkdir(parents=True)
    graph.write_text(json.dumps({"nodes": [
        {"id": "n1", "labels": ["Entity"],
         "properties": {"name": "Stub-Entity", "file_path": "知识库/wiki/entities/Stub-Entity.md"}},
        {"id": "n2", "labels": ["Entity"],
         "properties": {"name": "HandWritten", "file_path": "知识库/wiki/entities/HandWritten.md"}},
    ], "connections": []}), encoding="utf-8")
    envelope = install_doc_envelope(str(tmp_path))
    try:
        result = subprocess.run(
            [sys.executable, str(_HERE / "validate_graph.py"), "--auto-fix"],
            env={**os.environ, "KB_VAULT": str(tmp_path), "KB_DATA_DIR": str(data),
                 "DOC_ENVELOPE_PATH": str(envelope)},
            capture_output=True, text=True, timeout=60,
        )
        assert result.returncode == 0, (result.stdout, result.stderr)
        assert not stub.exists(), result.stdout   # 模板占位页（灰度）被自动清理
        assert hand.is_file(), result.stdout      # 无标记句的人写页保留
    finally:
        schema_loader.reset_envelope_cache()
