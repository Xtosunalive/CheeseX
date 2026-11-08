# 回归固化（PR-123，2026-10-26）：schema_loader 模块映射对可选键硬取 → KeyError。
# 病灶：module_subdomain_map()/module_system_map() 用 v["subdomain"]/v["system"] 硬取，而两份契约
# （contracts/enums.schema.json、contracts/theschema.subject-enums.schema.json）均把 subdomain/system
# 列为可选；e2e fixture 唯一模块 e2e-module 只带 description（合规）→ 管线 Stage 1 extract_graph
# 模块级初始化即 KeyError:'subdomain' 中断，受控 e2e 永远到不了 Stage 1.5/3.6 写面（掩盖 PR-120 写链缺陷）。
# 真库 modules 为空故从未触发。消费方（extract_graph:1687/2254）本就对 None 守卫，loader 对齐契约即可。
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import yaml

SCRIPT_DIR = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

import schema_loader  # noqa: E402


def _dump_cli():
    from pathlib import Path as _P

    return _P(__file__).resolve().parents[2] / "vault-runtime" / "dump-vocab-envelope.mjs"


_REPO_ROOT_DUMMY = None


def write_enums(temp_dir, modules):
    # WP-049 L3：fixture 经信封注入（Node 装载端口物化——被测 loader 零词表文件读取）
    from _vocab_fixture import install_vocab_envelope

    install_vocab_envelope(temp_dir, {"enums": {"modules": modules}})


class EnvPinnedTestCase(unittest.TestCase):
    """独立临时库经真实 loader 读取；每例复位两份缓存并还原环境，不依赖真库。"""

    def setUp(self):
        self._temp = tempfile.TemporaryDirectory()
        self.addCleanup(self._temp.cleanup)
        self._saved = {key: os.environ.get(key) for key in ("THESCHEMA_DIR", "KB_VAULT", "VOCAB_ENVELOPE_PATH")}
        self.addCleanup(self._restore)
        os.mkdir(os.path.join(self._temp.name, "知识库"))
        os.environ["KB_VAULT"] = self._temp.name
        os.environ["THESCHEMA_DIR"] = self._temp.name
        schema_loader._REGISTRY = None
        schema_loader._ONTOLOGY = None

    def _restore(self):
        for key, value in self._saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        schema_loader._REGISTRY = None
        schema_loader._ONTOLOGY = None


class ModuleMapsOptionalKeysTest(EnvPinnedTestCase):
    def test_module_without_subdomain_or_system_does_not_raise(self):
        # 与 e2e fixture（build-e2e-vault.mjs 写的 e2e-module）同形：只有 description
        write_enums(self._temp.name, {"e2e-module": {"description": "E2E vault module"}})
        self.assertEqual(schema_loader.module_subdomain_map(), {"e2e-module": None})
        self.assertEqual(schema_loader.module_system_map(), {"e2e-module": None})

    def test_module_with_keys_returns_values(self):
        write_enums(self._temp.name, {
            "svc-a": {"subdomain": "deploy", "system": "core"},
            "svc-b": {"description": "no keys"},
        })
        self.assertEqual(schema_loader.module_subdomain_map(), {"svc-a": "deploy", "svc-b": None})
        self.assertEqual(schema_loader.module_system_map(), {"svc-a": "core", "svc-b": None})

    def test_non_dict_module_definition_is_skipped_not_crashed(self):
        # 防御：非对象定义（legacy 裸标量）不抛——与 products() 对 definition 的 isinstance 守卫同口径
        write_enums(self._temp.name, {"legacy": "裸标量", "ok": {"subdomain": "x"}})
        self.assertEqual(schema_loader.module_subdomain_map(), {"ok": "x"})
        self.assertEqual(schema_loader.module_system_map(), {"ok": None})


