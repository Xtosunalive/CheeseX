#!/usr/bin/env python3
# Component: Semantic-Projector
# @responsible: 读取 master_graph.json，过滤 `arch_component: true` 节点，按 `SA_VALID_LAYERS` 投影为 UI 专用的逻辑架构组件列表；同步写入 `architecture_layout.json`
# @inputs: `master_graph.json`
# @outputs: `semantic_architecture.json` + `architecture_layout.json`
# @context: B. 逻辑中枢上下文 (Pipeline Context)
# contract: writes semantic_architecture.json, architecture_layout.json（enums.yaml 经统一写客户端，SPEC-021 波 B）
# contract: reads enums.yaml
"""
架构依赖解析器
遵循架构概念定义：详见 /TheSchema/AI_CONCEPT.md

依赖两层模型：
  - 骨架依赖：entity 文件中的 依赖::[[target]]，有效期 = 组件生命周期交集
  - 版本依赖：词表依赖规则集中定义，可覆盖骨架边
  - 显式标注：@effective(since=, until=) 最高优先

用法:
  python3 generate-sa.py                        # dry-run：仅对比组件预览与现有 SA（不对比依赖）
  python3 generate-sa.py --apply                # 本地写入 SA + layout（含依赖）
  python3 generate-sa.py --apply --sync-enums   # 同步词表 modules 段后写入 SA + layout
  python3 generate-sa.py --version "7.0.5.6"    # 生成指定版本的 SA
  python3 generate-sa.py --json --version "7.0.5.6"  # 只读输出机器可解析版本投影

说明:
  apply 模式从 master_graph 投影审定依赖；generate() 只拼装组件列表，dry-run 若对比依赖会对现有 SA 产生
  「依赖被删光」的假阳性。
"""

import json
from _vault_ledger import ledger
import os
import re
import shutil
import sys
from collections import OrderedDict
from datetime import datetime, timezone

import yaml

from kb_paths import theschema_dir, vault_roots
import doc_consumption  # WP-155：实体文档面改吃文档信封（ADR-016 §二装载入口——Python 不读 vault .md）
import schema_loader
from sa_projection_support import (
    atomic_write_json,
    build_layout,
    load_projection_schema,
    normalize_architecture_value,
    normalize_category as normalize_schema_category,
    print_diff_summary,
    project_dependencies,
    semantic_layers,
    validate_artifacts,
    write_pipeline_version,
)


def normalize_module_list(value):
    """将 entity frontmatter 的 module 字段归一化为 list[str]。

    None / \"\" → []
    str → [str]
    list → 过滤空值并转 str
    dict / 其他非预期 → []（不抛异常）"""
    if value is None:
        return []
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if isinstance(value, (list, tuple)):
        result = []
        for item in value:
            if item is None:
                continue
            if isinstance(item, str):
                s = item.strip()
                if s:
                    result.append(s)
            else:
                result.append(str(item))
        return result
    # dict 或其他非预期类型 → 返回空列表，不抛异常
    return []

VAULT_ROOT, VAULT = vault_roots()
# WP-155：ENTITIES_DIR 常量退役——实体文档经文档信封（doc_consumption）递入，本文件不再构造 .md 文件路径
# WP-049 L3（ADR-016 §四-2）：词表数据经 schema_loader→信封取数，本文件不再构造词表文件路径
PROJECTION_SCHEMA = load_projection_schema()
# PR-082（Master 2026-10-20 批）：SA/layout 是②类派生投影，迁 repo data/ 侧通用槽
# data/staging/sa/（与 master_graph 同族同治理；通用版无产品段——主体身份属未来
# subjects 机制，见方案决策卡裁项 1/2）。旧位 知识库/architecture/<产品>/<版本>/ 退役。
from kb_paths import staging_path

SA_PATH = staging_path("sa/semantic_architecture.json")
LAYOUT_PATH = staging_path("sa/architecture_layout.json")
MASTER_PATH = staging_path("master_graph.json")


def normalize_category(raw):
    return normalize_schema_category(raw, PROJECTION_SCHEMA)


def normalize_projection_level(raw):
    v = str(raw or "").strip().lower()
    if v in {"detail", "support", "aux"}:
        return "detail"
    return "core"


