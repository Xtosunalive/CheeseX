#!/usr/bin/env python3
# Component: Backwrite-Frontmatter
# @responsible: 存量文章 frontmatter 反向回写 — 将图谱对齐结果物理写入 Obsidian .md 文件
# @inputs: master_graph.json, vault .md 文件
# @outputs: 修改后的 .md 文件 + .pre-align-bak 备份
# @context: B. 逻辑中枢上下文 (Pipeline Context)
"""REL-45: Frontmatter 反向灌注与回写（Metadata Back-Writing）

用法:
  python3 backwrite-frontmatter.py --vault ~/Obsidian\ Vault --dry-run
  python3 backwrite-frontmatter.py --vault ~/Obsidian\ Vault --apply
"""

from __future__ import annotations
# W2 迁仓闭包（SPEC-025 C1/C12）：kb_paths/schema_loader 解析自仓内 vault-runtime（A 类事实源）；同族脚本同目录。
# PR-132：自举先于导入（原 65aee107 版两病齐发：文件锚差一层的自举在前且指向不存在目录、正确自举死在导入后）
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
import shutil
import sys
from datetime import datetime, timezone

from ruamel.yaml import YAML

LOG_PREFIX = "[Backwrite]"
DEFAULT_VERSION = "7.0.6.5"
BACKWRITE_FIELDS = ["id", "version"]


def split_frontmatter(content: str) -> tuple[dict, str, str]:
    if not content.startswith("---"):
        return {}, content, ""
    end = content.find("\n---", 3)
    if end < 0:
        return {}, content, ""
    raw = content[3:end]
    body = content[end + 4:]
    yaml = YAML()
    try:
        fm = yaml.load(raw)
    except Exception:
        return {}, body, raw
    return (fm if isinstance(fm, dict) else {}), body, raw


def write_frontmatter(filepath: str, fm: dict, body: str) -> None:
    yaml = YAML()
    buf = __import__("io").StringIO()
    yaml.dump(fm, buf)
    fm_str = buf.getvalue().rstrip("\n")
    new_content = f"---\n{fm_str}\n---{body}"
    write_text_atomic(filepath, new_content)


def should_backwrite(node: dict) -> bool:
    sf = node.get("sourceFile", "") or node.get("source_file", "")
    if not sf or sf in ("manual_ui", "system", "auto"):
        return False
    return True


def resolve_md_path(vault_root: str, node: dict) -> str | None:
    sf = node.get("sourceFile", "") or node.get("source_file", "")
    if not sf:
        return None
    candidate = os.path.join(vault_root, sf)
    if os.path.isfile(candidate):
        return candidate
    for prefix in ["知识库/", "知识库/raw/precleaned/", "知识库/wiki/entities/", "知识库/wiki/concepts/"]:
        c2 = os.path.join(vault_root, prefix, os.path.basename(sf))
        if os.path.isfile(c2):
            return c2
    return None


def backwrite_node(vault_root: str, node: dict, dry_run: bool = False) -> dict | None:
    md_path = resolve_md_path(vault_root, node)
    if not md_path:
        return None

    with open(md_path, encoding="utf-8") as f:
        content = f.read()

    fm, body, _raw_fm = split_frontmatter(content)
    if not isinstance(fm, dict):
        return None

    changes = {}
    node_id = node.get("id", "")
    node_version = node.get("version", DEFAULT_VERSION)

    if fm.get("id") != node_id and node_id:
        changes["id"] = {"old": fm.get("id"), "new": node_id}
    if fm.get("version") != node_version:
        changes["version"] = {"old": fm.get("version"), "new": node_version}

    if not changes:
        return None

    if dry_run:
        return {"file": md_path, "changes": changes, "dry_run": True}

    bak = md_path + ".pre-align-bak"
    if not os.path.exists(bak):
        shutil.copy2(md_path, bak)

    for field in BACKWRITE_FIELDS:
        if field in changes:
            fm[field] = changes[field]["new"]
    fm["_auto_aligned_at"] = datetime.now(timezone.utc).isoformat()

    write_frontmatter(md_path, fm, body)
    return {"file": md_path, "changes": changes, "dry_run": False}


def main():
    p = argparse.ArgumentParser(description="REL-45: Frontmatter 反向灌注与回写")
    p.add_argument("--vault", required=True, help="Obsidian Vault 根目录")
    p.add_argument("--master", help="master_graph.json 路径（默认 $VAULT/.ledger/master_graph.json）")
    p.add_argument("--apply", action="store_true", help="实际写入（默认 dry-run）")
    p.add_argument("--dry-run", action="store_true", help="仅预览，不写入")
    args = p.parse_args()

    vault_root = os.path.expanduser(args.vault)
    # SPEC-012 wave-2 跟迁（2026-10-15，随 cheeseh 侧同步）：master_graph 真身迁 repo data/staging
    _dd = os.environ.get("KB_DATA_DIR")
    master_path = args.master or ((_dd and os.path.join(_dd, "staging", "master_graph.json")) or os.path.join(vault_root, ".ledger", "master_graph.json"))

    if not os.path.isfile(master_path):
        print(f"{LOG_PREFIX} ERROR: master_graph.json 不存在: {master_path}", file=sys.stderr)
        sys.exit(1)

    with open(master_path, encoding="utf-8") as f:
        graph = json.load(f)

    nodes = graph.get("nodes", [])
    candidates = [n for n in nodes if should_backwrite(n)]
    print(f"{LOG_PREFIX} 候选节点: {len(candidates)} / {len(nodes)}", file=sys.stderr)

    dry_run = args.dry_run or not args.apply
    if dry_run:
        print(f"{LOG_PREFIX} MODE: DRY-RUN (预览模式，不写入)", file=sys.stderr)

    results = []
    for node in candidates:
        result = backwrite_node(vault_root, node, dry_run=dry_run)
        if result:
            results.append(result)
            marker = "[DRY-RUN]" if result.get("dry_run") else "[WRITE]"
            changes_str = ", ".join(
                f"{k}: {v['old']} → {v['new']}" for k, v in result["changes"].items()
            )
            print(f"  {marker} {os.path.basename(result['file'])}: {changes_str}", file=sys.stderr)

    written = sum(1 for r in results if not r.get("dry_run"))
    if not dry_run and written > 0:
        print(f"{LOG_PREFIX} {written} 篇旧文章 frontmatter 已自动更新，备份存于 .pre-align-bak", file=sys.stderr)
    elif dry_run:
        print(f"{LOG_PREFIX} DRY-RUN 完成: {len(results)} 篇需要回写，运行 --apply 实际写入", file=sys.stderr)
    else:
        print(f"{LOG_PREFIX} 无需回写，所有 frontmatter 已是最新", file=sys.stderr)

    print(json.dumps({"backwrite_count": len(results), "written": written, "dry_run": dry_run}, ensure_ascii=False))


if __name__ == "__main__":
    main()