class OntologyLifecycleConsumptionTest(EnvPinnedTestCase):
    """WP-038 单元/loader 契约层：真实临时 YAML 与仓内 JS 模块，不代表管线端到端。"""

    @staticmethod
    def retired(target):
        return {"lifecycle_status": "retired", "retirement": {
            "reason": "由后继替代", "replaced_by": target,
        }}

    def write_ontology(self, ontology, labels=None):
        # WP-049 L3：fixture 经信封注入（Node 装载端口物化＋形态收口），缓存随助手复位
        from _vocab_fixture import install_vocab_envelope

        install_vocab_envelope(self._temp.name, {
            "ontology": ontology,
            "enums": {"architecture_projection": {"wikilink_type_labels": labels or {}}},
        })
        # 确认夹具没有被形态校验丢弃，测试确实触达生命周期读侧。
        self.assertEqual(schema_loader._get_ontology(), ontology)
        return Path(self._temp.name, "知识库", "TheSchema", "ontology.yaml")

    def assert_resolution_error(self, section, original_id, code, chain):
        with self.assertRaises(ValueError) as caught:
            schema_loader.resolve_ontology_reference(section, original_id)
        message = str(caught.exception)
        self.assertTrue(message.startswith(code + ":"), message)
        self.assertIn(f"original_id={original_id!r}", message)
        self.assertIn(f"replacement_chain={chain!r}", message)
        return message

    def test_five_states_and_default_only_register_approved(self):
        entries = {
            "Default": {}, "Approved": {"lifecycle_status": "approved"},
            "Draft": {"lifecycle_status": "draft"},
            "Submitted": {"lifecycle_status": "submitted"},
            "Reserved": {"lifecycle_status": "reserved"},
            "Retired": self.retired("Approved"),
        }
        self.write_ontology({"node_types": entries, "relation_types": entries}, {
            **{key: key for key in entries}, "未知": "Missing", " 默认 ": " Default ",
        })
        expected = {key: entries[key] for key in ("Default", "Approved")}
        self.assertEqual(schema_loader.ontology_node_types(), expected)
        self.assertEqual(schema_loader.ontology_relation_types(), expected)
        self.assertEqual(schema_loader.wikilink_type_map(), {
            "Default": "Default", "Approved": "Approved", "默认": "Default",
        })
        for section in ("node_types", "relation_types"):
            for element_id in expected:
                with self.subTest(section=section, element_id=element_id):
                    self.assertEqual(schema_loader.resolve_ontology_reference(section, element_id), {
                        "original_id": element_id, "resolved_id": element_id,
                        "replacement_chain": [element_id],
                    })
            self.assertEqual(schema_loader.resolve_ontology_reference(section, "Retired"), {
                "original_id": "Retired", "resolved_id": "Approved",
                "replacement_chain": ["Retired", "Approved"],
            })

    def test_all_nonapproved_or_empty_registries_never_expose_wikilinks(self):
        entries = {
            "Draft": {"lifecycle_status": "draft"},
            "Submitted": {"lifecycle_status": "submitted"},
            "Reserved": {"lifecycle_status": "reserved"},
            "Retired": self.retired("Draft"),
        }
        for registry in (entries, {}):
            with self.subTest(registry=registry):
                self.write_ontology({"node_types": registry, "relation_types": registry}, {
                    **{key: key for key in entries}, "未知": "Missing",
                })
                self.assertEqual(schema_loader.ontology_node_types(), {})
                self.assertEqual(schema_loader.ontology_relation_types(), {})
                self.assertEqual(schema_loader.wikilink_type_map(), {})

    def test_multihop_matches_real_js_and_preserves_source_bytes_on_repeated_reads(self):
        entries = {"A": self.retired("B"), "B": self.retired("C"), "C": {}}
        path = self.write_ontology({"node_types": entries, "relation_types": entries})
        snapshot = path.read_bytes()
        loaded_snapshot = copy.deepcopy(schema_loader._get_ontology())
        queries = [(section, key) for section in ("node_types", "relation_types") for key in entries]
        expected = [{"original_id": key, "resolved_id": "C", "replacement_chain": chain}
                    for _section in ("node_types", "relation_types")
                    for key, chain in (("A", ["A", "B", "C"]), ("B", ["B", "C"]), ("C", ["C"]))]
        module = Path(SCRIPT_DIR).parents[1] / "server/shared/ontology-inheritance-resolver.cjs"
        javascript = """
const fs = require('node:fs');
const { normalizeRetiredReference } = require(process.argv[1]);
const { ontology, queries } = JSON.parse(fs.readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(queries.map(([section, id]) =>
  normalizeRetiredReference(ontology[section], id, { elementType: section, registries: ontology }))));
"""
        for _run in range(2):
            actual = [schema_loader.resolve_ontology_reference(section, key) for section, key in queries]
            self.assertEqual(actual, expected)
            result = subprocess.run(["node", "-e", javascript, str(module)], input=json.dumps({
                "ontology": schema_loader._get_ontology(), "queries": queries,
            }), text=True, capture_output=True, check=True)
            self.assertEqual(actual, json.loads(result.stdout))
            # 返回链可独立修改，不得污染后续读取或原始定义。
            actual[0]["replacement_chain"].append("not-a-definition")
            self.assertEqual(schema_loader._get_ontology(), loaded_snapshot)
            self.assertEqual(path.read_bytes(), snapshot)
            schema_loader._ONTOLOGY = None

    def test_unknown_original_and_invalid_ids_report_explicit_errors(self):
        self.write_ontology({"node_types": {}, "relation_types": {}})
        for section in ("node_types", "relation_types"):
            self.assert_resolution_error(section, "Missing", "UNKNOWN_ELEMENT", ["Missing"])
            for value in (None, "", 42):
                with self.subTest(section=section, value=value):
                    self.assert_resolution_error(section, value, "INVALID_ELEMENT_ID", [value])

    def test_broken_chains_report_distinct_reasons_original_id_and_full_chain(self):
        cases = [
            ({"A": self.retired("B"), "B": self.retired("Missing")},
             "DANGLING_REPLACEMENT", ["A", "B", "Missing"]),
            ({"A": self.retired("B"), "B": self.retired("A")},
             "REPLACEMENT_CYCLE", ["A", "B", "A"]),
            ({"A": self.retired("A")}, "REPLACEMENT_SELF_REFERENCE", ["A", "A"]),
            ({"A": self.retired("B"), "B": self.retired("B")},
             "REPLACEMENT_SELF_REFERENCE", ["A", "B", "B"]),
            ({"A": self.retired("B"), "B": {"lifecycle_status": "retired"}},
             "MISSING_REPLACEMENT", ["A", "B"]),
            ({"A": self.retired("")}, "MISSING_REPLACEMENT", ["A"]),
        ]
        for status in ("draft", "submitted", "reserved"):
            cases.extend([
                ({"A": {"lifecycle_status": status}}, "NO_APPROVED_REPLACEMENT", ["A"]),
                ({"A": self.retired("B"), "B": {"lifecycle_status": status}},
                 "NO_APPROVED_REPLACEMENT", ["A", "B"]),
            ])
        for section in ("node_types", "relation_types"):
            for registry, code, chain in cases:
                with self.subTest(section=section, registry=registry):
                    self.write_ontology({section: registry})
                    self.assert_resolution_error(section, "A", code, chain)
                    if section == "node_types":
                        with self.assertRaisesRegex(ValueError, code):
                            schema_loader.normalize_node_label("A")
                        for labels in (["A"], ["Unknown", "A"], ["A", "Unknown"]):
                            with self.assertRaisesRegex(ValueError, code):
                                schema_loader.infer_node_type_from_labels(labels)
                    else:
                        valid, message, error = schema_loader.validate_relation("C", "C", "A")
                        self.assertEqual((valid, error), (False, True))
                        self.assertIn(code, message)

    def test_cross_type_targets_are_identified_from_other_ontology_sections(self):
        sections = ("node_types", "relation_types", "action_types", "risk_types", "inference_rules", "constraints")
        for section in ("node_types", "relation_types"):
            for other in sections:
                if section == other:
                    continue
                with self.subTest(section=section, other=other):
                    foreign = [{"id": "Foreign"}] if other in ("inference_rules", "constraints") else {"Foreign": {}}
                    self.write_ontology({section: {"A": self.retired("Foreign")}, other: foreign})
                    message = self.assert_resolution_error(section, "A", "CROSS_TYPE_REPLACEMENT", ["A", "Foreign"])
                    self.assertIn(other, message)
                    self.assert_resolution_error(section, "Foreign", "CROSS_TYPE_REPLACEMENT", ["Foreign"])

    def test_same_id_in_another_section_does_not_override_local_target(self):
        self.write_ontology({
            "node_types": {"A": self.retired("B"), "B": {}},
            "relation_types": {"B": {"lifecycle_status": "draft"}},
        })
        self.assertEqual(schema_loader.normalize_node_label("A"), "B")

    def test_label_inference_normalizes_history_and_keeps_unknown_fallbacks(self):
        self.write_ontology({"node_types": {
            "A": self.retired("B"), "B": self.retired("C"), "C": {},
        }})
        self.assertEqual(schema_loader.normalize_node_label("A"), "C")
        self.assertEqual(schema_loader.infer_node_type_from_labels(["A"]), "C")
        self.assertEqual(schema_loader.infer_node_type_from_labels(["Unknown", "A"]), "C")
        self.assertIsNone(schema_loader.normalize_node_label("Unknown"))
        self.assertEqual(schema_loader.infer_node_type_from_labels(["Unknown", "Other"]), "Unknown")
        self.assertEqual(schema_loader.infer_node_type_from_labels([]), "Entity")
        self.assertEqual(schema_loader.infer_node_type_from_labels(None), "Entity")

    def test_empty_labels_cannot_fall_back_to_defined_nonapproved_entity(self):
        for status in ("draft", "submitted", "reserved"):
            with self.subTest(status=status):
                self.write_ontology({"node_types": {"Entity": {"lifecycle_status": status}}})
                with self.assertRaisesRegex(ValueError, "NO_APPROVED_REPLACEMENT"):
                    schema_loader.infer_node_type_from_labels([])
        self.write_ontology({"node_types": {"Entity": self.retired("C"), "C": {}}})
        self.assertEqual(schema_loader.infer_node_type_from_labels([]), "C")

    def test_historical_relation_and_endpoint_references_validate_without_rewriting(self):
        path = self.write_ontology({
            "node_types": {"A": self.retired("B"), "B": self.retired("C"), "C": {}},
            "relation_types": {
                "OLD_R": self.retired("MID_R"), "MID_R": self.retired("R"),
                "R": {"source_types": ["A"], "target_types": ["B"]},
            },
        }, {"旧关系": "OLD_R", "现役关系": "R"})
        historical_path = Path(self._temp.name, "historical-graph.json")
        historical_path.write_text('{"source": "A", "target": "B", "type": "OLD_R"}\n', encoding="utf-8")
        snapshots = {file: file.read_bytes() for file in (path, historical_path)}
        for _run in range(2):
            edge = json.loads(historical_path.read_text(encoding="utf-8"))
            self.assertEqual(schema_loader.validate_relation(edge["source"], edge["target"], edge["type"]), (True, "", False))
            source = schema_loader.infer_node_type_from_labels([edge["source"]])
            target = schema_loader.infer_node_type_from_labels([edge["target"]])
            self.assertEqual(schema_loader.validate_relation(source, target, edge["type"]), (True, "", False))
            self.assertEqual(schema_loader.ontology_relation_types().keys(), {"R"})
            self.assertEqual(schema_loader.wikilink_type_map(), {"现役关系": "R"})
            for file, snapshot in snapshots.items():
                self.assertEqual(file.read_bytes(), snapshot)
            schema_loader._ONTOLOGY = None
            schema_loader._REGISTRY = None

    def test_relation_rejects_nonapproved_endpoints_and_bad_unused_rule_members(self):
        for field in ("source_types", "target_types"):
            for definition, code in (
                ({"lifecycle_status": "draft"}, "NO_APPROVED_REPLACEMENT"),
                ({"lifecycle_status": "submitted"}, "NO_APPROVED_REPLACEMENT"),
                ({"lifecycle_status": "reserved"}, "NO_APPROVED_REPLACEMENT"),
                (self.retired("Missing"), "DANGLING_REPLACEMENT"),
            ):
                for in_rule in (False, True):
                    with self.subTest(field=field, definition=definition, in_rule=in_rule):
                        rule = {"source_types": ["C"], "target_types": ["C"]}
                        if in_rule:
                            rule[field].append("Bad")
                        self.write_ontology({"node_types": {"C": {}, "Bad": definition}, "relation_types": {"R": rule}})
                        source = "Bad" if field == "source_types" and not in_rule else "C"
                        target = "Bad" if field == "target_types" and not in_rule else "C"
                        valid, message, error = schema_loader.validate_relation(source, target, "R")
                        self.assertEqual((valid, error), (False, True))
                        self.assertIn(code, message)
                        self.assertIn("original_id='Bad'", message)

    def test_approved_relation_compatibility_still_returns_warning_tuple(self):
        self.write_ontology({
            "node_types": {"Source": {}, "Target": {}},
            "relation_types": {"R": {"source_types": ["Source"], "target_types": ["Target"]}},
        })
        self.assertEqual(schema_loader.validate_relation("Source", "Target", "R"), (True, "", False))
        for source, target in (("Target", "Target"), ("Source", "Source"), ("Target", "Source")):
            with self.subTest(source=source, target=target):
                valid, message, error = schema_loader.validate_relation(source, target, "R")
                self.assertEqual((valid, error), (False, False))
                self.assertTrue(message)


