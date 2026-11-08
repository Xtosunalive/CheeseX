#!/usr/bin/env python3
"""Minimal pipeline-runner stub for core-loop HTTP smoke tests.

Simulates a successful pipeline run when KB_VAULT points to a staging vault.
Creates all artifacts required by evaluateStaging so the batch can pass gating.
"""
import json, os, sqlite3, sys, time

# PR-165（DDL 单源双端执行）：document_index DDL/INSERT 与真抽取器执行同一份单源文件
# document_index.sql（真身住 scripts/vault-py/graph/，build-e2e-vault 构建时投递到本目录）。
# 手抄副本与生成物均已退役——改列只改单源文件，双端自动同步。
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _runtime_state_db


def _load_document_index_sql():
    """读取 sibling document_index.sql：非注释行＝schema 段；「-- insert-template:」行＝参数化模板。"""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "document_index.sql")
    schema_lines, template = [], None
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            if line.startswith("-- insert-template:"):
                template = line.split(":", 1)[1].strip()
            elif not line.lstrip().startswith("--"):
                schema_lines.append(line)
    if template is None or not "".join(schema_lines).strip():
        raise RuntimeError(f"document_index.sql 单源缺失或损坏（应由 build-e2e-vault 投递）: {path}")
    return "".join(schema_lines), template


def entity_nodes(vault):
    entities_dir = os.path.join(vault, "知识库", "wiki", "entities")
    if not os.path.isdir(entities_dir):
        return []
    nodes = []
    for name in sorted(os.listdir(entities_dir)):
        if not name.endswith(".md"):
            continue
        relative_path = os.path.join("知识库", "wiki", "entities", name).replace(os.sep, "/")
        raw = open(os.path.join(entities_dir, name), encoding="utf-8").read()
        node_id = ""
        frontmatter = {}
        for line in raw.splitlines():
            # 只认 frontmatter 标量键（module 列表键在 stub 内以逗号连接表达，与行内其余逻辑一致）
            for key in ("architecture-node-id", "module", "arch_layer", "arch_category", "arch_subdomain"):
                if line.startswith(key + ":") and key not in frontmatter:
                    frontmatter[key] = line.split(":", 1)[1].strip().strip("\"'[]")
            if line.startswith("architecture-node-id:"):
                node_id = line.split(":", 1)[1].strip().strip("\"'")
        if not node_id:
            continue
        heading = next((line[2:].strip() for line in raw.splitlines() if line.startswith("# ")), node_id)
        nodes.append({
            "id": node_id,
            "label": heading,
            "category": "ArchitectureComponent",
            "labels": ["ArchitectureComponent"],
            "properties": {
                "architecture_node_id": node_id,
                "file_path": relative_path,
                "module": frontmatter.get("module", ""),
                "arch_layer": frontmatter.get("arch_layer", ""),
                "arch_category": frontmatter.get("arch_category", ""),
                "arch_subdomain": frontmatter.get("arch_subdomain", ""),
            },
        })
    return nodes


