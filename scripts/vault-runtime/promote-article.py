#!/usr/bin/env python3
# Component: Article-Promoter
# @responsible: 人工确认后将 drafts/ 中文章提升到 precleaned/，完成定居和归档
# @inputs: drafts/*.md（需含 validation_status）
# @outputs: precleaned/*.md + 原始文件归档
# @context: A. 知识源上下文 (Vault Context)
"""
promote-article.py — 人工确认后从 drafts/ 提升到 precleaned/

人在 Obsidian 中 review drafts/ 中的文章（含 validation_* 校验标记），
确认无误后运行此脚本完成定居和归档。

用法:
  python3 promote-article.py <drafts/xxx.md>              # 提升单篇
  python3 promote-article.py <drafts/xxx.md> <yyy.md>     # 提升多篇
  python3 promote-article.py --all                        # 提升 drafts/ 中所有 validated 文章
  python3 promote-article.py --dry-run <drafts/xxx.md>    # 预览，不执行

行为:
  1. 检查 validation_status 存在（passed / warnings / failed / overridden）
  2. 检查 source_file 存在（原始文件路径）
  3. 复制文章到 raw/precleaned/
  4. 归档原始文件到 raw/archive/{产品线}/
  5. 删除 drafts/ 中的草稿
  6. 输出操作摘要
"""

from write_gateway import write_text_atomic, append_line, write_bytes_atomic
import json
import hashlib
import os
from _vault_ledger import ledger
import re
import shutil
import subprocess
import sys
from datetime import date

import yaml

from kb_paths import vault_roots


_, VAULT = vault_roots()
# .ledger 位于 vault 根（知识库的上级）
DRAFTS_DIR = os.path.join(VAULT, "raw", "drafts")
PRECLEANED_DIR = os.path.join(VAULT, "raw", "precleaned")
ARCHIVE_DIR = os.path.join(VAULT, "raw", "archive")
ENTITIES_DIR = os.path.join(VAULT, "wiki", "entities")  # WP-049 L3：词表经 schema_loader→信封取数
# SPEC-022 波 B：校验器切统一客户端（Node 唯一语义；vault 侧 A 类 symlink schema-write-client.mjs）
VAULT_ROOT_FROM_KB, _ = vault_roots()
VALIDATE_SCRIPT = os.path.join(VAULT, ".claude", "scripts", "schema-write-client.mjs")

# PR-065/WP2：content-addressed 归档件判定——archive/<lane>/<64位哈希>-原名.md（Node 层溯源锚命名）。
# 与知识库/ 前缀形态兼容（source_file 存的 vault 相对路径）。
_CONTENT_ADDRESSD_RE = re.compile(r"(?:^|/)raw/archive/(?:投稿|本地草稿)/[0-9a-f]{64}-")


def _is_content_addressed_archive(path_or_rel):
    """路径是否已是 Node 层唯一原文归档件（是则本脚本跳过二次归档）。"""
    normalized = str(path_or_rel).replace("\\", "/")
    return bool(_CONTENT_ADDRESSD_RE.search(normalized))


def load_enums_modules():
    """返回词表 enums 的 modules 段 dict，键为模块中文名（WP-049 L3：经信封取数）。"""
    import schema_loader
    return (schema_loader.load_the_schema("enums")[0] or {}).get("modules", {})


def build_wikilink_index():
    """返回 vault 中所有 .md 文件名（去扩展名）的集合。"""
    index = set()
    for base, _, files in os.walk(VAULT):
        for f in files:
            if f.endswith(".md"):
                index.add(f.replace(".md", ""))
    return index


