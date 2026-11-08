#!/usr/bin/env python3
# Component: Entity-Validator
# @responsible: entity 页面或词表 dependencies 变更后，提交前校验 frontmatter schema 合规性
# @inputs: 变更的 entity 页面 / 词表 dependencies（经信封，非文件直读——WP-049 L3）
# @outputs: 校验报告（ERROR 必须清零方可提交）
# @context: A. 知识源上下文 (Vault Context)
"""
validate-entity.py — entity / dependency 变更预检

在提交前运行，拦截明显错误。人工只需处理 WARNING 和 ERROR。

用法:
  python3 validate-entity.py                        # 全量检查 entity/ + 依赖规则（词表，经信封）
  python3 validate-entity.py file1.md file2.md      # 仅检查指定文件
  python3 validate-entity.py --changed              # 检查 git diff 中变更的文件

退出码:
  0 = 通过（含 WARNING 时仍为 0，但需人工复核）
  1 = ERROR（需修复后才能提交）
"""

import json
import os
import re
import sys
from collections import defaultdict

import yaml
import networkx as nx

from kb_paths import vault_roots

_, VAULT = vault_roots()
ENTITIES_DIR = os.path.join(VAULT, "wiki", "entities")
import schema_loader  # WP-049 L3（ADR-016 §四-2）：词表经信封取数，不再构造词表文件路径

# 旧 DEPS_PATH 指向 vault 侧已封存路径（SPEC-023 迁仓后恒不存在）——依赖校验自迁仓起
# 静默空跑；信封化后读真源，校验复活为真执行。
_enums = schema_loader.load_the_schema("enums")[0] or {}
_projection = _enums.get("architecture_projection", {})
VALID_LAYERS = {
    str(layer.get("id") or "").strip()
    for layer in (_enums.get("layers") or [])
    if isinstance(layer, dict)
    and layer.get("entity_layer") is not False
    and str(layer.get("id") or "").strip()
}
VALID_CATEGORIES = set(_enums.get("arch_categories", []))
VALID_SUBDOMAINS = {
    value for values in _enums.get("subdomains", {}).values()
    if isinstance(values, list) for value in values
}
LAYER_ALIASES = _projection.get("layer_aliases", {}) if isinstance(_projection.get("layer_aliases"), dict) else {}
CATEGORY_ALIASES = _projection.get("category_aliases", {}) if isinstance(_projection.get("category_aliases"), dict) else {}
SUBDOMAIN_ALIASES = _projection.get("subdomain_aliases", {}) if isinstance(_projection.get("subdomain_aliases"), dict) else {}

VALID_RELATION_TYPES = {
    "DEPENDS_ON", "CONNECTS_TO", "STORES_IN", "ROUTES_TO",
    "CONTAINS", "MANAGES", "BACKS_UP", "INDEXES"
}

DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')

errors = []
warnings = []


# ── 工具 ──

def parse_version(v):
    if not v or not str(v).strip():
        return None
    try:
        return tuple(int(x) for x in str(v).strip().split("."))
    except (ValueError, TypeError):
        return None


# WP-117 批3（SPEC-084 §二.3）：文档供给收进信封——零回落（缺失/版本/形态异常即退）。
from doc_envelope import DocEnvelopeError, load_doc_envelope as _load_doc_envelope

_DOC_ENV = None


def _doc_env():
    global _DOC_ENV
    if _DOC_ENV is None:
        _DOC_ENV = _load_doc_envelope()
    return _DOC_ENV


def _kb_rel(filepath):
    """绝对路径→信封 rel（知识库相对 POSIX）。VAULT 即知识库根，前缀补 知识库/。"""
    rel = os.path.relpath(filepath, VAULT).replace(os.sep, "/")
    return "知识库/" + rel if not rel.startswith("知识库/") else rel


def _entity_names():
    """entities 顶层 .md 文件名清单——信封过滤（原 os.listdir 顶层口径；sorted 确定性）。"""
    prefix = "知识库/wiki/entities/"
    return sorted(
        r.rsplit("/", 1)[-1] for r in _doc_env().paths()
        if r.startswith(prefix) and r.endswith(".md") and "/" not in r[len(prefix):]
    )


