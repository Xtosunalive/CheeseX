"""WP-031 红队阻断项的端到端回归：真实跑 extract_graph.py --apply 两轮，覆盖「抽取→落盘」环节
（此前的函数级测试停在 extract_entity_nodes 返回、HTTP 测试用手写 fixture 图——两块测试的缝
里藏着 merge 段 del 分支误删自建节点豁免的 bug，本测试按真实管道闭合）。

两轮断言（红队修复验收口径）：
  第一轮：文档写 exempt_rules → 落盘 master_graph 节点 properties.exempt_rules 在
  第二轮：文档删规则 → 落盘残留被清（无豁免幽灵）

层级：真实集成（subprocess 真跑抽取脚本——非 mock；独立临时 vault，测试自清理）。
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

_HERE = Path(__file__).resolve().parents[1]  # scripts/vault-py/graph
_EXTRACT = _HERE / "extract_graph.py"


def _run_apply(vault_root: str):
    # PR-159 夹具密封：配置钉扎 TheSchema（enums/ontology 复制仓内主源＋dependencies 置空）——
    # 原「解除钉扎走仓回落」在仓内 dependencies.yaml 载有活库 in-flight 草稿依赖时必炸
    # （依赖交叉校验对非源库恒失败）；钉扎空依赖的密封 schema 保留本测试本意（豁免规则管线往返）。
    theschema = Path(vault_root, "知识库", "TheSchema")
    theschema.mkdir(parents=True, exist_ok=True)
    repo_schema = _HERE.parents[2] / "data" / "theschema"
    for name in ("enums.yaml", "ontology.yaml"):
        src = repo_schema / name
        if src.exists():
            (theschema / name).write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
    (theschema / "dependencies.yaml").write_text("dependencies: []\n", encoding="utf-8")
    # WP-117 批2：文档面经信封供给——每轮 spawn 前按当前 vault 重物化（两轮间文档有改写）
    import sys as _sys

    _sys.path.insert(0, str(_HERE.parents[1] / "vault-runtime" / "__tests__"))
    from _vocab_fixture import install_doc_envelope

    install_doc_envelope(vault_root)
    env = {
        **os.environ,
        "KB_VAULT": vault_root,
        "KB_DATA_DIR": os.path.join(vault_root, "data"),
        # PR-158：隔离运行钉扎洁净基线——repo data/theschema 是活库运行态（依赖引用随用随长），
        # 活态依赖会按真库图节点校验使夹具库抽取 exit 1（doc-article-agents 前科）
        "THESCHEMA_DIR": str(_HERE.parents[2] / "test" / "fixtures" / "theschema-baseline"),
    }
    proc = subprocess.run(
        [sys.executable, str(_EXTRACT), "--apply"],
        env=env, capture_output=True, text=True, timeout=180,
    )
    return proc


def _staged_master(vault_root: str):
    p = Path(vault_root, "data", "staging", "master_graph.json")
    assert p.exists(), f"master_graph 应落盘：{p}"
    return json.loads(p.read_text(encoding="utf-8"))


def _exemptions_in_graph(master: dict) -> dict:
    return {
        n["id"]: n.get("properties", {}).get("exempt_rules")
        for n in master.get("nodes", [])
        if n.get("properties", {}).get("exempt_rules")
    }


def test_exempt_rules_roundtrip_through_real_pipeline():
    vault = tempfile.mkdtemp(prefix="eg-e2e-exempt-")
    (Path(vault) / "知识库" / "wiki" / "entities").mkdir(parents=True, exist_ok=True)
    (Path(vault) / "知识库" / "raw" / "precleaned").mkdir(parents=True, exist_ok=True)
    ent = Path(vault, "知识库", "wiki", "entities", "svc-exempt.md")

    # 第一轮：文档声明豁免 → 图里有
    ent.write_text(
        "---\ntitle: 豁免实体\nexempt_rules:\n  - isolated_entity\n---\n正文",
        encoding="utf-8",
    )
    proc1 = _run_apply(vault)
    assert proc1.returncode == 0, f"第一轮抽取应成功：\n{proc1.stderr[-800:]}"
    ex1 = _exemptions_in_graph(_staged_master(vault))
    assert any("isolated_entity" in (v or []) for v in ex1.values()), f"第一轮：豁免应入图，实况 {ex1}"

    # 第二轮：删规则 → 残留被清（无豁免幽灵）
    ent.write_text("---\ntitle: 豁免实体\n---\n正文", encoding="utf-8")
    proc2 = _run_apply(vault)
    assert proc2.returncode == 0, f"第二轮抽取应成功：\n{proc2.stderr[-800:]}"
    ex2 = _exemptions_in_graph(_staged_master(vault))
    assert ex2 == {}, f"第二轮：删规则后图内应无残留豁免，实况 {ex2}"
