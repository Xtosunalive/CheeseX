import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import yaml

SCRIPT_DIR = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "graph"))  # W3 迁仓：extract_graph 住 graph/
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)
# extract_graph 模块级 _staging_dir 需要 KB_DATA_DIR（缺省 fail-closed）——
# 借用后立即归还：discover 先收集后执行，模块级 setdefault 会泄漏给先跑的其他用例
# （准入清单允许根曾因此被翻转——实证 2026-10-20）
_saved_data_dir = os.environ.get("KB_DATA_DIR")
if not _saved_data_dir:
    os.environ["KB_DATA_DIR"] = tempfile.mkdtemp(prefix="assoc-override-test-")

import extract_graph

if _saved_data_dir is None:
    os.environ.pop("KB_DATA_DIR", None)


class ArticleAssociationOverridesTest(unittest.TestCase):
    def test_replace_overrides_automatic_edges_and_keeps_coordinates(self):
        with tempfile.TemporaryDirectory() as directory:
            vault_root = Path(directory)
            schema = vault_root / "知识库" / "TheSchema"
            schema.mkdir(parents=True)
            association = {
                "schema_version": 1,
                "decisions": [{
                    "decisionId": "decision-1", "articleId": "ART-1", "action": "replace",
                    "componentIds": ["audit"], "versionIds": ["version-anyshare-7-1"],
                    "candidateSourcePath": "知识库/raw/precleaned/a.md", "candidateSourceHash": "sha256:one",
                    "admissionBatchId": "batch-1", "decidedAt": "2026-07-18T00:00:00Z",
                }],
            }
            (schema / "article_associations.yaml").write_text(yaml.safe_dump(association), encoding="utf-8")
            # WP-054 E-B：article_associations 经信封取件——为本 fixture 物化信封
            #（fixture 的 TheSchema 需 enums.yaml 探针使阶梯成立；helper 自带中和 THESCHEMA_DIR）
            _rt = str(Path(__file__).resolve().parents[3] / "vault-runtime" / "__tests__")
            if _rt not in sys.path:
                sys.path.insert(0, _rt)
            from _vocab_fixture import install_vocab_envelope

            install_vocab_envelope(str(vault_root), {"article_associations": association})
            nodes = [{"id": "doc-1", "labels": ["Document"], "properties": {"article_id": "ART-1", "source_hash": "sha256:one"}}]
            edges = [
                {"source": "doc-1", "target": "gateway", "type": "DOCUMENTS", "properties": {"source": "automatic"}},
                {"source": "doc-1", "target": "version-anyshare-7-0", "type": "APPLIES_TO", "properties": {"source": "automatic"}},
            ]
            with patch.object(extract_graph, "VAULT", str(vault_root / "知识库")):
                result = extract_graph.apply_article_association_overrides(nodes, edges)
            pairs = {(edge["target"], edge["type"]) for edge in result}
            self.assertNotIn(("gateway", "DOCUMENTS"), pairs)
            self.assertIn(("audit", "DOCUMENTS"), pairs)
            manual = next(edge for edge in result if edge["target"] == "audit")
            self.assertEqual(manual["properties"]["decisionId"], "decision-1")

    def test_hash_change_marks_decision_stale_without_overriding(self):
        with tempfile.TemporaryDirectory() as directory:
            vault_root = Path(directory)
            schema = vault_root / "知识库" / "TheSchema"
            schema.mkdir(parents=True)
            (schema / "article_associations.yaml").write_text(yaml.safe_dump({"decisions": [{"articleId": "ART-1", "action": "remove", "componentIds": ["gateway"], "versionIds": [], "candidateSourceHash": "sha256:old"}]}), encoding="utf-8")
            nodes = [{"id": "doc-1", "labels": ["Document"], "properties": {"article_id": "ART-1", "source_hash": "sha256:new"}}]
            edges = [{"source": "doc-1", "target": "gateway", "type": "DOCUMENTS", "properties": {}}]
            with patch.object(extract_graph, "VAULT", str(vault_root / "知识库")):
                result = extract_graph.apply_article_association_overrides(nodes, edges)
            self.assertEqual(result, edges)
            self.assertTrue(nodes[0]["properties"]["association_override_stale"])


if __name__ == "__main__":
    unittest.main()