def parse_frontmatter(filepath):
    # WP-117 批3：全文＝信封 fmText＋body（逐字节还原原文件）；原编码链由 Node 侧物化承担。
    rel = _kb_rel(filepath)
    hit = _doc_env().get_document(rel)
    if hit["state"] != "present":
        raise FileNotFoundError(f"文件不在文档信封内: {rel}")
    content = hit["value"]["fmText"] + hit["value"]["body"]
    fm = {}
    body = content
    if content.startswith("---"):
        parts = content.split("---", 2)
        if len(parts) >= 3:
            try:
                fm = yaml.safe_load(parts[1]) or {}
            except yaml.YAMLError:
                pass
            body = parts[2]
    return fm, body


def extract_wikilinks(body):
    pattern = re.compile(r'^(?:-\s*)?(\S+)::\[\[([^\]]+)\]\](.*)$', re.MULTILINE)
    results = []
    for m in pattern.finditer(body):
        link_type = m.group(1)
        target = m.group(2)
        suffix = m.group(3).strip()
        effective = None
        em = re.search(r'@effective\(since=([^,)]+)(?:,\s*until=([^)]+))?\)', suffix)
        if em:
            effective = (em.group(1).strip(), em.group(2).strip() if em.group(2) else None)
        results.append((link_type, target, effective))
    return results


# ── 检查 1: Entity 文件 frontmatter ──

def check_entity(filepath):
    fm, body = parse_frontmatter(filepath)
    fname = os.path.basename(filepath)

    # 0.x architecture-node-id 仅允许与 arch_component: true 同时出现
    arch_id_raw = fm.get("architecture-node-id")
    if arch_id_raw and fm.get("arch_component") is not True:
        errors.append(f"{fname}: 包含 architecture-node-id ('{arch_id_raw}') 但 arch_component 不为 true，应删除 architecture-node-id")

    if fm.get("arch_component") is not True:
        return  # 非架构组件，跳过

    arch_id = fm.get("architecture-node-id", "")

    # 1.0 title 不为空
    title = fm.get("title", "")
    if not title:
        errors.append(f"{fname}: 缺少 title")

    # 1.0.1 date 存在且格式 YYYY-MM-DD
    date_val = str(fm.get("date", "")).strip()
    if not date_val:
        errors.append(f"{fname}: 缺少 date")
    elif not DATE_RE.match(date_val):
        errors.append(f"{fname}: date '{date_val}' 格式非法（需 YYYY-MM-DD）")

    # 1.0.2 tags 不为空
    tags_val = fm.get("tags", [])
    if not tags_val or (isinstance(tags_val, list) and len(tags_val) == 0):
        errors.append(f"{fname}: 缺少 tags")
    elif isinstance(tags_val, str):
        errors.append(f"{fname}: tags 需为列表格式（如 [标签1, 标签2]）")

    # 1.0.3 updated 存在
    updated_val = str(fm.get("updated", "")).strip()
    if not updated_val:
        warnings.append(f"{fname}: 缺少 updated（知识更新记录）")
    elif not DATE_RE.match(updated_val):
        errors.append(f"{fname}: updated '{updated_val}' 格式非法（需 YYYY-MM-DD）")

    # 1.1 architecture-node-id 存在且非空——形状不裁决（ADR-016 §二／SPEC-046 I2：ID 是不透明串，消费方不得正则解析）
    if not arch_id:
        errors.append(f"{fname}: 缺少 architecture-node-id")

    # 1.2 arch_layer 合法性
    layer = fm.get("arch_layer", "")
    if not layer:
        errors.append(f"{fname}: 缺少 arch_layer")
    elif LAYER_ALIASES.get(layer, layer) not in VALID_LAYERS:
        errors.append(f"{fname}: arch_layer '{layer}' 不合法（合法值: {', '.join(sorted(VALID_LAYERS))}）")

    # 1.3 arch_category 和 arch_subdomain 不空，category 值合法
    cat = fm.get("arch_category")
    if not cat:
        errors.append(f"{fname}: 缺少 arch_category（合法值: {', '.join(sorted(VALID_CATEGORIES))}）")
    elif CATEGORY_ALIASES.get(cat, cat) not in VALID_CATEGORIES:
        errors.append(f"{fname}: arch_category '{cat}' 不合法（合法值: {', '.join(sorted(VALID_CATEGORIES))}）。请根据组件性质选择匹配的分类，或检查词表 arch_categories 段（经页面或写客户端）确认是否需新增分类。")
    subdomain = fm.get("arch_subdomain")
    if not subdomain:
        warnings.append(f"{fname}: 缺少 arch_subdomain")
    elif SUBDOMAIN_ALIASES.get(subdomain, subdomain) not in VALID_SUBDOMAINS:
        errors.append(f"{fname}: arch_subdomain '{subdomain}' 不合法")

    # 1.4 arch_since 格式
    arch_since = fm.get("arch_since", "")
    if arch_since:
        sv = parse_version(arch_since)
        if sv is None:
            errors.append(f"{fname}: arch_since '{arch_since}' 格式非法（需 semver）")
    else:
        warnings.append(f"{fname}: arch_since 为空（建议填写）")

    # 1.5 arch_until < arch_since 检查
    arch_until = fm.get("arch_until", "")
    if arch_since and arch_until:
        sv = parse_version(arch_since)
        uv = parse_version(arch_until)
        if sv and uv and sv >= uv:
            errors.append(f"{fname}: arch_since ({arch_since}) >= arch_until ({arch_until})")

    # 1.6 module 字段
    mod = fm.get("module", [])
    if not mod:
        warnings.append(f"{fname}: 缺少 module 字段")


