"""ADR-014 §5.2.5 回归：坏引用逐边降级，不中断整轮本体合规校验。

层级：装载器/校验函数集成及本地 CLI 进程集成，均使用独立临时数据，不涉及外部服务。
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest
import yaml

_TMP = tempfile.mkdtemp(prefix="vg-degrade-")
(Path(_TMP) / "知识库").mkdir(parents=True, exist_ok=True)
os.environ["KB_VAULT"] = _TMP
os.environ.setdefault("KB_DATA_DIR", str(Path(_TMP) / "data"))
_HERE = Path(__file__).resolve().parents[1]  # scripts/vault-py/graph
sys.path.insert(0, str(_HERE))
sys.path.insert(0, str(_HERE.parents[1] / "vault-runtime"))  # 与 validate_graph.py 同一 A 类事实源

import schema_loader  # noqa: E402
import validate_graph  # noqa: E402


def _with_temp_ontology(document, run):
    # WP-049 L3：本体经信封注入（降级收据随信封透传——invalid 语义保持）
    from _vocab_fixture import install_vocab_envelope

    saved = {key: os.environ.get(key) for key in ("VOCAB_ENVELOPE_PATH", "KB_VAULT")}
    temp = tempfile.TemporaryDirectory()
    try:
        os.environ["KB_VAULT"] = temp.name
        install_vocab_envelope(temp.name, {"ontology": document})
        return run()
    finally:
        for key, value in saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        schema_loader.reset_envelope_cache()
        temp.cleanup()


ONTOLOGY = {
    "node_types": {
        "Good": {},
        "RetiredBroken": {"lifecycle_status": "retired",
                          "retirement": {"reason": "坏链", "replaced_by": "Missing"}},
    },
    "relation_types": {
        "R": {"source_types": ["Good"], "target_types": ["Good"]},
    },
}


def test_bad_label_degrades_per_edge_without_aborting():
    def run():
        nodes = [
            {"id": "g1", "labels": ["Good"]},
            {"id": "g2", "labels": ["Good"]},
            {"id": "broken", "labels": ["RetiredBroken"]},
            {"id": "unknown", "labels": ["BrandNew"]},
        ]
        edges = [
            {"source": "broken", "target": "g1", "type": "R"},
            {"source": "unknown", "target": "g1", "type": "R"},
            {"source": "g1", "target": "g2", "type": "R"},
            {"source": "ghost", "target": "g1", "type": "R"},
        ]
        return validate_graph.check_ontology_compliance(nodes, edges, schema_loader)

    errors, warnings = _with_temp_ontology(ONTOLOGY, run)
    # 坏链边被记为该边错误并显式报因，不是抛错吞掉整轮
    broken = [e for e in errors if e[1] == "RetiredBroken"]
    assert broken and "端点标签归一失败" in broken[0][3] and "DANGLING_REPLACEMENT" in broken[0][3], errors
    assert broken[0][0] == "R" and broken[0][2] == "Good"
    # 未定义标签边同样逐边降级
    assert any(e[1] == "BrandNew" and "UNKNOWN_ELEMENT" in e[3] for e in errors), errors
    # 坏边之后的合法边照常校验完毕（既不报错也不报警）
    assert not any(e[1] == "Good" and e[2] == "Good" for e in errors + warnings), (errors, warnings)
    # 端点缺失的边按既有口径跳过，不计入错误
    assert len(errors) == 2, errors


def _dotted_relation_fixture(bad_field):
    rule = {"source_types": ["Good"], "target_types": ["Good"]}
    ontology = {
        "node_types": {"Good": {}, "Other": {}},
        "relation_types": {"R.v1": {**rule, bad_field: 42}, "HEALTHY": rule},
    }
    nodes = [{"id": "good", "labels": ["Good"]}, {"id": "other", "labels": ["Other"]}]
    edges = [
        {"source": "good", "target": "good", "type": "R.v1"},
        {"source": "good", "target": "good", "type": "HEALTHY"},
        {"source": "other", "target": "good", "type": "HEALTHY"},
    ]
    return ontology, nodes, edges


@pytest.mark.parametrize("bad_field", ["source_types", "target_types"])
def test_dotted_bad_relation_reports_error_and_checks_following_edges(bad_field):
    """装载器/校验函数集成：健康规则的端点警告证明坏边之后仍在校验。"""
    ontology, nodes, edges = _dotted_relation_fixture(bad_field)
    errors, warnings = _with_temp_ontology(
        ontology, lambda: validate_graph.check_ontology_compliance(nodes, edges, schema_loader))
    assert len(errors) == 1, errors
    assert errors[0][:3] == ("R.v1", "Good", "Good")
    assert "R.v1" in errors[0][3] and "归一失败" in errors[0][3]
    assert len(warnings) == 1, warnings
    assert warnings[0][:3] == ("HEALTHY", "Other", "Good")
    assert "source 类型应为" in warnings[0][3]


def test_dotted_bad_relation_cli_reports_summary_and_continues(tmp_path):
    """本地进程集成：真实 validate_graph CLI，两轮均逐边报告而非 TypeError 中断。"""
    ontology, nodes, edges = _dotted_relation_fixture("source_types")
    knowledge = tmp_path / "知识库"
    schema = knowledge / "TheSchema"
    schema.mkdir(parents=True)
    ontology_path = schema / "ontology.yaml"
    ontology_path.write_text(yaml.safe_dump(ontology), encoding="utf-8")
    graph_path = knowledge / "architecture/AnyShare.architecture.json"
    graph_path.parent.mkdir()
    graph_path.write_text(json.dumps({"knowledgeGraph": {
        "moduleNodes": nodes, "semanticEdges": edges,
    }}), encoding="utf-8")
    # WP-049 L3：为本 vault 物化信封（子进程经 env 继承——外层信封属别的库，不得串台）；
    # 快照在安装后拍（助手重写 fixture 属测试供数，不属被测行为）
    from _vocab_fixture import install_vocab_envelope

    install_vocab_envelope(str(tmp_path), {"ontology": ontology})
    snapshots = {path: path.read_bytes() for path in (ontology_path, graph_path)}
    env = {**os.environ, "KB_VAULT": str(tmp_path),
           "KB_DATA_DIR": str(tmp_path / "data"), "PYTHONDONTWRITEBYTECODE": "1"}
    for run in range(2):
        result = subprocess.run(
            [sys.executable, str(_HERE / "validate_graph.py"), "--ontology"],
            env=env, capture_output=True, text=True, timeout=60)
        (tmp_path / f"validate-{run}.stdout.log").write_text(result.stdout, encoding="utf-8")
        (tmp_path / f"validate-{run}.stderr.log").write_text(result.stderr, encoding="utf-8")
        assert result.returncode == 1, (result.stdout, result.stderr)
        assert "Traceback" not in result.stderr, result.stderr
        assert "校验总结" in result.stdout, result.stdout
        assert "本体错误 1" in result.stdout and "本体警告 1" in result.stdout
        assert "R.v1" in result.stdout and "归一失败" in result.stdout
        assert "HEALTHY" in result.stdout and "source 类型应为" in result.stdout
        for path, snapshot in snapshots.items():
            assert path.read_bytes() == snapshot