def ensure_module_entities(fm, article_path, article_title):
    """检查 article module 字段的 wikilink 目标是否存在，缺失则自动创建 entity stub。

    仅对词表中已注册的 module 创建。返回 (created, skipped, entity_names)。
    创建的 entity 至少含两个关系：→ 标准文章（title 或文件名）、→ 源文件（source_file 字段提取）。"""
    raw_module = fm.get("module", "")
    if not raw_module:
        return 0, 0, []

    names = []
    if isinstance(raw_module, list):
        for m in raw_module:
            m = str(m).strip()
            match = re.match(r'^\[\[([^\]]+)\]\]$', m)
            names.append(match.group(1) if match else m)
    else:
        m = str(raw_module).strip()
        match = re.match(r'^\[\[([^\]]+)\]\]$', m)
        names.append(match.group(1) if match else m)

    enums_modules = load_enums_modules()
    wiki_index = build_wikilink_index()
    created = 0
    skipped = 0
    entity_names = []

    # Resolve source_file to wikilink target
    source_file = str(fm.get("source_file", "")).strip()
    source_target = ""
    if source_file:
        src_match = re.match(r'\[\[([^\]]+)\]\]', source_file)
        if src_match:
            source_target = src_match.group(1)
        else:
            # Source is a path — extract the file name without extension as wikilink target
            source_target = os.path.splitext(os.path.basename(source_file))[0]

    for name in names:
        if not name:
            continue
        mod_info = enums_modules.get(name)
        if not mod_info:
            skipped += 1
            continue

        # WP-113 M4：这个词表 system 值只当「模块挂在哪个系统下」的标签用（category-path 与
        # 正文描述），不再顶替身份号写进 architecture-node-id——组件身份的唯一来源是铸造口
        # （Node 侧 entity-identity-mint.cjs，由实体修复流在创建/补号时取号）。Python 侧不自写
        # UUID v4 编码器（那正是本批要避开的第二套自造形状），故此字段留空交补号流。
        system_ref = mod_info.get("system", name)
        prod_list = mod_info.get("products", [])
        product_str = ", ".join(prod_list) if prod_list else "通用"
        today = date.today().isoformat()
        entity_names.append(name)

        if name in wiki_index:
            continue

        # Build relation targets: 1) article  2) source_file — always both, even if names collide
        relation_targets = []
        # 1. relation to standard article
        article_target = article_title or os.path.splitext(os.path.basename(article_path))[0]
        relation_targets.append(article_target)
        # 2. relation to source file
        if source_target:
            relation_targets.append(source_target)

        relations_block = "\n".join(f"- 关联::[[{t}]]" for t in relation_targets)

        stub = f"""---
title: {name}
date: {today}
tags:
- {name}
status: 有效
category-path: ref:module:{system_ref}
review-cycle: 365d
updated: {today}
architecture-node-id:
module: {name}
arch_component: false
arch_category: 模块
---

# {name}

## 概述

{name}相关知识汇总模块。关联系统 `{system_ref}`，适用产品：{product_str}。

## 关联实体

{relations_block}
"""
        os.makedirs(ENTITIES_DIR, exist_ok=True)
        entity_path = os.path.join(ENTITIES_DIR, f"{name}.md")
        write_text_atomic(entity_path, stub)
        created += 1
        print(f"  📄 自动创建 entity: wiki/entities/{name}.md（系统标签 {system_ref}，身份号待修复流补）")

    # Add back-references from article to module entities (if article exists)
    # 写前自读（WP-155 定性，human_edit_guard 同族先例）：读现盘原文做防重复连线裁决后写回——
    # 写主权面自读，非文档装载消费链，不经信封（落笔瞬间的现盘真相优先于快照）。
    if entity_names and article_path and os.path.exists(article_path):
        with open(article_path, "r", encoding="utf-8") as f:
            article_content = f.read()

        existing_links = set(re.findall(r'\[\[([^\]]+)\]\]', article_content))
        new_links = [f"- 关联::[[{n}]]" for n in entity_names if n not in existing_links]

        if new_links:
            if "## 关联实体" not in article_content:
                article_content = article_content.rstrip() + "\n\n## 关联实体\n" + "\n".join(new_links) + "\n"
            else:
                article_content = article_content.rstrip() + "\n" + "\n".join(new_links) + "\n"
            write_text_atomic(article_path, article_content)

    return created, skipped, entity_names


def parse_frontmatter(filepath):
    # 写前自读（WP-155 定性，human_edit_guard 同族先例）：晋升前对目标页现盘原文取
    # validation_status 等裁决素材——写主权面自读，非文档装载消费链，不经信封。
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    fm = {}
    if content.startswith("---"):
        parts = content.split("---", 2)
        if len(parts) >= 3:
            try:
                fm = yaml.safe_load(parts[1]) or {}
            except yaml.YAMLError:
                pass
    return fm


