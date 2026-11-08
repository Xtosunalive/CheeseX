#!/usr/bin/env python3
"""Validate master_graph file-backed nodes against SQLite document_index."""

import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path


def expected_documents(master):
    result = {}
    for node in master.get("nodes", []):
        if not isinstance(node, dict) or not node.get("id"):
            continue
        properties = node.get("properties")
        if not isinstance(properties, dict):
            continue
        file_path = properties.get("file_path")
        if isinstance(file_path, str) and file_path.strip():
            result[str(node["id"])] = file_path.strip()
    return result


def check(master_path, db_path):
    if not os.path.isfile(master_path):
        return {"consistent": False, "error": f"master_graph.json 不存在: {master_path}"}
    if not os.path.isfile(db_path):
        return {"consistent": False, "error": f"master_graph.db 不存在: {db_path}"}

    try:
        with open(master_path, encoding="utf-8") as handle:
            master = json.load(handle)
    except (OSError, json.JSONDecodeError) as error:
        return {"consistent": False, "error": f"主图读取失败: {error}"}

    expected = expected_documents(master)
    try:
        # The generated DB is an immutable input during this read-only gate;
        # immutable mode avoids SQLite creating locks beside a protected Vault.
        database_uri = f"{Path(db_path).resolve().as_uri()}?mode=ro&immutable=1"
        with sqlite3.connect(database_uri, uri=True) as connection:
            rows = connection.execute(
                "SELECT node_id, file_path FROM document_index"
            ).fetchall()
    except sqlite3.Error as error:
        return {"consistent": False, "error": f"document_index 不可用: {error}"}

    actual = {str(node_id): str(file_path) for node_id, file_path in rows}
    missing = sorted(set(expected) - set(actual))
    extra = sorted(set(actual) - set(expected))
    mismatched = sorted(
        node_id for node_id in set(expected) & set(actual)
        if expected[node_id] != actual[node_id]
    )
    return {
        "consistent": not missing and not extra and not mismatched,
        "document_index": {
            "expected": len(expected),
            "actual": len(actual),
            "missing": missing,
            "extra": extra,
            "path_mismatches": mismatched,
        },
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--master", required=True)
    parser.add_argument("--db", required=True)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    report = check(args.master, args.db)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["consistent"] else 1


if __name__ == "__main__":
    sys.exit(main())
