#!/usr/bin/env python3
# Component: Document-Index-Validator
# @responsible: 只读校验 master_graph.json 与 SQLite document_index 的行集合、字段和路径边界。
# @inputs: $KB_DATA_DIR/staging/master_graph.json + master_graph.db（SPEC-012 wave-2 迁库）
# @outputs: missing_rows/orphan_rows/field_mismatches/unsafe_paths JSON 与退出码
# @context: Pipeline

# W2 迁仓闭包（SPEC-025 C1/C12）：kb_paths/schema_loader 解析自仓内 vault-runtime（A 类事实源）；同族脚本同目录。
# PR-132：write_gateway 同住 vault-runtime——自举必须先于导入（65aee107 曾把导入插在自举前＝必炸）
import sys as _sys
from pathlib import Path as _Path
_HERE = _Path(__file__).resolve().parent
for _dep in (_HERE, _HERE.parents[1] / "vault-runtime"):
    _s = str(_dep)
    if _s not in _sys.path:
        _sys.path.insert(0, _s)
from write_gateway import write_text_atomic, append_line, write_bytes_atomic
import argparse
import json
import os
import sqlite3
import sys


def validate(vault_root):
    # SPEC-012 wave-2：图族迁 repo 侧 data（staging 文件＋document_index 库）——vault 不再承载
    _data = os.environ.get("KB_DATA_DIR")
    if not _data:
        raise RuntimeError("KB_DATA_DIR 未设置（SPEC-012：图族已迁 data/；管线注入或手工 export）")
    graph_path = os.path.join(_data, "staging", "master_graph.json")
    db_path = os.path.join(_data, "master_graph.db")
    with open(graph_path, encoding="utf-8") as handle:
        graph = json.load(handle)
    expected = {}
    for node in graph.get("nodes", []):
        props = node.get("properties") or {}
        node_id = node.get("id") or ""
        file_path = props.get("file_path") or ""
        if node_id and file_path:
            expected[node_id] = {"file_path": file_path, "module": props.get("module", "")}

    with sqlite3.connect(f"file:{db_path}?mode=ro", uri=True) as connection:  # 波5 批①：校验器只读开库
        rows = connection.execute("SELECT node_id, file_path, module FROM document_index").fetchall()
    actual = {row[0]: {"file_path": row[1], "module": row[2]} for row in rows}
    missing = sorted(set(expected) - set(actual))
    orphan = sorted(set(actual) - set(expected))
    mismatches = []
    unsafe = []
    root_real = os.path.realpath(vault_root)
    for node_id in sorted(set(expected) & set(actual)):
        for field in ("file_path", "module"):
            if expected[node_id][field] != actual[node_id][field]:
                mismatches.append({"node_id": node_id, "field": field, "expected": expected[node_id][field], "actual": actual[node_id][field]})
    for node_id, row in actual.items():
        target = os.path.realpath(os.path.join(vault_root, row["file_path"]))
        if not target.startswith(root_real + os.sep) or not os.path.isfile(target):
            unsafe.append({"node_id": node_id, "file_path": row["file_path"]})
    report = {"ok": not (missing or orphan or mismatches or unsafe), "missing_rows": missing, "orphan_rows": orphan, "field_mismatches": mismatches, "unsafe_paths": unsafe, "expected_rows": len(expected), "actual_rows": len(actual)}
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--vault", default=os.environ.get("KB_VAULT") or os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))
    args = parser.parse_args()
    try:
        report = validate(os.path.abspath(args.vault))
    except Exception as error:
        report = {"ok": False, "error": str(error), "missing_rows": [], "orphan_rows": [], "field_mismatches": [], "unsafe_paths": []}
    print(json.dumps(report, ensure_ascii=False))
    return 0 if report.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