def main():
    vault = os.environ.get("KB_VAULT", "")
    if not vault or not os.path.isdir(vault):
        print("KB_VAULT not set or invalid", file=sys.stderr)
        sys.exit(1)

    # SPEC-012 wave-2：图族落点迁 data/staging（与真 extract_graph 同款；Node boot/完成钩摄取入库）
    data_dir = os.environ.get("KB_DATA_DIR")
    if not data_dir:
        print("KB_DATA_DIR not set", file=sys.stderr)
        sys.exit(1)
    staging = os.path.join(data_dir, "staging")
    os.makedirs(staging, exist_ok=True)
    start = time.time()

    # -- article-admission-manifest
    admission_manifest = None
    args = sys.argv[1:]
    for i, arg in enumerate(args):
        if arg == "--article-admission-manifest" and i + 1 < len(args):
            admission_manifest = args[i + 1]

    # Build staged master_graph.json from existing + admission manifest
    master_path = os.path.join(staging, "master_graph.json")
    existing = {}
    if os.path.isfile(master_path):
        existing = json.loads(open(master_path).read())

    nodes = list(existing.get("nodes", []))
    connections = list(existing.get("connections", []))
    seen_ids = {n.get("id", "") for n in nodes}

    for node in entity_nodes(vault):
        if node["id"] not in seen_ids:
            nodes.append(node)
            seen_ids.add(node["id"])

    if admission_manifest and os.path.isfile(admission_manifest):
        print("Stage 1: reading admission manifest")
        manifest = json.loads(open(admission_manifest).read())
        articles = manifest.get("articles", manifest.get("manifestArticles", []))
        for article in articles:
            node_id = article.get("articleId", "")
            if node_id and node_id not in seen_ids:
                nodes.append({
                    "id": node_id,
                    "label": article.get("title", node_id),
                    "category": "Document",
                    "labels": ["Document"],
                    "properties": {
                        "article_id": node_id,
                        "articleId": node_id,
                        "source_path": article.get("sourcePath", article.get("snapshotPath", "")),
                    },
                })
                seen_ids.add(node_id)

    graph = {
        "version": "1.0.0",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
        "nodes": nodes,
        "connections": connections,
    }

    with open(master_path, "w") as f:
        json.dump(graph, f, ensure_ascii=False, indent=2)
        f.write("\n")

    # -- extract_manifest.json（staging 落点，SPEC-012 wave-2）
    extract_path = os.path.join(staging, "extract_manifest.json")
    if not os.path.isfile(extract_path):
        with open(extract_path, "w") as f:
            json.dump({
                "schemaVersion": 1,
                "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
                "entities": [],
            }, f, ensure_ascii=False, indent=2)
            f.write("\n")

    # -- master_graph.db (SQLite with document_index table；data 落点，SPEC-012 wave-2)
    db_path = os.path.join(data_dir, "master_graph.db")
    conn = sqlite3.connect(db_path)
    # 桩不设 WAL（真抽取器设，但桩库微小且用后即弃——WAL 边车文件在夹具清理时引发
    # rm 竞态 ENOTEMPTY，PR-156 批实测；列结构与 PRAGMA 无关）
    schema_sql, insert_template = _load_document_index_sql()
    conn.executescript(schema_sql)
    conn.execute("DELETE FROM document_index")
    for node in nodes:
        props = node.get("properties", {})
        file_path = props.get("source_path", props.get("file_path", ""))
        full_path = os.path.join(vault, file_path) if file_path else ""
        mtime = os.path.getmtime(full_path) if full_path and os.path.exists(full_path) else 0
        conn.execute(insert_template,
            (
                node["id"], file_path, mtime, props.get("module", ""),
                props.get("arch_layer", ""), props.get("arch_layer", ""),
                props.get("arch_category", ""), props.get("arch_category", ""),
                props.get("arch_subdomain", ""), props.get("arch_subdomain", ""),
            ),
        )
    conn.commit()
    conn.close()


    # -- runtime-state.db（SPEC-012 WP-A：run 摘要与版本指纹入 runtime-state 库，服务端读库）
    # PR-165：改走 _runtime_state_db 唯一网关（DDL 自举＋流水落账内建），桩零手写 DDL——
    # 与真 runner 同一写路径，双端 schema 漂移在构造上不可能。
    duration = int((time.time() - start) * 1000)
    run_ts = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
    _runtime_state_db.insert_run_summary({
        "run_ts": run_ts,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "status": "success",
        "nodes": len(nodes),
        "connections": len(connections),
        "components": 1,
        "plates": 0,
        "failed_stage": None,
        "error": None,
        "duration_ms": duration,
    })
    _runtime_state_db.upsert_pipeline_version({
        "pipeline_run_id": run_ts,
        "master_graph_sha256": __import__("hashlib").sha256(open(master_path, "rb").read()).hexdigest(),
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })

    print(f"Stage 2: graph generated nodes={len(nodes)} connections={len(connections)}")
    print("Pipeline complete")
    sys.exit(0)


if __name__ == "__main__":
    main()
