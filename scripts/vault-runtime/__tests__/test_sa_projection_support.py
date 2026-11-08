import importlib.util
import json
import os
import sys
import tempfile
import unittest

import yaml

SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from sa_projection_support import (  # noqa: E402
    build_layout,
    load_projection_schema,
    project_dependencies,
    validate_artifacts,
)


def resolve_vault_root():
    """按既有约定解析 Vault 仓库根。

    优先环境变量 ``VAULT_PATH``（Vault 仓库根），否则回落到 ``kb_paths.vault_roots()``
    ——与该目录下其它脚本保持同一套路径约定。
    """
    vault_env = os.environ.get("VAULT_PATH")
    if vault_env:
        return os.path.abspath(os.path.expanduser(vault_env))
    from kb_paths import vault_roots  # noqa: E402  (SCRIPT_DIR 已在文件头注入 sys.path)

    vault_root, _knowledge_root = vault_roots()
    return vault_root


class SemanticProjectionSupportTest(unittest.TestCase):
    def test_schema_drives_product_relation_filter_and_layout(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            enums_path = os.path.join(temp_dir, "enums.yaml")
            master_path = os.path.join(temp_dir, "master_graph.json")
            deps_path = os.path.join(temp_dir, "dependencies.yaml")
            layout_path = os.path.join(temp_dir, "architecture_layout.json")
            with open(enums_path, "w", encoding="utf-8") as handle:
                yaml.safe_dump({
                    "arch_categories": ["服务"],
                    "layers": [{"id": "service", "label": "服务层", "color": "cyan", "layout": "central"}],
                    "architecture_projection": {
                        "product": "OtherProduct",
                        "version": "v2",
                        "category_aliases": {"backend": "服务"},
                        "layer_aliases": {"backend-layer": "service"},
                        "subdomain_aliases": {"legacy-sub": "architecture"},
                        "projected_relation_types": ["DEPENDS_ON"],
                    },
                }, handle, allow_unicode=True)
            with open(master_path, "w", encoding="utf-8") as handle:
                json.dump({
                    "nodes": [{"id": "a"}, {"id": "b"}],
                    "connections": [
                        {"from": "a", "to": "b", "relationType": "DEPENDS_ON"},
                        {"from": "a", "to": "b", "relationType": "RELATED"},
                    ],
                }, handle)
            with open(deps_path, "w", encoding="utf-8") as handle:
                yaml.safe_dump({"dependencies": []}, handle)

            # WP-049 L3：两函数改吃文档 dict（读侧经信封；测试自读 fixture 属测试供数面）
            with open(enums_path, encoding="utf-8") as handle:
                schema = load_projection_schema(yaml.safe_load(handle) or {})
            with open(deps_path, encoding="utf-8") as handle:
                dependencies = project_dependencies(master_path, ["a", "b"], schema, yaml.safe_load(handle) or {})
            sa = {
                "version": "1.0.0",
                "product": schema["product"],
                "layers": [{"id": "service", "label": "服务层", "color": "cyan"}],
                "components": [
                    {"id": "a", "layer": "service"},
                    {"id": "b", "layer": "service"},
                ],
                "dependencies": dependencies,
            }
            layout = build_layout(sa, schema, layout_path)
            validate_artifacts(sa, layout, schema)

            self.assertEqual(schema["product"], "OtherProduct")
            self.assertEqual(schema["layer_aliases"]["backend-layer"], "service")
            self.assertEqual(schema["subdomain_aliases"]["legacy-sub"], "architecture")
            self.assertEqual([item["relationType"] for item in dependencies], ["DEPENDS_ON"])
            self.assertEqual(set(layout["nodes"]), {"a", "b"})

    def test_dependency_range_is_half_open_and_yaml_cannot_create_edges(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            master_path = os.path.join(temp_dir, "master_graph.json")
            deps_path = os.path.join(temp_dir, "dependencies.yaml")
            with open(master_path, "w", encoding="utf-8") as handle:
                json.dump({
                    "nodes": [{"id": "a"}, {"id": "b"}],
                    "connections": [
                        {"from": "a", "to": "b", "relationType": "DEPENDS_ON"},
                    ],
                }, handle)
            with open(deps_path, "w", encoding="utf-8") as handle:
                yaml.safe_dump({"dependencies": [
                    {"source": "a", "target": "b", "type": "DEPENDS_ON", "since": "7.0", "until": "7.3"},
                    {"source": "b", "target": "a", "type": "DEPENDS_ON", "since": "7.0"},
                ]}, handle)
            schema = {"projected_relation_types": {"DEPENDS_ON"}}

            with open(deps_path, encoding="utf-8") as handle:
                deps_doc = yaml.safe_load(handle) or {}
            before_until = project_dependencies(master_path, ["a", "b"], schema, deps_doc, "7.2.9")
            at_until = project_dependencies(master_path, ["a", "b"], schema, deps_doc, "7.3")

            self.assertEqual([(item["from"], item["to"]) for item in before_until], [("a", "b")])
            self.assertEqual(at_until, [])


class RealEnumsContractTest(unittest.TestCase):
    """真实 ``知识库/TheSchema/enums.yaml`` 的契约回归测试。

    存在的意义：``SemanticProjectionSupportTest`` 用 tempfile 造的是**合成** enums，
    只能验证「机制」；一旦真实 enums 的契约形态发生漂移（例如 T8 删掉了顶层
    ``arch_layers`` 与 ``architecture_projection.layers`` 却漏迁消费者），合成 fixture
    给不出任何信号。本类直接读真实 enums，把漂移钉死在测试里。

    无 Vault 的环境（如 CI）里静默跳过，不 fail-close。
    """

    def _resolve_real_enums_path(self):
        vault_root = resolve_vault_root()
        enums_path = os.path.join(vault_root, "知识库", "TheSchema", "enums.yaml")
        if not os.path.isfile(enums_path):
            raise unittest.SkipTest(
                "真实 enums.yaml 不存在，跳过真实契约测试 "
                f"(VAULT_PATH={os.environ.get('VAULT_PATH')!r}): {enums_path}"
            )
        return vault_root, enums_path

    def _import_validate_entity(self, vault_root):
        """加载 validate-entity.py 只取 VALID_LAYERS 常量。

        该模块的 ``main()`` 由 ``if __name__ == "__main__"`` 守护，import 无主动副作用；
        但它在 import 期经 ``kb_paths.vault_roots()``（读 ``KB_VAULT``）解析 enums，
        故先临时把 ``KB_VAULT`` 钉到同一个 vault_root，保证两侧读的是同一份契约。
        """
        saved = os.environ.get("KB_VAULT")
        os.environ["KB_VAULT"] = vault_root
        try:
            module_path = os.path.join(SCRIPT_DIR, "validate-entity.py")
            spec = importlib.util.spec_from_file_location(
                "validate_entity_real_contract", module_path
            )
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return module
        finally:
            if saved is None:
                os.environ.pop("KB_VAULT", None)
            else:
                os.environ["KB_VAULT"] = saved

    def test_retired_keys_stay_retired_and_layer_counts_hold(self):
        vault_root, enums_path = self._resolve_real_enums_path()
        with open(enums_path, "r", encoding="utf-8") as handle:
            enums = yaml.safe_load(handle) or {}

        # a. 退役键保持退役：顶层无 arch_layers，architecture_projection 下无 layers 子键
        self.assertNotIn("arch_layers", enums)
        projection = enums.get("architecture_projection") or {}
        self.assertNotIn("layers", projection)

        # b. 投影侧（sa_projection_support）读顶层 layers：11 项，含 plate
        schema = load_projection_schema(enums_path)
        self.assertEqual(len(schema["valid_layers"]), 11)
        self.assertIn("plate", schema["valid_layers"])

        # c. entity 校验侧（validate-entity）读同一顶层 layers 但过 entity_layer 过滤：10 项，不含 plate
        validate_entity = self._import_validate_entity(vault_root)
        self.assertEqual(len(validate_entity.VALID_LAYERS), 10)
        self.assertNotIn("plate", validate_entity.VALID_LAYERS)


if __name__ == "__main__":
    unittest.main()
