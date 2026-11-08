import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path
import sys


SCRIPT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPT_DIR))

from article_admission_manifest import load_admitted_precleaned_paths


class ArticleAdmissionManifestTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="article-admission-")
        # 允许根随 KB_DATA_DIR 翻转（SPEC-012 wave-2/F3）——本组夹具用 vault 侧回退根，
        # 显式摘掉外部泄漏的 env（discover 收集期其他模块的模块级 setdefault 会先跑）
        self._saved_data_dir = os.environ.pop("KB_DATA_DIR", None)
        self.vault = Path(self.temp_dir.name)
        self.knowledge = self.vault / "知识库"
        self.article = self.knowledge / "wiki" / "articles" / "candidate-1" / "snapshot.md"
        self.article.parent.mkdir(parents=True)
        self.article.write_text("---\narticle_id: candidate-1\n---\n正文\n", encoding="utf-8")
        self.manifests = self.vault / ".ledger" / "article-admission-batches"
        self.manifests.mkdir(parents=True)

    def tearDown(self):
        if self._saved_data_dir is not None:
            os.environ["KB_DATA_DIR"] = self._saved_data_dir
        self.temp_dir.cleanup()

    def write_manifest(self, content_hash=None, source_path="知识库/wiki/articles/candidate-1/snapshot.md", purpose="article_graph_publication", articles=None):
        manifest = {
            "schemaVersion": "2.0",
            "batchId": "batch-1",
            "purpose": purpose,
            "createdAt": "2026-07-16T00:00:00Z",
            "articles": articles if articles is not None else [{
                "articleId": "candidate-1",
                "sourcePath": source_path,
                "contentHash": content_hash or hashlib.sha256(self.article.read_bytes()).hexdigest(),
                "approvalDecisionId": "decision-1",
            }],
        }
        path = self.manifests / "batch-1.json"
        path.write_text(json.dumps(manifest), encoding="utf-8")
        return path

    def test_accepts_only_hash_matched_approved_snapshot_coordinates(self):
        manifest = self.write_manifest()
        result = load_admitted_precleaned_paths(str(manifest), str(self.vault), str(self.knowledge))
        self.assertEqual(result, {"知识库/wiki/articles/candidate-1/snapshot.md"})

    def test_rejects_changed_or_outside_candidates(self):
        manifest = self.write_manifest(content_hash="0" * 64)
        with self.assertRaisesRegex(ValueError, "内容已变化"):
            load_admitted_precleaned_paths(str(manifest), str(self.vault), str(self.knowledge))

        manifest = self.write_manifest(source_path="知识库/raw/precleaned/candidate.md")
        with self.assertRaisesRegex(ValueError, "非批准文章快照路径"):
            load_admitted_precleaned_paths(str(manifest), str(self.vault), str(self.knowledge))

    def test_allows_empty_derived_graph_repair_manifest(self):
        manifest = self.write_manifest(purpose="derived_graph_repair", articles=[])
        result = load_admitted_precleaned_paths(str(manifest), str(self.vault), str(self.knowledge))
        self.assertEqual(result, set())

    def test_rejects_unknown_purpose_or_missing_approval_decision(self):
        manifest = self.write_manifest(purpose="unknown")
        with self.assertRaisesRegex(ValueError, "结构非法"):
            load_admitted_precleaned_paths(str(manifest), str(self.vault), str(self.knowledge))

        manifest = self.write_manifest(articles=[{
            "articleId": "candidate-1",
            "sourcePath": "知识库/wiki/articles/candidate-1/snapshot.md",
            "contentHash": hashlib.sha256(self.article.read_bytes()).hexdigest(),
        }])
        with self.assertRaisesRegex(ValueError, "批准决定"):
            load_admitted_precleaned_paths(str(manifest), str(self.vault), str(self.knowledge))


if __name__ == "__main__":
    unittest.main()
