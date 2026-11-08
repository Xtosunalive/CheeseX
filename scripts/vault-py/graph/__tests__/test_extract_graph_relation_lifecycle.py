"""ADR-014 §4 产出闸回归：已定义但非 approved 的关系不得进入新产出。

层级：纯单元、装载器契约及本地 CLI 进程集成，均使用独立临时数据，不涉及外部服务。
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest
import yaml

_TMP = tempfile.mkdtemp(prefix="eg-lifecycle-")
(Path(_TMP) / "知识库").mkdir(parents=True, exist_ok=True)
os.environ["KB_VAULT"] = _TMP
os.environ.setdefault("KB_DATA_DIR", str(Path(_TMP) / "data"))
_HERE = Path(__file__).resolve().parents[1]  # scripts/vault-py/graph
_EXTRACT = _HERE / "extract_graph.py"
sys.path.insert(0, str(_HERE))

import extract_graph as eg  # noqa: E402
import schema_loader  # noqa: E402

LIFECYCLE = {
    "DEPENDS_ON": "approved",
    "REFERENCES": "retired",
    "MENTIONS": "draft",
    "HAS_VERSION": "submitted",
    "USES": "reserved",
    "BROKEN": "invalid",
}


def test_inactive_relation_reason_pure():
    """纯单元：现役放行；四类非现役一律拒产且报因；未定义关系不归本闸管。"""
    assert eg._inactive_relation_reason({"type": "DEPENDS_ON"}, LIFECYCLE) is None
    for etype, status in (("REFERENCES", "retired"), ("MENTIONS", "draft"),
                          ("HAS_VERSION", "submitted"), ("USES", "reserved")):
        reason = eg._inactive_relation_reason({"type": etype}, LIFECYCLE)
        assert reason and etype in reason and status in reason, reason
    # 未定义关系不在生命周期闸：产出准入仍由断言政策缺省 pending 兜底（不擅删）
    assert eg._inactive_relation_reason({"type": "UNKNOWN"}, LIFECYCLE) is None
    # 显式非法状态（手改 YAML 的 null/空白）fail-closed 拒产
    assert eg._inactive_relation_reason({"type": "BROKEN"}, LIFECYCLE)
    # 图产物两套键名并存：relationType 键同样受闸
    assert eg._inactive_relation_reason({"relationType": "REFERENCES"}, LIFECYCLE)


def test_accessor_reads_all_statuses_from_real_loader():
    """真实 loader 读独立 ontology：全量状态可读，且与现役过滤面分工不混。"""
    from _vocab_fixture import install_vocab_envelope

    saved = {key: os.environ.get(key) for key in ("VOCAB_ENVELOPE_PATH", "KB_VAULT")}
    temp = tempfile.TemporaryDirectory()
    try:
        os.environ["KB_VAULT"] = temp.name
        # WP-049 L3：本体经信封注入；降级收据随信封透传（invalid 标记保留——形态降级不能把
        # 已定义损坏关系变成未知关系，产出闸语义不变）
        install_vocab_envelope(temp.name, {"ontology": {"relation_types": {
            "R_APPROVED": {},
            "R_DRAFT": {"lifecycle_status": "draft"},
            "R_RETIRED": {"lifecycle_status": "retired",
                          "retirement": {"reason": "旧", "replaced_by": "R_APPROVED"}},
            "R_NULL": {"lifecycle_status": None},
            "R_BLANK": {"lifecycle_status": "  "},
        }}})
        lifecycle = schema_loader.ontology_relation_lifecycle()
        assert lifecycle == {
            "R_APPROVED": "approved", "R_DRAFT": "draft", "R_RETIRED": "retired",
            "R_NULL": "invalid", "R_BLANK": "invalid",
        }, lifecycle
        assert set(schema_loader.ontology_relation_types()) == {"R_APPROVED"}
    finally:
        for key, value in saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        schema_loader.reset_envelope_cache()
        temp.cleanup()


def _run_apply(vault_root):
    # WP-117 批2：文档面经信封供给——每轮 spawn 前按当前 vault 重物化（夹具在轮间改写文档）
    from _vocab_fixture import install_doc_envelope

    install_doc_envelope(vault_root)
    env = {
        **os.environ,
        "KB_VAULT": vault_root,
        "KB_DATA_DIR": os.path.join(vault_root, "data"),
    }
    env.pop("THESCHEMA_DIR", None)
    return subprocess.run(
        [sys.executable, str(_EXTRACT), "--apply"],
        env=env, capture_output=True, text=True, timeout=180,
    )


def _write_fixture(vault_root, references_status):
    # WP-049 L3：词表 fixture 经信封注入（Node 装载端口物化；被测抽取零词表文件读取）
    from _vocab_fixture import install_vocab_envelope

    kb = Path(vault_root, "知识库")
    for rel in ("wiki/entities", "raw/precleaned"):
        Path(kb, rel).mkdir(parents=True, exist_ok=True)
    # 实体 + 引用它的文档：文档正文裸链 → REFERENCES 边（该路径类型硬编码，不受 wikilink 触发词面影响）
    Path(kb, "wiki/entities", "svc-target.md").write_text(
        "---\ntitle: 目标实体\n---\n目标实体正文", encoding="utf-8")
    # 实体名映射键为文件名（extract_entity_nodes: entity_name = 文件名去后缀）
    Path(kb, "raw/precleaned", "doc-ref.md").write_text(
        "---\ntitle: 引用文档\n---\n正文引用 [[svc-target]]。", encoding="utf-8")
    if references_status == "retired":
        relation_types = {
            "REFERENCES": {"lifecycle_status": "retired",
                           "retirement": {"reason": "ADR-014 测试退役", "replaced_by": "CITES"}},
            "CITES": {"lifecycle_status": "approved"},
        }
    else:
        relation_types = {"REFERENCES": {"lifecycle_status": "approved"}}
    install_vocab_envelope(vault_root, {
        "enums": {"domains": {"ops": "运维操作"}, "arch_categories": ["服务"]},
        "ontology": {"relation_types": relation_types},
    })


def _connections_of(vault_root, relation_type):
    master = json.loads(Path(vault_root, "data", "staging", "master_graph.json").read_text(encoding="utf-8"))
    return [c for c in master.get("connections", []) if c.get("relationType") == relation_type]


def test_retired_relation_not_produced_and_flip_revives():
    """真实集成：退役关系零产出；翻回 approved 后同一边回来——闸门关系驱动、可逆。"""
    vault = tempfile.mkdtemp(prefix="eg-lifecycle-e2e-")
    _write_fixture(vault, "retired")
    first = _run_apply(vault)
    assert first.returncode == 0, f"第一轮抽取应成功：\n{first.stderr[-800:]}"
    assert "非现役关系拒产" in first.stdout, f"拒产必须显式报告：\n{first.stdout[-800:]}"
    assert _connections_of(vault, "REFERENCES") == [], "非现役关系不得进入新产出"

    _write_fixture(vault, "approved")
    second = _run_apply(vault)
    assert second.returncode == 0, f"第二轮抽取应成功：\n{second.stderr[-800:]}"
    assert _connections_of(vault, "REFERENCES"), "翻回 approved 后同一边应恢复产出"


def test_retired_relation_not_carried_over_from_existing_graph():
    """真实集成（红队反证）：先产边、再退役——存量边不得经 existing_only 继承回图。

    空库起跑的退役测试遮不住承运方向：旧图里的边每次重建都会被 existing_only 带回来，
    若只在「本次产出」闸上过滤，master_graph 仍是退役段位，产线报告成假绿。
    """
    vault = tempfile.mkdtemp(prefix="eg-lifecycle-carry-")
    _write_fixture(vault, "approved")
    first = _run_apply(vault)
    assert first.returncode == 0, f"前置轮应成功：\n{first.stderr[-800:]}"
    assert _connections_of(vault, "REFERENCES"), "前置：approved 期必须真实产出 REFERENCES 边"

    _write_fixture(vault, "retired")
    second = _run_apply(vault)
    assert second.returncode == 0, f"退役轮应成功：\n{second.stderr[-800:]}"
    assert "非现役剔除" in second.stdout, f"承运边剔除必须显式报告：\n{second.stdout[-800:]}"
    assert _connections_of(vault, "REFERENCES") == [], "退役后存量边不得经 existing_only 继承回图"

    _write_fixture(vault, "approved")
    third = _run_apply(vault)
    assert third.returncode == 0, f"恢复轮应成功：\n{third.stderr[-800:]}"
    assert _connections_of(vault, "REFERENCES"), "翻回 approved 后应重新产出"


def test_corrupt_vocab_fails_at_materialization_not_silent_empty():
    """WP-049 L3 语义迁移：坏词表在物化点显式失败（旧「坏 YAML 静默吞成空文档＋空表告警」
    宽面收口——ADR-016 §四-2 fail-closed）；物化失败时抽取根本不启动，既有图不被触碰。"""
    import subprocess as _sp

    vault = tempfile.mkdtemp(prefix="eg-lifecycle-corrupt-")
    _write_fixture(vault, "approved")
    first = _run_apply(vault)
    assert first.returncode == 0, f"前置轮应成功：\n{first.stderr[-800:]}"
    assert _connections_of(vault, "REFERENCES")

    Path(vault, "知识库", "TheSchema", "ontology.yaml").write_text(
        "relation_types: [unclosed", encoding="utf-8")
    dump = _sp.run(
        ["node", str(_HERE.parents[1] / "vault-runtime" / "dump-vocab-envelope.mjs"),
         "--vault", vault, "--out", str(Path(vault, ".ledger", "vocab-envelope.json"))],
        capture_output=True, text=True,
        env={k: v for k, v in os.environ.items() if k != "THESCHEMA_DIR"},
    )
    assert dump.returncode != 0, "坏词表必须在物化点失败，不得静默给空信封"
    assert _connections_of(vault, "REFERENCES"), "物化失败不动既有图（抽取未启动）"


BAD_DEFINITIONS = [
    pytest.param({"lifecycle_status": status, "source_types": 42,
                  **({"retirement": {"reason": "旧定义", "replaced_by": "CITES"}}
                     if status == "retired" else {})}, id=f"{status}-bad-field")
    for status in ("approved", "draft", "submitted", "reserved", "retired")
] + [
    pytest.param({"lifecycle_status": status}, id=name)
    for status, name in ((None, "null"), (False, "false"), (42, "number"),
                         ("", "empty"), ("  ", "blank"))
]


@pytest.mark.parametrize("definition", BAD_DEFINITIONS)
def test_real_loader_keeps_invalid_relation_ids(tmp_path, monkeypatch, definition):
    """装载器契约层：普通及含点 ID 均拒产，真正未知 ID 仍走 pending。"""
    (tmp_path / "知识库").mkdir()
    monkeypatch.setenv("KB_VAULT", str(tmp_path))
    from _vocab_fixture import install_vocab_envelope

    install_vocab_envelope(str(tmp_path), {"ontology": {"relation_types": {
        "REFERENCES": definition, "R.v1": definition,
        "CITES": {}, "R": {}, "HEALTHY": {"lifecycle_status": "approved"},
    }}})
    schema_loader.reset_envelope_cache()
    try:
        assert set(schema_loader.ontology_relation_types()) == {"CITES", "R", "HEALTHY"}
        lifecycle = schema_loader.ontology_relation_lifecycle()
        assert lifecycle == {
            "REFERENCES": "invalid", "R.v1": "invalid", "CITES": "approved",
            "R": "approved", "HEALTHY": "approved",
        }
        for relation_type in ("REFERENCES", "R.v1"):
            reason = eg._inactive_relation_reason({"type": relation_type}, lifecycle)
            assert relation_type in reason and "invalid" in reason
        assert eg._inactive_relation_reason({"type": "HEALTHY"}, lifecycle) is None
        assert eg._inactive_relation_reason({"type": "UNKNOWN.v1"}, lifecycle) is None
        assert eg._policy_review_status("UNKNOWN.v1", {}, {}) == "pending"
    finally:
        schema_loader.reset_envelope_cache()


def _write_degraded_fixture(vault, definition):
    # WP-049 L3：本体 fixture 经信封注入（坏定义由 Node 装载点降级丢弃，见各断言的语义迁移注）
    from _vocab_fixture import install_vocab_envelope

    _write_fixture(str(vault), "approved")
    (vault / "知识库/wiki/entities/svc-source.md").write_text(
        "---\ntitle: 来源实体\n---\n来源实体正文", encoding="utf-8")
    install_vocab_envelope(str(vault), {
        "ontology": {"relation_types": {
            "REFERENCES": definition, "R.v1": definition,
            "CITES": {}, "HEALTHY": {"lifecycle_status": "approved"},
        }},
    })
    inputs = vault / ".pipeline/intermediates/merged_edges.json"
    inputs.parent.mkdir(parents=True, exist_ok=True)
    inputs.write_text(json.dumps([
        {"source": "svc-source", "target": "svc-target", "type": relation_type}
        for relation_type in ("R.v1", "HEALTHY", "UNKNOWN.v1")
    ]), encoding="utf-8")


def _record_apply(vault, phase):
    result = _run_apply(str(vault))
    (vault / f"{phase}.stdout.log").write_text(result.stdout, encoding="utf-8")
    (vault / f"{phase}.stderr.log").write_text(result.stderr, encoding="utf-8")
    assert result.returncode == 0, (result.stdout, result.stderr)
    return result


@pytest.mark.parametrize("definition", BAD_DEFINITIONS)
@pytest.mark.parametrize("carry_only", [False, True], ids=["new", "carried"])
def test_invalid_relations_rejected_by_real_process(tmp_path, definition, carry_only):
    """本地进程集成：真实 CLI/YAML/图产物，两轮拒产；不代表外部服务端到端。"""
    if carry_only:
        _write_degraded_fixture(tmp_path, {"lifecycle_status": "approved"})
        _record_apply(tmp_path, "approved")
        for relation_type in ("REFERENCES", "R.v1", "HEALTHY", "UNKNOWN.v1"):
            assert _connections_of(tmp_path, relation_type), relation_type

    _write_degraded_fixture(tmp_path, definition)
    if carry_only:
        (tmp_path / ".pipeline/intermediates/merged_edges.json").write_text("[]", encoding="utf-8")
        (tmp_path / "知识库/raw/precleaned/doc-ref.md").write_text(
            "---\ntitle: 引用文档\n---\n移除引用但保留文档节点。", encoding="utf-8")
    ontology_path = tmp_path / "知识库/TheSchema/ontology.yaml"
    ontology_bytes = ontology_path.read_bytes()
    for run in range(2):
        result = _record_apply(tmp_path, f"invalid-{run}")
        for relation_type in ("REFERENCES", "R.v1"):
            assert _connections_of(tmp_path, relation_type) == [], (relation_type, result.stdout)
        if not carry_only or run == 0:
            marker = "非现役剔除" if carry_only else "非现役关系拒产"
            assert marker in result.stdout, result.stdout
            for relation_type in ("REFERENCES", "R.v1"):
                assert f"{relation_type}（lifecycle_status=invalid）" in result.stdout
        for relation_type in ("HEALTHY", "UNKNOWN.v1"):
            connections = _connections_of(tmp_path, relation_type)
            assert connections, (relation_type, result.stdout)
            assert all(c["reviewStatus"] == "pending" for c in connections), connections
        assert "关系生命周期表为空" not in result.stdout
        assert ontology_path.read_bytes() == ontology_bytes
