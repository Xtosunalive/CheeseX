# Component: Schema-Loader
# @responsible: 为图谱抽取与约束校验提供类型定义——WP-049 L3（ADR-016 §四-2「装载收进同一宿主」）起
#   数据经版本化信封递入（vocab_envelope.load_envelope），本模块不再读词表 yaml；形态收口在
#   Node 侧装载入口完成（同一 theschema.registry 形态源，两侧引擎同构），信封指纹即来源收据。
# @inputs: VOCAB_ENVELOPE_PATH 信封（Node 拉起物化／dump-vocab-envelope.mjs 手工物化）、
#   contracts/theschema.registry.json（normalize_the_schema 写侧/对账用，非词表五件）
# @outputs: Python dict（模块注册表、本体定义、版本注册表）
# @context: A. 知识源上下文 (Vault Context)
"""枚举注册表取数器 — 从词表信封取类型定义

PR-053：normalize_the_schema 仍是 Python 侧形态咽喉（jsonschema 对 contracts/*.schema.json
严格校验＋脏节点局部降级），供写侧/对账消费；读侧取数自 WP-049 L3 起走信封（Node 侧装载
入口已在物化时过同一形态收口，收据随信封指纹下发）——Python 不再持有词表文件读取路径。
"""
import copy
import datetime
import json
import os

import jsonschema

from vocab_envelope import VocabEnvelope, VocabEnvelopeError, load_envelope

_REGISTRY = None
_ONTOLOGY = None
_VERSIONS = None
_ENVELOPE = None

# ── PR-053：TheSchema 形态收口——Python 侧唯一咽喉 ──
# 形态定义全仓唯一一份：contracts/theschema.registry.json 登记的 schema 文件与 Node 侧同源。
# 校验用 jsonschema（成熟库，不自造轮子）；降级语义镜像 Node（实例路径前两段丢脏节点，绝不整份拒绝）。
# realpath（非 abspath）：vault 侧经 A 类 symlink 调用时 __file__ 落在 vault 路径上，
# contracts 真身在 repo——与 kb_paths.theschema_dir 的 symlink 解析约定一致
_CONTRACTS_DIR = os.path.normpath(
    os.path.join(os.path.dirname(os.path.realpath(__file__)), "..", "..", "contracts")
)
_SCHEMA_CACHE = {}

# 跨语言形态对齐：PyYAML 将裸时间戳解析为 datetime/date，而 Node 侧 YAML 1.2 解析为字符串。
# 校验时把 datetime 视作 string 型，避免两侧对同一份文件得出不同形态结论。
_StringLike = (str, datetime.date, datetime.datetime)
_Pr7TypeChecker = jsonschema.Draft7Validator.TYPE_CHECKER.redefine(
    "string", lambda _checker, instance: isinstance(instance, _StringLike)
)
_TheSchemaValidator = jsonschema.validators.extend(
    jsonschema.Draft7Validator, type_checker=_Pr7TypeChecker
)


def _document_schema(name):
    """取 contracts/theschema.registry.json 登记的 schema 文件（与 Node 侧同一份文件）。"""
    if name not in _SCHEMA_CACHE:
        with open(os.path.join(_CONTRACTS_DIR, "theschema.registry.json"), "r", encoding="utf-8") as f:
            registry = json.load(f)
        entry = registry["documents"][name]
        with open(os.path.join(_CONTRACTS_DIR, entry["schema"]), "r", encoding="utf-8") as f:
            _SCHEMA_CACHE[name] = json.load(f)
    return _SCHEMA_CACHE[name]


def _drop_at(data, parts):
    """按原始路径前两段丢弃脏节点，ID 内的点不分割，数组位留 None 占位。"""
    head = parts[0]
    if len(parts) == 1:
        data.pop(head, None)
        return
    tail = parts[1]
    container = data.get(head)
    if isinstance(container, list):
        if isinstance(tail, int) and 0 <= tail < len(container):
            container[tail] = None
    elif isinstance(container, dict):
        container.pop(tail, None)