def extract_architecture_attributes(fm):
    attrs = {}

    def put(key, val):
        if val is None or val == "":
            return
        s = str(val).strip()
        if s:
            attrs[key] = s

    put("role", fm.get("arch_role") or fm.get("role"))
    put("runtime", fm.get("arch_runtime") or fm.get("runtime"))
    put("stack", fm.get("arch_stack") or fm.get("stack"))
    put(
        "governanceStatus",
        fm.get("arch_governance_status")
        or fm.get("governance_status")
        or fm.get("gov_status"),
    )
    return attrs


# ── 解析 ──
# （WP-155：文件口径 parse_frontmatter 已退役——实体文档统一经 doc_consumption 信封口径
#   parse_frontmatter 递入，fmText/body 由信封 documents 成员供给；本件不再 open 任何 .md。）


def extract_wikilinks(body):
    """从 body 中提取类型化 wikilink，返回 [(link_type, target_name, effective_since, effective_until), ...]。

    支持显式标注:
      依赖::[[MySQL]] @effective(since=7.0.0, until=7.3.0)
      依赖::[[MySQL]] @effective(since=7.3.0)

    无 @effective = 骨架依赖，有效期由组件生命周期交集自动计算。
    """
    pattern = re.compile(r'^(?:-\s*)?(\S+)::\[\[([^\]]+)\]\](.*)$', re.MULTILINE)
    results = []
    for m in pattern.finditer(body):
        link_type = m.group(1)
        target_name = m.group(2)
        suffix = m.group(3).strip()

        wikilink_type_map = schema_loader.wikilink_type_map()
        if link_type not in wikilink_type_map:
            continue

        effective_since = None
        effective_until = None
        em = re.search(r'@effective\(since=([^,)]+)(?:,\s*until=([^)]+))?\)', suffix)
        if em:
            effective_since = em.group(1).strip()
            effective_until = em.group(2).strip() if em.group(2) else None

        results.append((link_type, target_name, effective_since, effective_until))
    return results


def load_all_entities():
    """读取所有 entity 页面（WP-155 信封口径——经 doc_consumption，本件零 .md 直读），
    返回 {architecture-node-id: entity_data}。只返回 arch_component: true 的页面。

    语义对齐注记：原文件口径 parse_frontmatter 对无块/坏 YAML 返回 ({}, body) 后由
    arch_component 判 False 跳过；信封口径 parse 返回 None 分支同址跳过——净行为等价。
    目录缺失形态：信封 paths 对缺失目录放行（空清单继续），原 os.path.exists(ENTITIES_DIR)
    提前返回同形（SPEC-084 §八-3 口径）。"""
    entities = {}
    envelope = doc_consumption.load_for_vault(VAULT_ROOT)
    kb_prefix = doc_consumption.knowledge_prefix(VAULT_ROOT, VAULT)
    for rel, doc in doc_consumption.iter_documents(envelope, prefixes=(kb_prefix + "wiki/entities/",)):
        fname = rel.rsplit("/", 1)[-1]
        parsed = doc_consumption.parse_frontmatter(doc["fmText"], doc["body"])
        if parsed is None:
            continue
        fm, body = parsed
        if fm.get("arch_component") is not True:
            continue

        arch_id = fm.get("architecture-node-id", "")
        if not arch_id:
            continue

        module_val = normalize_module_list(fm.get("module"))

        arch_cat = fm.get("arch_category", "")
        arch_layer = fm.get("arch_layer", "")
        arch_subdomain = fm.get("arch_subdomain", "")
        proj = normalize_projection_level(
            fm.get("projection_level") or fm.get("projectionLevel") or fm.get("level")
        )
        arch_attrs = extract_architecture_attributes(fm)

        ent = {
            "filename": fname,
            "title": fm.get("title", arch_id),
            "arch_layer": arch_layer,
            "arch_layer_canonical": normalize_architecture_value("layer", arch_layer, PROJECTION_SCHEMA),
            "arch_category": arch_cat,
            "arch_category_canonical": normalize_architecture_value("category", arch_cat, PROJECTION_SCHEMA),
            "arch_subdomain": arch_subdomain,
            "arch_subdomain_canonical": normalize_architecture_value("subdomain", arch_subdomain, PROJECTION_SCHEMA),
            "arch_since": str(fm.get("arch_since") or fm.get("since", "")),
            "arch_until": str(fm.get("arch_until") or fm.get("until", "")),
            "arch_version_overrides": fm.get("arch_version_overrides") or [],
            "modules": module_val,
            "wikilinks": extract_wikilinks(body),
            "projection_level": proj,
            "updated": str(fm.get("updated", "")),
        }
        if arch_attrs:
            ent["attributes"] = arch_attrs
        entities[arch_id] = ent
    return entities


