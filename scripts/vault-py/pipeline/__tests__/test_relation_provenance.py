import os
import sys
import tempfile
import unittest

# W2 迁仓：extract_graph 住 graph/（本测试住 pipeline/tests/）——目标目录按相对位置定位
SCRIPT_DIR = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "graph"))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

# extract_graph 模块级 _staging_dir 需要 KB_DATA_DIR（缺省 fail-closed）——
# 借用后立即归还：discover 先收集后执行，模块级 setdefault 会泄漏给先跑的其他用例
_saved_data_dir = os.environ.get("KB_DATA_DIR")
if not _saved_data_dir:
    os.environ["KB_DATA_DIR"] = tempfile.mkdtemp(prefix="relation-provenance-test-")

import extract_graph

if _saved_data_dir is None:
    os.environ.pop("KB_DATA_DIR", None)


class RelationProvenanceTest(unittest.TestCase):
    def test_typed_wikilink_keeps_source_hash_line_and_evidence(self):
        edges = []
        unresolved = extract_graph._extract_entity_references(
            "gateway",
            "说明\n依赖::[[Auth]]\n",
            edges,
            {"Auth": "auth"},
            [],
            "知识库/wiki/entities/gateway.md",
            "sha256:source",
            5,
        )

        self.assertEqual(unresolved, [])
        self.assertEqual(len(edges), 1)
        source = edges[0]["properties"]["sources"][0]
        self.assertEqual(source["file"], "知识库/wiki/entities/gateway.md")
        self.assertEqual(source["source_hash"], "sha256:source")
        self.assertEqual(source["line_number"], 7)
        self.assertEqual(source["evidence_text"], "依赖::[[Auth]]")
        self.assertEqual(extract_graph._edge_source_hash({"properties": edges[0]["properties"]}), "sha256:source")

    def test_merge_key_treats_legacy_and_canonical_source_paths_as_the_same_relation(self):
        legacy = {"from": "gateway", "to": "auth", "sourceFile": "wiki/entities/gateway.md", "lineNumber": 12, "evidenceHash": "evidence-1"}
        canonical = {"from": "gateway", "to": "auth", "sourceFile": "知识库/wiki/entities/gateway.md", "lineNumber": 12, "evidenceHash": "evidence-1"}
        self.assertEqual(extract_graph._edge_merge_key(legacy), extract_graph._edge_merge_key(canonical))

    def test_vault_relative_source_path_is_not_prefixed_twice(self):
        self.assertEqual(
            extract_graph._vault_rel_from_kb_relative("知识库/wiki/entities/gateway.md"),
            "知识库/wiki/entities/gateway.md",
        )

    def test_derived_relation_records_rule_revision_and_real_input_chain(self):
        edge = {
            "source": "gateway",
            "target": "auth",
            "type": "DEPENDS_ON",
            "properties": {
                "source": "dependency-rule",
                "reviewStatus": "approved",
            },
        }
        nodes = {
            "gateway": {
                "id": "gateway",
                "properties": {"file_path": "知识库/wiki/entities/gateway.md"},
            },
            "auth": {
                "id": "auth",
                "properties": {
                    "extraction_trace": [
                        {"stage": "origin", "detail": "AnyShare"},
                        {"stage": "rule", "rule_id": "R-product"},
                    ],
                },
            },
        }

        extract_graph.apply_derived_relation_lineage(edge, nodes)

        self.assertEqual(edge["properties"]["ruleId"], "extract_graph.dependency-rule")
        self.assertTrue(edge["properties"]["ruleRevision"].startswith("sha256:"))
        self.assertEqual(
            edge["properties"]["inputCoordinates"][0],
            "vault:知识库/wiki/entities/gateway.md#node:gateway",
        )
        self.assertNotIn("master_graph.json", " ".join(edge["properties"]["inputCoordinates"]))


if __name__ == "__main__":
    unittest.main()