def _apply_lenient_coercion(name, data):
    """镜像 Node 宽容口径：仅 schema x-lenientPaths 声明的顶层键接受标量→数组无损转化（策略随 schema 走，不散落代码）。"""
    schema = _document_schema(name)
    trail = []
    scalar_types = set(schema.get("x-lenientScalarTypes") or ["string"])
    for path_expr in schema.get("x-lenientPaths") or []:
        key = path_expr.lstrip("/").split("/")[0]
        container = data.get(key)
        if not isinstance(container, dict):
            continue
        for sub_key, raw in list(container.items()):
            if isinstance(raw, list):
                continue
            if isinstance(raw, str) and "string" in scalar_types:
                container[sub_key] = [raw]
                trail.append({"path": f"{key}.{sub_key}", "from": "string", "to": "array", "value": [raw]})
    return trail


def normalize_the_schema(name, document):
    """读侧形态收口（PR-053 Python 唯一咽喉）：宽容转化 → 严格校验 → 局部降级。

    返回 (data, normalizationTrail, degradedNodes)。非对象入参返回空收口结果。
    """
    if not isinstance(document, dict):
        return {}, [], []
    data = copy.deepcopy(document)
    trail = _apply_lenient_coercion(name, data)
    validator = _TheSchemaValidator(_document_schema(name))
    degraded = []
    seen = set()
    for error in validator.iter_errors(data):
        parts = tuple(error.absolute_path)[:2]
        if not parts or parts in seen:
            continue
        seen.add(parts)
        dotted = ".".join(str(p) for p in parts)
        degraded.append({"path": dotted, "path_parts": list(parts), "message": error.message})
        _drop_at(data, parts)
    return data, trail, degraded


def _envelope():
    """进程内单例信封（拉起时物化，内容在整个进程生命周期内不变——与旧单次装载缓存同寿）。"""
    global _ENVELOPE
    if _ENVELOPE is None:
        _ENVELOPE = load_envelope()
    return _ENVELOPE


def reset_envelope_cache():
    """测试注入口：更换信封后清缓存（生产代码不调——信封由拉起点一次性物化）。"""
    global _ENVELOPE, _REGISTRY, _VERSIONS, _ONTOLOGY
    _ENVELOPE = None
    _REGISTRY = None
    _VERSIONS = None
    _ONTOLOGY = None


def load_the_schema(name, filename=None):
    """按注册表名取词表文档，pipeline 各脚本统一取数入口。

    WP-049 L3（ADR-016 §四-2 同宿主裁决）：数据经版本化信封递入，本函数不再读词表文件。
    返回 (data, normalizationTrail, degradedNodes) 三元组（签名保持）；trail/degraded 恒空——
    形态收口已在 Node 侧装载时完成（同一 contracts/theschema.registry 形态源），收据＝信封指纹。
    信封缺件＝空文档（与旧「文件缺失返回空收口结果」语义对齐）；信封本身缺失/坏＝显式失败
    不回落自读（VocabEnvelopeError 上抛——旧实现静默吞解析错误的宽面已由 Node 侧装载 fail-closed 收口）。
    filename 参数保留签名兼容（信封按注册名取件，忽略文件名）。
    """
    envelope = _envelope()
    doc = envelope.try_doc(name)
    data = doc if isinstance(doc, dict) else {}
    # 降级收据透传（WP-049 L3）：path_parts 形态与旧装载器一致——消费面（如
    # ontology_relation_lifecycle 的 invalid 标记/产出闸）行为保持。
    degraded = [
        {"path": node["path"], "path_parts": list(node["pathParts"]), "message": ""}
        for node in envelope.degraded(name)
    ]
    return data, [], degraded


def _load():
    global _REGISTRY
    if _REGISTRY:
        return _REGISTRY
    _REGISTRY, _, _ = load_the_schema("enums")
    return _REGISTRY


