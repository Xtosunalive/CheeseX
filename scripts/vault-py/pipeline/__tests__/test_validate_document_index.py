import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
import importlib.util

SCRIPT = Path(__file__).resolve().parents[1] / "validate-document-index.py"


class DocumentIndexValidatorTest(unittest.TestCase):
    def test_detects_missing_orphan_mismatch_and_unsafe(self):
        # SPEC-012 wave-2：图族读 repo 侧 data（staging/master_graph.json＋master_graph.db），
        # 不再读 vault .ledger——fixture 按 KB_DATA_DIR 布局，vault_root 只服务路径安全判定
        spec = importlib.util.spec_from_file_location("validate_document_index", SCRIPT)
        validator = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(validator)
        with tempfile.TemporaryDirectory() as temp, tempfile.TemporaryDirectory() as data_temp:
            root = Path(temp)
            data_dir = Path(data_temp)
            source = root / "知识库" / "doc.md"; source.parent.mkdir(); source.write_text("x", encoding="utf-8")
            graph = {"nodes": [
                {"id": "ok", "properties": {"file_path": "知识库/doc.md", "module": "M"}},
                {"id": "missing", "properties": {"file_path": "知识库/doc.md", "module": "M"}},
            ]}
            staging = data_dir / "staging"; staging.mkdir()
            (staging / "master_graph.json").write_text(json.dumps(graph), encoding="utf-8")
            db = sqlite3.connect(data_dir / "master_graph.db")
            # 3 列表是该校验器读面的最小输入形状（validate-document-index.py 只 SELECT
            # node_id/file_path/module 三列），非 11 列 DDL 的手抄副本——PR-165 勘误注记
            db.execute("CREATE TABLE document_index(node_id TEXT PRIMARY KEY,file_path TEXT,module TEXT)")
            db.execute("INSERT INTO document_index VALUES(?,?,?)", ("ok", "知识库/doc.md", "Wrong"))
            db.execute("INSERT INTO document_index VALUES(?,?,?)", ("orphan", "../outside.md", ""))
            db.commit(); db.close()
            saved = os.environ.get("KB_DATA_DIR")
            os.environ["KB_DATA_DIR"] = str(data_dir)
            try:
                report = validator.validate(str(root))
            finally:
                if saved is None:
                    os.environ.pop("KB_DATA_DIR", None)
                else:
                    os.environ["KB_DATA_DIR"] = saved
            self.assertFalse(report["ok"])
            self.assertEqual(report["missing_rows"], ["missing"])
            self.assertEqual(report["orphan_rows"], ["orphan"])
            self.assertEqual(report["field_mismatches"][0]["field"], "module")
            self.assertEqual(report["unsafe_paths"][0]["node_id"], "orphan")


if __name__ == "__main__":
    unittest.main()
