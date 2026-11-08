# 回归固化：ADR-008 D1 子域词条双形态——schema_loader.subdomains() 归一 + extract_graph 消费。
# 病灶史（2026-10-20 运行概览 500）：注册表词条对象被 extract_domain_nodes 当裸标量拼接，
# id 形如 "ref:{'id': 'x'}"、label/name 携带 dict，服务端 assertTopologySchema 拒收。
import importlib.util
import os
import sys
import tempfile
import unittest

import yaml

SCRIPT_DIR = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "vault-runtime"))  # W3 迁仓：schema_loader/kb_paths 住 vault-runtime/
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

import schema_loader  # noqa: E402


def _borrow_data_dir():
    """extract_graph 模块级 _staging_dir 需要 KB_DATA_DIR——借用后归还，
    不在模块级泄漏（discover 先收集后执行，泄漏会翻转准入清单等其他用例的允许根）。"""
    saved = os.environ.get("KB_DATA_DIR")
    if not saved:
        os.environ["KB_DATA_DIR"] = tempfile.mkdtemp(prefix="subdomain-entry-test-")
    return saved


def load_extract_graph():
    spec = importlib.util.spec_from_file_location(
        "extract_graph",
        os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "graph", "extract_graph.py")),  # W3 迁仓：extract_graph 住 graph/
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_enums(temp_dir, subdomains):
    # WP-049 L3：词表 fixture 经信封注入（Node 装载端口物化）
    from _vocab_fixture import install_vocab_envelope

    install_vocab_envelope(temp_dir, {"enums": {
        "domains": {"arch": "架构"}, "subdomains": subdomains,
    }})


class EnvPinnedTestCase(unittest.TestCase):
    """每例钉 THESCHEMA_DIR 到临时目录并复位 _REGISTRY，结束后还原真库。"""

    def setUp(self):
        self._temp = tempfile.TemporaryDirectory()
        self.addCleanup(self._temp.cleanup)
        self._saved = {k: os.environ.get(k) for k in ("THESCHEMA_DIR", "VOCAB_ENVELOPE_PATH")}
        self.addCleanup(self._restore)

    def _restore(self):
        for key, value in self._saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        schema_loader.reset_envelope_cache()


class SubdomainEntryNormalizationTest(EnvPinnedTestCase):
    def test_scalar_legacy_entries_become_id_objects(self):
        write_enums(self._temp.name, {"arch": ["deploy", " backup "]})
        schema_loader.reset_envelope_cache()
        self.assertEqual(
            schema_loader.subdomains(), {"arch": [{"id": "deploy"}, {"id": "backup"}]})

    def test_entry_objects_pass_through_with_trimmed_id(self):
        write_enums(self._temp.name, {"arch": [
            {"id": " deploy ", "label": "部署", "description": "发布与回滚"},
            {"id": "monitor", "label": "监控"},
        ]})
        schema_loader.reset_envelope_cache()
        self.assertEqual(schema_loader.subdomains(), {"arch": [
            {"id": "deploy", "label": "部署", "description": "发布与回滚"},
            {"id": "monitor", "label": "监控"},
        ]})

    def test_null_placeholder_preserved_and_dirty_domain_degraded(self):
        # 脏条目（非标量非词条对象）在 normalize_the_schema 严格层即整域降级丢弃
        # （PR-053 实例路径前两段语义）——归一层只见合法双形态；null=域预留位保留
        write_enums(self._temp.name, {
            "arch": [123, {"label": "无 id"}],
            "ops": None,
        })
        schema_loader.reset_envelope_cache()
        self.assertEqual(schema_loader.subdomains(), {"ops": None})


class ExtractDomainNodesEntryConsumptionTest(EnvPinnedTestCase):
    def test_registry_entries_emit_string_nodes(self):
        write_enums(self._temp.name, {"arch": [{"id": "deploy", "label": "部署"}]})
        schema_loader.reset_envelope_cache()
        saved = _borrow_data_dir()
        try:
            module = load_extract_graph()
        finally:
            if saved is None:
                os.environ.pop("KB_DATA_DIR", None)
        nodes, edges = module.extract_domain_nodes()
        subdomain = next(n for n in nodes if "Subdomain" in n["labels"])
        # 修复前：name/slug 为 dict、id 为 "arch:{'id': 'deploy', ...}"——正是 500 根因
        self.assertEqual(subdomain["id"], "arch:deploy")
        self.assertEqual(subdomain["properties"]["name"], "部署")
        self.assertEqual(subdomain["properties"]["slug"], "deploy")
        self.assertTrue(all(isinstance(n["properties"]["name"], str) for n in nodes))
        self.assertTrue(all(isinstance(e["source"], str) and isinstance(e["target"], str) for e in edges))


if __name__ == "__main__":
    unittest.main()