def domains():
    return _load().get("domains", {})


def subdomains():
    """ADR-008 D1 子域词条归一（与 Node enums-loader.normalizeSubdomainEntries 同口径）：
    裸标量（legacy）→ {id}；对象直通（trim id，label/description 原样保留）；
    非串非对象条目防御性丢弃；null = 域预留位语义原样保留。
    消费方拿到的恒为 {domain: [entry] | None}，entry 至少含字符串 id。"""
    raw = _load().get("subdomains", {})
    if not isinstance(raw, dict):
        return {}
    normalized = {}
    for domain_id, entries in raw.items():
        if entries is None:
            normalized[domain_id] = None
            continue
        if not isinstance(entries, list):
            normalized[domain_id] = []
            continue
        collected = []
        for item in entries:
            if isinstance(item, str):
                if item.strip():
                    collected.append({"id": item.strip()})
            elif isinstance(item, dict):
                item_id = item.get("id")
                if isinstance(item_id, str) and item_id.strip():
                    entry = {"id": item_id.strip()}
                    if item.get("label") is not None:
                        entry["label"] = item["label"]
                    if item.get("description") is not None:
                        entry["description"] = item["description"]
                    collected.append(entry)
        normalized[domain_id] = collected
    return normalized


def products():
    registry = _load()
    result = set()
    configured = registry.get("products", [])
    if isinstance(configured, list):
        result.update(item.strip() for item in configured if isinstance(item, str) and item.strip())
    projection = registry.get("architecture_projection", {})
    if isinstance(projection, dict):
        product = projection.get("product")
        if isinstance(product, str) and product.strip():
            result.add(product.strip())
    module_registry = registry.get("modules", {})
    if isinstance(module_registry, dict):
        for definition in module_registry.values():
            if not isinstance(definition, dict):
                continue
            module_products = definition.get("products", [])
            if isinstance(module_products, list):
                result.update(item.strip() for item in module_products if isinstance(item, str) and item.strip())
    return result


def modules():
    return _load().get("modules", {})


def module_names():
    return set(modules().keys())


def article_types():
    return set(_load().get("article_types") or [])


def doc_types():
    return set(_load().get("doc_types") or [])


def tags():
    all_tags = set()
    for group in (_load().get("tags") or {}).values():
        all_tags.update(group)
    return all_tags


def _module_field_map(field):
    # subdomain/system 在契约（enums.schema.json／theschema.subject-enums.schema.json）里均为可选键：
    # 缺省映射 None（消费方 extract_graph 对 None 已守卫），非对象定义跳过——与 products() 同口径。
    return {k: v.get(field) for k, v in modules().items() if isinstance(v, dict)}


def module_subdomain_map():
    return _module_field_map("subdomain")


def module_system_map():
    return _module_field_map("system")


def _parse_version(v):
    """将版本字符串转为可比较的整数元组，如 '7.0.6.8' → (7,0,6,8)"""
    if not v:
        return None
    try:
        return tuple(int(x) for x in str(v).strip().split("."))
    except:
        return None


def module_version_range(mod_name):
    """返回 (since_tuple, until_tuple)，None 表示无限制"""
    raw = modules().get(mod_name, {})
    since = raw.get("since", "")
    until = raw.get("until", "")
    return (_parse_version(since) if since else None,
            _parse_version(until) if until else None)


def modules_for_version(version_str):
    """返回适用于给定版本的所有 module 名称列表"""
    ver = _parse_version(version_str)
    result = []
    for mname, info in modules().items():
        since = _parse_version(info.get("since", ""))
        until = _parse_version(info.get("until", ""))
        if since and ver and ver < since:
            continue
        if until and ver and ver > until:
            continue
        result.append(mname)
    return result


def lifecycle():
    return _load().get("lifecycle", {})


def status_values():
    return set((lifecycle() or {}).get("status") or [])


def review_cycle_values():
    return set((lifecycle() or {}).get("review_cycle") or [])