def run_article_validation(filepath, stamp=False):
    cmd = ["node", VALIDATE_SCRIPT, "validate-article", "--file", filepath, "--vault", VAULT_ROOT_FROM_KB]
    if stamp:
        cmd.append("--stamp")
    result = subprocess.run(cmd, capture_output=True, text=True)
    try:
        payload = json.loads(result.stdout or "{}")
    except json.JSONDecodeError:
        payload = {}
    # M3 修复（红队）：exit 2＝校验器自身不可用（解析物缺失/损坏）——fatal 标志上抛，
    # promote 必须拒绝提升（旧章草稿不得零校验放行——fail-closed）。
    fatal = result.returncode == 2
    return result.returncode == 0, payload, (result.stderr or result.stdout).strip(), fatal


def generate_article_id(title):
    """从标题生成 article_id slug（小写 ASCII，空格/特殊字符转连字符）。"""
    slug = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "-", title.lower()).strip("-")
    return slug or "untitled"


def ensure_article_id(filepath, fm):
    """如果 frontmatter 缺少 article_id，自动生成并写入文件。返回 (updated, article_id)。"""
    existing = fm.get("article_id")
    if existing and str(existing).strip():
        return False, str(existing).strip()
    title = str(fm.get("title", os.path.splitext(os.path.basename(filepath))[0]))
    article_id = generate_article_id(title)
    # 写入 frontmatter
    # 写前自读（WP-155 定性，human_edit_guard 同族先例）：写前现盘原文插入 article_id 后原子写回——
    # 写主权面自读，非文档装载消费链，不经信封。
    with open(filepath, "r", encoding="utf-8") as f:
        raw = f.read()
    if raw.startswith("---"):
        parts = raw.split("---", 2)
        if len(parts) >= 3:
            fm_text = parts[1]
            # 在 title 行后插入 article_id
            if "article_id:" not in fm_text:
                fm_text = fm_text.replace("title:", f"article_id: {article_id}\ntitle:", 1)
                if "article_id:" not in fm_text:
                    fm_text = "\narticle_id: " + article_id + fm_text
            new_raw = f"---{fm_text}---{parts[2]}"
            write_text_atomic(filepath, new_raw)
            return True, article_id
    return False, article_id


def is_structural_blocker(error_text):
    """判定 validate 错误是否为结构阻断（promote 仍拒绝）vs 可上报字段问题。
    结构阻断仅限：文件不存在 / frontmatter 无法解析 / source_file 缺失（无法定位归档）。
    字段缺失（article_id/product/article_type/module/version 等）一律不阻断晋升，
    随候选打标上报前端「待处理问题」补齐——对齐 docs/方案-promote不阻塞全上报待处理问题.md :9 约定
    （2026-09-05 架构师裁决：脚本曾越权把「缺必填字段」当结构阻断，撤销）。"""
    if not isinstance(error_text, str):
        return True
    blockers = [
        "文件不存在",
        "无法解析 frontmatter",
        "缺少 source_file",
        "原始来源文件不存在",
    ]
    return any(b in error_text for b in blockers)


def _archive_product_bucket(source_path, product, source_bytes, source_hash):
    """产品分桶归档（legacy 回退分支——source_file 未走 Node 归档锚的存量/手工草稿可达）。
    返回 (ok, message, archive_dest)。SPEC-028：source-archive=read-only-evidence——
    归档件写一次即只读 0o444（Python 侧点修，统一经 vault-io 为后续波次）；
    写后哈希校验保留（SPEC-028 C9 第二层纵深）。"""
    archive_product_dir = os.path.join(ARCHIVE_DIR, product)
    os.makedirs(archive_product_dir, exist_ok=True)
    archive_dest = os.path.join(archive_product_dir, f"{source_hash}-{os.path.basename(source_path)}")
    if not os.path.exists(archive_dest):
        # 波5 批①：归档封存（fsync＋0444）收口 write_gateway
        write_bytes_atomic(archive_dest, source_bytes, fsync=True, seal_readonly=True)
    with open(archive_dest, "rb") as archive_file:
        if hashlib.sha256(archive_file.read()).hexdigest() != source_hash:
            return False, "原始来源归档校验失败，已保留草稿并拒绝提升", archive_dest
    return True, None, archive_dest