# ── 检查 2: architecture-node-id 全局唯一性 ──

def check_id_uniqueness():
    id_map = defaultdict(list)
    for fname in _entity_names():
        if not fname.endswith(".md"):
            continue
        fm, _ = parse_frontmatter(os.path.join(ENTITIES_DIR, fname))
        aid = fm.get("architecture-node-id", "")
        if aid:
            id_map[aid].append(fname)
    for aid, files in id_map.items():
        if len(files) > 1:
            errors.append(f"architecture-node-id 重复: '{aid}' → {', '.join(files)}")


# ── 检查 3: 依赖关系 ──

def check_dependencies():
    # WP-049 L3：依赖规则经 schema_loader→信封取数（旧 vault 侧路径自 SPEC-023 迁仓后不存在，
    # 本检查曾静默空跑；信封读真源后复活）。信封缺 dependencies 件＝无规则可查，静默返回。
    from vocab_envelope import load_envelope
    if not load_envelope().has("dependencies"):
        return
    data = schema_loader.load_the_schema("dependencies")[0] or {}
    entries = data.get("dependencies", [])

    # 加载所有已知 entity — 多路名字查找
    known_ids = set()
    entity_name_lookup = {}  # display name / filename → arch-id
    entity_versions = {}
    for fname in _entity_names():
        if not fname.endswith(".md"):
            continue
        fm, _ = parse_frontmatter(os.path.join(ENTITIES_DIR, fname))
        aid = fm.get("architecture-node-id", "")
        if not aid:
            continue
        known_ids.add(aid)
        title = fm.get("title", "")
        if title:
            entity_name_lookup[title] = aid
            entity_name_lookup[title.replace(" ", "")] = aid
            entity_name_lookup[title.replace(" / ", "/")] = aid
        entity_name_lookup[fname.replace(".md", "")] = aid
        entity_name_lookup[fname.replace(".md", "").replace(" ", "")] = aid
        sv = parse_version(fm.get("arch_since", ""))
        uv = parse_version(fm.get("arch_until", "")) if fm.get("arch_until", "") else None
        entity_versions[aid] = (sv, uv)

    def resolve_target(name):
        """通过多种形式解析 wikilink 目标 → arch-id。"""
        if name in known_ids:
            return name
        if name in entity_name_lookup:
            return entity_name_lookup[name]
        if name.replace(" ", "") in entity_name_lookup:
            return entity_name_lookup[name.replace(" ", "")]
        return None

    seen = set()
    for i, entry in enumerate(entries):
        src = entry.get("source", entry.get("from", ""))
        tgt = entry.get("target", entry.get("to", ""))
        rtype = entry.get("type", "DEPENDS_ON")
        since = entry.get("since", "")
        until = entry.get("until", "")

        # 3.1 source / target 存在
        if not resolve_target(src):
            errors.append(f"依赖规则[{i}]: source '{src}' 对应的 entity 不存在")
        if not resolve_target(tgt):
            errors.append(f"依赖规则[{i}]: target '{tgt}' 对应的 entity 不存在")

        # 3.2 type 合法
        if rtype not in VALID_RELATION_TYPES:
            errors.append(f"依赖规则[{i}]: type '{rtype}' 不合法（合法值: {', '.join(sorted(VALID_RELATION_TYPES))}）")

        # 3.3 since/until 格式
        if since:
            if parse_version(since) is None:
                errors.append(f"依赖规则[{i}]: since '{since}' 格式非法")
        if until:
            if parse_version(until) is None:
                errors.append(f"依赖规则[{i}]: until '{until}' 格式非法")

        # 3.4 since < until
        sv = parse_version(since)
        uv = parse_version(until) if until else None
        if sv and uv and sv >= uv:
            errors.append(f"依赖规则[{i}]: since ({since}) >= until ({until})")

        # 3.5 依赖区间与 entity 生命周期有交集
        if src in entity_versions and tgt in entity_versions:
            esv, _ = entity_versions[src]
            if esv and uv and esv >= uv:
                warnings.append(f"依赖规则[{i}]: {src}→{tgt} 的 until={until} 早于 {src} 的 arch_since，区间无交集")

        # 3.6 重复定义
        key = (src, tgt, rtype, since, until or "")
        if key in seen:
            errors.append(f"依赖规则[{i}]: {src}→{tgt} ({rtype}) 重复定义")
        seen.add(key)

    # 检查 entity wikilink 依赖的目标是否存在
    for fname in _entity_names():
        if not fname.endswith(".md"):
            continue
        fm, body = parse_frontmatter(os.path.join(ENTITIES_DIR, fname))
        if fm.get("arch_component") is not True:
            continue
        for link_type, target_name, effective in extract_wikilinks(body):
            if not resolve_target(target_name):
                warnings.append(f"{fname}: wikilink {link_type}::[[{target_name}]] 目标不在已知 entity 中")


