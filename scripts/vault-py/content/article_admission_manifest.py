"""Validate the immutable standard-article batch selected by the Web admission flow."""

from __future__ import annotations

import hashlib
import json
import os


SCHEMA_VERSION = "2.0"


def load_admitted_precleaned_paths(manifest_path: str | None, vault_root: str, knowledge_root: str) -> set[str] | None:
    """Return approved candidate coordinates, or None for the ordinary full-vault pipeline."""
    if not manifest_path:
        return None

    resolved_vault_root = os.path.realpath(os.path.abspath(vault_root))
    resolved_knowledge_root = os.path.realpath(os.path.abspath(knowledge_root))
    # SPEC-012 wave-2/F3：准入清单暂存迁 repo 侧 data/admission-batches（与服务端验证根同迁）
    _data = os.environ.get("KB_DATA_DIR")
    allowed_root = os.path.realpath(os.path.join(_data, "admission-batches")) if _data else os.path.realpath(os.path.join(resolved_vault_root, ".ledger", "article-admission-batches"))
    absolute_manifest = os.path.realpath(os.path.abspath(manifest_path))
    if not _is_within(absolute_manifest, allowed_root) or not absolute_manifest.endswith(".json"):
        raise ValueError("文章准入清单不在允许目录")

    try:
        with open(absolute_manifest, encoding="utf-8") as handle:
            manifest = json.load(handle)
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"文章准入清单无法读取: {error}") from error

    articles = manifest.get("articles") if isinstance(manifest, dict) else None
    purpose = manifest.get("purpose") if isinstance(manifest, dict) else None
    repair_batch = purpose == "derived_graph_repair"
    if purpose not in {"article_graph_publication", "derived_graph_repair"} or manifest.get("schemaVersion") != SCHEMA_VERSION or not isinstance(articles, list) or (not articles and not repair_batch):
        raise ValueError("文章准入清单结构非法")

    approved_root = os.path.realpath(os.path.join(resolved_knowledge_root, "wiki", "articles"))
    admitted_paths: set[str] = set()
    for item in articles:
        if not isinstance(item, dict):
            raise ValueError("文章准入清单包含非法条目")
        article_id = item.get("articleId")
        source_path = item.get("sourcePath")
        content_hash = item.get("contentHash")
        approval_decision_id = item.get("approvalDecisionId")
        if not isinstance(article_id, str) or not article_id.strip() or not isinstance(source_path, str) or not isinstance(content_hash, str) or not isinstance(approval_decision_id, str) or not approval_decision_id.strip():
            raise ValueError("文章准入清单缺少文章坐标、内容哈希或批准决定")
        normalized_path = source_path.replace("\\", "/")
        if os.path.isabs(normalized_path) or not normalized_path.startswith("知识库/wiki/articles/"):
            raise ValueError("文章准入清单包含非批准文章快照路径")
        absolute_source = os.path.realpath(os.path.abspath(os.path.join(resolved_vault_root, normalized_path)))
        if not _is_within(absolute_source, approved_root) or not os.path.isfile(absolute_source):
            raise ValueError("文章准入清单引用的批准文章快照不存在")
        with open(absolute_source, "rb") as handle:
            actual_hash = hashlib.sha256(handle.read()).hexdigest()
        expected_hash = content_hash.removeprefix("sha256:").lower()
        if actual_hash != expected_hash:
            raise ValueError("批准文章快照内容已变化，请重新批准后执行")
        relative_path = os.path.relpath(absolute_source, resolved_vault_root).replace(os.sep, "/")
        if relative_path in admitted_paths:
            raise ValueError("文章准入清单包含重复候选路径")
        admitted_paths.add(relative_path)
    return admitted_paths


def _is_within(candidate: str, directory: str) -> bool:
    try:
        return os.path.commonpath([candidate, directory]) == directory and candidate != directory
    except ValueError:
        return False
