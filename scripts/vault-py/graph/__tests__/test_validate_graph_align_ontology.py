"""WP-138 R1 回归：对齐值域矩阵经信封取数（PR-257 手抄 10 条矩阵删除后的行为钉）。

层级：纯单元（分档判定）＋ 装载器/校验函数集成（信封派生矩阵）＋ 本地 CLI 进程集成
（run_alignment 真实子进程）。均使用独立临时数据，不涉及外部服务。
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

_TMP = tempfile.mkdtemp(prefix="vg-align-")
(Path(_TMP) / "知识库").mkdir(parents=True, exist_ok=True)
os.environ["KB_VAULT"] = _TMP
os.environ.setdefault("KB_DATA_DIR", str(Path(_TMP) / "data"))
_HERE = Path(__file__).resolve().parents[1]  # scripts/vault-py/graph
sys.path.insert(0, str(_HERE))
sys.path.insert(0, str(_HERE.parents[1] / "vault-runtime"))  # 与 validate_graph.py 同一 A 类事实源

import schema_loader  # noqa: E402
import validate_graph  # noqa: E402
from _vocab_fixture import install_vocab_envelope  # noqa: E402

# 夹具本体：骨架关系带 projected 端点（节点类型 ID）＋类别折算路径；Ghost 无 category
# （防御跳过钉）；REFERENCES 非架构面（semantic_role 过滤钉）。测试自写词表 fixture
# 属测试供数面，不属被测读面（WP-049 L3 同款纪律）。
ALIGN_ONTOLOGY = {
    "node_types": {
        "System": {"category": "服务"},
        "Storage": {"category": "存储"},
        "Terminal": {"category": "终端"},
        "Ghost": {},
    },
    "relation_types": {
        "CONNECTS_TO": {"semantic_role": "architecture_skeleton",
                        "source_types": ["Terminal", "System", "Ghost"],
                        "target_types": ["System", "Storage"]},
        "DEPENDS_ON": {"semantic_role": "architecture_skeleton",
                       "source_types": ["System"], "target_types": ["System"]},
        "REFERENCES": {"semantic_role": "weak_semantic",
                       "source_types": ["System"], "target_types": ["System"]},
    },
}

ALIGN_ENUMS = "arch_categories:\n  - 服务\n  - 终端\n  - 存储\n"


@pytest.fixture(autouse=True)
def _reset_validate_graph_caches():
    """validate_graph 模块级缓存随信封更换复位（_enums_cache/_align_ontology_cache）。"""
    validate_graph._enums_cache = None
    validate_graph._align_ontology_cache = None
    yield
    validate_graph._enums_cache = None
    validate_graph._align_ontology_cache = None
    schema_loader.reset_envelope_cache()


def _with_envelope(files, run):
    saved = {key: os.environ.get(key) for key in ("VOCAB_ENVELOPE_PATH", "KB_VAULT")}
    temp = tempfile.TemporaryDirectory()
    try:
        os.environ["KB_VAULT"] = temp.name
        install_vocab_envelope(temp.name, files)
        return run()
    finally:
        for key, value in saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        temp.cleanup()


# ── 装载器/校验函数集成：信封派生矩阵 ──


def test_align_matrix_derived_from_envelope():
    def run():
        return validate_graph._load_align_ontology()

    matrix = _with_envelope({"enums": ALIGN_ENUMS, "ontology": ALIGN_ONTOLOGY}, run)
    # 端点值域＝source/target_types（节点类型 ID）经现役 node_types[].category 折算
    assert matrix["CONNECTS_TO"] == ({"终端", "服务"}, {"服务", "存储"}), matrix
    assert matrix["DEPENDS_ON"] == ({"服务"}, {"服务"}), matrix
    # 非架构面关系不进对齐矩阵（semantic_role 过滤——与 run_alignment 架构拓扑面同面）
    assert "REFERENCES" not in matrix, matrix
    # 无 category 的节点类型防御性跳过（Ghost 不产生 None 类别值）
    assert None not in matrix["CONNECTS_TO"][0], matrix


def test_align_matrix_envelope_missing_ontology_is_empty_fail_open():
    """信封缺 ontology＝空集（WP-049 契约）：空矩阵不伪装已知全集，判定显式「未知」。"""
    def run():
        return validate_graph._load_align_ontology()

    matrix = _with_envelope({"ontology": None}, run)
    assert matrix == {}, matrix
    verdict = validate_graph._align_validate(matrix, "CONNECTS_TO", "服务", "服务")
    assert verdict == (False, 0.0, "未知关系类型 CONNECTS_TO"), verdict


# ── 纯单元：分档判定（矩阵来源无关——语义保持钉）──


def test_align_validate_tiers_preserved():
    matrix = {
        "CONNECTS_TO": ({"终端", "服务"}, {"服务", "存储"}),
        "DEPENDS_ON": ({"服务"}, {"服务"}),
    }
    assert validate_graph._align_validate(matrix, "CONNECTS_TO", "服务", "服务") == (True, 1.0, "")
    assert validate_graph._align_validate(matrix, "CONNECTS_TO", "终端", "存储") == (True, 1.0, "")
    # 不命中→0.3 带逐端问题说明（文案与分档保持）
    assert validate_graph._align_validate(
        matrix, "CONNECTS_TO", "服务", "域") == (True, 0.3, "域 不在 CONNECTS_TO range")
    assert validate_graph._align_validate(
        matrix, "DEPENDS_ON", "终端", "服务") == (True, 0.3, "终端 不在 DEPENDS_ON domain")
    # 端点类别缺失→0.4
    assert validate_graph._align_validate(matrix, "DEPENDS_ON", "", "服务") == (True, 0.4, "实体缺少类别")
    # 外部导入特例→0.5
    assert validate_graph._align_validate(matrix, "LINKS_TO", "", "") == (True, 0.5, "外部导入关系")
    assert validate_graph._align_validate(matrix, "TAGGED_WITH", "服务", "域") == (True, 0.5, "外部导入关系")
    # 不在册→False「未知关系类型」
    assert validate_graph._align_validate(matrix, "ROUTES_TO", "服务", "服务") == (False, 0.0, "未知关系类型 ROUTES_TO")


# ── 本地 CLI 进程集成：run_alignment 真实子进程（连续两轮无污染）──


MASTER_GRAPH = {
    "nodes": [
        {"id": "svc1", "category": "服务"},
        {"id": "svc2", "category": "服务"},
        {"id": "term1", "category": "终端"},
        {"id": "ghost", "category": "存储"},
    ],
    "connections": [
        {"from": "svc1", "to": "svc2", "relationType": "CONNECTS_TO"},
        {"from": "svc2", "to": "term1", "relationType": "DEPENDS_ON"},
        {"from": "svc1", "to": "ghost", "relationType": "ROUTES_TO"},
    ],
}


def _run_alignment_cli(vault, apply=False):
    env = {**os.environ, "KB_VAULT": str(vault),
           "KB_DATA_DIR": str(vault / "data"), "PYTHONDONTWRITEBYTECODE": "1"}
    argv = [sys.executable, str(_HERE / "validate_graph.py"), "--mode", "alignment"]
    if apply:
        argv.append("--apply")
    return subprocess.run(argv, env=env, capture_output=True, text=True, timeout=60)


def _write_master_graph(tmp_path):
    (tmp_path / "知识库").mkdir(exist_ok=True)
    ledger = tmp_path / ".ledger"
    ledger.mkdir(exist_ok=True)
    (ledger / "master_graph.json").write_text(json.dumps(MASTER_GRAPH), encoding="utf-8")


def test_run_alignment_cli_tiers_from_envelope(tmp_path):
    (tmp_path / "知识库").mkdir(exist_ok=True)
    install_vocab_envelope(str(tmp_path), {"enums": ALIGN_ENUMS, "ontology": ALIGN_ONTOLOGY})
    _write_master_graph(tmp_path)
    for run in range(2):
        result = _run_alignment_cli(tmp_path)
        assert result.returncode == 0, (result.stdout, result.stderr)
        assert "Traceback" not in result.stderr, result.stderr
        # 命中→1.0 保留；端点不命中→0.3 降权保留；幻影关系→显式「未知」降档
        assert "保留 CONNECTS_TO: 1" in result.stdout, result.stdout
        assert "保留 DEPENDS_ON: 1" in result.stdout, result.stdout
        assert "ROUTES_TO → CONNECTS_TO (pending): 1" in result.stdout, result.stdout
    # --apply 落盘回读：分档与文案钉（dry-run 只报计数，reviewReason 随写可见）
    result = _run_alignment_cli(tmp_path, apply=True)
    assert result.returncode == 0, (result.stdout, result.stderr)
    written = json.loads((tmp_path / ".ledger" / "master_graph.json").read_text(encoding="utf-8"))
    conns = {(c["from"], c["to"]): c for c in written["connections"]}
    assert conns[("svc1", "svc2")]["confidence"] == 1.0, conns
    degraded = conns[("svc2", "term1")]
    assert degraded["confidence"] == 0.3 and degraded["reviewStatus"] == "pending", degraded
    assert degraded["reviewReason"] == "终端 不在 DEPENDS_ON range", degraded
    rerouted = conns[("svc1", "ghost")]
    assert rerouted["relationType"] == "CONNECTS_TO" and rerouted["confidence"] == 0.6, rerouted
    assert rerouted["reviewReason"] == "原 ROUTES_TO 需人工确认语义", rerouted


def test_run_alignment_cli_empty_matrix_fail_open(tmp_path):
    """信封缺 ontology 的 CLI 面：不炸、全部显式降档 pending（fail-open 契约钉）。"""
    (tmp_path / "知识库").mkdir(exist_ok=True)
    install_vocab_envelope(str(tmp_path), {"enums": ALIGN_ENUMS, "ontology": None})
    _write_master_graph(tmp_path)
    result = _run_alignment_cli(tmp_path)
    assert result.returncode == 0, (result.stdout, result.stderr)
    assert "Traceback" not in result.stderr, result.stderr
    # 空矩阵＝一切架构关系判「未知」→ reroute CONNECTS_TO pending（逐类型各 1 条）
    assert "CONNECTS_TO → CONNECTS_TO (pending): 1" in result.stdout, result.stdout
    assert "DEPENDS_ON → CONNECTS_TO (pending): 1" in result.stdout, result.stdout
    assert "ROUTES_TO → CONNECTS_TO (pending): 1" in result.stdout, result.stdout
    assert "架构关系→CONNECTS_TO: 3" in result.stdout, result.stdout
    assert "保留 CONNECTS_TO" not in result.stdout, result.stdout
