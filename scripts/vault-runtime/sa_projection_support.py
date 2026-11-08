#!/usr/bin/env python3
"""Local semantic-architecture projection helpers.

TheSchema is the only configuration source. This module intentionally has no
dependency on the legacy architecture repository.
"""

from write_gateway import write_text_atomic, append_line, write_bytes_atomic
import hashlib
import json
import math
import os
from datetime import datetime, timezone

import yaml


def load_projection_schema(enums_doc=None):
    """PR-082 裁项 2（Master 2026-10-20 批）：身份可选化——元层态（无挂载主体、注册表
    无产品身份）为合法形态，不再硬拒。product/version 仅供版本过滤参考，缺省为空串；
    SA/layout 恒落通用槽（staging/sa/，无产品段）。
    WP-049 L3：词表经 schema_loader→信封取数（enums_doc 保留测试注入位，缺省走信封）。"""
    if enums_doc is None:
        import schema_loader
        enums_doc = schema_loader.load_the_schema("enums")[0] or {}
    enums = enums_doc
    projection = enums.get("architecture_projection", {})
    product = str(projection.get("product") or "").strip()
    version = str(projection.get("version") or "").strip()

    allowed_layers = [
        str(layer.get("id") or "").strip()
        for layer in (enums.get("layers") or [])
        if isinstance(layer, dict) and str(layer.get("id") or "").strip()
    ]
    if not allowed_layers:
        raise ValueError("enums.layers must define at least one layer id")
    layer_defs = []
    seen_layers = set()
    for layer in enums.get("layers", []):
        if not isinstance(layer, dict):
            continue
        layer_id = str(layer.get("id") or "").strip()
        if not layer_id or layer_id not in allowed_layers:
            continue
        layer_defs.append({
            "id": layer_id,
            "label": str(layer.get("label") or layer_id),
            "color": str(layer.get("color") or "slate"),
            "layout": str(layer.get("layout") or "central"),
        })
        seen_layers.add(layer_id)
    missing_layers = [layer for layer in allowed_layers if layer not in seen_layers]
    if missing_layers:
        raise ValueError("enums.layers missing layer definitions: " + ", ".join(missing_layers))

    projected_relations = projection.get("projected_relation_types", [])
    if not isinstance(projected_relations, list):
        raise ValueError("architecture_projection.projected_relation_types must be a list")

    return {
        "product": product,
        "version": version,
        "layers": layer_defs,
        "valid_layers": frozenset(allowed_layers),
        "layer_colors": {layer["id"]: layer["color"] for layer in layer_defs},
        "categories": frozenset(str(value) for value in enums.get("arch_categories", []) if str(value).strip()),
        "layer_aliases": projection.get("layer_aliases", {}) if isinstance(projection.get("layer_aliases"), dict) else {},
        "category_aliases": projection.get("category_aliases", {}) if isinstance(projection.get("category_aliases"), dict) else {},
        "subdomain_aliases": projection.get("subdomain_aliases", {}) if isinstance(projection.get("subdomain_aliases"), dict) else {},
        "projected_relation_types": frozenset(str(value) for value in projected_relations if str(value).strip()),
    }


def normalize_category(raw, schema):
    value = str(raw or "").strip()
    if value in schema["categories"]:
        return value
    aliases = schema["category_aliases"]
    return aliases.get(value) or aliases.get(value.lower()) or "服务"


def normalize_architecture_value(field, raw, schema):
    value = str(raw or "").strip()
    aliases = schema.get(f"{field}_aliases", {})
    return str(aliases.get(value, value) or "").strip()


def semantic_layers(schema):
    return [
        {"id": layer["id"], "label": layer["label"], "color": layer["color"]}
        for layer in schema["layers"]
    ]


def print_diff_summary(new_sa, old_sa):
    if old_sa is None:
        print("(现有 SA 不存在，将新建)")
        return
    old_components = {item["id"]: item for item in old_sa.get("components", [])}
    new_components = {item["id"]: item for item in new_sa.get("components", [])}
    added = set(new_components) - set(old_components)
    removed = set(old_components) - set(new_components)
    changed = []
    for component_id in set(new_components) & set(old_components):
        differences = []
        for field in ("layer", "category", "colorKey", "label", "projectionLevel"):
            old_value = old_components[component_id].get(field)
            new_value = new_components[component_id].get(field)
            if old_value != new_value:
                differences.append(f"{field}: {old_value} -> {new_value}")
        if differences:
            changed.append((component_id, differences))
    print(f"\n组件: {len(old_components)} -> {len(new_components)}")
    if added:
        print(f"  + 新增 {len(added)}: {', '.join(sorted(added))}")
    if removed:
        print(f"  - 移除 {len(removed)}: {', '.join(sorted(removed))}")
    if changed:
        print(f"  ~ 变更 {len(changed)}:")
        for component_id, differences in changed:
            print(f"      {component_id}: {'; '.join(differences)}")
    if not added and not removed and not changed:
        print("  组件: 无变化")

    old_dependencies = {
        (item["from"], item["to"], item["relationType"])
        for item in old_sa.get("dependencies", [])
    }
    new_dependencies = {
        (item["from"], item["to"], item["relationType"])
        for item in new_sa.get("dependencies", [])
    }
    if not new_dependencies:
        print(f"\n依赖: dry-run 不投影；现有 SA 有 {len(old_dependencies)} 条。")
        return
    print(f"\n依赖: {len(old_dependencies)} -> {len(new_dependencies)}")
    print(f"  + 新增 {len(new_dependencies - old_dependencies)} 条")
    print(f"  - 移除 {len(old_dependencies - new_dependencies)} 条")