# ── 版本过滤 ──

def parse_version(v):
    """将版本字符串转为可比较的 tuple，如 '7.0.6.8' → (7, 0, 6, 8)。"""
    try:
        return tuple(int(x) for x in str(v).split("."))
    except (ValueError, TypeError):
        return (0,)


def component_active_at(comp, target_version):
    """检查组件在 target_version 时是否存在。"""
    tv = parse_version(target_version)
    since = parse_version(comp["arch_since"]) if comp["arch_since"] else (0,)
    until = parse_version(comp["arch_until"]) if comp["arch_until"] else None
    if tv < since:
        return False
    if until is not None and tv >= until:
        return False
    return True


def apply_overrides(comp, target_version=None):
    """返回应用版本覆盖后的 arch_layer 和 arch_category。
    若 target_version 为 None，取最新覆盖值。
    """
    layer = comp["arch_layer"]
    category = comp["arch_category"]
    overrides = comp.get("arch_version_overrides", [])
    if not overrides:
        return layer, category

    tv = parse_version(target_version) if target_version else None

    applicable = []
    for ov in overrides:
        ov_ver = str(ov.get("version", ""))
        ov_tv = parse_version(ov_ver)
        if tv is None or ov_tv <= tv:
            applicable.append((ov_tv, ov))

    if not applicable:
        return layer, category

    applicable.sort(key=lambda x: x[0])
    _, best = applicable[-1]

    if "arch_layer" in best:
        layer = best["arch_layer"]
    if "arch_category" in best:
        category = best["arch_category"]
    return layer, category


# ── 生成 ──

def generate(target_version=None):
    """从 entity 页面生成 SA 数据结构。"""
    all_entities = load_all_entities()

    # 过滤 + 应用版本
    active = {}
    for arch_id, comp in all_entities.items():
        if target_version and not component_active_at(comp, target_version):
            continue
        layer, category = apply_overrides(comp, target_version)
        active[arch_id] = {**comp, "effective_layer": layer, "effective_category": category}

    # 生成 components
    components = []
    for arch_id, comp in sorted(active.items()):
        raw_layer = comp["effective_layer"]
        raw_category = comp["effective_category"]
        layer = normalize_architecture_value("layer", raw_layer, PROJECTION_SCHEMA)
        category = normalize_category(raw_category)
        raw_subdomain = comp.get("arch_subdomain", "")
        canonical_subdomain = normalize_architecture_value("subdomain", raw_subdomain, PROJECTION_SCHEMA)
        color_key = PROJECTION_SCHEMA["layer_colors"].get(layer, "slate")
        # WP-155 信封口径：sourcePath＝知识库相对路径（与原 relpath(ENTITIES_DIR/filename,
        # VAULT_ROOT).replace("\\","/") 逐字节同值——含「知识库/」前缀，对拍钉住）
        source_path = doc_consumption.knowledge_prefix(VAULT_ROOT, VAULT) + f"wiki/entities/{comp['filename']}"
        modules = comp.get("modules") if isinstance(comp.get("modules"), list) else []
        primary_module = modules[0] if modules and isinstance(modules[0], str) else ""
        row = OrderedDict([
            ("id", arch_id),
            ("label", comp["title"]),
            ("sublabel", ""),
            ("module", primary_module),
            ("modules", modules),
            ("layer", layer),
            ("category", category),
            ("arch_layer", raw_layer),
            ("arch_layer_canonical", layer),
            ("arch_category", raw_category),
            ("arch_category_canonical", category),
            ("arch_subdomain", raw_subdomain),
            ("arch_subdomain_canonical", canonical_subdomain),
            ("colorKey", color_key),
            ("status", "approved"),
            ("projectionLevel", comp.get("projection_level", "core")),
            ("sourcePath", source_path),
        ])
        if comp.get("attributes"):
            row["attributes"] = comp["attributes"]
        components.append(row)

    # Apply mode projects dependencies from master_graph; dry-run previews components only.
    dependencies = []

    # crosscutting
    crosscutting = sorted([
        arch_id for arch_id, comp in active.items()
        if comp["effective_layer"] == "crosscutting"
    ])

    updated_dates = [c["updated"] for c in active.values() if c.get("updated")]
    max_updated = max(updated_dates) if updated_dates else datetime.now(timezone.utc).isoformat()

    return OrderedDict([
        ("version", "1.0.0"),
        ("_format_version", "1.0"),
        ("_generated_by", "generate-sa.py"),
        ("_generated_at", datetime.now(timezone.utc).isoformat()),
        ("_generated_for_version", target_version or "master"),
        ("_source", "wiki/entities/ (arch_component: true)"),
        ("product", PROJECTION_SCHEMA["product"]),
        ("updatedAt", max_updated),
        ("components", components),
        ("layers", semantic_layers(PROJECTION_SCHEMA)),
        ("dependencies", dependencies),
        ("crosscutting", crosscutting),
    ])