def category_map():
    return _load().get("category_map", {})


def tag_governance():
    """G7（PR-020 批4）：标签治理键单点装载——disabled_tags（停用）/ tag_aliases（别名归一）。
    消费方（extract_graph._frontmatter_tags）禁止自行解析词表（C6 单一装载器原则；装载宿主＝Node 信封）。
    PR-053：形态由咽喉保证（disabled_tags 串、tag_aliases 键值对象），手写 isinstance 兜底退役。"""
    data = _load()
    return {
        "disabled": {str(t).strip() for t in (data.get("disabled_tags") or []) if str(t).strip()},
        "aliases": data.get("tag_aliases") or {},
    }


def architecture_projection():
    return _load().get("architecture_projection", {})


def architecture_aliases():
    """返回三类架构字段的 alias -> canonical 映射。
    PR-053：形态由咽喉保证（projection 键值对象），手写 isinstance 兜底退役。"""
    projection = architecture_projection()
    result = {}
    for field, key in (
        ("arch_layer", "layer_aliases"),
        ("arch_category", "category_aliases"),
        ("arch_subdomain", "subdomain_aliases"),
    ):
        result[field] = projection.get(key) or {}
    return result


def normalize_architecture_value(field, value):
    """将 Entity raw 值归一化为 Schema canonical 值，来源值由调用方另行保留。"""
    raw = str(value or "").strip()
    aliases = architecture_aliases().get(field, {})
    return str(aliases.get(raw, raw) or "").strip()


def projected_relation_types():
    """返回进入 semantic_architecture.json 的关系类型白名单。"""
    return set(architecture_projection().get("projected_relation_types") or [])


# ── G1+G5（PR-020 批5）：产品身份统一解析——单一入口，图谱侧/校验侧同调 ──

def _load_versions_registry():
    """产品/版本/别名注册表。缓存单次加载（WP-049 L3 起经信封取数）。"""
    global _VERSIONS
    if _VERSIONS is None:
        _VERSIONS, _, _ = load_the_schema("versions")
    return _VERSIONS


def resolve_product_identity(raw):
    """产品身份统一解析（G1+G5 后端单源，JS 侧 resolveArchitectureProduct 与本函数行为对齐）。

    输入任意产品字面值（frontmatter 原文/别名/注册键/保留键），返回：
      {"canonical": str, "registered": bool, "reserved": bool}
    - canonical：注册键（词表 versions 的 products 键）经 product_aliases 归一后的展示全名；
      未注册且非保留 → 原值透传（调用方按 unregistered 标记处置，不丢弃）。
    - registered：注册表命中（经别名或键直连）。
    - reserved：命中 reserved_products（如「通用」=跨产品占位，不建 Product 节点）。
    """
    raw_text = str(raw or "").strip()
    if not raw_text:
        return {"canonical": "", "registered": False, "reserved": False}
    registry = _load_versions_registry()
    reserved = {str(r).strip() for r in registry.get("reserved_products") or [] if str(r).strip()}
    if raw_text in reserved:
        return {"canonical": raw_text, "registered": False, "reserved": True}
    product_keys = {str(k).strip() for k in registry.get("products", {}).keys() if isinstance(k, str)}
    aliases = architecture_projection().get("product_aliases") or {}
    # ①别名键直连（AS→AnyShare：别名表是完整归一链，独立成立）
    if raw_text in aliases:
        target = str(aliases[raw_text]).strip()
        if target:
            return {"canonical": target, "registered": True, "reserved": False}
    # ②注册键（As）：经别名表大小写不敏感反查其目标全名（AS→AnyShare 先例），无映射则原样
    if raw_text in product_keys:
        canonical = raw_text
        for alias_key, target in aliases.items():
            if alias_key.lower() == raw_text.lower():
                canonical = str(target).strip() or raw_text
                break
        return {"canonical": canonical, "registered": True, "reserved": False}
    # ③展示全名（AnyShare）：在注册表派生集（products()/别名目标）中即视为注册
    known_full_names = {str(t).strip() for t in aliases.values() if str(t).strip()}
    if raw_text in known_full_names or raw_text in products():
        return {"canonical": raw_text, "registered": True, "reserved": False}
    # ④未注册：原值透传（调用方按 unregistered 标记处置，不丢弃）
    return {"canonical": raw_text, "registered": False, "reserved": False}


