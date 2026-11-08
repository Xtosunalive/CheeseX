"""WP-113 M4：建图侧不再现编组件身份号——缺 architecture-node-id 的组件不进图，改投待审面。

背景：组件身份的唯一铸造口是 server/shared/entity-identity-mint.cjs（Node 内建 UUID v4）。
extract_entity_nodes 原有一条 `entity-{slug}` 现编 fallback，属第二身份来源（WP-107 D1 之后
剩下的两处之一）。本刀撤销「写侧现编」，**不撤读侧兼容**——server/services/projection/node-id-resolver.cjs
的 COMMON_PREFIXES 仍认 entity-，存量图/账里的旧号还要读得到。

层级：① ② ③ 纯单元（函数级断言＋独立临时 vault 结构，不触真库）；
      ④ 真实集成（subprocess 真跑 extract_graph.py --apply，断言 pendingReview 落盘与补号后第二轮）。
判据形状照同文件 D1 先例（IDENTITY_CONFLICTS→pendingReview）：违规产物物理不产出＋可定位明细，
不整体失败建图、不自动改写存量身份；每条负断言配正对照（有号组件照常进图、非组件兜底不变）。
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

_TMP = tempfile.mkdtemp(prefix="eg-missing-identity-")
(Path(_TMP) / "知识库").mkdir(parents=True, exist_ok=True)
os.environ["KB_VAULT"] = _TMP
os.environ.setdefault("KB_DATA_DIR", str(Path(_TMP) / "data"))
_HERE = Path(__file__).resolve().parents[1]  # scripts/vault-py/graph
_EXTRACT = _HERE / "extract_graph.py"
sys.path.insert(0, str(_HERE))

from _vocab_fixture import install_doc_envelope

import extract_graph as eg  # noqa: E402


def _fresh_vault(monkeypatch, prefix):
    """每测试独立 vault——沿用本目录 test_exempt_rules.py 的隔离口径（防顺序耦合）。

    VAULT/VAULT_ROOT 按真实管道次序挂（VAULT_ROOT/知识库 == VAULT），来源路径才与 D1
    撞键条目里的 file_path 同形（`知识库/wiki/entities/…`）——单测里偷懒把两者并成一个，
    断言就会验到假的来源串。"""
    root = tempfile.mkdtemp(prefix=prefix)
    knowledge = Path(root, "知识库")
    knowledge.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("KB_VAULT", root)
    monkeypatch.setattr(eg, "VAULT_ROOT", root)
    monkeypatch.setattr(eg, "VAULT", str(knowledge))
    ents = knowledge / "wiki" / "entities"
    ents.mkdir(parents=True, exist_ok=True)
    return root, ents


def test_缺身份号的组件不产出节点且进待审清单(monkeypatch):
    """① 核心判据：arch_component 为真＋缺 architecture-node-id → 节点零产出，待审条目点名来源。"""
    _root, ents = _fresh_vault(monkeypatch, "eg-miss-a-")
    (ents / "无号组件.md").write_text(
        "---\ntitle: 无号组件\narch_component: true\n---\n依赖::[[别的]]\n",
        encoding="utf-8",
    )
    install_doc_envelope(_root)  # WP-117 批2：文档面经信封供给（写面完成后物化）
    nodes, edges, _deps, unresolved, exemptions = eg.extract_entity_nodes(set(), {})

    assert nodes == [], f"缺号组件必须物理不产出节点，实况 {nodes}"
    assert all(not n["id"].startswith("entity-") for n in nodes), "不得再现编 entity-{slug} 顶号"
    assert edges == [], "没有身份号就没有可挂的键——不产悬挂边"
    assert unresolved == [], "本文件整体不进图，不再代表它解析连线"
    assert exemptions == {}

    assert len(eg.MISSING_COMPONENT_IDENTITIES) == 1, eg.MISSING_COMPONENT_IDENTITIES
    entry = eg.MISSING_COMPONENT_IDENTITIES[0]
    assert entry["reason"] == "missing_architecture_node_id", entry
    assert entry["sources"] == ["知识库/wiki/entities/无号组件.md"], f"来源必须可定位：{entry}"
    assert entry["id"] == "missing-identity:无号组件", entry
    assert "无号组件" in entry["title"], entry


def test_有身份号的组件照常进图_节点与连线数与改前一致(monkeypatch):
    """② 差分断言：同夹具两条连线关系（aaa←bbb）在改前/改后都产出 2 节点 1 边——
    本条不是「不报错」，是把数量与键名钉死，防「缺号不产出」被扩面成「有号也不产出」的假红。"""
    _root, ents = _fresh_vault(monkeypatch, "eg-miss-b-")
    (ents / "aaa.md").write_text(
        "---\ntitle: aaa\narchitecture-node-id: 3f1a2b4c-0000-4000-8000-0000000000aa\narch_component: true\n---\n正文\n",
        encoding="utf-8",
    )
    (ents / "bbb.md").write_text(
        "---\ntitle: bbb\narchitecture-node-id: 3f1a2b4c-0000-4000-8000-0000000000bb\narch_component: true\n---\n依赖::[[aaa]]\n",
        encoding="utf-8",
    )
    install_doc_envelope(_root)
    nodes, edges, deps, unresolved, _ex = eg.extract_entity_nodes(set(), {})

    assert len(nodes) == 2, f"有号组件仍须 2 节点，实况 {len(nodes)}"
    assert sorted(n["id"] for n in nodes) == [
        "3f1a2b4c-0000-4000-8000-0000000000aa",
        "3f1a2b4c-0000-4000-8000-0000000000bb",
    ], "节点键＝声明的身份号本身，不掺现编号"
    assert len(edges) == 1 and edges[0]["type"] == "DEPENDS_ON", edges
    assert (edges[0]["source"], edges[0]["target"]) == (
        "3f1a2b4c-0000-4000-8000-0000000000bb",
        "3f1a2b4c-0000-4000-8000-0000000000aa",
    ), edges[0]
    assert len(deps) == 1 and unresolved == []
    assert eg.MISSING_COMPONENT_IDENTITIES == [], "有号即不进待审——否则待审面变噪声源"


def test_非组件缺号仍按既有兜底命名_正对照(monkeypatch):
    """③ 本刀只收「组件身份」一条：arch_component 不为真的缺号实体保持 entity-{slug} 兜底。"""
    _root, ents = _fresh_vault(monkeypatch, "eg-miss-c-")
    (ents / "svc-x.md").write_text("---\ntitle: svc-x\n---\n正文\n", encoding="utf-8")
    install_doc_envelope(_root)
    nodes, _edges, _deps, _unresolved, _ex = eg.extract_entity_nodes(set(), {})

    assert [n["id"] for n in nodes] == ["entity-svc-x"], f"非组件行为不得变，实况 {nodes}"
    assert nodes[0]["labels"] == ["Module"], nodes[0]["labels"]
    assert eg.MISSING_COMPONENT_IDENTITIES == []


def test_标签晋升的组件缺号同样不产出(monkeypatch):
    """组件判定读 _is_promoted_arch_component（arch_component 真值 或 晋升标签）——
    只认 frontmatter 布尔会漏掉标签晋升那一半，正对照随之失效。"""
    _root, ents = _fresh_vault(monkeypatch, "eg-miss-d-")
    (ents / "tagged.md").write_text(
        "---\ntitle: tagged\ntags:\n  - Arch/Component\n---\n正文\n",
        encoding="utf-8",
    )
    install_doc_envelope(_root)
    nodes, _edges, _deps, _unresolved, _ex = eg.extract_entity_nodes(set(), {})
    assert nodes == [], nodes
    assert [e["id"] for e in eg.MISSING_COMPONENT_IDENTITIES] == ["missing-identity:tagged"]


# ── ④ 真实集成：复用 D1 那条出口（pendingReview）落盘，并补号后第二轮无幽灵 ──

def _run_apply(vault_root: str):
    """真跑 extract_graph.py --apply。

    夹具密封口径同 PR-158/159：THESCHEMA_DIR 钉仓内洁净基线夹具（test/fixtures/theschema-baseline）
    ——repo data/theschema 是活库运行态载体，其 in-flight 依赖会让夹具库抽取 exit 1。
    本夹具只钉环境变量，不在测试里写 TheSchema 文件（那会新增端口外词表路径命中，
    contracts/vocab-load-baseline.json 是只减不增的存在制基线）。
    """
    from _vocab_fixture import install_doc_envelope

    install_doc_envelope(vault_root)  # WP-117 批2：每轮 spawn 前按当前 vault 重物化文档信封
    env = {
        **os.environ,
        "KB_VAULT": vault_root,
        "KB_DATA_DIR": os.path.join(vault_root, "data"),
        "THESCHEMA_DIR": str(_HERE.parents[2] / "test" / "fixtures" / "theschema-baseline"),
    }
    return subprocess.run(
        [sys.executable, str(_EXTRACT), "--apply"], env=env, capture_output=True, text=True, timeout=240
    )


def _staged_master(vault_root: str):
    p = Path(vault_root, "data", "staging", "master_graph.json")
    assert p.exists(), f"master_graph 应落盘：{p}"
    return json.loads(p.read_text(encoding="utf-8"))


def test_缺号组件经真实管道进落盘的pendingReview且补号后不残留():
    """④ 出口复用不是注释里的说法：第一轮缺号 → nodes 无该实体、pendingReview 有条目；
    第二轮补上号 → 条目消失（不积压历史）、节点带身份号进图。连续两轮各自成立。"""
    vault = tempfile.mkdtemp(prefix="eg-e2e-missing-id-")
    (Path(vault) / "知识库" / "wiki" / "entities").mkdir(parents=True)
    (Path(vault) / "知识库" / "raw" / "precleaned").mkdir(parents=True)
    ent = Path(vault, "知识库", "wiki", "entities", "no-id-comp.md")
    ent.write_text("---\ntitle: no-id-comp\narch_component: true\n---\n正文\n", encoding="utf-8")

    proc1 = _run_apply(vault)
    assert proc1.returncode == 0, f"第一轮抽取应成功：\n{proc1.stdout[-1500:]}\n{proc1.stderr[-800:]}"
    master1 = _staged_master(vault)
    node_ids1 = [n["id"] for n in master1.get("nodes", [])]
    assert "no-id-comp" not in node_ids1 and "entity-no-id-comp" not in node_ids1, node_ids1
    pending = master1.get("pendingReview", [])
    hit = [p for p in pending if p.get("id") == "missing-identity:no-id-comp"]
    assert len(hit) == 1, f"缺号组件应落进既有 pendingReview 面，实况 {pending}"
    assert hit[0]["reason"] == "missing_architecture_node_id", hit[0]
    assert hit[0]["sources"] == ["知识库/wiki/entities/no-id-comp.md"], hit[0]

    # 第二轮：补号（补号来源＝铸造口/修复流，本测试只验出口闭环）
    ent.write_text(
        "---\ntitle: no-id-comp\narchitecture-node-id: 7c9e6679-7425-40de-944b-e07fc1f90ae7\n"
        "arch_component: true\n---\n正文\n",
        encoding="utf-8",
    )
    proc2 = _run_apply(vault)
    assert proc2.returncode == 0, f"第二轮抽取应成功：\n{proc2.stdout[-1500:]}\n{proc2.stderr[-800:]}"
    master2 = _staged_master(vault)
    ids2 = {n["id"] for n in master2.get("nodes", [])}
    assert "7c9e6679-7425-40de-944b-e07fc1f90ae7" in ids2, ids2
    assert not [p for p in master2.get("pendingReview", []) if p.get("id") == "missing-identity:no-id-comp"], \
        "补号后待审条目不得残留成幽灵"