# ── enums.yaml 同步 ──

# 〔SPEC-021 波 B 退役〕snapshot_enums：enums 直写自实现已由统一写客户端（schema-write-client.mjs）取代——协议单源。

# 〔SPEC-021 波 B 退役〕atomic_write_yaml：enums 直写自实现已由统一写客户端（schema-write-client.mjs）取代——协议单源。

def sync_enums(entities):
    """更新词表 enums 的 modules 段，使其与 entity 页面的 module 列表一致（读经信封，写经统一客户端）。"""
    import schema_loader
    enums = schema_loader.load_the_schema("enums")[0] or {}

    existing_modules = enums.get("modules", {})

    # 从 entity 页面收集 module 映射
    # 以 existing_modules 为基底，entity 仅覆盖 4 个锚定字段，其余字段原样保留
    new_modules = OrderedDict()
    for mod_name, old_data in existing_modules.items():
        new_modules[mod_name] = dict(old_data) if isinstance(old_data, dict) else {}

    for arch_id, comp in sorted(entities.items()):
        for mod_name in normalize_module_list(comp.get("modules")):
            if not mod_name:
                continue
            old = existing_modules.get(mod_name, {})
            entry = dict(old) if isinstance(old, dict) else {}
            entry["subdomain"] = comp.get("arch_subdomain_canonical") or comp.get("arch_subdomain") or old.get("subdomain", "")
            entry["system"] = arch_id
            entry["since"] = comp.get("arch_since") or old.get("since", "")
            entry["until"] = comp.get("arch_until") or old.get("until", "")
            new_modules[mod_name] = entry

    enums["modules"] = new_modules
    return enums


# ── CLI ──

