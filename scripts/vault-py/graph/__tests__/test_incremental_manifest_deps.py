# PR-141 回归锚（WP-049 L3 语义迁移）：词表变更纳入增量指纹——依赖规则编辑不再静默不反映。
# 新契约：五件词表条目由 extract_graph 从信封指纹注入 manifest（.ledger/vocab/<name>.yaml，
# sha16＝内容哈希前 16，与旧逐件哈希字节同值）；编辑词表 → 重物化信封 → 注入条目变 → diff 判 changed。
# 层级：子进程隔离单元（extract_graph 导入时读 KB_VAULT/KB_DATA_DIR 全局环境并注册
# 模块级状态——pytest 同进程改环境会污染后续测试〔PR-140 跨文件状态泄漏族的活标本，
# 本文件初版即因此五连跑一致红〕，故每用例以独立 python 子进程跑真实构建）。
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
GRAPH = REPO / "scripts" / "vault-py" / "graph"

PROBE = r"""
import json, os, subprocess, sys
sys.path.insert(0, {graph!r})
import extract_graph as eg
mode = {mode!r}
DUMP = {dump!r}
# WP-049 L3：探针进程自身的信封指到本 vault（外层缺省信封属别的库——不得串台）
os.environ["VOCAB_ENVELOPE_PATH"] = os.path.join(eg.VAULT_ROOT, ".ledger", "vocab-envelope.json")
def rematerialize():
    env = {{k: v for k, v in os.environ.items() if k != "THESCHEMA_DIR"}}
    env["VOCAB_ENVELOPE_PATH"] = os.path.join(eg.VAULT_ROOT, ".ledger", "vocab-envelope.json")
    subprocess.run(["node", DUMP, "--vault", eg.VAULT_ROOT,
                    "--out", env["VOCAB_ENVELOPE_PATH"]],
                   check=True, capture_output=True, text=True, env=env)
if mode == "in-manifest":
    manifest = eg._build_incremental_manifest()
    bases = [os.path.basename(k) for k in manifest["files"]]
    print(json.dumps({{"in": "dependencies.yaml" in bases}}))
elif mode == "changed-diff":
    rematerialize()
    prev = eg._build_incremental_manifest()
    deps = os.path.join(eg.VAULT_ROOT, "知识库", "TheSchema", "dependencies.yaml")
    open(deps, "w").write("rules:\n  - id: new-rule\n")
    rematerialize()  # WP-049 L3：词表编辑经重物化反映到注入条目（sha16 同构旧逐件哈希）
    diff = eg._diff_incremental_manifest(prev, eg._build_incremental_manifest())
    deps_key = [k for k in eg._build_incremental_manifest()["files"] if os.path.basename(k) == "dependencies.yaml"][0]
    print(json.dumps({{"changed": deps_key in diff["changed"]}}))
"""


def _run_probe(vault: Path, mode: str) -> dict:
    env = dict(
        os.environ,
        KB_VAULT=str(vault),
        KB_DATA_DIR=str(vault.parent / "data"),
        PYTHONPATH=str(GRAPH.parent),
    )
    code = PROBE.format(graph=str(GRAPH), mode=mode,
                        dump=str(REPO / "scripts" / "vault-runtime" / "dump-vocab-envelope.mjs"))
    out = subprocess.run([sys.executable, "-c", code], env=env, capture_output=True, text=True, check=True)
    return json.loads(out.stdout.strip().splitlines()[-1])


def _make_vault(tmp: Path, with_deps: bool) -> Path:
    vault = tmp / "vault"
    ts = vault / "知识库" / "TheSchema"
    ts.mkdir(parents=True)
    for n in ("enums", "fields", "versions", "ontology"):
        (ts / f"{n}.yaml").write_text("x: 1\n")
    if with_deps:
        (ts / "dependencies.yaml").write_text("rules: []\n")
    (vault / "知识库" / "wiki").mkdir(parents=True)
    # WP-117 批2：probe 的 extract_graph import 期即强制装载文档信封（入口收权）——先物化
    subprocess.run(
        ["node", str(REPO / "scripts" / "vault-runtime" / "dump-doc-envelope.mjs"),
         "--vault", str(vault), "--out", str(vault / ".ledger" / "doc-envelope.json")],
        check=True, capture_output=True, text=True,
    )
    # WP-049 L3：为本 vault 物化信封＋指纹件（probe 的 extract_graph import 期即取词表）
    subprocess.run(
        ["node", str(REPO / "scripts" / "vault-runtime" / "dump-vocab-envelope.mjs"),
         "--vault", str(vault), "--out", str(vault / ".ledger" / "vocab-envelope.json")],
        check=True, capture_output=True, text=True,
        env={k: v for k, v in os.environ.items() if k != "THESCHEMA_DIR"},
    )
    return vault


class TestDepsInFingerprint(unittest.TestCase):
    def test_deps_file_enters_manifest(self):
        with tempfile.TemporaryDirectory(prefix="pr141-") as tmp:
            result = _run_probe(_make_vault(Path(tmp), with_deps=True), "in-manifest")
            self.assertTrue(result["in"], "词表五件条目必须在增量指纹清单（信封指纹注入——词表变更检测载体）")

    def test_deps_edit_yields_changed_diff(self):
        with tempfile.TemporaryDirectory(prefix="pr141-") as tmp:
            result = _run_probe(_make_vault(Path(tmp), with_deps=True), "changed-diff")
            self.assertTrue(result["changed"], "依赖规则编辑（经重物化）必须令增量 diff 判 changed（逐件条目点名）")


if __name__ == "__main__":
    unittest.main()