def wikilink_type_map():
    """返回 entity 正文 typed wikilink 中文触发词 → relationType 的唯一配置映射。"""
    configured = architecture_projection().get("wikilink_type_labels") or {}

    allowed = set(ontology_relation_types().keys())
    result = {}
    for label, relation_type in configured.items():
        if not isinstance(label, str) or not isinstance(relation_type, str):
            continue
        label = label.strip()
        relation_type = relation_type.strip()
        if not label or not relation_type:
            continue
        if relation_type not in allowed:
            continue
        result[label] = relation_type
    return result


# ── 本体（ontology）加载 ──

def _get_ontology():
    """正文与降级诊断一同缓存、失效；空文档沿用原有重试。"""
    global _ONTOLOGY
    if _ONTOLOGY is None or not _ONTOLOGY[0]:
        _ONTOLOGY = load_the_schema("ontology")
    return _ONTOLOGY[0]


def _approved_ontology_entries(section):
    raw = _get_ontology().get(section, {})
    if not isinstance(raw, dict):
        return {}
    return {
        element_id: definition
        for element_id, definition in raw.items()
        if isinstance(definition, dict) and definition.get("lifecycle_status", "approved") == "approved"
    }


def ontology_node_types():
    """返回进入新产出与活消费面的现役节点类型。"""
    return _approved_ontology_entries("node_types")


def ontology_relation_types():
    """返回进入新产出与活消费面的现役关系类型。"""
    return _approved_ontology_entries("relation_types")


def ontology_relation_lifecycle():
    """返回全部已定义关系类型的生命周期状态 {id: status}（降级定义标 invalid）。

    产出侧据此判定「已定义但非 approved」——这类关系不得进入新产出（ADR-014 §4）。
    未定义关系不在本映射内：它们的产出准入由断言政策缺省 pending 兜底，不在生命周期闸。
    """
    raw = _get_ontology().get("relation_types", {})
    if not isinstance(raw, dict):
        raw = {}
    result = {
        element_id: _relation_lifecycle_status(definition)
        for element_id, definition in raw.items()
    }
    for node in _ONTOLOGY[2]:
        parts = node["path_parts"]
        if len(parts) == 2 and parts[0] == "relation_types":
            result[parts[1]] = "invalid"
    return result


def _relation_lifecycle_status(definition):
    """缺省 approved；显式非字符串/空值（手改 YAML 可达）→ invalid（fail-closed 拒产）。"""
    if not isinstance(definition, dict):
        return "invalid"
    status = definition.get("lifecycle_status", "approved")
    return status if isinstance(status, str) and status.strip() else "invalid"


