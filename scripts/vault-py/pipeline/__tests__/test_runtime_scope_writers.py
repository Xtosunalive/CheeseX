# runtime-scope 波2（V02/V05）写者解析测试：规则资产根与 master_graph.db 落点不再按脚本位置/空串猜。
# 层级：纯单元（解析函数行为）；验证对象：
#   scripts/vault-py/rules/validate-relation-expectations.py::_resolve_rules_root
#   scripts/vault-py/graph/extract_graph.py::_populate_document_index（经 kb_paths.data_dir）
import importlib.util
import os
import tempfile
import unittest
from pathlib import Path

_HERE = Path(__file__).resolve().parent


def _load(relpath, name):
    spec = importlib.util.spec_from_file_location(name, (_HERE / relpath).resolve())
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class EnvGuard(unittest.TestCase):
    def pin_env(self, **kv):
        """kv=None 表示弹出；返回还原函数。"""
        saved = {}
        for key, val in kv.items():
            saved[key] = os.environ.get(key)
            if val is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = val

        def restore():
            for key, val in saved.items():
                if val is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = val
        self.addCleanup(restore)


class RulesRootScopeTest(EnvGuard):
    def test_env_gt_arch_repo_gt_fail_closed(self):
        mod = _load("../../rules/validate-relation-expectations.py", "vre_scope")
        self.pin_env(PIPELINE_RULES_DIR=None, ARCH_REPO=None)
        with self.assertRaises(RuntimeError):
            mod._resolve_rules_root()
        self.pin_env(ARCH_REPO="/x/svc-tree")
        self.assertEqual(mod._resolve_rules_root(), Path("/x/svc-tree") / "data" / "governance" / "pipeline-rules")
        self.pin_env(PIPELINE_RULES_DIR="/y/rules")
        self.assertEqual(mod._resolve_rules_root(), Path("/y/rules"))

    def test_runtime_channel_does_not_need_rules_root(self):
        # 运行时通道（--expectations-file）不触规则资产根：缺 ARCH_REPO 也不因根解析失败误伤
        import json
        mod = _load("../../rules/validate-relation-expectations.py", "vre_rt")
        with tempfile.TemporaryDirectory() as tmp:
            exp = Path(tmp) / "expectations.json"
            exp.write_text("[]", encoding="utf-8")
            (Path(tmp) / ".ledger").mkdir()
            (Path(tmp) / ".ledger" / "master_graph.json").write_text('{"connections": []}', encoding="utf-8")
            self.pin_env(PIPELINE_RULES_DIR=None, ARCH_REPO=None)
            import sys
            old_argv = sys.argv
            sys.argv = ["vre", "--vault", tmp, "--expectations-file", str(exp)]
            self.addCleanup(setattr, sys, "argv", old_argv)
            rc = mod.main()
        self.assertIn(rc, (0, 1))


class ExtractGraphMasterPathTest(EnvGuard):
    def test_master_graph_db_resolves_via_data_dir_fail_closed(self):
        mod = _load("../../graph/extract_graph.py", "eg_scope")
        self.pin_env(KB_DATA_DIR=None)
        with self.assertRaises(RuntimeError):
            mod._populate_document_index([])
        with tempfile.TemporaryDirectory() as tmp:
            self.pin_env(KB_DATA_DIR=tmp)
            mod._populate_document_index([])
            self.assertTrue((Path(tmp) / "master_graph.db").exists(), "库未落到钉定的 data 目录")


if __name__ == "__main__":
    unittest.main()
