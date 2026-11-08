-- document_index 单源 DDL（openbkn migrations 单源模式——一份定义、双端各自执行；PR-165）
-- 消费者①（真身）：scripts/vault-py/graph/extract_graph.py::_populate_document_index
-- 消费者②（e2e 桩）：test/fixtures/minimal-vault/知识库/.claude/scripts/pipeline-runner.py
--   （经 build-e2e-vault 投递本文件到构建目标 知识库/.claude/scripts/ 目录）
-- 纪律：改列只改本文件。非注释行＝schema 段（execute(s)script 执行）；
-- 「-- insert-template:」行＝参数化 INSERT 模板（绑参执行，不随 schema 段执行）。
CREATE TABLE IF NOT EXISTS document_index (
    node_id TEXT PRIMARY KEY,
    file_path TEXT NOT NULL,
    file_mtime REAL NOT NULL DEFAULT 0,
    module TEXT NOT NULL DEFAULT '',
    arch_layer TEXT NOT NULL DEFAULT '',
    arch_layer_canonical TEXT NOT NULL DEFAULT '',
    arch_category TEXT NOT NULL DEFAULT '',
    arch_category_canonical TEXT NOT NULL DEFAULT '',
    arch_subdomain TEXT NOT NULL DEFAULT '',
    arch_subdomain_canonical TEXT NOT NULL DEFAULT '',
    extracted_at TEXT NOT NULL
);
-- insert-template: INSERT OR REPLACE INTO document_index (node_id, file_path, file_mtime, module, arch_layer, arch_layer_canonical, arch_category, arch_category_canonical, arch_subdomain, arch_subdomain_canonical, extracted_at) VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))