def load_existing_sa():
    if not os.path.exists(SA_PATH):
        return None
    with open(SA_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def main():
    args = sys.argv[1:]
    apply_mode = "--apply" in args
    sync_mode = "--sync-enums" in args
    force_mode = "--force" in args
    target_version = None
    summary_only = "--summary" in args
    json_mode = "--json" in args

    # WP-155：实体文档面统一走文档信封——管线拉起链（pipeline-runner／server spawn）已注入
    # DOC_ENVELOPE_PATH 时直接短路；直拉运行缺失则自动物化一次，失败显式退出（零回落）。
    doc_consumption.ensure_doc_envelope(VAULT_ROOT)

    for i, arg in enumerate(args):
        if arg == "--version" and i + 1 < len(args):
            target_version = args[i + 1]

    if json_mode and (apply_mode or sync_mode):
        print("--json 只允许只读预览，不能与 --apply/--sync-enums 同时使用", file=sys.stderr)
        return 2

    if apply_mode:
        try:
            all_entities = load_all_entities()
            new_sa = generate(target_version)
            if not new_sa["components"]:
                print("⚠️ 未发现 arch_component entity，写入空 SA/layout", flush=True)
            component_ids = [component["id"] for component in new_sa["components"]]
            new_sa["dependencies"] = project_dependencies(
                MASTER_PATH,
                component_ids,
                PROJECTION_SCHEMA,
                schema_loader.load_the_schema("dependencies")[0] or {},  # WP-049 L3：依赖规则经信封
                target_version,
            )
            layout = build_layout(
                new_sa,
                PROJECTION_SCHEMA,
                LAYOUT_PATH,
                reset=force_mode or "--reset-layout" in args,
            )
            validate_artifacts(new_sa, layout, PROJECTION_SCHEMA)
            atomic_write_json(SA_PATH, new_sa)
            atomic_write_json(LAYOUT_PATH, layout)
            write_pipeline_version(VAULT_ROOT, MASTER_PATH, SA_PATH, LAYOUT_PATH)
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            print(f"❌ SA 本地投影失败: {exc}", flush=True)
            return 1

        if sync_mode:
            # D2 修复：乐观锁基线在读时取（sha256 与 enums-write-service revision 同式）——窗口期页面写入将 409 拒绝。
            # WP-049 L3：sha256 直取信封指纹（与词表文件字节哈希同值同源，零文件读取）
            from vocab_envelope import load_envelope as _load_vocab_envelope
            _enums_revision = "sha256:" + _load_vocab_envelope().fingerprint("enums")
            new_enums = sync_enums(all_entities)
            # SPEC-021 波 B：enums 写收敛统一客户端——协议（原子/快照/canonical/解析物联动）单源，
            # 原 Python 自实现 snapshot_enums/atomic_write_yaml 退役（同款协议不允许第二份实现）。
            import subprocess as _sp
            import tempfile as _tf
            with _tf.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as _fh:
                json.dump(new_enums.get("modules", {}), _fh, ensure_ascii=False)
                _modules_file = _fh.name
            try:
                _client = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schema-write-client.mjs")
                _proc = _sp.run(["node", _client, "enums-set-modules", "--vault", VAULT_ROOT, "--revision", _enums_revision, "--file", _modules_file], capture_output=True, text=True)
                if _proc.returncode != 0:
                    print(f"❌ enums 同步失败（统一写客户端）: {_proc.stderr.strip()}", flush=True)
                    return 1
                print(f"✅ 已同步词表 enums modules 段 ({len(new_enums.get('modules', {}))} 个 module，经统一写客户端：原子+快照+解析物联动)")
            finally:
                os.unlink(_modules_file)

        print(f"✅ 已写入 SA: {SA_PATH} ({len(new_sa['components'])} 组件, {len(new_sa['dependencies'])} 关系)")
        print(f"✅ 已写入布局: {LAYOUT_PATH} ({len(layout['nodes'])} 节点, {len(layout['groups'])} 分组)")
        print(f"ℹ️  数据源 Vault: {VAULT_ROOT}", flush=True)

        # SPEC-011-W11 WP2: CLI 收尾记账（登记真实写入路径）。WP-049 L3：词表写入的 git 记账由
        # 统一写客户端（Node repoWrite）自带，Python 侧不再登记词表路径（也无需知其路径）。
        ledger("cli", "generate-sa --apply", [SA_PATH, LAYOUT_PATH])
        return 0

    all_entities = load_all_entities()
    new_sa = generate(target_version)

    if json_mode:
        component_ids = [component["id"] for component in new_sa["components"]]
        new_sa["dependencies"] = project_dependencies(
            MASTER_PATH,
            component_ids,
            PROJECTION_SCHEMA,
            schema_loader.load_the_schema("dependencies")[0] or {},  # WP-049 L3：依赖规则经信封
            target_version,
        )
        print(json.dumps(new_sa, ensure_ascii=False, separators=(",", ":")))
        return 0

    if summary_only:
        print(f"组件: {len(new_sa['components'])}")
        print(f"依赖: {len(new_sa['dependencies'])}（summary/dry-run 不投影；--apply 从 master_graph 投影）")
        print(f"横切: {len(new_sa['crosscutting'])}")
        layers_seen = set(c["layer"] for c in new_sa["components"])
        print(f"层级: {', '.join(sorted(layers_seen))}")
        return 0

    old_sa = load_existing_sa()
    print("=" * 60)
    print("generate-sa.py  —  Entity 预览（组件） + 本地投影完整 SA")
    print(f"目标版本: {target_version or 'master'}")
    print(f"源: {len(all_entities)} 个 arch_component entity 页面")
    print("=" * 60)

    print_diff_summary(new_sa, old_sa)

    # 检查 entity 页面数据质量
    invalid_layers = []
    empty_categories = []
    for arch_id, comp in all_entities.items():
        layer = comp.get("arch_layer_canonical") or comp["arch_layer"]
        if layer and layer not in PROJECTION_SCHEMA["valid_layers"]:
            invalid_layers.append((arch_id, layer))
        if not comp["arch_category"]:
            empty_categories.append(arch_id)

    if invalid_layers or empty_categories:
        print(f"\n⚠️  Entity 页面数据问题（需在 Obsidian 中修正）:")
        if invalid_layers:
            print(f"  arch_layer 值非法 ({len(invalid_layers)} 个):")
            for aid, layer in sorted(invalid_layers):
                print(f"    - {aid}: arch_layer='{layer}' (合法值: {', '.join(sorted(PROJECTION_SCHEMA['valid_layers']))})")
        if empty_categories:
            print(f"  arch_category 缺失 ({len(empty_categories)} 个):", ", ".join(sorted(empty_categories)))

    print(f"\n(dry-run 模式。加 --apply 由 generate-sa.py 本地写入 SA + layout。)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