class OntologyDegradedPathsTest(EnvPinnedTestCase):
    """装载器契约层：局部删除与同次诊断，不替代抽取进程验证。
    WP-049 L3 语义迁移：读侧取数经信封——降级/缓存/坏件语义按新契约重写（Node 装载点
    收口：脏节点丢弃、坏 YAML 物化点失败、缺件＝空文档）；normalize_the_schema 纯函数面不动。"""

    def test_dotted_ids_drop_exact_nodes_without_mutating_input(self):
        document = {
            "node_types": {"Good.v1": {}, "Bad.v1": {"description": 42}},
            "relation_types": {
                "R": {"source_types": ["Good.v1"]},
                "R.v1": {"source_types": 42, "target_types": False},
                "R.v1/part~0": {"target_types": 42},
                "HEALTHY": {"source_types": ["Good.v1"], "target_types": ["Good.v1"]},
            },
        }
        snapshot = copy.deepcopy(document)
        data, trail, degraded = schema_loader.normalize_the_schema("ontology", document)
        self.assertEqual(set(data["relation_types"]), {"R", "HEALTHY"})
        self.assertEqual(set(data["node_types"]), {"Good.v1"})
        self.assertEqual(trail, [])
        self.assertEqual({tuple(item["path_parts"]) for item in degraded}, {
            ("node_types", "Bad.v1"), ("relation_types", "R.v1"),
            ("relation_types", "R.v1/part~0"),
        })
        self.assertEqual(len(degraded), 3)
        for item in degraded:
            self.assertEqual(item["path"], ".".join(item["path_parts"]))
            self.assertTrue(item["message"])
        self.assertEqual(document, snapshot)

    def test_top_level_drop_and_array_placeholders_are_unchanged(self):
        data, _, degraded = schema_loader.normalize_the_schema("ontology", {
            "node_types": 42,
            "inference_rules": [{"id": "bad", "description": 42}, {"id": "good"}],
            "relation_types": {"0": {"source_types": 42}, "HEALTHY": {}},
        })
        self.assertEqual(data, {
            "inference_rules": [None, {"id": "good"}],
            "relation_types": {"HEALTHY": {}},
        })
        self.assertEqual({tuple(item["path_parts"]) for item in degraded}, {
            ("node_types",), ("inference_rules", 0), ("relation_types", "0"),
        })

    def test_rematerialize_replaces_data_and_cache_resets_with_it(self):
        # WP-049 L3：脏节点在 Node 装载点降级丢弃，降级收据随信封透传——invalid 标记保留，
        # 消费面（产出闸）语义与旧装载器一致；重物化＝数据与收据一同翻新。
        from _vocab_fixture import install_vocab_envelope

        install_vocab_envelope(self._temp.name, {"ontology": {"relation_types": {
            "R.v1": {"source_types": 42}, "HEALTHY": {},
        }}})
        self.assertEqual(schema_loader.ontology_relation_types(), {"HEALTHY": {}})
        # 降级收据随信封透传：invalid 标记保留（产出闸语义不变）——数据里 R.v1 已丢（Node 装载点），
        # 收据里 path_parts 可逆（含点 ID 不切碎——正是 Node 侧 dropNode 修复的缺口）
        self.assertEqual(schema_loader.ontology_relation_lifecycle(), {"R.v1": "invalid", "HEALTHY": "approved"})
        self.assertEqual(schema_loader._get_ontology(), {"relation_types": {"HEALTHY": {}}})

        for replacement, expected in (
            ({"relation_types": {"R.v1": {}}}, {"R.v1": "approved"}),
            ({"relation_types": {"OTHER": {}}}, {"OTHER": "approved"}),
            ({}, {}),
        ):
            install_vocab_envelope(self._temp.name, {"ontology": replacement})
            self.assertEqual(schema_loader.ontology_relation_lifecycle(), expected)
            self.assertEqual(schema_loader._get_ontology(), replacement)

    def test_one_envelope_feeds_repeated_reads_until_rematerialize(self):
        # WP-049 L3：同信封内多次取数同源（进程内单例）；重物化后翻新（旧「一载一诊断」缓存语义）
        from _vocab_fixture import install_vocab_envelope

        install_vocab_envelope(self._temp.name, {"ontology": {"relation_types": {
            "BROKEN": {"source_types": 42},
        }}})
        self.assertEqual(schema_loader.ontology_relation_types(), {})
        self.assertEqual(schema_loader.ontology_relation_lifecycle(), {"BROKEN": "invalid"})
        install_vocab_envelope(self._temp.name, {"ontology": {"relation_types": {"HEALTHY": {}}}})
        self.assertEqual(schema_loader.ontology_relation_lifecycle(), {"HEALTHY": "approved"})

    def test_unparseable_vocab_fails_closed_at_materialization_not_silent_empty(self):
        # WP-049 L3 语义迁移：坏 YAML 在物化点显式失败（旧「解析失败静默吞成空表」宽面收口）；
        # 修复 fixture 重物化后恢复正常。
        import subprocess as _sp

        ts = Path(self._temp.name, "知识库", "TheSchema")
        ts.mkdir(parents=True, exist_ok=True)
        # 阶梯成立条件：vault 侧目录须含 enums.yaml（theschema-root 探针）——只写坏 ontology，
        # 缺 enums 会回落仓内主源，坏件根本不被读到（假阴）
        (ts / "enums.yaml").write_text("domains: {}\n", encoding="utf-8")
        (ts / "ontology.yaml").write_text("relation_types: [unclosed", encoding="utf-8")
        proc = _sp.run(
            ["node", str(_REPO_ROOT_DUMMY) if False else _dump_cli(), "--vault", self._temp.name,
             "--out", str(Path(self._temp.name, ".ledger", "vocab-envelope.json"))],
            capture_output=True, text=True,
            env={k: v for k, v in os.environ.items() if k != "THESCHEMA_DIR"},
        )
        self.assertNotEqual(proc.returncode, 0, "坏词表必须在物化点失败，不得静默给空信封")

        from _vocab_fixture import install_vocab_envelope

        install_vocab_envelope(self._temp.name, {"ontology": {"relation_types": {"HEALTHY": {}}}})
        self.assertEqual(schema_loader.ontology_relation_lifecycle(), {"HEALTHY": "approved"})

    def test_missing_vocab_piece_yields_empty_doc_explicitly(self):
        # WP-049 L3：信封缺件＝空文档（与旧「文件缺失返回空收口结果」对齐）；缺的是件不是信封本身
        from _vocab_fixture import install_vocab_envelope

        install_vocab_envelope(self._temp.name, {"ontology": None})
        self.assertEqual(schema_loader.ontology_relation_lifecycle(), {})
        self.assertEqual(schema_loader._get_ontology(), {})


if __name__ == "__main__":
    unittest.main()