def _parse_version(value):
    try:
        return tuple(int(part) for part in str(value or "").split(".") if part != "")
    except (TypeError, ValueError):
        return (0,)


def _active_at(target_version, since, until):
    if not target_version:
        return True
    target = _parse_version(target_version)
    if since and target < _parse_version(since):
        return False
    if until and target >= _parse_version(until):
        return False
    return True


def _load_versioned_dependencies(dependencies_doc):
    # WP-049 L3：依赖规则经 schema_loader→信封取数（形态收口已在 Node 装载时完成——
    # PR-053 的 contracts/theschema.dependencies.schema.json 唯一形态源不变，读侧不再重复过闸；
    # 仅保留降级占位 None 的跳过）。
    normalized = dependencies_doc if isinstance(dependencies_doc, dict) else {}
    result = {}
    for entry in normalized.get("dependencies") or []:
        if not isinstance(entry, dict):
            continue
        source = str(entry.get("source") or "").strip()
        target = str(entry.get("target") or "").strip()
        relation_type = str(entry.get("type") or "DEPENDS_ON").strip()
        if not source or not target:
            continue
        result.setdefault((source, target, relation_type), []).append({
            "since": str(entry.get("since") or ""),
            "until": str(entry.get("until") or ""),
        })
    return result


def project_dependencies(master_path, component_ids, schema, dependencies_doc, target_version=None):
    if not os.path.exists(master_path):
        raise FileNotFoundError(f"master_graph.json not found: {master_path}")
    with open(master_path, "r", encoding="utf-8") as handle:
        graph = json.load(handle)
    nodes = graph.get("nodes", [])
    connections = graph.get("connections", graph.get("edges", []))
    endpoint_map = {}
    for node in nodes:
        if not isinstance(node, dict):
            continue
        node_id = str(node.get("id") or "").strip()
        props = node.get("properties", {}) if isinstance(node.get("properties"), dict) else {}
        architecture_id = str(
            props.get("architecture_node_id")
            or props.get("architecture-node-id")
            or node_id
        ).strip()
        if node_id:
            endpoint_map[node_id] = architecture_id

    allowed_ids = set(component_ids)
    allowed_relations = schema["projected_relation_types"]
    versioned = _load_versioned_dependencies(dependencies_doc)
    dependencies = []
    seen = set()
    for connection in connections:
        if not isinstance(connection, dict):
            continue
        relation_type = str(
            connection.get("relationType")
            or connection.get("relation_type")
            or connection.get("type")
            or ""
        ).strip().upper()
        if relation_type not in allowed_relations:
            continue
        source = endpoint_map.get(str(connection.get("from") or connection.get("source") or "").strip(), "")
        target = endpoint_map.get(str(connection.get("to") or connection.get("target") or "").strip(), "")
        if source not in allowed_ids or target not in allowed_ids:
            continue
        props = connection.get("properties", {}) if isinstance(connection.get("properties"), dict) else {}
        since = str(props.get("since") or connection.get("since") or "")
        until = str(props.get("until") or connection.get("until") or "")
        entries = versioned.get((source, target, relation_type), [])
        if not since and not until and entries:
            best = max(entries, key=lambda item: _parse_version(item.get("since")))
            since = best.get("since", "")
            until = best.get("until", "")
        if not _active_at(target_version, since, until):
            continue
        key = (source, target, relation_type)
        if key in seen:
            continue
        seen.add(key)
        dependency = {
            "from": source,
            "to": target,
            "label": str(connection.get("label") or ""),
            "color": str(connection.get("color") or ""),
            "relationType": relation_type,
        }
        if since:
            dependency["since"] = since
        if until:
            dependency["until"] = until
        dependencies.append(dependency)

    return dependencies