def promote_one(filepath, dry_run=False):
    """提升单篇文章。返回 (ok, message)。"""
    fname = os.path.basename(filepath)

    if not os.path.exists(filepath):
        return False, f"文件不存在: {filepath}"

    valid, validation, raw_validation_output, validator_fatal = run_article_validation(filepath, stamp=not dry_run)
    if validator_fatal:
        return False, f"{fname}: 校验器不可用（{raw_validation_output[:120]}）——已拒绝提升（fail-closed，SPEC-022 红队 M3）"
    # 方案（docs/方案-promote不阻塞全上报待处理问题.md）：字段问题不阻断提升——
    # validate 的 errors 中只有"结构阻断"项（文件/解析/source_file）才拒绝；
    # 其余（version/module 缺失、枚举不符、格式非法）打标为上报项，随文章进 precleaned。
    # 成熟项目参照：CI continue-on-error 语义（非阻断问题上报，不失败）。
    structural_errors = [e for e in (validation.get("errors") or []) if is_structural_blocker(e)]
    if structural_errors:
        details = "\n  " + "\n  ".join(structural_errors[:5])
        return False, f"{fname}: 提升前结构校验失败，已拒绝提升。" + details

    # 收集可上报字段问题（validate.reportable + 非结构 errors）
    pending_issues = list(validation.get("reportable") or [])
    for e in (validation.get("errors") or []):
        if not is_structural_blocker(e):
            pending_issues.append(e)

    fm = parse_frontmatter(filepath)

    # 确保 article_id 存在（准入必填）
    id_updated, article_id = ensure_article_id(filepath, fm)
    if id_updated:
        fm = parse_frontmatter(filepath)  # reload after write

    vstatus = fm.get("validation_status", "")

    if not vstatus:
        return False, f"{fname}: 缺少 validation_status 字段，请先运行 schema-write-client.mjs validate-article --stamp"

    # validation_status=failed 仅因字段问题（无结构阻断）→ 不拒绝，随上报继续
    if vstatus == "failed" and not fm.get("validation_override") and pending_issues:
        # 字段问题已上报，不再因 validation_status 拒绝（结构阻断已在上方拦截）
        pass

    # Resolve source_file (may be wikilink or path)
    source = fm.get("source_file", "")
    if not source:
        return False, f"{fname}: 缺少 source_file 字段（无法确定原始文件路径）"

    # Extract wikilink target
    source_path = None
    match = re.match(r'\[\[([^\]]+)\]\]', str(source))
    if match:
        source_name = match.group(1)
        source_basename = os.path.basename(source_name)
        # Search in archive or imported
        for base in [ARCHIVE_DIR, os.path.join(VAULT, "raw", "imported")]:
            for root, _, files in os.walk(base):
                for f in files:
                    f_no_ext = os.path.splitext(f)[0]
                    s_no_ext = os.path.splitext(source_basename)[0]
                    if f == source_basename or f_no_ext == s_no_ext:
                        source_path = os.path.join(root, f)
                        break
                if source_path:
                    break
            if source_path:
                break
        if not source_path:
            # Try as direct path under VAULT
            candidate = os.path.join(VAULT, source_name)
            if os.path.exists(candidate):
                source_path = candidate
    else:
        resolved_source = source
        if not os.path.isabs(source) and source.startswith("知识库/"):
            # source_file 由 JS workflow 写入时以 vault root 为基准（含 知识库/ 前缀），
            # 但本脚本 VAULT 变量实际是 knowledge root（…/知识库）。
            # 去掉前缀后用 knowledge root 重新拼接，避免 知识库/知识库/ 双重路径。
            resolved_source = source[len("知识库/"):]
        source_path = source if os.path.isabs(source) else os.path.join(VAULT, resolved_source)

    if not source_path or not os.path.isfile(source_path):
        return False, f"{fname}: 原始来源文件不存在，已保留草稿并拒绝提升"

    dest_path = os.path.join(PRECLEANED_DIR, fname)

    # PR-065/WP2（Master 2026-10-15 单份裁定）：原文归档单层化——source_file 已指向
    # archive/ 下的 content-addressed 归档件（Node 层 archiveDraftSource 写入的溯源锚）时
    # 不再二次拷贝（原产品分桶逻辑会把已归档件再抄一份，产生 <哈希>-<哈希>-名 双归档伪影）。
    # 原文归档唯一属主 = Node 层；本脚本只消费 source_file 锚点做存在性校验（上面已过）。
    if _is_content_addressed_archive(source_path):
        archive_dest = source_path
    else:
        # Determine product for archive
        product = fm.get("product", "通用")
        if isinstance(product, str):
            product = product.replace("[[", "").replace("]]", "")

        if dry_run:
            msg = (
                f"[DRY-RUN] {fname}:\n"
                f"  目标: {dest_path}\n"
                f"  归档: {source_path} → {ARCHIVE_DIR}/{product}/\n"
                f"  删除草稿: {filepath}"
            )
            if pending_issues:
                msg += f"\n  待处理问题({len(pending_issues)}): " + "; ".join(pending_issues[:5])
            return True, msg

        # 1. Archive and verify the original before creating the active candidate.
        with open(source_path, "rb") as source_file:
            source_bytes = source_file.read()
        source_hash = hashlib.sha256(source_bytes).hexdigest()
        bucket_ok, bucket_message, archive_dest = _archive_product_bucket(source_path, product, source_bytes, source_hash)
        if not bucket_ok:
            return False, f"{fname}: {bucket_message}"

    # 2. Copy the candidate only after the source archive is durable.
    os.makedirs(PRECLEANED_DIR, exist_ok=True)
    # 波5 批①：候选拷贝经 write_gateway（读源字节＋原子落盘；copy2 的 mtime 保留不属数据语义）
    with open(filepath, "rb") as src:
        write_bytes_atomic(dest_path, src.read(), fsync=False)

    # 3. Entity creation removed: promote only produces article candidates.
    # ensure_module_entities() has been retired per Slice 1 boundary.

    # 4. Remove the working draft last.
    os.remove(filepath)


    msg = (
        f"✅ {fname}:\n"
        f"  → precleaned: {dest_path}\n"
        f"  → archive: {archive_dest}"
    )
    if pending_issues:
        msg += f"\n  ⚠ 待处理问题({len(pending_issues)}): " + "; ".join(pending_issues[:5])
        # 快照上报通道已退役（2026-09-05 重构）：字段缺口卡由 Web 扫描通道读时派生
        # （scanCandidateArticleSources → checkArticleCompliance），账本不再落 pendingIssues。
    return True, msg