def resolve_ontology_reference(section, original_id):
    """ADR-014 §5.2：只读归一同类型替代链；失败携带原因、原始 ID 和已访问链。"""
    ontology = _get_ontology()
    registry = ontology.get(section, {})
    chain = [original_id]

    def fail(code, reason):
        # 原因码与 Node normalizeRetiredReference 对齐，失败路径同样保留全链供调用方报告。
        raise ValueError(
            f"{code}: section={section!r}, original_id={original_id!r}, "
            f"replacement_chain={chain!r}: {reason}"
        )

    if not isinstance(registry, dict):
        fail("INVALID_REGISTRY", "替代链注册表必须为对象")
    if not isinstance(original_id, str) or not original_id:
        fail("INVALID_ELEMENT_ID", "原始 ID 必须为非空字符串")
    visited = set()
    current_id = original_id
    while True:
        if current_id in visited:
            fail("REPLACEMENT_CYCLE", f"替代链在 {current_id!r} 成环")
        visited.add(current_id)
        if current_id not in registry:
            # ID 属于所在段；只识别跨类型错误，不从其它段取定义或猜替代。
            for other_section, entries in ontology.items():
                if other_section == section:
                    continue
                if isinstance(entries, dict):
                    found = current_id in entries
                elif isinstance(entries, list):
                    found = any(isinstance(entry, dict) and entry.get("id") == current_id for entry in entries)
                else:
                    found = False
                if found:
                    fail("CROSS_TYPE_REPLACEMENT", f"{current_id!r} 属于其它类型 {other_section!r}")
            code = "UNKNOWN_ELEMENT" if len(chain) == 1 else "DANGLING_REPLACEMENT"
            fail(code, f"未找到 {current_id!r} 的定义")
        definition = registry[current_id]
        if not isinstance(definition, dict):
            fail("INVALID_ELEMENT_DEFINITION", f"{current_id!r} 的定义必须为对象")
        status = definition.get("lifecycle_status", "approved")
        if status == "approved":
            return {"original_id": original_id, "resolved_id": current_id, "replacement_chain": chain.copy()}
        if status != "retired":
            fail("NO_APPROVED_REPLACEMENT", f"终点 {current_id!r} 非现役，lifecycle_status={status!r}")
        retirement = definition.get("retirement")
        replaced_by = retirement.get("replaced_by") if isinstance(retirement, dict) else None
        if not isinstance(replaced_by, str) or not replaced_by:
            fail("MISSING_REPLACEMENT", f"退役元素 {current_id!r} 缺少非空 replaced_by")
        chain.append(replaced_by)
        if replaced_by == current_id:
            fail("REPLACEMENT_SELF_REFERENCE", f"退役元素 {current_id!r} 指向自身")
        current_id = replaced_by


def normalize_node_label(label):
    """历史标签归一；未知标签仍返回 None，已定义但不可归一的标签显式报错。"""
    if not isinstance(label, str) or label not in _get_ontology().get("node_types", {}):
        return None
    return resolve_ontology_reference("node_types", label)["resolved_id"]


def infer_node_type_from_labels(labels):
    """从 labels 数组推断主要节点类型，历史退役类只读归一到现役替代。"""
    if not labels:
        return normalize_node_label("Entity") or "Entity"
    for label in labels:
        resolved = normalize_node_label(label)
        if resolved is not None:
            return resolved
    # 仅未知标签可沿用原有兜底；已定义的坏链/非现役类已由归一入口报错。
    return labels[0]


def validate_relation(source_label, target_label, relation_type):
    """只读校验历史关系与端点，返回 (valid, warning, error)，不用于新产出准入。"""
    try:
        resolved = resolve_ontology_reference("relation_types", relation_type)
        rule = _get_ontology().get("relation_types", {})[resolved["resolved_id"]]
        source = resolve_ontology_reference("node_types", source_label)["resolved_id"]
        target = resolve_ontology_reference("node_types", target_label)["resolved_id"]
        # 先校验规则的全部引用，不能因现役端点命中而掩盖列表里其它非现役/坏链。
        source_types = [resolve_ontology_reference("node_types", label)["resolved_id"]
                        for label in rule.get("source_types", [])]
        target_types = [resolve_ontology_reference("node_types", label)["resolved_id"]
                        for label in rule.get("target_types", [])]
    except ValueError as error:
        return False, f"关系 {relation_type} 归一失败: {error}", True
    src_ok = source in source_types
    tgt_ok = target in target_types
    if not src_ok and not tgt_ok:
        return False, f"关系 {relation_type} 不兼容: {source_label} → {target_label}", False
    if not src_ok:
        return False, f"关系 {relation_type} 的 source 类型应为 {source_types}，当前为 {source_label}", False
    if not tgt_ok:
        return False, f"关系 {relation_type} 的 target 类型应为 {target_types}，当前为 {target_label}", False
    return True, "", False