def _finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _read_layout(path):
    if not os.path.exists(path):
        return {"nodes": {}, "groups": {}}
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        return {
            "nodes": data.get("nodes", {}) if isinstance(data.get("nodes"), dict) else {},
            "groups": data.get("groups", {}) if isinstance(data.get("groups"), dict) else {},
        }
    except (OSError, json.JSONDecodeError):
        return {"nodes": {}, "groups": {}}


def _merge_box(default_box, existing_box):
    if not isinstance(existing_box, dict):
        return default_box
    merged = dict(default_box)
    for key in ("x", "y", "width", "height"):
        if _finite(existing_box.get(key)):
            merged[key] = existing_box[key]
    return merged


def build_layout(sa, schema, layout_path, reset=False):
    existing = {"nodes": {}, "groups": {}} if reset else _read_layout(layout_path)
    by_layer = {layer["id"]: [] for layer in schema["layers"]}
    for component in sa.get("components", []):
        by_layer.setdefault(component.get("layer", ""), []).append(component)

    groups = {}
    defaults = {}
    central_y = 80
    left_y = 80
    right_y = 80
    for layer in schema["layers"]:
        layout_kind = layer["layout"]
        items = sorted(by_layer.get(layer["id"], []), key=lambda item: (str(item.get("label") or ""), str(item.get("id") or "")))
        rows = max(1, math.ceil(len(items) / 4))
        if layout_kind == "left-panel":
            box = {"x": 25, "y": left_y, "width": 190, "height": max(180, 55 + len(items) * 62)}
            left_y += box["height"] + 18
            cols = 1
            node_width = 150
        elif layout_kind == "right-panel":
            box = {"x": 1075, "y": right_y, "width": 205, "height": max(180, 55 + len(items) * 62)}
            right_y += box["height"] + 18
            cols = 1
            node_width = 165
        else:
            box = {"x": 235, "y": central_y, "width": 820, "height": max(100, 55 + rows * 62)}
            central_y += box["height"] + 18
            cols = 4
            node_width = 170
        groups[layer["id"]] = _merge_box(box, existing["groups"].get(layer["id"]))
        for index, component in enumerate(items):
            row = index // cols
            col = index % cols
            defaults[component["id"]] = {
                "x": box["x"] + 20 + col * 190,
                "y": box["y"] + 40 + row * 62,
                "width": node_width,
                "height": 50,
            }

    nodes = {
        component_id: _merge_box(default_box, existing["nodes"].get(component_id))
        for component_id, default_box in defaults.items()
    }
    return {
        "version": sa.get("version", "1.0.0"),
        "product": schema["product"],
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "nodes": nodes,
        "groups": groups,
    }


def validate_artifacts(sa, layout, schema):
    if not isinstance(sa.get("components"), list) or not isinstance(sa.get("dependencies"), list):
        raise ValueError("semantic architecture components/dependencies must be arrays")
    # PR-082 裁项 2：product 空串＝元层态合法（通用槽无产品身份）；layers 结构仍必须合法
    if not isinstance(sa.get("layers"), list) or not isinstance(sa.get("product"), str):
        raise ValueError("semantic architecture layers/product are required")
    component_ids = set()
    for component in sa["components"]:
        component_id = str(component.get("id") or "").strip()
        if not component_id:
            raise ValueError("semantic architecture component id is required")
        if component_id in component_ids:
            raise ValueError(f"duplicate semantic architecture component id: {component_id}")
        component_ids.add(component_id)
        if component.get("layer") not in schema["valid_layers"]:
            raise ValueError(f"invalid semantic architecture layer: {component.get('layer')}")
    for dependency in sa["dependencies"]:
        if dependency.get("from") not in component_ids or dependency.get("to") not in component_ids:
            raise ValueError("semantic architecture dependency endpoint is missing")
        if dependency.get("relationType") not in schema["projected_relation_types"]:
            raise ValueError(f"invalid projected relation type: {dependency.get('relationType')}")
    if set(layout.get("nodes", {})) != component_ids:
        raise ValueError("architecture layout node ids do not match semantic architecture components")


def atomic_write_json(path, data):
    # 波5 批①：原语收口 write_gateway（尾部换行语义保持）
    write_text_atomic(path, json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def _sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_pipeline_version(vault_root, master_path, semantic_path, layout_path):
    # SPEC-012 WP-A：版本指纹迁 runtime-state.db（vault_root 参数保留签名兼容，不再写 vault 文件）
    import _runtime_state_db
    payload = {
        "pipeline_run_id": datetime.now(timezone.utc).isoformat(),
        "master_graph_sha256": _sha256(master_path),
        "semantic_architecture_sha256": _sha256(semantic_path),
        "architecture_layout_sha256": _sha256(layout_path),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    _runtime_state_db.upsert_pipeline_version(payload)
