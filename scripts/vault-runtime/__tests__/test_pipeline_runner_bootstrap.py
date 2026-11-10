import importlib.util
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT_DIR = Path(__file__).resolve().parents[1]
# A 类脚本按 PR-016 事实源取版：ARCH_REPO 注入时优先（待验分支修复经此进入测试链），
# 否则用 vault 镜像（realpath 同指主仓 scripts/vault-runtime）
_factsource = Path(os.environ["ARCH_REPO"]) / "scripts" / "vault-runtime" if os.environ.get("ARCH_REPO") else SCRIPT_DIR
RUNNER_PATH = _factsource / "pipeline-runner.py"
# pipeline-runner 是 A 类脚本（vault 侧 symlink→repo scripts/vault-runtime），模块级导入
# _vault_ledger/_runtime_state_db 只在真身目录可解析——按 realpath 把真身目录上 path
RUNTIME_DIR = os.path.dirname(os.path.realpath(RUNNER_PATH))
if RUNTIME_DIR not in sys.path:
    sys.path.append(RUNTIME_DIR)  # 追加不抢位：vault 侧 kb_paths 优先，repo 目录只补 _vault_ledger 等缺口


def load_runner():
    spec = importlib.util.spec_from_file_location("pipeline_runner_bootstrap", RUNNER_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PipelineBootstrapTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # runner 模块级 staging_path 需要 KB_DATA_DIR（缺省 fail-closed）
        cls._saved_data_dir = os.environ.get("KB_DATA_DIR")
        if not cls._saved_data_dir:
            import tempfile
            os.environ["KB_DATA_DIR"] = tempfile.mkdtemp(prefix="runner-bootstrap-test-")

    @classmethod
    def tearDownClass(cls):
        if cls._saved_data_dir is None:
            os.environ.pop("KB_DATA_DIR", None)
        else:
            os.environ["KB_DATA_DIR"] = cls._saved_data_dir

    def test_preflight_allows_missing_derived_outputs(self):
        runner = load_runner()
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            enums = root / "知识库" / "TheSchema" / "enums.yaml"
            ontology = root / "知识库" / "TheSchema" / "ontology.yaml"
            enums.parent.mkdir(parents=True)
            enums.write_text("architecture_projection:\n  product: Fixture\n  version: v1\n", encoding="utf-8")
            ontology.write_text("relation_types: {}\n", encoding="utf-8")

            required = {
                "master_graph.json": str(root / ".ledger" / "master_graph.json"),
                "enums.yaml": str(enums),
                "ontology.yaml": str(ontology),
                "semantic_architecture.json": str(root / "sa.json"),
                "architecture_layout.json": str(root / "layout.json"),
            }
            with patch.object(runner, "REQUIRED_PATHS", required), \
                 patch.object(runner, "VAULT_ROOT", str(root)), \
                 patch.object(runner, "API_PORT", None), \
                 patch.object(runner, "_scan_archive_dirs", return_value=[]):
                ok, message, _data = runner.stage_0_preflight()

            self.assertTrue(ok)
            self.assertEqual(message, "PRE-FLIGHT 通过")

    def test_manifest_excludes_product_scale_gates(self):
        source = RUNNER_PATH.read_text(encoding="utf-8")
        self.assertNotIn("connections > 0", source)
        self.assertNotIn("modules_n < 50", source)
        self.assertNotIn("merge_raw_components", source)
        # 锚点：确认读到的是 A 类事实源 runner（PR-016 方案甲），旧锚 '~/架构图系统-rebuild'
        # 已随 ARCH_REPO 缺省翻向 repo 侧退役
        self.assertIn("RUNTIME_FACTSOURCE_DIR", source)

    def test_direct_runner_admission_gate_fails_closed(self):
        runner = load_runner()
        with patch.object(runner.os.path, "isfile", return_value=True), \
             patch.object(runner, "run", return_value=(2, '{"ready":false,"blockerCount":2,"blockingSourceKeys":["x.md"]}\n', "")):
            ok, message, data = runner.stage_0_5_admission_readiness()
        self.assertFalse(ok)
        self.assertIn("blockerCount=2", message)
        self.assertFalse(data["readiness"]["ready"])

    def test_direct_runner_admission_gate_passes(self):
        runner = load_runner()
        with patch.object(runner.os.path, "isfile", return_value=True), \
             patch.object(runner, "run", return_value=(0, '{"ready":true,"blockerCount":0}\n', "")):
            ok, message, _data = runner.stage_0_5_admission_readiness()
        self.assertTrue(ok)
        self.assertEqual(message, "ADMISSION READINESS 通过")


if __name__ == "__main__":
    unittest.main()


class GraphFamilyCwdAnchor(unittest.TestCase):
    """PR-110 锚定：graph 族脚本（extract_graph/graph-status/validate_graph）住 vault-py/graph/——
    runner 内对其调用必须 cwd=GRAPH_DIR；此前 --validate（Stage 1 诊断）与 graph-status --write 仍钉
    SCRIPTS_DIR（pipeline/ 位），新库 Stage 1 必败于「can't open file …/pipeline/extract_graph.py」。"""

    def test_graph_family_calls_use_graph_dir(self):
        source = RUNNER_PATH.read_text(encoding="utf-8")
        for cmd in ("extract_graph.py --validate", "graph-status.py --write", "extract_graph.py --apply"):
            self.assertIn(cmd, source, f"runner 应调用 {cmd}")
        # 命令串形态（尾随引号）区分于日志文案——只锚真正的 run() 调用
        # --apply 命令串尾随插值（{extract_flag}），以 GRAPH_DIR 同窗断言覆盖即可（下方防回退窗）
        for cmd in ('extract_graph.py --validate"', 'graph-status.py --write"'):
            idx = 0
            found = 0
            while True:
                idx = source.find(cmd, idx)
                if idx == -1:
                    break
                found += 1
                window = source[idx: idx + 220]
                self.assertIn("cwd=GRAPH_DIR", window, f"命令串 {cmd} 的调用须 cwd=GRAPH_DIR（窗口：{window[:100]}…）")
                idx += len(cmd)
            self.assertGreaterEqual(found, 1, f"应存在命令串 {cmd}")
        # 命令串与 cwd=SCRIPTS_DIR 不得同窗共现（防回退）
        for cmd in ('extract_graph.py --validate"', 'graph-status.py --write"', 'extract_graph.py --apply'):
            idx = source.find(cmd)
            while idx != -1:
                self.assertNotIn("cwd=SCRIPTS_DIR", source[idx: idx + 220], f"{cmd} 窗口内出现 cwd=SCRIPTS_DIR（graph 族住 GRAPH_DIR——PR-110）")
                idx = source.find(cmd, idx + len(cmd))

    def test_cleanup_old_snapshots_never_aborts_pipeline(self):
        """缓存清理失败（含批量删除护栏的 SystemExit）不得冒泡中断管道。

        2026-10-28 实证回归：受限环境对「单目录条目数 > 50」要求批量确认，rmtree 直接
        SystemExit(1) → 无 traceback、无 run 摘要落库，日志停在 Stage 8 最后一行，
        现象与「Stage 8 失败」无法区分；而 keep=5 恒删 1 个 → 每次重建都失败。
        """
        runner = load_runner()
        tmp = tempfile.mkdtemp(prefix="runner-cleanup-")
        for i in range(7):
            d = Path(tmp) / f"run-2026010{i}-000000"
            d.mkdir(parents=True)
            os.utime(d, (1_000_000 + i, 1_000_000 + i))

        with patch.object(runner, "SNAPSHOT_DIR", tmp), patch.object(
            runner.shutil, "rmtree", side_effect=SystemExit(1)
        ):
            runner.cleanup_old_snapshots(keep=5)  # 不抛即通过：清理没有中断管道的权力

        # 兜底：单目录删除抛 OSError 同样不得冒泡
        with patch.object(runner, "SNAPSHOT_DIR", tmp), patch.object(
            runner.shutil, "rmtree", side_effect=OSError("read-only")
        ):
            runner.cleanup_old_snapshots(keep=5)


class ValidateStageTest(unittest.TestCase):
    def test_nonzero_structural_check_stops_stage(self):
        with tempfile.TemporaryDirectory() as temp_dir, patch.dict(os.environ, {"KB_DATA_DIR": temp_dir}):
            runner = load_runner()
            with patch.object(runner, "run", return_value=(1, "架构图文件不存在", "")) as run:
                ok, message, _ = runner.stage_2_validate()
            self.assertFalse(ok, message)
            self.assertEqual(run.call_count, 1)


    def test_failed_wiki_inference_does_not_merge_stale_output(self):
        with tempfile.TemporaryDirectory() as temp_dir, patch.dict(os.environ, {"KB_DATA_DIR": temp_dir}):
            runner = load_runner()

            def execute(cmd, **_kwargs):
                return (1, "", "bad product scope") if "infer-from-wiki.py" in cmd else (0, "", "")

            with patch.object(runner, "INFER_DIR", temp_dir), \
                 patch.object(runner, "inject_skeleton_data"), \
                 patch.object(runner, "run", side_effect=execute) as run:
                ok, _, data = runner.stage_1_5_infer(mode="quick")
            self.assertTrue(ok)
            self.assertEqual(data["inference_status"]["wiki"], "degraded")
            wiki_command = next(call.args[0] for call in run.call_args_list if "infer-from-wiki.py" in call.args[0])
            self.assertIn("--mode full", wiki_command)
            self.assertIn('--wiki ""', run.call_args.args[0])
