"""merge-inferred 轨迹落点隔离——红绿双证：
绿：PIPELINE_TRAJECTORIES_DIR 指向临时目录时轨迹落临时目录、仓内 data/governance/pipeline-trajectories.jsonl 字节不变；
红面由 scripts/quality/__tests__/check-py-tests.test.mjs 的全量 pytest 跑前后哈希断言承担（无隔离即红）。
层级：纯单元（函数行为）；验证对象：scripts/vault-py/pipeline/merge-inferred.py::_append_trajectory / _trajectory_dir。"""
import hashlib
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "merge-inferred.py"
REPO_TRAJ = Path(__file__).resolve().parents[4] / "data" / "governance" / "pipeline-trajectories.jsonl"


def _load():
    spec = importlib.util.spec_from_file_location("merge_inferred", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else "absent"


class MergeInferredTrajectoryIsolationTest(unittest.TestCase):
    def test_env_override_redirects_trajectory_and_leaves_repo_file_untouched(self):
        mod = _load()
        before = _sha(REPO_TRAJ)
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "gov"
            old = os.environ.get("PIPELINE_TRAJECTORIES_DIR")
            os.environ["PIPELINE_TRAJECTORIES_DIR"] = str(target)
            try:
                mod._append_trajectory({"body": 1, "wiki": 0, "config": 0}, [{"method": "unit-test"}])
            finally:
                if old is None:
                    os.environ.pop("PIPELINE_TRAJECTORIES_DIR", None)
                else:
                    os.environ["PIPELINE_TRAJECTORIES_DIR"] = old
            out = target / "pipeline-trajectories.jsonl"
            self.assertTrue(out.exists(), "轨迹未落到 PIPELINE_TRAJECTORIES_DIR")
            rows = [json.loads(l) for l in out.read_text(encoding="utf-8").splitlines() if l.strip()]
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["tool"], "merge-inferred.py")
            self.assertEqual(rows[0]["outputs"]["methods"], {"unit-test": 1})
        self.assertEqual(_sha(REPO_TRAJ), before, "仓内 pipeline-trajectories.jsonl 被测试写入")

    def test_scope_resolution_env_gt_arch_repo_gt_fail_closed(self):
        mod = _load()
        old_traj = os.environ.pop("PIPELINE_TRAJECTORIES_DIR", None)
        old_arch = os.environ.pop("ARCH_REPO", None)
        try:
            # runtime-scope V01：解析链＝env ＞ ARCH_REPO/data/governance ＞ RuntimeError
            # （旧形态「缺省＝脚本所在仓 data/governance」废止——写路径不按 __file__ 位置猜）
            with self.assertRaises(RuntimeError):
                mod._trajectory_dir()
            os.environ["ARCH_REPO"] = "/x/svc-tree"
            self.assertEqual(mod._trajectory_dir(), Path("/x/svc-tree") / "data" / "governance")
            os.environ["PIPELINE_TRAJECTORIES_DIR"] = "/y/pinned"
            self.assertEqual(mod._trajectory_dir(), Path("/y/pinned"))
        finally:
            for key, val in (("PIPELINE_TRAJECTORIES_DIR", old_traj), ("ARCH_REPO", old_arch)):
                if val is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = val

    def test_append_trajectory_fail_open_when_scope_unresolved(self):
        # D5 fail-open 包装不变：作用域未解析时轨迹跳过（stderr 告警），主链路不炸、仓内零写入
        mod = _load()
        before = _sha(REPO_TRAJ)
        old_traj = os.environ.pop("PIPELINE_TRAJECTORIES_DIR", None)
        old_arch = os.environ.pop("ARCH_REPO", None)
        try:
            mod._append_trajectory({"body": 0, "wiki": 0, "config": 0}, [])
        finally:
            for key, val in (("PIPELINE_TRAJECTORIES_DIR", old_traj), ("ARCH_REPO", old_arch)):
                if val is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = val
        self.assertEqual(_sha(REPO_TRAJ), before, "作用域未解析时仍写了仓内轨迹")


if __name__ == "__main__":
    unittest.main()