# ── 检查 4: 循环依赖检测 ──

def check_dep_cycles():
    """检测 DEPENDS_ON 有向图中的循环依赖。"""
    G = nx.DiGraph()

    # 构建 name → arch-id 映射
    known_ids = set()
    name_lookup = {}
    for fname in _entity_names():
        if not fname.endswith(".md"):
            continue
        fm, _ = parse_frontmatter(os.path.join(ENTITIES_DIR, fname))
        aid = fm.get("architecture-node-id", "")
        if not aid:
            continue
        known_ids.add(aid)
        title = fm.get("title", "")
        if title:
            name_lookup[title] = aid
        name_lookup[fname.replace(".md", "")] = aid

        # entity wikilink DEPENDS_ON edges
        _, body = parse_frontmatter(os.path.join(ENTITIES_DIR, fname))
        for link_type, target_name, _ in extract_wikilinks(body):
            if link_type != "依赖":
                continue
            tid = name_lookup.get(target_name) or target_name
            if tid in known_ids:
                G.add_edge(aid, tid)

    # 依赖规则 DEPENDS_ON edges（WP-049 L3：经信封）
    for dep in (schema_loader.load_the_schema("dependencies")[0] or {}).get("dependencies", []):
            src = dep.get("source", "").strip()
            tgt = dep.get("target", "").strip()
            rtype = dep.get("type", "DEPENDS_ON")
            if rtype == "DEPENDS_ON" and src in known_ids and tgt in known_ids:
                G.add_edge(src, tgt)

    cycles = list(nx.simple_cycles(G))
    if cycles:
        for c in cycles:
            path = " → ".join(c) + " → " + c[0]
            warnings.append(f"循环依赖: {path}")


# ── 主 ──

def main():
    if "--changed" in sys.argv:
        # git diff 变更文件
        import subprocess
        result = subprocess.run(
            ["git", "diff", "--name-only", "HEAD"],
            capture_output=True, text=True, cwd=VAULT
        )
        files = [f for f in result.stdout.strip().split("\n") if f]
        # WP-049 L3：只筛 entity 文件——词表编辑在 repo 侧经统一写客户端与仓内门禁校验，
        # vault git diff 不再含词表路径（旧 dependencies.yaml 筛选分支随迁仓已死）。
        files = [os.path.join(VAULT, f) for f in files if "wiki/entities/" in f]
    elif len(sys.argv) > 1:
        files = sys.argv[1:]
    else:
        # 全量
        files = [os.path.join(ENTITIES_DIR, f) for f in _entity_names()]

    entity_files = [f for f in files if f.endswith(".md") and os.path.basename(os.path.dirname(f)) == "entities"]

    # 检查 entity 文件
    for fpath in entity_files:
        if os.path.exists(fpath):
            check_entity(fpath)

    # 全局唯一性（全量扫描）
    check_id_uniqueness()

    # 检查依赖
    check_dependencies()
    check_dep_cycles()

    # ── 输出 ──
    if errors:
        print(f"\n❌ ERROR ({len(errors)} 条，需修复):")
        for e in errors:
            print(f"  - {e}")

    if warnings:
        print(f"\n⚠️  WARNING ({len(warnings)} 条，建议人工复核):")
        for w in warnings:
            print(f"  - {w}")

    if not errors and not warnings:
        print("✅ 全部通过")

    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