def main():
    dry_run = "--dry-run" in sys.argv
    args = [a for a in sys.argv[1:] if not a.startswith("--")]

    if not args and "--all" not in sys.argv:
        print("用法: python3 promote-article.py [--dry-run] [--all] <drafts/xxx.md> [...]")
        print()
        print("  --dry-run  预览操作，不实际执行")
        print("  --all      提升 drafts/ 中所有已校验文章")
        sys.exit(1)

    if "--all" in sys.argv:
        files = [os.path.join(DRAFTS_DIR, f) for f in os.listdir(DRAFTS_DIR)
                 if f.endswith(".md") and not f.startswith(".")]
        if not files:
            print("drafts/ 中没有待提升的文章")
            sys.exit(0)
    else:
        files = args

    promoted = 0
    failed = 0
    for fp in files:
        ok, msg = promote_one(fp, dry_run=dry_run)
        print(msg)
        if ok:
            promoted += 1
        else:
            failed += 1

    print(f"\n提升: {promoted}  失败: {failed}" + ("  (dry-run)" if dry_run else ""))

    # SPEC-011-W11 WP2: CLI 收尾记账（只在非 dry-run 且有成功提升时记账）
    if not dry_run and promoted > 0:
        ledger("cli", f"promote-article ({promoted} 篇)", [
            "知识库/raw/precleaned",
            "知识库/raw/archive",
            "知识库/raw/drafts",
        ])

    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
