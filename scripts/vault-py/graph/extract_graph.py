#!/usr/bin/env python3
# Component: Graph-Extractor
# @responsible: 扫描 Vault 全文，执行 R1-R5 五条晋升规则，产出全量物理图谱。R5 Plate 三轴门控在此实现
# @inputs: Fact-Store (entities, concepts, documents) + 词表（enums/dependencies/ontology，经信封）
# @outputs: `master_graph.json`（原子写入：tmp + rename）
# @context: B. 逻辑中枢上下文 (Pipeline Context)
# contract: writes master_graph.json, master_graph.db, extract_manifest.json, latest_change_log.json, graph_data.json
# contract: reads DOC_ENVELOPE_PATH（文档信封——vault .md 唯一供给面，WP-117 批2／SPEC-084 §二.1；零 .md 直读）, 词表 enums/dependencies/ontology（经信封——WP-049 L3／WP-138 R1 零词表文件直读）
"""
知识图谱数据提取脚本 — 7 节点 + 7 边属性图模型
职责边界：本脚本生成大而全的 master_graph.json，可包含文档、概念、领域、版本和图数据库语义关系。
主架构画布投影由 generate-sa.py / semantic_architecture.json 负责，不在本脚本中收窄。
用法:
  python3 extract_graph.py                          # 预览统计（不写入）
  python3 extract_graph.py --apply                  # 写入架构图 JSON
  python3 extract_graph.py --apply --incremental    # Vault 未变化时跳过全量重建（指纹= mtime_ns＋内容短哈希）
  # force 全量重建＝不带 --incremental（D4：维护通道语义；due 自动执行恒走 --incremental）
  python3 extract_graph.py --apply --cache          # 同时写入 graph_data.json 缓存
  python3 extract_graph.py --apply --create-stubs   # 显式创建缺失实体占位页
  python3 extract_graph.py --apply --keep-orphan-concepts  # 保留历史「无概念页」占位 concept 节点（默认会清理）
  python3 extract_graph.py --validate               # 预览 + 验证图完整性

环境变量 ``KB_VAULT`` 默认为 ``~/Obsidian Vault``（Obsidian **仓库根**）。Schema/wiki/raw 从
``<仓库根>/知识库`` 读取；兼容旧用法：若 ``KB_VAULT`` 仍设为 ``…/知识库``，脚本会自动识别。
"""

from __future__ import annotations
# W1 迁仓闭包（SPEC-025 C1/C12）：本地模块解析——vault-runtime（A 类：kb_paths/schema_loader）与
# 相邻 content/（article_admission_manifest 提前随迁——闭包驱动，原 W3 白名单件）。vault 侧不再有本地依赖。
import sys as _sys
from pathlib import Path as _Path
_HERE = _Path(__file__).resolve().parent
for _dep in (_HERE.parent / "content", _HERE.parents[1] / "vault-runtime"):
    _s = str(_dep)
    if _s not in _sys.path:
        _sys.path.insert(0, _s)

import json
import hashlib
import os
import re
import sys
import time
from pathlib import Path
from datetime import datetime

import yaml

from kb_paths import vault_roots, ledger_dir

VAULT_ROOT, VAULT = vault_roots()

# ── 文档信封入口收权（WP-117 批2／SPEC-084 §二.1／ADR-016 §四-2）──
# 本文件对 vault .md 的全部消费（fm／body／sha／遍历清单）改由文档信封供给：进程入口解析
# DOC_ENVELOPE_PATH→load_doc_envelope，缺失／版本／形态异常即报错退出——不回落直读（零回落）。
# 报错附物化指引；DocEnvelopeError 的 raise 即信封接收器 fail-closed 面。
from doc_envelope import DocEnvelopeError, load_doc_envelope as _load_doc_envelope

_DOC_ENVELOPE_STATE = {"path": None, "envelope": None}


def _load_doc_envelope_fail_closed():
    try:
        return _load_doc_envelope()
    except DocEnvelopeError as error:
        print(
            f"DOC_ENVELOPE_FAIL_CLOSED: {error}\n"
            "  物化指引：server/shared/doc-envelope-materializer.cjs writeDocEnvelope"
            "（vault-runtime 拉起 docEnvelope:true 自动物化）；手工运行"
            " node scripts/vault-runtime/dump-doc-envelope.mjs --vault <库根>。"
            "Python 不回落直读 vault .md。",
            file=sys.stderr,
        )
        raise SystemExit(2)


def _doc_envelope():
    """信封取用口：进程入口已强制装载（下方）；此后缓存随 DOC_ENVELOPE_PATH 变化重载
    （测试夹具换库换信封同帧生效——信封是本次装载产出，路径不变不重载）。"""
    path = os.environ.get("DOC_ENVELOPE_PATH")
    if _DOC_ENVELOPE_STATE["envelope"] is None or _DOC_ENVELOPE_STATE["path"] != path:
        _DOC_ENVELOPE_STATE["path"] = path
        _DOC_ENVELOPE_STATE["envelope"] = _load_doc_envelope_fail_closed()
    return _DOC_ENVELOPE_STATE["envelope"]


# 进程入口强制装载（fail-closed 零回落：信封不可用即退出，不进任何直读路径）
_DOC_ENVELOPE_STATE["envelope"] = _load_doc_envelope_fail_closed()
_DOC_ENVELOPE_STATE["path"] = os.environ.get("DOC_ENVELOPE_PATH")


def _doc_envelope_root():
    """信封根＝Node 拉起点物化时的 vaultPath（vault-runtime-spawn 同值写入 KB_VAULT）——
    按 kb_paths.vault_roots 同款推导还原（abspath+expanduser；缺省推导＝仓库根）。"""
    raw = os.environ.get("KB_VAULT")
    if raw:
        return os.path.abspath(os.path.expanduser(raw))
    return VAULT_ROOT


def _doc_kb_rel(doc):
    """信封文档 → 知识库（VAULT）相对 POSIX 路径；知识库子树外文件 → None（各根前缀过滤
    自然排除——信封是全语料承诺，含库根层非知识库 .md，消费根过滤保留原口径）。"""
    rel = os.path.relpath(os.path.join(_doc_envelope_root(), doc["path"]), VAULT)
    if rel == os.pardir or rel.startswith(os.pardir + os.sep):
        return None
    return rel.replace(os.sep, "/")


def _doc_abs(kb_rel):
    """知识库相对路径 → 绝对路径（stat／relpath 消费用；信封口径不读内容）。"""
    return os.path.normpath(os.path.join(VAULT, kb_rel))


def _doc_envelope_flat_md_docs(prefix):
    """prefix（知识库相对）下直接子 .md 文档（对齐 os.listdir 顶层口径——不下钻子目录），
    按文件名排序。返回 [(fname, kb_rel, doc)]。"""
    out = []
    envelope = _doc_envelope()
    prefix = prefix.strip("/") + "/"
    for rel in envelope.paths():
        hit = envelope.get_document(rel)
        if hit["state"] != "present":
            continue
        kb_rel = _doc_kb_rel(hit["value"])
        if kb_rel is None or not kb_rel.startswith(prefix):
            continue
        rest = kb_rel[len(prefix):]
        if "/" in rest or not rest.endswith(".md"):
            continue
        out.append((rest, kb_rel, hit["value"]))
    return sorted(out, key=lambda item: item[0])


def _doc_envelope_walk_md_docs(prefix, skip_dir_names=()):
    """os.walk 分组语义的信封等价（WP-117 批2）：按目录分组产出
    [(dir_kb_rel, [(fname, kb_rel, doc), ...])]——父目录先于子目录、目录与目录内文件均取
    字典稳定序（原 scandir 目录序平台相关非契约，如实记；目录内 sorted(files) 语义保持）。
    skip_dir_names 剪目录名（任意层，对齐 os.walk dirs[:] 剪枝；文件名不受剪——walk files
    列语义；walk 根目录名自身不在剪枝面）。prefix 为知识库相对路径；子树外/空树产出 []。"""
    groups = {}
    envelope = _doc_envelope()
    prefix = prefix.strip("/") + "/"
    for rel in envelope.paths():
        hit = envelope.get_document(rel)
        if hit["state"] != "present":
            continue
        kb_rel = _doc_kb_rel(hit["value"])
        if kb_rel is None or not kb_rel.startswith(prefix) or not kb_rel.endswith(".md"):
            continue
        cut = kb_rel.rfind("/")
        dir_rel, fname = kb_rel[:cut], kb_rel[cut + 1:]
        rel_below = dir_rel[len(prefix):]
        if rel_below and any(seg in skip_dir_names for seg in rel_below.split("/")):
            continue
        groups.setdefault(dir_rel, []).append((fname, kb_rel, hit["value"]))
    return [(dir_rel, sorted(docs, key=lambda item: item[0])) for dir_rel, docs in sorted(groups.items())]


def _doc_envelope_md_docs_under(prefix, skip_dir_names=(), skip_dot_dirs=False):
    """prefix（知识库相对）子树内 .md 文档（对齐 os.walk 口径）：skip_dir_names 剪目录名
    （任意层，对齐 os.walk dirs[:] 剪枝；文件名不受剪——walk files 列语义）；skip_dot_dirs
    剪「.」起头目录名（concepts 口径 not d.startswith(".")）。按路径排序返回
    [(kb_rel, doc)]——原遍历面 sorted(绝对路径) 与此同序（前缀同 → 相对序同）。"""
    out = []
    envelope = _doc_envelope()
    prefix = prefix.strip("/") + "/"
    for rel in envelope.paths():
        hit = envelope.get_document(rel)
        if hit["state"] != "present":
            continue
        kb_rel = _doc_kb_rel(hit["value"])
        if kb_rel is None or not kb_rel.startswith(prefix):
            continue
        segments = kb_rel.split("/")
        dir_segments = segments[:-1]  # 末段是文件名——walk 剪枝只作用于目录
        if skip_dot_dirs and any(seg.startswith(".") for seg in dir_segments):
            continue
        if any(seg in skip_dir_names for seg in dir_segments):
            continue
        out.append((kb_rel, hit["value"]))
    return sorted(out, key=lambda item: item[0])

# 工件落点单源（SPEC-012 wave-2 类消收敛，随包直提 2026-10-15）：staging 落点推导唯一入口＝
# kb_paths.staging_dir（A 类 symlink→cheeseh-runtime 快照，含本函数）。此前本地独立实现为
# 五份散布推导之一（wave-2 漏改点族温床）；收敛后与 runner/generate-sa/状态库同一入口，
# 搬家只改 kb_paths 一处。目录创建职责保留在此（写方语义，单源只管地址）。
from kb_paths import staging_dir as _staging_dir_src


def _staging_dir():
    _p = _staging_dir_src()
    os.makedirs(_p, exist_ok=True)
    return _p

_STAGING = _staging_dir()
MASTER_JSON = os.path.join(_STAGING, "master_graph.json")
INCREMENTAL_MANIFEST = os.path.join(_STAGING, "extract_manifest.json")
EXTRACT_ERRORS_JSON = os.path.join(_STAGING, "extract_errors.json")
OUTPUT = os.path.join(os.path.dirname(__file__), "graph_data.json")
# WP-049 L3（ADR-016 §四-2 同宿主裁决）：依赖规则等词表数据经 schema_loader→信封取数
# （load_deps_yaml），本文件不再构造词表文件路径（原 _deps_yaml_path/DEPS_YAML 删除——
# PR-158 的同源解析诉求由「Node 装载入口物化信封」在结构上兑现：钉扎/活库解析全在 Node 侧）。

sys.path.insert(0, os.path.dirname(__file__))
import schema_loader
from article_admission_manifest import load_admitted_precleaned_paths

ADMISSION_COORDINATES = {}

# ── 词表枚举（经信封）──

DOMAIN_INFO = schema_loader.domains()
SUBDOMAIN_INFO = schema_loader.subdomains()
MODULE_SUBDOMAIN_MAP = schema_loader.module_subdomain_map()
MODULE_SYSTEM_MAP = schema_loader.module_system_map()
CATEGORY_MAP = schema_loader.category_map()
ARCH_PROMOTION_TAGS = {"Arch/Component", "#Arch/Component", "arch/component"}
MASTER_GRAPH_FORMAT_VERSION = "1.0"
DERIVATION_RULE_REVISION = "sha256:" + hashlib.sha256(Path(__file__).read_bytes()).hexdigest()


def _node_input_coordinate(node):
    props = node.get("properties", {}) if isinstance(node, dict) else {}
    node_id = str(node.get("id", "unknown"))
    source_path = str(props.get("file_path") or props.get("source_path") or "").replace("\\", "/").strip()
    if source_path:
        return f"vault:{source_path}#node:{node_id}"
    traces = props.get("extraction_trace") if isinstance(props.get("extraction_trace"), list) else []
    rule_id = next((str(item.get("rule_id")) for item in traces if isinstance(item, dict) and item.get("rule_id")), "unknown-rule")
    origin = next((str(item.get("detail")) for item in traces if isinstance(item, dict) and item.get("stage") == "origin" and item.get("detail")), "unknown-origin")
    return f"derived-input:{rule_id}:{node_id}:{origin}"


def apply_derived_relation_lineage(edge, nodes_by_id):
    props = edge.setdefault("properties", {})
    sources = props.get("sources") if isinstance(props.get("sources"), list) else []
    if sources or props.get("reviewStatus") != "approved":
        return
    generator = str(props.get("source") or edge.get("type") or "unknown-generator").strip()
    source_id = edge.get("source") or edge.get("from")
    target_id = edge.get("target") or edge.get("to")
    coordinates = [
        _node_input_coordinate(nodes_by_id.get(source_id, {"id": source_id})),
        _node_input_coordinate(nodes_by_id.get(target_id, {"id": target_id})),
    ]
    if props.get("decisionId"):
        coordinates.append(f"decision:{props['decisionId']}")
    if props.get("articleId"):
        coordinates.append(f"article:{props['articleId']}@{props.get('candidateSourceHash') or 'unknown-revision'}")
    # document-body 边不产出 ruleId：消费端按 source_kind 显式兜底到
    # extract_graph.plain_wikilink（仓库白名单不含 extract_graph.document-body，ADR009 G2 fail-closed）
    if generator != "document-body":
        props["ruleId"] = props.get("ruleId") or f"extract_graph.{generator}"
    props["ruleRevision"] = props.get("ruleRevision") or DERIVATION_RULE_REVISION
    props["inputCoordinates"] = list(dict.fromkeys(str(item) for item in coordinates if item))


def _edge_first_source(conn):
    props = conn.get("properties", {}) if isinstance(conn, dict) else {}
    sources = props.get("sources", []) if isinstance(props, dict) else []
    if isinstance(sources, list) and sources and isinstance(sources[0], dict):
        return sources[0]
    return {}


def _edge_evidence_text(conn):
    props = conn.get("properties", {}) if isinstance(conn, dict) else {}
    src = _edge_first_source(conn)
    return (
        conn.get("evidenceText")
        or conn.get("evidence_text")
        or (props.get("evidenceText") if isinstance(props, dict) else "")
        or (props.get("evidence_text") if isinstance(props, dict) else "")
        or src.get("evidence_text")
        or src.get("evidenceText")
        or ""
    )


def _edge_evidence_hash(conn):
    props = conn.get("properties", {}) if isinstance(conn, dict) else {}
    explicit = (
        conn.get("evidenceHash")
        or conn.get("evidence_hash")
        or (props.get("evidenceHash") if isinstance(props, dict) else "")
        or (props.get("evidence_hash") if isinstance(props, dict) else "")
        or ""
    )
    if explicit:
        return str(explicit).strip()
    evidence = str(_edge_evidence_text(conn)).strip()
    if not evidence:
        return ""
    return hashlib.sha1(evidence.encode("utf-8")).hexdigest()[:16]


def _source_sha256(doc):
    """源文档 sha256 收据——信封直取（WP-117 批2：不再读文档文件）。信封 sha256＝交付文本
    （utf-8 编码）指纹，utf-8 文件与原文件字节哈希恒等；非 utf-8 文件为编码链解码后文本的收据
    （Node 侧 decodeDocumentBytes 注记）。doc＝信封 documents 成员（{sha256, sha16, ...}）。"""
    return "sha256:" + doc["sha256"]


def _edge_source_file(conn):
    props = conn.get("properties", {}) if isinstance(conn, dict) else {}
    src = _edge_first_source(conn)
    return str(
        conn.get("sourceFile")
        or conn.get("source_file")
        or src.get("file")
        or (props.get("sourceFile") if isinstance(props, dict) else "")
        or (props.get("source_file") if isinstance(props, dict) else "")
        or ""
    ).strip()


def _edge_source_hash(conn):
    props = conn.get("properties", {}) if isinstance(conn, dict) else {}
    src = _edge_first_source(conn)
    return str(
        conn.get("sourceHash")
        or conn.get("source_hash")
        or (props.get("sourceHash") if isinstance(props, dict) else "")
        or (props.get("source_hash") if isinstance(props, dict) else "")
        or src.get("sourceHash")
        or src.get("source_hash")
        or ""
    ).strip()


def _edge_line_number(conn):
    props = conn.get("properties", {}) if isinstance(conn, dict) else {}
    src = _edge_first_source(conn)
    value = (
        conn.get("lineNumber")
        or conn.get("line_number")
        or (props.get("lineNumber") if isinstance(props, dict) else None)
        or (props.get("line_number") if isinstance(props, dict) else None)
        or src.get("line_number")
        or src.get("lineNumber")
        or ""
    )
    try:
        n = int(value)
    except (TypeError, ValueError):
        return ""
    return str(n) if n > 0 else ""


def _edge_stable_id(conn):
    # WP-053 V-B（红队发现 C 清偿）：边持久身份经身份入口（长度前缀编码）——本值 :3100 持久化进
    # master_graph.json；与 JS stableEdgeId 字节同构。过渡期存量图混形态：读路径（JS decorateEdge）
    # 按段重算＋legacy 兼容面（见 edge-identity.cjs）不受影响；--force 全量重建自然翻新。
    from identity_port import make_id
    return make_id("edge-id", [
        str(conn.get("from") or conn.get("source") or "").strip(),
        str(conn.get("to") or conn.get("target") or "").strip(),
        str(conn.get("relationType") or conn.get("type") or "").strip(),
        _edge_source_file(conn),
        _edge_line_number(conn),
        _edge_evidence_hash(conn),
    ])


def _edge_merge_key(conn):
    # WP-051 I-B（SPEC-046 I1/I4）：边合并键经身份入口（域标签＋长度前缀编码）——
    # from/to 含 | 时不再撞键（P2 实跑址 1：存量边被静默剔除）。键只用于进程内增量比对，
    # 不入 manifest 指纹、不持久化——改键形态不破坏存量（比对语义严格等价：同参同键）。
    from identity_port import make_id
    source_file = _edge_source_file(conn)
    if source_file and not source_file.startswith("知识库/"):
        source_file = f"知识库/{source_file.lstrip('/')}"
    return make_id("edge", [
        str(conn.get("from") or conn.get("source") or "").strip(),
        str(conn.get("to") or conn.get("target") or "").strip(),
        str(conn.get("relationType") or conn.get("type") or "").strip(),
        source_file,
        _edge_line_number(conn),
        _edge_evidence_hash(conn),
    ])


def _vault_rel_from_kb_relative(kb_rel: str) -> str:
    """知识库内相对路径 → Obsidian Vault 仓库根相对路径（供 source_vault_path）。"""
    p = kb_rel.strip().replace("\\", "/").lstrip("/")
    try:
        kb_part = os.path.relpath(VAULT, VAULT_ROOT).replace("\\", "/")
    except ValueError:
        kb_part = "知识库"
    if kb_part in (".", ""):
        return p
    if p == kb_part or p.startswith(f"{kb_part}/"):
        return p
    return f"{kb_part}/{p}"


def _lineage_rule_and_result_kind(labels) -> tuple[str, str]:
    """极简治理轨迹：溯源规则 id + 结果类型（与 neo4j 主语义标签对齐）。"""
    lbls = set(labels or [])
    if "Document" in lbls:
        return "R-wiki-document-scan", "document"
    if "Concept" in lbls:
        return "R-wiki-concept-page", "concept"
    if "ProductVersion" in lbls:
        return "R-doc-derived-version-graph", "product_version"
    if "Product" in lbls:
        return "R-doc-derived-product-graph", "product"
    if "BusinessDomain" in lbls:
        return "R-schema-domain-registry", "business_domain"
    if "Subdomain" in lbls:
        return "R-schema-subdomain-registry", "subdomain"
    if "Team" in lbls:
        return "R-static-team-placeholder", "team"
    if "System" in lbls:
        return "R-arch-json-system-node", "system"
    if "Module" in lbls:
        return "R-wiki-entity-module-page", "module"
    if "Plate" in lbls:
        return "R-doc-derived-plate-aggregation", "plate"
    return "R-extract-generic", "unknown"


# WP-107 D1（SPEC-046 I3／PR-231 实测在册）：节点去重——同 id 且来源不同＝撞键，整批不产出。
# 原语义 last wins 会让两个实体的关系静默画进同一节点（图上零痕迹），正是目的裁定要防的错。
# 处置随本件既有 house law（政策拒产/非现役拒产同款）：违规产物物理不产出＋明细点名，
# 不整体失败建图（一份坏数据不冻结全图），也不自动改写任何存量身份（列清单交人裁）。
IDENTITY_CONFLICTS = []

# WP-113 M4（ADR-016 §二／SPEC-046 I2）：组件身份只有一个来源——唯一铸造口
# server/shared/entity-identity-mint.cjs（Node 内建 UUID v4）。建图侧原有一条
# `entity-{slug}` 现编 fallback，属第二身份来源，本件撤销：arch_component 为真且缺
# architecture-node-id 的实体不铸造、不产出节点，改投 D1 那条既有待审面
# （pendingReview，条目形状同款），交人裁后由修复流补号（补号出口：F02 声明 immutable
# 只在「已有非空现值」时拒改，空号可补——见 entity-repair-service.cjs immutableFields 循环）。
# 只撤「写侧现编」，不撤读侧兼容：server/services/projection/node-id-resolver.cjs 的
# COMMON_PREFIXES 仍认 entity-，存量图/账里那些历史号还要读得到，撤读侧会连读都读不到。
# 非组件（arch_component 不为真）保持既有 entity-{slug} 兜底——本刀只收组件身份这一条。
MISSING_COMPONENT_IDENTITIES = []
MISSING_IDENTITY_PENDING_PREFIX = "missing-identity:"


def _missing_identity_entry(entity_name, source_file):
    """缺号组件的待审条目——形状逐字段对齐 D1 撞键条目（id/reason/architectureNodeId/
    sources/nodeCount/title），复用同一条出口，不自造新面、不新开文件。"""
    return {
        "id": MISSING_IDENTITY_PENDING_PREFIX + entity_name,
        "reason": "missing_architecture_node_id",
        "architectureNodeId": "",
        "sources": [source_file],
        "nodeCount": 0,  # 本项不产出任何节点——与 D1「整批不产出」同口径可核
        "title": "缺身份号的组件：" + entity_name,
    }


def _brief_missing_identities(limit=4):
    """缺号清单摘要（运维点名用，最多列 limit 条来源）——与 D1 撞键打印同款节流，不刷屏。"""
    listed = [entry["sources"][0] for entry in MISSING_COMPONENT_IDENTITIES[:limit]]
    rest = len(MISSING_COMPONENT_IDENTITIES) - len(listed)
    return ", ".join(listed) + (f" 等 {rest} 处" if rest > 0 else "")


def _node_source_file(node):
    """节点来源文件（撞键点名用）；取不到按标签兜底，绝不回空串以免冲突失去住址。"""
    props = node.get("properties") if isinstance(node.get("properties"), dict) else {}
    return (
        props.get("source_file")
        or props.get("sourceFile")
        or node.get("source_file")
        or "<无来源标记:%s>" % (node.get("label") or node.get("id"))
    )


def dedupe_nodes_keep_conflicts(all_nodes):
    """返回 (可产出节点, 撞键字典 id -> (节点列表, 来源列表))。

    同 id 但来源相同（同一份文件被两条通道各建一次，如 architecture JSON 与 entity 页同源）
    不算撞键——那是本件原有的「覆盖」语义，仍按后写者保留。
    """
    by_key = {}
    for n in all_nodes:
        by_key.setdefault(n["id"], []).append(n)
    conflicts = {}
    for key, group in by_key.items():
        sources = sorted({_node_source_file(x) for x in group})
        if len(group) > 1 and len(sources) > 1:
            conflicts[key] = (group, sources)
    kept = {}
    for n in all_nodes:
        if n["id"] in conflicts:
            continue
        kept[n["id"]] = n
    return list(kept.values()), conflicts


def apply_minimal_lineage_props(props: dict, labels: list[str], *, run_ts_iso: str) -> None:
    """写入 last_extract_time、source_vault_path、extraction_trace（起源→规则→结果）。

    Mutates props in place."""
    rule_id, result_kind = _lineage_rule_and_result_kind(labels)
    kb_fp = props.get("file_path")
    wiki_hint = props.get("wiki_path")
    nm = props.get("name") or props.get("title") or ""

    props["last_extract_time"] = run_ts_iso

    if kb_fp:
        props["source_vault_path"] = _vault_rel_from_kb_relative(str(kb_fp))
        origin_detail = str(kb_fp).replace("\\", "/")
    elif wiki_hint:
        props["source_vault_path"] = f"architecture.json:{wiki_hint}"
        origin_detail = props["source_vault_path"]
    elif nm:
        props["source_vault_path"] = f"derived:{nm}"
        origin_detail = props["source_vault_path"]
    else:
        props["source_vault_path"] = "derived:no-name"
        origin_detail = "derived:no-name"

    props["extraction_trace"] = [
        {"stage": "origin", "detail": origin_detail},
        {"stage": "rule", "rule_id": rule_id},
        {"stage": "result", "kind": result_kind},
    ]




EXTRACT_ERRORS = []

def _record_extract_error(filepath, stage, error):
    rel = os.path.relpath(filepath, VAULT).replace("\\", "/") if filepath else ""
    item = {"file": rel, "stage": stage, "error": str(error)}
    EXTRACT_ERRORS.append(item)
    print(f"    ⚠ 跳过: {rel} — {error}")

def _write_extract_errors():
    os.makedirs(os.path.dirname(EXTRACT_ERRORS_JSON), exist_ok=True)
    payload = {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "errors": EXTRACT_ERRORS,
    }
    tmp = EXTRACT_ERRORS_JSON + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    os.replace(tmp, EXTRACT_ERRORS_JSON)

def _check_pipeline_lock():
    lock_file = os.path.join(ledger_dir(VAULT_ROOT), ".pipeline.lock")  # PR-243 批B：单源
    if not os.path.exists(lock_file):
        return None
    try:
        with open(lock_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        if time.time() - os.path.getmtime(lock_file) > 600:
            os.remove(lock_file)
            return None
        allowed_run_id = os.environ.get("PIPELINE_LOCK_RUN_ID", "")
        if allowed_run_id and str(data.get("runId", "")) == allowed_run_id:
            return None
        return data
    except Exception:
        return {"pid": None, "runId": None, "startedAt": None}


def parse_frontmatter(fm_text, body):
    """信封口径 frontmatter 解析（WP-117 批2 迁移）：fm_text＝含定界符 frontmatter 块原文
    （无块为空串），body＝块后全文——均由信封 documents 成员供给。原 filepath 版的编码容错链
    （utf-8/utf-8-sig/gbk/latin-1）由 Node 侧物化承担（G1 已按链解码，Python 不再处理编码）；
    切分与 safe_load 语义与原 :445-454 逐字对齐：
      - fm_text 不以 --- 起头（含空串＝无块/未闭合两态，信封侧统一空串）→ None
      - 哑切分 ---（maxsplit=2，含六连短横自重叠边界同形）不足三段 → None（信封口径不可达，防御保留）
      - yaml.safe_load(parts[1]) 失败 → None；解析为 None（空块）→ {}
    返回 (fm, body)。body＝原 parts[2]（信封切分点与原 split("---",2) 同址，逐字节同源）。"""
    if not fm_text.startswith("---"):
        return None
    parts = fm_text.split("---", 2)
    if len(parts) < 3:
        return None
    try:
        fm = yaml.safe_load(parts[1]) or {}
    except yaml.YAMLError:
        return None
    return fm, body


def _frontmatter_line_offset(fm_text):
    """frontmatter 区换行计数（证据行号偏移）——信封口径（WP-117 批2）。
    原语义＝文件内 parts[0]+parts[1]+两处定界符（6 字符）前缀的换行数；该前缀逐字节等于
    信封 fmText（含定界符块原文），故等价计算＝fm_text 换行计数（fm_text=""↔原 len(parts)<3
    的 0 值形态对齐）。逐字对账证据落 doc-envelope-materializer.test.mjs 对拍。"""
    return fm_text.count("\n")


def collect_md_files(target_dir=None, skip_dirs=None):
    """指纹面 .md 清单——信封口径（WP-117 批2）：原 os.walk(VAULT) 剪枝语义逐条映射为信封
    path 过滤——skip_dirs 剪目录名（任意层，对齐 os.walk dirs[:] 剪枝；文件名不受剪）；
    target_dir 即原 walk_root 前缀。walk 根在知识库外/不存在 → 原语义静默空清单，同形返回 []。
    返回绝对路径列表（调用方 stat/relpath 消费——签名同形，零内容读取）。"""
    if skip_dirs is None:
        skip_dirs = {".obsidian", ".git", ".claude", "raw"}
    root_prefix = ""
    if target_dir:
        root_prefix = os.path.relpath(os.path.abspath(target_dir), VAULT).replace(os.sep, "/")
        if root_prefix in (".", ""):
            root_prefix = ""
        elif root_prefix.startswith(".."):
            return []  # walk 根在知识库外：原 os.walk 对不存在目录静默空清单
    md_files = []
    envelope = _doc_envelope()
    for rel in envelope.paths():
        hit = envelope.get_document(rel)
        if hit["state"] != "present":
            continue
        kb_rel = _doc_kb_rel(hit["value"])
        if kb_rel is None or not kb_rel.endswith(".md"):
            continue
        dir_segments = kb_rel.split("/")[:-1]  # 末段是文件名——walk 剪枝只作用于目录
        if any(seg in skip_dirs for seg in dir_segments):
            continue
        if root_prefix and not kb_rel.startswith(root_prefix + "/"):
            continue
        md_files.append(_doc_abs(kb_rel))
    return sorted(md_files)


def _architecture_product_version():
    projection = schema_loader.architecture_projection()
    product = (os.environ.get("ARCH_PRODUCT")
               or os.environ.get("PRODUCT_NAME")
               or projection.get("product")
               or projection.get("product_name"))
    version = (os.environ.get("ARCH_VERSION")
               or os.environ.get("ARCH_BRANCH")
               or projection.get("version")
               or projection.get("branch"))
    product = str(product or "").strip().strip("/")
    version = str(version or "").strip().strip("/")
    # D3（ADR-011/SPEC-025 C3）：空配置降级不拒跑——产品上下文相关抽取段跳过进 manifest skipped，
    # 其余抽取照跑；raise 只留数据正确性边界。EvoOntology workflow「needs_X＋next_action」同构。
    return product, version  # 允许空串：消费方按 falsy 判定降级（_pipeline_context_status 统一出口）


def _pipeline_context_status(product, version):
    """D3（SPEC-025 C3）：产品上下文缺位时的显式降级状态——不拒跑、写 manifest、给行动指引。"""
    if product and version:
        return None
    return {
        "status": "needs_product_context",
        "skipped": ["product_context_extraction: architecture_projection.product/version 为空（相关抽取段已跳过，其余照跑）"],
        "next_action": "填词表 enums 的 architecture_projection.product/version（经页面或写客户端；或设 ARCH_PRODUCT/ARCH_VERSION 环境变量）以启用产品上下文抽取",
    }


def _configured_products():
    try:
        return {str(item).strip() for item in schema_loader.products() if str(item).strip()}
    except Exception:
        return set()


def _configured_product_aliases():
    projection = schema_loader.architecture_projection()
    raw_aliases = projection.get("product_aliases", {})
    if not isinstance(raw_aliases, dict):
        return {}
    products = _configured_products()
    aliases = {}
    for alias, product in raw_aliases.items():
        alias_text = str(alias or "").strip()
        product_text = str(product or "").strip()
        if alias_text and product_text and product_text in products:
            aliases[alias_text] = product_text
    return aliases


def _find_configured_product(text):
    candidates = {product: product for product in _configured_products()}
    candidates.update(_configured_product_aliases())
    for token, product in sorted(candidates.items(), key=lambda item: len(item[0]), reverse=True):
        if re.search(rf"(?<!\w){re.escape(token)}(?!\w)", text, re.I):
            return product, token
    return "", ""


def _manifest_source_files():
    skip_dirs = {".obsidian", ".git", ".claude", "Attachments"}
    files = collect_md_files(VAULT, skip_dirs=skip_dirs)
    product, version = _architecture_product_version()
    semantic_arch = os.path.join(VAULT, "architecture", product, version, "semantic_architecture.json")
    if os.path.exists(semantic_arch):
        files.append(semantic_arch)
    # 红队复验修复（#76 面3a）：词表变更纳入指纹——改词表后增量不再误判无变化。
    # WP-049 L3：五件词表的变更检测折到「稳定指纹件」（.ledger/vocab-envelope.fingerprint，
    # Node 装载物化时随信封写出——只含逐件 sha256、无时间戳，词表不变则字节不变）。manifest
    # 哈希它＝哈希五件内容，语义与旧「五文件逐个入 manifest」（#76/PR-140/PR-141 沿革）严格
    # 等价，而本脚本零词表文件读取。
    # 词表变更检测（WP-049 L3）：不列文件——五件条目在 _build_incremental_manifest 里由信封指纹
    # 直接注入（sha16＝词表文件内容 sha256 前 16，与旧「逐件哈希」字节同值；零词表文件读取）
    return sorted(set(files))


def _doc_sha16_by_vault_root_rel():
    """信封文档 → 仓库根（VAULT_ROOT）相对 POSIX 路径 → sha16（知识库子树内文档才在册）。
    WP-117 批2：--incremental 第 4 次整读（原 :574）的收编——文档 sha16 直取信封指纹。"""
    out = {}
    envelope = _doc_envelope()
    for rel in envelope.paths():
        hit = envelope.get_document(rel)
        if hit["state"] != "present":
            continue
        kb_rel = _doc_kb_rel(hit["value"])
        if kb_rel is None:
            continue
        root_rel = os.path.relpath(_doc_abs(kb_rel), VAULT_ROOT).replace(os.sep, "/")
        out[root_rel] = hit["value"]["sha16"]
    return out


def _build_incremental_manifest():
    entries = {}
    _doc_sha16 = _doc_sha16_by_vault_root_rel()
    for filepath in _manifest_source_files():
        try:
            stat = os.stat(filepath)
        except OSError:
            continue
        rel_path = os.path.relpath(filepath, VAULT_ROOT)
        # 红队复验修复（#76 面3b）：内容短哈希真落地——防 cp -p/touch -r 保 mtime 换内容漏检（原声称未生效）
        # WP-117 批2：文档 sha16 直取信封（指纹随下发，不再读文档文件）；信外件
        # （semantic_architecture.json 等派生工件）保持原文件字节哈希。
        sha16 = _doc_sha16.get(rel_path.replace(os.sep, "/"))
        if sha16 is None:
            sha16 = hashlib.sha256(open(filepath, "rb").read()).hexdigest()[:16]
        entries[rel_path] = {
            "mtime_ns": stat.st_mtime_ns,
            "size": stat.st_size,
            "sha16": sha16,
        }
    # WP-049 L3：词表五件条目由信封指纹注入——值与旧「逐件哈希实际文件」字节同值（sha256 前 16），
    # 消费面（freshness 逐件点名、增量 diff）语义不变；mtime/size 置 0（信封无此二数，
    # 比较面以 sha16 为准——同值恒等不误报）。#76/PR-140/PR-141 沿革语义保持。
    try:
        from vocab_envelope import load_envelope as _load_vocab_envelope
        _env = _load_vocab_envelope()
        for _name in sorted(_env.names()):
            _fp = _env.fingerprint(_name) or ""
            entries[f".ledger/vocab/{_name}.yaml"] = {
                "mtime_ns": 0,
                "size": len(_fp) // 2,
                "sha16": _fp[:16],
            }
    except Exception:
        pass
    return {
        "version": 1,
        "vault": VAULT,
        "generatedAt": datetime.now().isoformat(),
        "files": entries,
    }


def _read_incremental_manifest():
    if not os.path.exists(INCREMENTAL_MANIFEST):
        return None
    try:
        with open(INCREMENTAL_MANIFEST, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def _diff_incremental_manifest(previous, current):
    old_files = (previous or {}).get("files", {})
    new_files = current.get("files", {})
    old_keys = set(old_files)
    new_keys = set(new_files)
    changed = [
        path for path in sorted(old_keys & new_keys)
        if old_files.get(path) != new_files.get(path)
    ]
    return {
        "created": sorted(new_keys - old_keys),
        "deleted": sorted(old_keys - new_keys),
        "changed": changed,
    }


def _write_incremental_manifest(manifest):
    os.makedirs(os.path.dirname(INCREMENTAL_MANIFEST), exist_ok=True)
    tmp = INCREMENTAL_MANIFEST + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    os.rename(tmp, INCREMENTAL_MANIFEST)


def slugify(text):
    return re.sub(r'[^\w]', '-', text.lower())


def node_id_for_file(rel_path):
    return "doc-" + slugify(rel_path.replace(".md", ""))


def _component_role(name):
    """Map concrete components to stable architecture roles without merging entities."""
    key = str(name or "").lower()
    if "mysql" in key or "mariadb" in key:
        return "metadata_db"
    if "opensearch" in key or "elasticsearch" in key:
        return "search_engine"
    if "ceph" in key or "eceph" in key:
        return "object_storage"
    return ""


def _as_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def _is_truthy(value):
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"true", "yes", "1", "y", "是"}


def _parse_quality(raw):
    """Parse quality field: integer 0-10, or empty string if missing/invalid."""
    if raw is None:
        return ""
    try:
        v = int(raw)
        if 0 <= v <= 10:
            return v
        return ""
    except (ValueError, TypeError):
        return ""


def _frontmatter_tags(fm):
    tags = []
    # G7（PR-020 批4）：标签治理图谱侧接线——停用标签不入图（属性级过滤）+ tag_aliases 归一
    # （经 schema_loader.tag_governance 单点装载，禁止自解析 enums.yaml——C6 原则）
    try:
        governance = schema_loader.tag_governance()
    except Exception:
        governance = {"disabled": set(), "aliases": {}}
    for tag in _as_list(fm.get("tags")):
        cleaned = str(tag).strip()
        if not cleaned:
            continue
        cleaned = str(governance["aliases"].get(cleaned, cleaned))
        if cleaned and cleaned not in governance["disabled"]:
            tags.append(cleaned)
    return tags


def _normalize_category_path(cp_raw):
    """标准化 category-path：兼容新旧格式，只保留前两段 domain:subdomain"""
    cp = str(cp_raw).strip("\"'")
    parts = cp.split(":")
    if len(parts) >= 2:
        return f"{parts[0]}:{parts[1]}"
    return cp if cp else ""


# ── 自动 module 推断规则 ──
_MODULE_INFERENCE_RULES = [
    # (匹配函数, 映射到 module)
    (lambda p, t, b: "KnowledgeCenter" in t or "认知助手" in t, "认知助手"),
    (lambda p, t, b: "智能搜索" in t or "smart.search" in t.lower().replace("-",""), "智能搜索"),
    (lambda p, t, b: "工作中心" in t or "workflow" in t.lower(), "工作中心"),
    (lambda p, t, b: "WPS" in t or "wps中台" in t.lower(), "WPS"),
    (lambda p, t, b: "Office Online" in t or "office.online" in t.lower().replace("-",".") or "在线编辑" in t or "office插件" in p.lower(), "Office Online"),
    (lambda p, t, b: "MySQL" in t or "mysql" in t.lower() or "主从复制" in t or "数据库" in t or "xtrabackup" in t.lower() or "mariadb" in t.lower(), "MySQL"),
    (lambda p, t, b: "mongodb" in t.lower(), "MySQL"),
    (lambda p, t, b: "redis" in t.lower(), "Redis"),
    (lambda p, t, b: "OpenSearch" in t or "opensearch" in t.lower() or "全文索引" in t or "搜索" in t, "OpenSearch"),
    (lambda p, t, b: "Ceph" in t or "ceph" in t.lower() or "eceph" in t.lower() or "磁盘" in t or "OSD" in t or "存储巡检" in t, "Ceph"),
    (lambda p, t, b: "Calico" in t or "calico" in t.lower() or "证书到期" in t, "Calico"),
    (lambda p, t, b: "Docker" in t or "docker" in t.lower(), "Docker"),
    (lambda p, t, b: "Kubernetes" in t or "kubernetes" in t.lower() or "k8s" in t.lower() or "滚动重启" in t or "ingress" in t.lower() or "负载均衡" in t or "Deployment" in t or "yaml" in t.lower() or "pod" in t.lower() or "容器" in t, "Kubernetes"),
    (lambda p, t, b: "客户" in t or "Sailor" in t or "sailor" in t.lower() or "同步盘" in t or "用户终端" in t or "兼容性" in t or "PC" in t.upper() or "桌面" in t or "windows" in t.lower() or "mac" in t.lower() or "anyShare同步" in t.lower() or "anyShare客户" in t.lower(), "客户端"),
    (lambda p, t, b: "亿赛通" in t or "yisaitong" in t.lower(), "亿赛通"),
    (lambda p, t, b: "证书" in t or "cert" in t.lower() or "证书链" in t or "https" in t.lower() or "tls" in t.lower() or "license" in t.lower() or "许可" in t, "证书管理"),
    (lambda p, t, b: "漏洞" in t or "vuln" in t.lower(), "漏洞管理"),
    (lambda p, t, b: "数据加密" in t or "加密" in t or "data.encrypt" in t.lower().replace("-","."), "数据加密"),
    (lambda p, t, b: "Content服务" in t or "content.service" in t.lower().replace("-",".") or "SAP" in t or "流式下载" in t or "文件冲突" in t, "Content服务"),
    (lambda p, t, b: "OSS网关" in t or "oss.gateway" in t.lower().replace("-",".") or "NAS" in t or "nas" in t.lower() or "网关" in t, "OSS网关"),
    (lambda p, t, b: "ECMS" in t or "ecms" in t.lower(), "ECMS集群"),
    (lambda p, t, b: "Zabbix" in t or "zabbix" in t.lower(), "Zabbix"),
    (lambda p, t, b: "麒麟" in t or "Linux性能" in t or "linux" in t.lower(), "麒麟OS"),
    (lambda p, t, b: "CRM" in t or "Bot" in t or "crm" in t.lower() or "工单" in t, "Bot"),
    (lambda p, t, b: "可观测" in t or "OOM" in t or "oom" in t.lower() or "ecoindex" in t.lower() or "北极星" in t or "运营指标" in t or "JVM" in t or "jvm" in t.lower() or "日志" in t, "可观测性"),
    (lambda p, t, b: "文档同步" in t or "文档流转" in t or "docsync" in t.lower() or "document.flow" in t.lower().replace("-","."), "文档同步"),
    (lambda p, t, b: "认证" in t or "oauth2" in t.lower() or "访问控制" in t or "access.control" in t.lower().replace("-",".") or "登录" in t, "认证服务"),
    (lambda p, t, b: "升级" in t or "安装" in t or "部署" in t or "实施" in t or "备份" in t or "更新指导" in t or "系统备份" in t, "安装部署"),
    # 按路径兜底
    (lambda p, t, b: "/03-实施指导/" in p or "/04-更新指导/" in p or "/05-升级/" in p, "安装部署"),
    (lambda p, t, b: "/09-功能列表/" in p or "功能对比" in t or "功能列表" in t, "主模块"),
    # 通用排错文档兜底
    (lambda p, t, b: "报错" in t or "异常" in t or "失败" in t or "无法" in t or "timeout" in t.lower() or "crash" in t.lower() or "宕机" in t or "OOM" in t, "Kubernetes"),
]

# ── 按路径前缀匹配（兜底）──
_MODULE_PATH_RULES = [
    ("raw/precleaned/", "安装部署"),
    ("wiki/sources/", "Kubernetes"),
]


def _infer_module_from_context(rel_path, fname, fm, body):
    """从文件名、路径、category-path、body 推断 module"""
    title = str(fm.get("title", fname.replace(".md", "")))
    # 关键词规则匹配
    for match_fn, mod in _MODULE_INFERENCE_RULES:
        if match_fn(rel_path, title, body or ""):
            return mod
    # 路径前缀兜底
    for prefix, mod in _MODULE_PATH_RULES:
        if rel_path.startswith(prefix):
            return mod
    return None


def _is_promoted_arch_component(fm):
    tags = set(_frontmatter_tags(fm))
    return (
        _is_truthy(fm.get("arch_component"))
        or _is_truthy(fm.get("is_arch_component"))
        or bool(tags & ARCH_PROMOTION_TAGS)
    )


def _version_id(product, version):
    return f"version-{slugify(product)}-{slugify(version)}"


def _product_id(product):
    return f"product-{slugify(product)}"


def _normalize_version_value(raw):
    value = str(raw or "").strip().strip("\"'")
    if not value:
        return ""
    if re.fullmatch(r"\d{2}", value):
        return f"{value[0]}.{value[1]}"
    if re.fullmatch(r"\d{4}", value) and value.startswith(("5", "6", "7")):
        return ".".join(str(int(part)) for part in value)
    return value.lstrip("vV")


def _infer_product_version(fm, rel_path):
    title = str(fm.get("title", "") or "")
    # G1+G5（PR-020 批5）：产品身份经 schema_loader.resolve_product_identity 统一解析
    # （versions.yaml 注册表唯一权威 + product_aliases 归一 + reserved_products 判定；
    # 未注册值透传原值并带 unregistered_product 标记，不丢弃——wild_tag 同款治理先例）
    identity = schema_loader.resolve_product_identity(_clean_wikilink(str(fm.get("product", ""))))
    product = identity["canonical"]
    version = _normalize_version_value(fm.get("version", ""))

    text = f"{title} {rel_path}"
    inferred_product, matched_token = _find_configured_product(text)
    if not product and inferred_product:
        product = inferred_product
    if not version:
        version_token = matched_token or product
        match = None
        if version_token:
            match = re.search(rf"{re.escape(version_token)}\s*(\d+(?:\.\d+){{0,3}})", text, re.I)
        if match:
            version = _normalize_version_value(match.group(1))
        elif version_token:
            compact = re.search(rf"(?<!\w){re.escape(version_token)}(\d{{4}})(?!\w)", text, re.I)
            if compact:
                version = _normalize_version_value(compact.group(1))

    return product, version


# ── Step 1-2: BusinessDomain + Subdomain 节点 ──


def _ensure_subdomain_node(nodes, edges, domain_id, subdomain_id):
    """Auto-create Subdomain + parent BusinessDomain node if not already present.

    Idempotent — checks against nodes already accumulated in the list, so
    repeated calls with the same ID create at most one node pair.
    """
    node_ids = {n["id"] for n in nodes}
    # Create BusinessDomain if missing
    if domain_id not in node_ids:
        nodes.append({
            "id": domain_id,
            "labels": ["BusinessDomain"],
            "properties": {"name": domain_id, "is_active": True},
        })
    # Create Subdomain if missing
    if subdomain_id not in node_ids:
        nodes.append({
            "id": subdomain_id,
            "labels": ["Subdomain"],
            "properties": {
                "name": subdomain_id.split(":")[-1],
                "slug": subdomain_id.split(":")[-1],
                "category_path_prefix": subdomain_id,
                "domain_id": domain_id,
            },
        })
        # WP-005（SPEC-027 §九裁定）：结构走属性轴——子域→域骨架边停发（domain_id 属性已承载）


def extract_domain_nodes():
    nodes = []
    edges = []
    for domain_id, domain_name in DOMAIN_INFO.items():
        nodes.append({
            "id": domain_id,
            "labels": ["BusinessDomain"],
            "properties": {"name": domain_name, "is_active": True},
        })
        for entry in (SUBDOMAIN_INFO.get(domain_id) or []):
            # ADR-008 D1：注册表词条为 {id[, label]} 对象（schema_loader.subdomains() 已归一），
            # id 进复合 ID/slug，label 作展示名（name）
            sub_id = str(entry.get("id", "")).strip()
            if not sub_id:
                continue
            sub_name = str(entry.get("label") or sub_id)
            composite_sub_id = f"{domain_id}:{sub_id}"
            nodes.append({
                "id": composite_sub_id,
                "labels": ["Subdomain"],
                "properties": {
                    "name": sub_name,
                    "slug": sub_id,
                    "category_path_prefix": f"{domain_id}:{sub_id}",
                    "domain_id": domain_id,
                },
            })
            # WP-005：组合子域骨架边同款停发
    return nodes, edges


# ── Step 4-5: wiki entities → System/Module 节点补全 ──

def _frontmatter_exempt_rules(fm):
    """实体文档 frontmatter 的 exempt_rules（WP-031 拓扑缺口豁免闭环）。

    宽容读：字符串视作单值、非字符串项忽略、去空白——用户手写 YAML 不因格式小错炸抽取。
    语义：该实体文档按缺口类型豁免（gap-engine computeGaps 消费，与单条 resolve 同管道）。
    """
    raw = fm.get("exempt_rules", [])
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, list):
        return []
    return [str(r).strip() for r in raw if r is not None and str(r).strip()]


def extract_entity_nodes(arch_node_ids, name_to_id):
    # WP-113 M4：本次文档扫描为准——每轮扫描重建缺号清单（防旧图残留成待审幽灵，
    # 与 pendingReview 每轮重算的既有口径一致）
    MISSING_COMPONENT_IDENTITIES.clear()
    # WP-117 批2：遍历面改信封过滤——wiki/entities 顶层 .md（原 :915 os.listdir 口径：
    # 不下钻子目录、无目录名剪枝；目录缺失＝空清单，与原 isdir 早退同形返回）
    entity_docs = _doc_envelope_flat_md_docs("wiki/entities")

    nodes = []
    edges = []
    wikilink_deps = []  # (source_id, target_id, target_name, link_type) from 依赖::
    unresolved_wikilinks = []  # unresolved wikilink references
    node_exemptions = {}  # node_id -> [缺口类型]——is_system 分支的节点他处创建，主流程收尾 merge

    for fname, kb_rel, doc in entity_docs:
        try:
                filepath = _doc_abs(kb_rel)
                result = parse_frontmatter(doc["fmText"], doc["body"])
                if not result:
                    continue
                fm, body = result

                entity_name = fname.replace(".md", "")
                arch_id = fm.get("architecture-node-id", fm.get("architecture_node_id", ""))
                is_system = arch_id and arch_id in arch_node_ids
                is_promoted_arch_component = _is_promoted_arch_component(fm)
                exempt_rules = _frontmatter_exempt_rules(fm)

                if is_system and not is_promoted_arch_component:
                    # Already created as System from architecture JSON — skip node creation
                    # Register name → ID mapping and extract wikilinks
                    name_to_id[entity_name] = arch_id
                    if exempt_rules:
                        node_exemptions[arch_id] = exempt_rules
                    source_file = os.path.relpath(filepath, VAULT_ROOT).replace("\\", "/")
                    uw = _extract_entity_references(arch_id, body, edges, name_to_id, wikilink_deps, source_file, _source_sha256(doc), _frontmatter_line_offset(doc["fmText"]))
                    if uw:
                        unresolved_wikilinks.extend(uw)
                    continue

                # WP-113 M4：组件缺身份号 → 不在建图侧现编号。不产出节点、不代表它解析连线
                # （没有身份号就没有可挂的键），改投 D1 那条既有待审面，交人裁后由修复流补号。
                # 判定用 _is_promoted_arch_component（arch_component 真值或晋升标签），与本文件
                # 其余组件判据同口径；非组件保持下方 entity-{slug} 兜底，本刀不扩面。
                if is_promoted_arch_component and not arch_id:
                    MISSING_COMPONENT_IDENTITIES.append(
                        _missing_identity_entry(
                            entity_name,
                            os.path.relpath(filepath, VAULT_ROOT).replace("\\", "/"),
                        )
                    )
                    continue

                # Use architecture-node-id if present, else entity-{slug} fallback
                # （兜底只服务非组件——组件身份号的现编通道已于 WP-113 M4 撤销）
                slug = re.sub(r'[^\w]', '-', entity_name.lower())
                if arch_id:
                    node_id = arch_id
                else:
                    node_id = f"entity-{slug}"
                labels = ["Module"]
                tags = _frontmatter_tags(fm)
                is_promoted_arch_component = _is_promoted_arch_component(fm)
                if is_promoted_arch_component:
                    labels.append("ArchitectureComponent")
                if entity_name in _configured_products():
                    labels = ["System"]
                    if is_promoted_arch_component:
                        labels.append("ArchitectureComponent")

                module_val = fm.get("module", [])
                if isinstance(module_val, list):
                    module_val = [_clean_wikilink(str(m)) for m in module_val if m]
                elif isinstance(module_val, str) and module_val.strip():
                    module_val = _clean_wikilink(module_val.strip())
                else:
                    module_val = ""

                props = {
                    "name": entity_name,
                    "title": fm.get("title", entity_name),
                    "category_path": _normalize_category_path(fm.get("category-path", "")),
                    "tags": tags,
                    "file_path": os.path.relpath(filepath, VAULT_ROOT).replace("\\", "/"),
                    "date": str(fm.get("date", "")),
                    "updated": str(fm.get("updated", "")),
                    "review_cycle": str(fm.get("review-cycle", "")),
                    "module": module_val if isinstance(module_val, str) else ",".join(module_val),
                }
                if arch_id:
                    # master_graph 契约：只写下划线字段名（YAML 仍可使用 architecture-node-id）
                    props["architecture_node_id"] = arch_id
                if is_promoted_arch_component:
                    raw_layer = str(fm.get("arch_layer", fm.get("layer", "")) or "").strip()
                    raw_category = str(fm.get("arch_category", fm.get("category", "")) or "").strip()
                    raw_subdomain = str(fm.get("arch_subdomain", "") or "").strip()
                    props.update({
                        "arch_component": True,
                        "arch_layer": raw_layer,
                        "arch_layer_canonical": schema_loader.normalize_architecture_value("arch_layer", raw_layer),
                        "arch_category": raw_category,
                        "arch_category_canonical": schema_loader.normalize_architecture_value("arch_category", raw_category),
                        "arch_subdomain": raw_subdomain,
                        "arch_subdomain_canonical": schema_loader.normalize_architecture_value("arch_subdomain", raw_subdomain),
                        "arch_since": str(fm.get("arch_since", "")),
                        "arch_until": str(fm.get("arch_until", "")),
                        "arch_status": fm.get("arch_status", fm.get("status", "")),
                    })
                role = _component_role(entity_name)
                if role:
                    props["component_role"] = role

                # BELONGS_TO → Subdomain (from category-path)
                cp = fm.get("category-path", "")
                if cp:
                    cp_parts = str(cp).strip("\"'").split(":")
                    if len(cp_parts) >= 2:
                        domain_id = cp_parts[0]
                        sub_id = f"{domain_id}:{cp_parts[1]}"
                        _ensure_subdomain_node(nodes, edges, domain_id, sub_id)
                        # WP-005：挂载属性化（结构走属性轴——节点属性承载，不再发边）
                        props["subdomain_id"] = sub_id
                        props["domain_id"] = domain_id

                nodes.append({"id": node_id, "labels": labels, "properties": props})
                # WP-031 红队修正：自建节点豁免也统一走 node_exemptions 单通道（props 直写会被
                # 主流程 merge 的「删则清」分支误删——豁免从未落盘，批量豁免主路径整体失效）
                if exempt_rules:
                    node_exemptions[node_id] = exempt_rules
                name_to_id[entity_name] = node_id
                source_file = os.path.relpath(filepath, VAULT_ROOT).replace("\\", "/")
                uw = _extract_entity_references(node_id, body, edges, name_to_id, wikilink_deps, source_file, _source_sha256(doc), _frontmatter_line_offset(doc["fmText"]))
                if uw:
                    unresolved_wikilinks.extend(uw)

        except Exception as e:
            _record_extract_error(locals().get("filepath", os.path.join(VAULT, kb_rel)), "entity", e)
            continue
    return nodes, edges, wikilink_deps, unresolved_wikilinks, node_exemptions


def _extract_entity_references(source_id, body, edges, name_to_id, wikilink_deps=None, source_file="", source_hash="", source_line_offset=0):
    """Extract typed wikilinks from entity body as architecture edges.

    Typed wikilinks matching the vocab envelope enums become edges with the correct
    architecture relation type. DEPENDS_ON wikilinks are additionally collected
    in wikilink_deps for cross-validation against the dependency rules.

    Returns list of unresolved wikilinks (target entity not found in name_to_id).
    """
    if wikilink_deps is None:
        wikilink_deps = []
    unresolved_wikilinks = []

    # Pre-compute line offsets for O(log n) line number lookup
    line_starts = [0]
    for i, ch in enumerate(body):
        if ch == '\n':
            line_starts.append(i + 1)

    def _line_number(pos):
        """Return 1-based line number for character position (binary search)."""
        lo, hi = 0, len(line_starts) - 1
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if line_starts[mid] <= pos:
                lo = mid
            else:
                hi = mid - 1
        return lo + 1 + source_line_offset

    wikilink_pattern = re.compile(r'^(?:-\s+)?(\S+)::\[\[([^\]]+)\]\]', re.MULTILINE)
    for m in wikilink_pattern.finditer(body):
        link_type_raw = m.group(1)
        target_name = m.group(2)
        line_no = _line_number(m.start())
        evidence = m.group(0).strip()
        target_id = name_to_id.get(target_name)
        if not target_id:
            unresolved_wikilinks.append({
                "source_entity": source_id,
                "source_file": source_file,
                "target_name": target_name,
                "link_type": link_type_raw,
                "evidence_text": evidence,
                "line_number": line_no,
            })
            continue

        link_type = _normalize_link_type(link_type_raw)
        sources = [{
            "file": source_file,
            "source_hash": source_hash,
            "method": "entity_wikilink",
            "confidence": 1.0,
            "line_number": line_no,
            "evidence_text": evidence,
        }]
        if not link_type:
            unresolved_wikilinks.append({
                "source_entity": source_id,
                "source_file": source_file,
                "target_name": target_name,
                "link_type": link_type_raw,
                "evidence_text": evidence,
                "line_number": line_no,
                "reason": "unknown_link_type",
            })
            continue
        if link_type == "DEPENDS_ON":
            wikilink_deps.append((source_id, target_id, target_name, link_type_raw))
            edges.append({
                "source": source_id,
                "target": target_id,
                "type": "DEPENDS_ON",
                "properties": {
                    "link_type": link_type_raw,
                    "source": "entity-wikilink",
                    "sources": sources,
                    "reviewStatus": "pending",
                },
            })
        elif link_type != "REFERENCES":
            edges.append({
                "source": source_id,
                "target": target_id,
                "type": link_type,
                "properties": {
                    "link_type": link_type_raw,
                    "source": "entity-wikilink",
                    "sources": sources,
                    "reviewStatus": "pending",
                },
            })
        else:
            edges.append({
                "source": source_id,
                "target": target_id,
                "type": "REFERENCES",
                "properties": {
                    "link_type": link_type_raw,
                    "source_section": "关联实体",
                    "sources": sources,
                    "reviewStatus": "pending",
                },
            })

    # Also extract bare wikilinks from 关联概念 section
    concept_section = re.search(r'##\s*关联概念\s*\n(.*?)(?=\n##|\Z)', body, re.DOTALL)
    if concept_section:
        concept_text = concept_section.group(1)
        concept_offset = concept_section.start(1)
        for m in re.finditer(r'\[\[([^\]]+)\]\]', concept_text):
            target_name = m.group(1)
            line_no = _line_number(concept_offset + m.start())
            evidence = m.group(0)
            target_id = name_to_id.get(target_name)
            if target_id:
                edges.append({
                    "source": source_id,
                    "target": target_id,
                    "type": "REFERENCES",
                    "properties": {
                        "source_section": "关联概念",
                        "sources": [{
                            "file": source_file,
                            "source_hash": source_hash,
                            "method": "entity_wikilink",
                            "confidence": 1.0,
                            "line_number": line_no,
                            "evidence_text": evidence,
                        }],
                        "reviewStatus": "pending",
                    },
                })
            else:
                unresolved_wikilinks.append({
                    "source_entity": source_id,
                    "source_file": source_file,
                    "target_name": target_name,
                    "link_type": "关联概念",
                    "evidence_text": evidence,
                    "line_number": line_no,
                })

    return unresolved_wikilinks


def _extract_document_references(doc_id, body, edges, name_to_id, doc_id_set, source_file="", source_hash="", source_line_offset=0):
    """文档正文 wikilink → REFERENCES 边（打通 doc↔doc 直连链路）。
    仅产出 REFERENCES 语义，覆盖三种写法：
      - 类型化 wikilink `TYPE::[[目标]]`（TYPE 归一为 REFERENCES 时）→ 任意已注册目标
      - `## 关联概念` 段内裸链 `[[目标]]` → 任意已注册目标
      - 正文裸链 `[[标题]]` → 仅当目标是 Document 节点（doc↔doc 直连）
    目标须存在于 name_to_id（含 extract_document_nodes pass 1 注册的文档标题/article_id）；
    未解析落空 → fail-closed，不产生边。返回新增边数量。"""
    # 行号定位（与 _extract_entity_references 同构）
    line_starts = [0]
    for i, ch in enumerate(body):
        if ch == "\n":
            line_starts.append(i + 1)

    def _line_number(pos):
        lo, hi = 0, len(line_starts) - 1
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if line_starts[mid] <= pos:
                lo = mid
            else:
                hi = mid - 1
        return lo + 1 + source_line_offset

    emitted = set()  # 去重：同一文档对同一目标只产一条 REFERENCES
    added = 0

    def _emit(target_id, evidence, line_no, section):
        nonlocal added
        if target_id == doc_id:
            return  # 自引用无意义
        if target_id in emitted:
            return
        emitted.add(target_id)
        edges.append({
            "source": doc_id,
            "target": target_id,
            "type": "REFERENCES",
            "properties": {
                "source_section": section,
                "method": "document-wikilink",
                "sources": [{
                    "file": source_file,
                    "source_hash": source_hash,
                    "method": "document-wikilink",
                    "confidence": 1.0,
                    "line_number": line_no,
                    "evidence_text": evidence,
                }],
                "reviewStatus": "pending",
            },
        })
        added += 1

    # 1) 类型化 wikilink TYPE::[[目标]] → REFERENCES（任意已注册目标）
    for m in re.finditer(r'^(?:-\s+)?(\S+)::\[\[([^\]]+)\]\]', body, re.MULTILINE):
        link_type_raw = m.group(1)
        target_name = m.group(2)
        link_type = _normalize_link_type(link_type_raw)
        if link_type != "REFERENCES":
            continue  # 文档仅产出 REFERENCES；DEPENDS_ON 等交由实体路径 / YAML 校验
        target_id = name_to_id.get(target_name)
        if target_id:
            _emit(target_id, m.group(0).strip(), _line_number(m.start()), "关联实体")

    # 2) ## 关联概念 段内裸链 → REFERENCES（任意已注册目标）
    concept_sec = re.search(r'##\s*关联概念\s*\n(.*?)(?=\n##|\Z)', body, re.DOTALL)
    if concept_sec:
        for m in re.finditer(r'\[\[([^\]]+)\]\]', concept_sec.group(1)):
            target_id = name_to_id.get(m.group(1))
            if target_id:
                _emit(target_id, m.group(0), _line_number(concept_sec.start(1) + m.start()), "关联概念")

    # 3) 正文裸链 [[标题]] → REFERENCES（仅 Document 目标 = doc↔doc 直连）
    for m in re.finditer(r'\[\[([^\]]+)\]\]', body):
        s = m.start()
        if concept_sec and concept_sec.start(1) <= s < concept_sec.end(1):
            continue  # 已在 关联概念 段处理
        if body[max(0, s - 2):s] == "::":
            continue  # 类型化 wikilink 已在第 1 步处理
        target_id = name_to_id.get(m.group(1))
        if target_id and target_id in doc_id_set:
            _emit(target_id, m.group(0), _line_number(s), "body")

    return added


def _normalize_link_type(raw):
    """Map wikilink type keyword to architecture relation type via the vocab envelope."""
    wikilink_type_map = schema_loader.wikilink_type_map()
    if raw in wikilink_type_map:
        return wikilink_type_map[raw]
    r = raw.lower()
    if r in wikilink_type_map:
        return wikilink_type_map[r]
    allowed = schema_loader.ontology_relation_types().keys()
    canonical = raw.upper()
    if canonical in allowed:
        return canonical
    return ""


# ── Multi-source inference edge loading ──

def load_inferred_edges(vault_root, stdin_data=None):
    """Load merged_edges.json and convert to master_graph connection format (D-31).
    Phase 2 pipe mode: if stdin_data is provided, use it directly (no disk read)."""
    if stdin_data is not None:
        data = stdin_data if isinstance(stdin_data, list) else json.loads(stdin_data)
    else:
        merged_path = os.path.join(vault_root, ".pipeline", "intermediates", "merged_edges.json")
        if not os.path.isfile(merged_path):
            return []
        try:
            with open(merged_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            return []

    converted = []
    for e in data:
        props = e.get("properties", {})
        sources = props.get("sources", [])
        needs_review = props.get("needs_manual_review", False)
        # C8（SPEC-027）：导入缺省不写值——保 missing 语义（无值→建议资格）；0.0 保留为显式合法低值
        has_confidence = "confidence" in e and e["confidence"] is not None

        converted.append({
            "source": e["source"],
            "target": e["target"],
            "type": e.get("type", "REFERENCES"),
            "label": "",
            "properties": {
                "source": "multi-source-inference",
                **({"confidence": e["confidence"]} if has_confidence else {}),
                "inference_sources": sources,
                "needs_manual_review": needs_review,
                "reviewStatus": "pending",
            },
        })

    return converted


# ── YAML dependency generation ──

def load_deps_yaml():
    """依赖规则条目（WP-49 L3：经 schema_loader→词表信封取数——不再读词表文件）。"""
    data = schema_loader.load_the_schema("dependencies")[0] or {}
    return data.get("dependencies", [])


def generate_yaml_deps_edges(all_nodes, all_edges, wikilink_deps=None):
    """Enrich entity-wikilink DEPENDS_ON edges with YAML version info.

    - Wikilink DEPENDS_ON edges are preserved (source=entity-wikilink)
    - YAML entries enrich matching wikilink edges with since/until
    - YAML entries without wikilink counterpart → ERROR (must add wikilink in entity body)
    - Wikilink edges without YAML entry → kept as skeleton (no version constraint)

    Returns (new_edges, errors, warnings, enriched_count, yaml_only_count).
    """
    if wikilink_deps is None:
        wikilink_deps = []

    yaml_deps = load_deps_yaml()
    node_ids = {n["id"] for n in all_nodes}

    # Separate wikilink DEPENDS_ON edges from everything else
    wikilink_dep_edges = []
    other_edges = []
    for e in all_edges:
        if e.get("type") == "DEPENDS_ON" and e.get("properties", {}).get("source") == "entity-wikilink":
            wikilink_dep_edges.append(e)
        else:
            other_edges.append(e)

    # Build YAML pair → entry map
    yaml_map = {}
    errors = []
    warnings = []
    for dep in yaml_deps:
        src = dep.get("source", "").strip()
        tgt = dep.get("target", "").strip()
        if not src or not tgt:
            continue
        missing = []
        if src not in node_ids:
            missing.append(f"source={src}")
        if tgt not in node_ids:
            missing.append(f"target={tgt}")
        if missing:
            errors.append(f"YAML ({src} → {tgt}): 节点未找到 — {', '.join(missing)}")
            continue
        pair = (src, tgt)
        if pair not in yaml_map:
            yaml_map[pair] = {
                "dep_type": dep.get("type", "DEPENDS_ON"),
                "since": str(dep.get("since", "")).strip(),
                "until": str(dep.get("until", "")).strip(),
            }

    # Enrich wikilink edges with YAML version data
    enriched = 0
    wikilink_pairs = set()
    for e in wikilink_dep_edges:
        pair = (e["source"], e["target"])
        wikilink_pairs.add(pair)
        yaml_entry = yaml_map.get(pair)
        if yaml_entry:
            e["properties"]["source"] = "entity-wikilink+yaml"
            if yaml_entry["since"]:
                e["properties"]["since"] = yaml_entry["since"]
            if yaml_entry["until"]:
                e["properties"]["until"] = yaml_entry["until"]
            enriched += 1

    # YAML entries without wikilink → ERROR (no auto-edge creation)
    wd_pairs = {(s, t) for s, t, _, _ in wikilink_deps}
    yaml_no_wikilink = set(yaml_map.keys()) - wd_pairs
    if yaml_no_wikilink:
        for src, tgt in sorted(yaml_no_wikilink):
            errors.append(
                f"YAML ({src} → {tgt}): 缺少依赖:: wikilink 对应，请在 source entity 正文中补上 依赖::[[目标]]（当前可能用的是 关联:: 或其它弱类型，YAML 仅富化 依赖:: 类型的 DEPENDS_ON 边）"
            )

    # Cross-validation: wikilink deps without YAML entry
    for src_id, tgt_id, tgt_name, link_type in wikilink_deps:
        if (src_id, tgt_id) not in yaml_map:
            warnings.append(
                f"wikilink 依赖::[[{tgt_name}]] ({src_id} → {tgt_id}) 保留为骨架边（可登记到依赖规则（词表，经页面或写客户端）以补充版本约束）"
            )

    result = other_edges + wikilink_dep_edges
    return result, errors, warnings, enriched, 0


# ── Step 6: wiki concepts → Concept 节点 ──


def _snippet_from_concept_body(body, fm):
    """与 Obsidian 推送逻辑一致：优先 ## 概述，其次 frontmatter，再取正文首段（避免只改正文仍显示旧/空 sublabel）。"""
    overview_match = re.search(r"##\s*概述\s*\n(.*?)(?=\n##|\Z)", body, re.DOTALL)
    if overview_match:
        t = overview_match.group(1).strip()
        if t:
            return t[:4000]
    for key in ("definition", "Definition", "摘要", "summary", "Summary"):
        raw = fm.get(key)
        if isinstance(raw, str) and raw.strip():
            return raw.strip()[:4000]
    text = re.sub(r"^#\s+[^\n]+\s*\n?", "", body.strip(), count=1)
    text = re.sub(r"```[\s\S]*?```", " ", text)
    text = re.sub(r"\[\[([^\]|]+)(?:\|[^\]]+)?\]\]", r"\1", text)
    parts = re.split(r"\n\s*\n+", text)
    for p in parts:
        p = p.strip()
        if not p or p.startswith("#"):
            continue
        line = re.sub(r"\s+", " ", p)
        if len(line) >= 8:
            return line[:4000]
    return ""


def _extract_symptoms_preview(body):
    """提取 ## 报错现象 / ## Symptoms 后第一段内容，作为节点预览属性"""
    m = re.search(
        r'##\s*(?:报错现象|Symptoms|错误现象|问题现象|故障现象|异常现象)\s*\n+(.*?)(?=\n##|\n#|\Z)',
        body, re.DOTALL,
    )
    if m:
        text = m.group(1).strip()
        return text[:500]
    return ""


def _parse_dataview_health(body):
    """扫描 Dataview status::value 语法，映射为 health_score"""
    m = re.search(r'^status::(.+)$', body, re.MULTILINE)
    if not m:
        return None
    v = m.group(1).strip()
    mapping = {
        "已解决": 100, "已关闭": 100, "已验证": 100, "已修复": 100,
        "处理中": 50, "分析中": 50, "待验证": 50,
        "待解决": 0, "未解决": 0, "无法复现": 0, "已规避": 75,
    }
    return mapping.get(v)


def extract_concept_nodes(name_to_id):
    # WP-117 批2：遍历面改信封过滤——wiki/concepts 子树（原 :1491 os.walk 口径：剪「.」起头
    # 目录名〔任意层〕；目录缺失＝空清单，与原 isdir 早退同形返回；排序＝原 sorted(绝对路径) 同序）
    concept_docs = _doc_envelope_md_docs_under("wiki/concepts", skip_dot_dirs=True)

    nodes = []
    edges = []

    for kb_rel, doc in concept_docs:
        try:
                filepath = _doc_abs(kb_rel)
                fname = os.path.basename(filepath)
                result = parse_frontmatter(doc["fmText"], doc["body"])
                if not result:
                    continue
                fm, body = result

                # 与导出到 master 的 label 一致：用文件名（无 .md）。子目录内文件也会被 os.walk 扫到。
                concept_name = fname.replace(".md", "")
                node_id = f"concept-{slugify(concept_name)}"
                arch_id = fm.get("architecture-node-id", fm.get("architecture_node_id", ""))
                tags = _frontmatter_tags(fm)

                props = {
                    "name": concept_name,
                    "title": fm.get("title", concept_name),
                    "category_path": _normalize_category_path(fm.get("category-path", "")),
                    "file_path": os.path.relpath(filepath, VAULT_ROOT).replace("\\", "/"),
                    "tags": tags,
                }
                if arch_id:
                    # master_graph 契约：只写下划线字段名（YAML 仍可使用 architecture-node-id）
                    props["architecture_node_id"] = arch_id
                concept_labels = ["Concept"]
                if _is_promoted_arch_component(fm):
                    concept_labels.append("ArchitectureComponent")
                    raw_layer = str(fm.get("arch_layer", fm.get("layer", "")) or "").strip()
                    raw_category = str(fm.get("arch_category", "") or "").strip()
                    raw_subdomain = str(fm.get("arch_subdomain", "") or "").strip()
                    props.update({
                        "arch_component": True,
                        "arch_layer": raw_layer,
                        "arch_layer_canonical": schema_loader.normalize_architecture_value("arch_layer", raw_layer),
                        "arch_category": raw_category,
                        "arch_category_canonical": schema_loader.normalize_architecture_value("arch_category", raw_category),
                        "arch_subdomain": raw_subdomain,
                        "arch_subdomain_canonical": schema_loader.normalize_architecture_value("arch_subdomain", raw_subdomain),
                        "arch_status": fm.get("arch_status", fm.get("status", "")),
                    })

                snippet = _snippet_from_concept_body(body, fm)
                if snippet:
                    props["definition"] = snippet[:2000]

                nodes.append({"id": node_id, "labels": concept_labels, "properties": props})
                name_to_id[concept_name] = node_id

                # Extract wikilinks as REFERENCES (resolve using name_to_id)
                for m in re.finditer(r'\[\[([^\]]+)\]\]', body):
                    target_name = m.group(1)
                    target_id = name_to_id.get(target_name)
                    if target_id:
                        edges.append({
                            "source": node_id,
                            "target": target_id,
                            "type": "REFERENCES",
                            "properties": {"source": "concept-body", "reviewStatus": "pending"},
                        })

        except Exception as e:
            _record_extract_error(filepath, "concept", e)
            continue
    return nodes, edges


# ── Step 7: 全库 .md → Document 节点 + DOCUMENTS 边 ──

def extract_document_nodes(arch_node_ids, name_to_id, concept_names, old_doc_props=None, admitted_article_paths=None):
    nodes = []
    edges = []
    doc_bodies = []  # pass 2: (doc_id, body, source_file, source_hash, line_offset) 待扫正文 wikilink
    doc_id_set = set()  # 全部 Document 节点 id，用于裸链仅对 Document 目标产出 REFERENCES
    unclassified_docs = []  # 收集无 module 的文档
    version_pending_docs = []  # 收集有 module 但无 version 的文档，在 cockpit「文档版本审核」处理
    version_nodes_by_key = {}  # (product, version) → version_node_id
    body_version_pending = []  # (doc_id, product, set of version strings)
    if old_doc_props is None:
        old_doc_props = {}

    # Directories to scan for Document nodes
    scan_dirs = [
        os.path.join(VAULT, "raw", "precleaned"),
        os.path.join(VAULT, "wiki", "articles"),
        os.path.join(VAULT, "wiki", "sources"),
        os.path.join(VAULT, "wiki", "overview"),
        os.path.join(VAULT, "wiki", "queries"),
        os.path.join(VAULT, "wiki", "comparisons"),
        os.path.join(VAULT, "wiki", "todo"),
    ]
    precleaned_prefix = os.path.relpath(os.path.join(VAULT, "raw", "precleaned"), VAULT).replace(os.sep, "/")
    approved_articles_prefix = os.path.relpath(os.path.join(VAULT, "wiki", "articles"), VAULT).replace(os.sep, "/")

    for scan_dir in scan_dirs:
        # WP-117 批2：遍历面改信封过滤——七根各按原根前缀过滤（原 os.walk 口径：剪 .git/.obsidian/
        # Attachments 目录名〔任意层〕；根缺失＝空清单与原 isdir 跳过同形；准入模式 precleaned
        # 整跳、articles 只留批准快照的原 abspath 判定改前缀等价形；目录序由 scandir 序改字典
        # 稳定序——原序平台相关非契约，如实记）
        scan_prefix = os.path.relpath(os.path.abspath(scan_dir), VAULT).replace(os.sep, "/")
        for root, dir_docs in _doc_envelope_walk_md_docs(
            scan_prefix, skip_dir_names=(".git", ".obsidian", "Attachments")
        ):
            for fname, kb_rel, doc in dir_docs:
                try:
                        if not fname.endswith(".md"):
                            continue
                        filepath = _doc_abs(kb_rel)
                        rel_path = os.path.relpath(filepath, VAULT_ROOT).replace(os.sep, "/")
                        if admitted_article_paths is not None:
                            if scan_prefix == precleaned_prefix:
                                continue
                            if scan_prefix == approved_articles_prefix and rel_path not in admitted_article_paths:
                                continue
                        result = parse_frontmatter(doc["fmText"], doc["body"])
                        if not result:
                            continue
                        fm, body = result

                        knowledge_rel_path = os.path.relpath(filepath, VAULT)
                        rel_path = os.path.relpath(filepath, VAULT_ROOT)
                        article_id = str(fm.get("article_id", "") or "").strip()
                        doc_id = f"doc-article-{slugify(article_id)}" if article_id else node_id_for_file(knowledge_rel_path)
                        product, inferred_version = _infer_product_version(fm, knowledge_rel_path)

                        symptoms_preview = _extract_symptoms_preview(body)
                        health_score = _parse_dataview_health(body)

                        props = {
                            "title": fm.get("title", fname.replace(".md", "")),
                            "file_path": rel_path,
                            "category_path": _normalize_category_path(fm.get("category-path", "")),
                            "product": product,
                            "version": inferred_version,
                            "version_range": str(fm.get("version_range", fm.get("version-range", ""))).strip(),
                            "article_type": fm.get("article_type", ""),
                            "doc_type": fm.get("doc-type", fm.get("doc_type", "")),
                            "status": fm.get("status", ""),
                            "quality": _parse_quality(fm.get("quality")),
                            "symptoms_preview": symptoms_preview,
                            "article_id": article_id,
                            "source_path": rel_path.replace(os.sep, "/"),
                            "source_hash": _source_sha256(doc),
                        }
                        admission_coordinate = ADMISSION_COORDINATES.get(rel_path.replace(os.sep, "/"), {})
                        if admission_coordinate.get("admissionBatchId"):
                            props["admission_batch_id"] = admission_coordinate["admissionBatchId"]
                        if health_score is not None:
                            props["health_score"] = health_score

                        module_raw = _clean_wikilink(str(fm.get("module", "")))
                        if not module_raw and re.search(r"MariaDB\s+[\d.]+.*内置Proton RDS", body, re.I | re.S):
                            module_raw = "MariaDB"

                        # 无 module → 自动推断兜底（保证生成关系），同时进待审核
                        is_inferred = False
                        if not module_raw:
                            module_raw = _infer_module_from_context(rel_path, fname, fm, body)
                            if module_raw:
                                is_inferred = True
                                props["_inferred_module"] = True  # 标记为推断

                        if module_raw:
                            props["module"] = module_raw
                            role = _component_role(module_raw)
                            if role:
                                props["component_role"] = role
                            # _learn_module(module_raw)  # DISABLED: auto-learn removed
                            if module_raw not in schema_loader.module_names():
                                sys_name = module_raw.lower().replace(" ", "-")
                                print(f"    ⚠️  未注册模块 \"{module_raw}\"（文档: {fname}），请在词表 modules 段（经页面或写客户端）添加:")
                                print(f"        {module_raw}:")
                                print(f"          subdomain: general")
                                print(f"          system: {sys_name}")
                                print(f"          since: 7.0.0")
                                print(f"          until: ''")

                            # ── version 三角校验 ──
                            doc_version = str(fm.get("version", "") or "").strip()
                            doc_version = doc_version.strip('"\'')
                            old_props = old_doc_props.get(doc_id, {})
                            old_version = str(old_props.get("version", "") or "").strip().strip('"\'')
                            old_version_recorded = str(old_props.get("_version_recorded", "") or "").strip().strip('"\'')

                            if not doc_version:
                                # 无 version → 进 version pending 审核
                                props["_version_pending"] = True
                                version_pending_docs.append({
                                    "id": doc_id,
                                    "file_path": rel_path,
                                    "title": fm.get("title", fname.replace(".md", "")),
                                    "product": product,
                                    "remarks": str(fm.get("remarks", "") or ""),
                                })
                            elif old_version_recorded and doc_version != old_version_recorded:
                                # version 有值但和上次记录的不同 → 可能是用户手动改了，也可能是前端审核回写了
                                props["_version_recorded"] = doc_version
                                if doc_version == old_version:
                                    # 与 master_graph 当前值一致（前端已回写且覆盖了 master）
                                    # 清除所有 pending 标记
                                    props.pop("_version_pending", None)
                                    props.pop("_version_conflict", None)
                                else:
                                    # frontmatter 变了但 master_graph 还没跟上（用户手动改了）
                                    # 以 frontmatter 为准，标记为已确认
                                    props["_version_recorded"] = doc_version
                                    props.pop("_version_pending", None)
                                    props.pop("_version_conflict", None)
                            else:
                                # version 有值且一致 → 正常，记录当前值
                                props["_version_recorded"] = doc_version
                                props.pop("_version_pending", None)
                                props.pop("_version_conflict", None)
                        else:
                            # 既无 module 也无法自动推断 → 收集到待审核列表
                            unclassified_docs.append({
                                "id": doc_id,
                                "file_path": rel_path,
                                "title": fm.get("title", fname.replace(".md", "")),
                                "product": product,
                                "version": inferred_version,
                                "suggested_module": None,
                            })

                        # Auto-learn disabled: unregistered tags must be added manually in the vocab (enums)
                        for tag in (fm.get("tags") or []):
                            if isinstance(tag, str) and tag not in schema_loader.tags():
                                print(f"    ⚠️  未注册标签 \"{tag}\"（文档: {fname}），请在词表 tags 段（经页面或写客户端）手动添加。")

                        nodes.append({"id": doc_id, "labels": ["Document"], "properties": props})

                        # ── doc↔doc 直连链路：注册文档标题/article_id 进解析表，并收集正文待扫 ──
                        doc_id_set.add(doc_id)
                        _doc_title = props.get("title", "")
                        if _doc_title and _doc_title not in name_to_id:
                            name_to_id[_doc_title] = doc_id
                        _doc_aid = str(props.get("article_id", "") or "")
                        if _doc_aid and _doc_aid not in name_to_id:
                            name_to_id[_doc_aid] = doc_id
                        doc_bodies.append((
                            doc_id,
                            body,
                            rel_path,
                            props.get("source_hash", ""),
                            _frontmatter_line_offset(doc["fmText"]),
                        ))

                        product = props.get("product", "")
                        version = props.get("version", "")
                        version_range = props.get("version_range", "")
                        product_node_id = ""
                        version_node_id = ""
                        product_identity = None
                        if product:
                            # G1+G5（PR-020 批5）：未注册产品照建节点但带 unregistered_product 标记
                            # （治理页可暴露，wild_tag 同款"不拦截、标记后治理"先例）；reserved 不建节点。
                            product_identity = schema_loader.resolve_product_identity(product)
                            if product_identity["reserved"]:
                                product = ""
                        if product:
                            product_node_id = _product_id(product)
                            product_props = {"name": product, "title": product}
                            if product_identity and not product_identity["registered"]:
                                product_props["unregistered_product"] = True
                            nodes.append({
                                "id": product_node_id,
                                "labels": ["Product"],
                                "properties": product_props,
                            })
                            edges.append({
                                "source": doc_id,
                                "target": product_node_id,
                                "type": "APPLIES_TO",
                                "properties": {"source": "document-frontmatter", "product": product, "weight": 0.9},
                            })
                            if version:
                                version_node_id = _version_id(product, version)
                                nodes.append({
                                    "id": version_node_id,
                                    "labels": ["ProductVersion"],
                                    "properties": {
                                        "name": f"{product} {version}",
                                        "title": f"{product} {version}",
                                        "product": product,
                                        "version": version,
                                        "versionRange": f"={version}",
                                    },
                                })
                                edges.append({
                                    "source": product_node_id,
                                    "target": version_node_id,
                                    "type": "HAS_VERSION",
                                    "properties": {"product": product, "version": version, "weight": 1.0},
                                })
                                edges.append({
                                    "source": doc_id,
                                    "target": version_node_id,
                                    "type": "APPLIES_TO",
                                    "properties": {"source": "document-frontmatter", "product": product, "version": version, "weight": 1.0},
                                })
                                version_nodes_by_key[(product, version)] = version_node_id

                        # ── 正文版本号扫描：跳过（版本节点仅由 frontmatter version 生成）──
                        # body_versions = set(re.findall(r'\b(\d+\.\d+\.\d+(?:\.\d+)?)\b', body))
                        # if product and body_versions:
                        #     body_version_pending.append((doc_id, product, body_versions))

                        has_direct_docs = False
                        module_target_id = ""

                        # DOCUMENTS edge: Document → System/Module via module field
                        def _doc_edge_props(mapping, is_official):
                            p = {"mapping": mapping, "is_official": is_official}
                            if inferred_version:
                                p["version"] = inferred_version
                            vr = str(fm.get("version_range", fm.get("version-range", ""))).strip()
                            if vr:
                                p["version_range"] = vr
                            at = str(fm.get("article_type", "")).strip()
                            if at:
                                p["article_type"] = at
                            return p

                        # Slice 2: module field no longer generates DOCUMENTS edges.
                        # DOCUMENTS only from explicit architecture_associations.
                        # module_target_id still resolved for version edge logic.
                        if module_raw and module_raw in MODULE_SYSTEM_MAP and MODULE_SYSTEM_MAP.get(module_raw):
                            sys_id = MODULE_SYSTEM_MAP[module_raw]
                            if sys_id in arch_node_ids:
                                module_target_id = sys_id
                            elif module_raw in name_to_id:
                                module_target_id = name_to_id[module_raw]
                        elif module_raw and module_raw in name_to_id:
                            module_target_id = name_to_id[module_raw]

                        # ADR009 R9：USES 关系已裁定删除，不再产出 USES 边。
                        # （原 product+module_target_id → USES 边生成逻辑已移除；
                        #   存量 USES 边由下方合并过滤统一剔除。）

                        # BELONGS_TO → Subdomain：文档挂载到域，构建独立导航维度
                        # 若目标 Subdomain 节点尚不存在则自动创建（连同父级 BusinessDomain）
                        cp = _normalize_category_path(fm.get("category-path", ""))
                        if cp:
                            cp_parts = cp.split(":")
                            if len(cp_parts) >= 2:
                                domain_id = cp_parts[0]
                                subdomain_id = f"{domain_id}:{cp_parts[1]}"
                                _ensure_subdomain_node(nodes, edges, domain_id, subdomain_id)
                                # WP-005：挂载属性化——就地写入已入列的 doc 节点属性
                                for _n in reversed(nodes):
                                    if _n["id"] == doc_id:
                                        _n["properties"]["subdomain_id"] = subdomain_id
                                        _n["properties"]["domain_id"] = domain_id
                                        break

                        # Slice 2: category-path indirect DOCUMENTS removed.
                        # DOCUMENTS only from explicit architecture_associations.

                        # REFERENCES edges: wikilinks in body (weight by occurrence count)
                        ref_counts = {}
                        for m in re.finditer(r'\[\[([^\]]+)\]\]', body):
                            target_name = m.group(1)
                            target_id = name_to_id.get(target_name) or name_to_id.get(target_name.strip())
                            if target_id:
                                ref_counts[target_id] = ref_counts.get(target_id, 0) + 1
                        for tid, count in ref_counts.items():
                            edges.append({
                                "source": doc_id,
                                "target": tid,
                                "type": "REFERENCES",
                                "properties": {"source": "document-body",
                                               "weight": round(min(0.9, 0.3 + count * 0.2), 2),
                                               "reviewStatus": "pending"},
                            })

                        # MENTIONS edges: keyword matching (weight by density + position)
                        body_lower = body.lower()
                        title_lower = str(fm.get("title", "")).lower()
                        for concept_name, concept_id in concept_names.items():
                            if len(concept_name) >= 2 and concept_name.lower() in body_lower:
                                count = body_lower.count(concept_name.lower())
                                in_title = concept_name.lower() in title_lower
                                base = 0.4 if in_title else 0.2
                                w = min(0.8, base + count * 0.1)
                                if len(concept_name) <= 3:
                                    w -= 0.15
                                edges.append({
                                    "source": doc_id,
                                    "target": concept_id,
                                    "type": "MENTIONS",
                                    "properties": {"method": "keyword-match", "keyword": concept_name,
                                                   "weight": round(max(0.1, w), 2),
                                                   "reviewStatus": "pending"},
                                })

                        # HAS_SYMPTOM edges: 排错指南 docs → Concept nodes via tag matching
                        article_type = str(fm.get("article_type", ""))
                        if article_type == "排错指南":
                            doc_tags = _frontmatter_tags(fm)
                            matched_concepts = set()
                            for tag in doc_tags:
                                tag_lower = tag.lower()
                                for concept_name, concept_id in concept_names.items():
                                    if concept_id in matched_concepts:
                                        continue
                                    cn_lower = concept_name.lower()
                                    if tag == concept_name or (len(tag) >= 2 and (tag_lower in cn_lower or cn_lower in tag_lower)):
                                        matched_concepts.add(concept_id)
                                        edges.append({
                                            "source": doc_id,
                                            "target": concept_id,
                                            "type": "HAS_SYMPTOM",
                                            "properties": {"method": "tag-match", "tag": tag,
                                                           "weight": 0.7,
                                                           "reviewStatus": "pending"},
                                        })

                except Exception as e:
                    _record_extract_error(locals().get("filepath", os.path.join(VAULT, kb_rel)), "document", e)
                    continue

            # ── 正文版本血缘解析：将 body 中检测到的版本号挂载到已有 ProductVersion 节点 ──
            body_version_edges = 0
            for doc_id, product, body_versions in body_version_pending:
                for bv in body_versions:
                    vid = version_nodes_by_key.get((product, bv))
                    if not vid:
                        # 正文版本号可能没有对应的 frontmatter version，动态创建版本节点
                        vid = _version_id(product, bv)
                        version_nodes_by_key[(product, bv)] = vid
                        nodes.append({
                            "id": vid,
                            "labels": ["ProductVersion"],
                            "properties": {
                                "name": f"{product} {bv}",
                                "title": f"{product} {bv}",
                                "product": product,
                                "version": bv,
                                "versionRange": f"={bv}",
                            },
                        })
                        nodes.append({
                            "id": _product_id(product),
                            "labels": ["Product"],
                            "properties": {"name": product, "title": product},
                        })
                        edges.append({
                            "source": _product_id(product),
                            "target": vid,
                            "type": "HAS_VERSION",
                            "properties": {"product": product, "version": bv, "weight": 1.0,
                                           "reviewStatus": "pending"},
                        })
                    edges.append({
                        "source": doc_id,
                        "target": vid,
                        "type": "APPLIES_TO",
                        "properties": {"source": "document-body-version", "product": product, "version": bv, "weight": 0.85,
                                       "reviewStatus": "pending"},
                    })
                    body_version_edges += 1
            if body_version_edges:
                print(f"    → {body_version_edges} 条正文版本血缘边 (APPLIES_TO)")

    # ── Pass 2：文档正文 wikilink → REFERENCES（doc↔doc 直连链路；仅产出 REFERENCES，避免文档引入未经 YAML 校验的 DEPENDS_ON 等边）──
    _doc_ref_edges = 0
    for _d in doc_bodies:
        _doc_id, _body, _sf, _sh, _lo = _d
        _doc_ref_edges += _extract_document_references(_doc_id, _body, edges, name_to_id, doc_id_set, _sf, _sh, _lo)
    if _doc_ref_edges:
        print(f"    → {_doc_ref_edges} 条文档正文 REFERENCES 边（含 doc↔doc 直连）")

    return nodes, edges, unclassified_docs, version_pending_docs


def apply_article_association_overrides(nodes, edges):
    # WP-054 E-B（SPEC-049 X3）：article_associations 经信封取件——软缺件语义逐字保持
    # （缺件→边不变）；解析失败 warn 面保持。坏信封 fail-closed（vocab_envelope 显式抛错）。
    from vocab_envelope import load_envelope, VocabEnvelopeError
    try:
        envelope = load_envelope()
    except VocabEnvelopeError as error:
        print(f"  ⚠️ 文章关联覆盖读取失败: {error}")
        return edges
    if not envelope.has("article_associations"):
        return edges
    data = envelope.doc("article_associations") or {}
    documents = {
        node.get("properties", {}).get("article_id"): node
        for node in nodes
        if "Document" in node.get("labels", []) and node.get("properties", {}).get("article_id")
    }
    result = list(edges)
    for decision in data.get("decisions", []):
        article_id = str(decision.get("articleId", "") or "").strip()
        document = documents.get(article_id)
        if not document:
            continue
        props = document.get("properties", {})
        if props.get("source_hash") != decision.get("candidateSourceHash"):
            props["association_override_stale"] = True
            continue
        document_id = document.get("id")
        action = decision.get("action")
        component_ids = set(decision.get("componentIds") or [])
        version_ids = set(decision.get("versionIds") or [])
        if action == "replace":
            result = [edge for edge in result if not (
                edge.get("source") == document_id and (
                    edge.get("type") == "DOCUMENTS" or
                    (edge.get("type") == "APPLIES_TO" and str(edge.get("target", "")).startswith("version-"))
                )
            )]
        elif action == "remove":
            result = [edge for edge in result if not (
                edge.get("source") == document_id and (
                    (edge.get("type") == "DOCUMENTS" and edge.get("target") in component_ids) or
                    (edge.get("type") == "APPLIES_TO" and edge.get("target") in version_ids)
                )
            )]
        if action in {"add", "replace"}:
            source_coordinates = {
                "source": "article-association-override",
                "decisionId": decision.get("decisionId"),
                "articleId": article_id,
                "candidateSourcePath": decision.get("candidateSourcePath"),
                "candidateSourceHash": decision.get("candidateSourceHash"),
                "admissionBatchId": decision.get("admissionBatchId"),
            }
            existing = {(edge.get("source"), edge.get("target"), edge.get("type")) for edge in result}
            for target in sorted(component_ids):
                if (document_id, target, "DOCUMENTS") not in existing:
                    result.append({"source": document_id, "target": target, "type": "DOCUMENTS", "properties": dict(source_coordinates)})
            for target in sorted(version_ids):
                if (document_id, target, "APPLIES_TO") not in existing:
                    result.append({"source": document_id, "target": target, "type": "APPLIES_TO", "properties": dict(source_coordinates)})
        props["association_decision_id"] = decision.get("decisionId")
    return result


def _clean_wikilink(val):
    """Strip wikilink brackets and quotes from frontmatter values."""
    return val.strip("[]\"'").replace("[[", "").replace("]]", "")


def _subdomain_to_system(subdomain):
    """Map a subdomain slug to a primary System node ID."""
    mapping = {
        "cluster": "ecms-cluster", "database": "mysql", "storage": "ceph-eceph",
        "network": "calico", "auth": "access-control", "search": "opensearch",
        "gateway": "content-service", "client": "user-endpoints", "upgrade": "ecms-cluster",
        "console": "user-endpoints", "office": "office-online", "security": "cert-management",
        "infra": "kubernetes", "os": "os-support", "general": "crm-ticket",
        "deploy": "kubernetes", "backup": "xtrabackup", "monitor": "kubernetes",
        "config": "kubernetes", "maintain": "ecms-cluster",
    }
    return mapping.get(subdomain)


# ── PR-095：断言政策驱动的出生章 ─────────────────────────────────────────────
# decision_mode→出生章：deterministic（规则即有效）/ inherit_source_approval（来源审过边继承，
# 须能指回裁定证据 decisionId）。reviewed/derived_only/forbidden/未知一律 pending——
# 执法找不到声明时不许自作主张放行（fail-closed）。
# 政策唯一源＝ontology.yaml relation_types[].assertion_policies（经 schema_loader 装载）；
# 边源标签（properties.source）与政策 source_kind 同名对位，对不上且政策不唯一 → pending。


def _policy_review_status(edge_type, props, relation_policies):
    """按（关系类型, 边源标签）查断言政策，返回出生 reviewStatus。纯函数，测试直吃。"""
    policies = relation_policies.get(edge_type) or []
    if not policies:
        return "pending"
    source_label = str(props.get("source") or "")
    policy = None
    for candidate in policies:
        if candidate.get("source_kind") == source_label:
            policy = candidate
            break
    if policy is None and len(policies) == 1:
        policy = policies[0]
    mode = policy.get("decision_mode") if policy else None
    if mode == "deterministic":
        return "deterministic"
    if mode == "inherit_source_approval":
        if props.get("decisionId") or props.get("association_decision_id"):
            return "inherited_approved"
    return "pending"


# ── 承运边闸门（PR-095 补口）────────────────────────────────────────────────
# 实证缺陷（2026-10-28）：出生章与拒产闸只作用于「本次提取新产出」的边（all_edges）；
# 承运边（本次不再产出、靠既有图 existing_only 继承的存量边）只在 approved/rejected 时
# 降级 pending，既不按政策重盖章、也不随关系类型退役而剔除。后果：WP-005 停发的
# 60 条 subdomain→domain BELONGS_TO 僵尸边永久滞留，且始终以 pending 身份堵在
# 「待审核关系」队列里（其政策实为 deterministic）——重启服务、重跑管道都无效，
# 因为每次重建都被 existing_only 原样继承回来。故两道闸必须对承运边同样生效。

_RETIRED_EDGE_RULES = (
    ("USES（ADR009 R9 已裁定删除，生产者停发）",
     lambda et, props: et == "USES"),
    ("team-placeholder 占位边（PR-018② 政策 working_projection: never）",
     lambda et, props: props.get("source") == "team-placeholder"),
    ("BELONGS_TO 骨架/挂载边（WP-005 停发：结构走属性轴 subdomain_id/domain_id）",
     lambda et, props: et == "BELONGS_TO"),
)


def _edge_type(edge):
    """边的类型读取（图产物两套键名并存：relationType / type）。"""
    return edge.get("relationType") or edge.get("type") or ""


def _edge_props(edge):
    props = edge.get("properties")
    return props if isinstance(props, dict) else {}


def _retired_edge_reason(edge):
    """退役关系判定：命中即物理剔除——退役产物不得借增量合并复活（P0 公理⑤）。"""
    et = _edge_type(edge)
    props = _edge_props(edge)
    for reason, hit in _RETIRED_EDGE_RULES:
        if hit(et, props):
            return reason
    return None


def _carried_edge_review_status(edge, relation_policies):
    """承运边按断言政策重盖章：旧图章不是事实源（ADR054 D2 账本为准），政策才是。"""
    return _policy_review_status(_edge_type(edge), _edge_props(edge), relation_policies)


def _inactive_relation_reason(edge, relation_lifecycle):
    """ADR-014 §4.1：已定义但非 approved 的关系类型不得进入新产出（纯函数，测试直吃）。

    与断言政策闸分工：政策闸管「现役关系的产出方式」（derived_only/forbidden）；
    本闸管「关系本身是否现役」——非现役关系即便有政策也不得产出。
    """
    edge_type = _edge_type(edge)
    status = relation_lifecycle.get(edge_type)
    if status is None or status == "approved":
        return None
    return f"{edge_type}（lifecycle_status={status}）"


def _policy_forbids_production(edge_type, props, relation_policies):
    """WP-006 第3项（结构式执法）：政策 decision_mode∈{derived_only, forbidden}
    （≡ working_projection=never，装载校验钉死的函数关系）→ 该边**产线拒产**。
    违规产物物理不出现，而非事后过滤（P0 公理⑤：结构优于稽查）。纯函数，测试直吃。"""
    policies = relation_policies.get(edge_type) or []
    if not policies:
        return False
    source_label = str(props.get("source") or "")
    policy = None
    for candidate in policies:
        if candidate.get("source_kind") == source_label:
            policy = candidate
            break
    if policy is None and len(policies) == 1:
        policy = policies[0]
    mode = policy.get("decision_mode") if policy else None
    return mode in ("derived_only", "forbidden")


# ── 枚举自动学习 ──



# 〔closeout 批删除〕_learn 收集器——落盘点已随 SPEC-021 退役，收集无消费，删。

# 〔closeout 批删除〕_learn 收集器——落盘点已随 SPEC-021 退役，收集无消费，删。

# 〔Master 加固批③：物理删除〕_flush_learnt_enums 死代码已移除（原顾问式 no-op——自动注册
# 裸写于 SPEC-021 波 B 退役，本批消除复活面）。习得项登记经统一写客户端：
#   node schema-write-client.mjs modules-upsert --name <模块> --system <实体> --subdomain <子域>

# ── 缺页自动补链 ──

def _growth_default_status():
    """实体生长模板初始 status（PR-284）：取词表盖章缺省——TheSchema lifecycle.default_status
    声明面（状态机语义宿主＝contracts/entity-readiness-rules.json.statusMachine.default，灰度），
    legacy 三值硬编码退役。缺省缺席或不在受控值域＝写路径硬错，不回落猜测。"""
    default = schema_loader.default_status()
    values = schema_loader.status_values()
    if not default or default not in values:
        raise RuntimeError(
            "实体生长模板初始 status 取数失败：词表 lifecycle.default_status 缺席或不在"
            f" lifecycle.status 受控值域（default={default!r}, values={sorted(values)}）——"
            "检查 TheSchema enums.lifecycle（status 四受控值＋default_status 盖章缺省）"
        )
    return default


def _ensure_entity_stubs(name_to_id):
    """Create stub wiki/entity pages for frontmatter wikilinks that have no page."""
    entity_dir = os.path.join(VAULT, "wiki", "entities")
    os.makedirs(entity_dir, exist_ok=True)

    created = []
    for name in name_to_id:
        filepath = os.path.join(entity_dir, f"{name.replace('/', '-')}.md")
        if os.path.exists(filepath):
            continue
        content = f"""---
title: {name}
date: {datetime.now().strftime('%Y-%m-%d')}
tags:
  - 待分类
status: {_growth_default_status()}
---

# {name}

## 概述

（自动创建的占位页面，待补充内容）

## 来源

## 关联实体

## 关联概念
"""
        # WP-015/SPEC-077：占位页创建改经统一写通道——人改裁决门＋建页即登记机器基线
        from write_gateway import write_text_atomic as _wta
        _wta(filepath, content)
        created.append(name)

    if created:
        print(f"📄 自动创建 {len(created)} 个实体占位页: {', '.join(created)}")


# ── 边权重赋值 ──

def _assign_structural_weights(edges):
    """Add weight to edges that don't already have one (structural / entity / concept edges)."""
    for e in edges:
        props = e.setdefault("properties", {})
        if "weight" in props:
            continue
        etype = e["type"]
        if etype in ("BELONGS_TO", "DEPENDS_ON"):
            props["weight"] = 1.0
        elif etype == "DOCUMENTS":
            props["weight"] = 0.9 if props.get("mapping") == "direct-module" else 0.5
        elif etype == "REFERENCES":
            src = props.get("source", "")
            section = props.get("source_section", "")
            if section == "关联实体" or src == "entity-wikilink":
                props["weight"] = 0.7
            elif section == "关联概念":
                props["weight"] = 0.6
            elif src == "concept-body":
                props["weight"] = 0.5
            else:
                props["weight"] = 0.4
        elif etype == "MENTIONS":
            props["weight"] = 0.3
        elif etype == "HAS_SYMPTOM":
            props["weight"] = 0.7
        else:
            props["weight"] = 0.5


# ── Step 8: 占位 Team 节点 ──

def extract_team_nodes():
    return [
        {"id": "team-unassigned", "labels": ["Team"],
         "properties": {"name": "待分配", "is_placeholder": True}}
    ]


def _health_from_statuses(statuses: list[str], expires_dates: list[str]) -> str:
    """聚合文档状态 → Plate 健康灯（PR-284：legacy 三值经 legacy_status_map 归一到四值状态机再判定，
    值域单源＝TheSchema lifecycle.status／contracts/entity-readiness-rules.json.statusMachine）。

    green:  全部在线且未过期
    yellow: 含灰度文档（在途），或 30 天内即将过期
    red:    含退役／已驳回文档（驳族群——reject 主轨落退役、独立值已驳回），或已过期
    """
    from datetime import date, datetime
    today = date.today()
    has_archived = False
    has_draft = False
    has_expiring = False

    for i, s in enumerate(statuses):
        normalized = schema_loader.normalize_status(str(s))
        if normalized in ("退役", "已驳回"):
            has_archived = True
        if normalized == "灰度":
            has_draft = True
        exp_str = expires_dates[i] if i < len(expires_dates) else ""
        if exp_str:
            try:
                exp_date = datetime.strptime(str(exp_str)[:10], "%Y-%m-%d").date()
                days_left = (exp_date - today).days
                if days_left < 0:
                    has_archived = True  # 已过期 → red
                elif days_left <= 30:
                    has_expiring = True
            except (ValueError, TypeError):
                pass

    if has_archived:
        return "red"
    if has_draft or has_expiring:
        return "yellow"
    return "green"


# ── 板块四轴常量（系统设定的固定板块类型 · G4 2026-09-14：四轴统一收回代码）──
# 四轴 = business（业务能力域）/ scene（场景升级）/ publication（出版物手册）/ component（组件报错）。
# 轴 = 系统固定类型；板块实例 = 内容聚合产物。
# 轴 0 路由表：doc_type / article_type → 业务板块名
BUSINESS_PLATE_ROUTES = {
    "用户手册": "内容管理与协作",
    "部署指南": "集成与API网关",
    "配置手册": "集成与API网关",
    "运维手册": "可观测性与运维",
    "技术文档": "集成与API网关",
    "巡检手册": "可观测性与运维",
    "升级经验": "可观测性与运维",
    "排错指南": "可观测性与运维",
    "常见问题": "可观测性与运维",
}
# 业务板块注册表：板块名 → {domain slug, description}
# description 为释义，待 L3 术语表建成后按 C3 搬入（届时可从此处删除）
BUSINESS_PLATES = {
    "内容管理与协作": {"domain": "content-collaboration", "description": "文档管理、在线编辑、知识中心、工作中心等"},
    "搜索与知识发现": {"domain": "search-discovery", "description": "全文检索、智能搜索、知识图谱"},
    "安全与合规": {"domain": "security-compliance", "description": "访问控制、证书管理、数据加密、漏洞管理"},
    "数据与存储": {"domain": "data-storage", "description": "MySQL、MongoDB、Ceph、OpenSearch 等存储基础设施"},
    "集成与API网关": {"domain": "integration-gateway", "description": "REST API、OSS 网关、第三方集成"},
    "可观测性与运维": {"domain": "observability-ops", "description": "监控、巡检、排错、升级、备份恢复"},
    "AI与智能服务": {"domain": "ai-intelligence", "description": "认知助手、内容机器人、智能搜索"},
}


def extract_plate_nodes(all_nodes, external_node_ids):
    """从 Document 节点聚合生成 Plate 节点（四轴概念晋升，每轴独立硬门控）。

    四轴 = 系统设定的固定板块类型；板块实例由内容聚合产生（内容 ⊇ 轴类型）。

    轴 0 — 业务能力域：(doc_type/article_type 路由) 聚合
      门控: doc_type / article_type 命中 BUSINESS_PLATE_ROUTES
      Plate 命名: 命中的业务板块名

    轴 1 — 场景/升级：(product, module) 聚合
      门控: article_type=="升级经验" + category-path 子域 upgrade + version 含 "→"
      Plate 命名: "{产品} {模块} 版本升级"

    轴 2 — 出版物/手册：(product, doc_type) 聚合
      门控: doc_type ∈ {用户手册, 部署指南, 配置手册, 运维手册, 技术文档, 巡检手册}
      Plate 命名: "{产品} {文档类型}"

    轴 3 — 组件/报错：(product, module, article_type) 聚合
      门控: article_type ∈ {排错指南, 常见问题} + module 非空
      Plate 命名: "{产品} {模块} {文章类型}"

    每块 Plate 自动计算：
    - doc_count：下属文档数
    - health：green/yellow/red（基于文档 status 聚合）
    - health_score：基于文档 quality 的均值（0-10）

    边拓扑：
    - (Document) -[:BELONGS_TO]-> (Plate)
    - (Plate) -[:ASSOCIATED_WITH]-> (Product)
    - (Plate) -[:ASSOCIATED_WITH]-> (System/Module)  — 聚合去重自文档 module 字段
    - (Plate) -[:APPLIES_TO]-> (ProductVersion)        — 聚合去重自文档 version 字段
    """
    doc_nodes = [n for n in all_nodes if "Document" in n.get("labels", [])]
    if not doc_nodes:
        return [], []

    # ── 建立已有节点 ID 查找表 ──
    node_by_id = {n["id"]: n for n in all_nodes}
    product_id_set = external_node_ids.get("product_ids", set())
    module_id_set = external_node_ids.get("module_ids", set())
    version_id_set = external_node_ids.get("version_ids", set())

    # ── 轴 0 — 业务能力域（business）：四轴统一收回代码（G4），不再读 enums 配置 ──
    # 按业务能力域分组文档（doc_type / article_type → BUSINESS_PLATE_ROUTES → business plate）
    domain_groups: dict[str, list] = {name: [] for name in BUSINESS_PLATES}
    for doc in doc_nodes:
        props = doc.get("properties", {})
        prod = props.get("product", "").strip()
        dt = props.get("doc_type", "").strip()
        at = props.get("article_type", "").strip()
        if not prod:
            continue
        biz_plate = BUSINESS_PLATE_ROUTES.get(dt) or BUSINESS_PLATE_ROUTES.get(at)
        if biz_plate and biz_plate in domain_groups:
            domain_groups[biz_plate].append(doc)

    nodes = []
    edges = []
    seen_plate_ids = set()

    def _make_plate(plate_id, name, product, axis, docs=None):
        """创建单个 Plate 节点及其所有关联边。"""
        if plate_id in seen_plate_ids:
            return
        docs = docs or []
        seen_plate_ids.add(plate_id)

        # 聚合文档状态
        statuses = [d.get("properties", {}).get("status", "") for d in docs]
        qualities = []
        for d in docs:
            q = d.get("properties", {}).get("quality")
            if isinstance(q, (int, float)):
                qualities.append(q)
        doc_count = len(docs)
        health = _health_from_statuses(
            statuses,
            [d.get("properties", {}).get("expires", "") for d in docs],
        )
        health_score = round(sum(qualities) / len(qualities), 1) if qualities else 0.0

        # 聚合唯一 module
        unique_modules = set()
        for d in docs:
            m = d.get("properties", {}).get("module", "").strip()
            m = m.removeprefix("[[").removesuffix("]]")
            if m:
                unique_modules.add(m)

        # 聚合唯一 version key
        unique_versions = set()
        for d in docs:
            v = d.get("properties", {}).get("version", "").strip()
            if v:
                unique_versions.add(v)

        nodes.append({
            "id": plate_id,
            "labels": ["Plate"],
            "properties": {
                "name": name,
                "product": product,
                "axis": axis,
                "doc_count": doc_count,
                "health": health,
                "health_score": health_score,
                "arch_component": True,
                "arch_layer": "plate",
                "arch_category": "板块",
            },
        })

        # WP-005：Plate 聚合挂载同款属性化——不发边
        for d in docs:
            d.setdefault("properties", {})
            d["properties"]["plate_id"] = plate_id

        # (Plate) -[:ASSOCIATED_WITH]-> (Product)
        product_id = _product_id(product)
        if product_id in product_id_set or product_id in node_by_id:
            edges.append({
                "source": plate_id,
                "target": product_id,
                "type": "ASSOCIATED_WITH",
                "properties": {"source": "plate-product-link", "weight": 0.95},
            })

        # (Plate) -[:ASSOCIATED_WITH]-> (System/Module) — 聚合去重
        for mod_name in unique_modules:
            sys_id = MODULE_SYSTEM_MAP.get(mod_name, "")
            if sys_id and sys_id in node_by_id:
                edges.append({
                    "source": plate_id,
                    "target": sys_id,
                    "type": "ASSOCIATED_WITH",
                    "properties": {"source": "plate-system-aggregation", "weight": 0.85},
                })

        # (Plate) -[:APPLIES_TO]-> (ProductVersion) — 聚合去重
        for ver_str in unique_versions:
            ver_id = f"version-{slugify(product)}-{slugify(ver_str)}"
            if ver_id in version_id_set or ver_id in node_by_id:
                edges.append({
                    "source": plate_id,
                    "target": ver_id,
                    "type": "APPLIES_TO",
                    "properties": {"source": "plate-version-aggregation", "weight": 0.8},
                })

    # ── 为每个业务能力域生成 Plate 节点 ──
    for plate_name, docs in domain_groups.items():
        bp = BUSINESS_PLATES.get(plate_name, {})
        domain = bp.get("domain", slugify(plate_name))
        plate_id = f"plate:business:{domain}"
        products = [
            d.get("properties", {}).get("product", "").strip()
            for d in docs
            if d.get("properties", {}).get("product", "").strip()
        ]
        primary_product = max(set(products), key=products.count) if products else _architecture_product_version()[0]
        _make_plate(plate_id, plate_name, primary_product, axis="business", docs=docs)

    # ── 轴 1 — 场景/升级板块 (scene) ──
    # 门控: article_type=="升级经验" + category-path subdomain=="upgrade" + version 含 "→"
    axis1_groups: dict[tuple, list] = {}
    for doc in doc_nodes:
        p = doc.get("properties", {})
        prod = p.get("product", "").strip()
        mod = p.get("module", "").strip().removeprefix("[[").removesuffix("]]")
        at = p.get("article_type", "").strip()
        cp = p.get("category_path", "").strip()
        ver = p.get("version", "").strip()
        if not (prod and mod and at == "升级经验" and ver and "→" in ver):
            continue
        cp_parts = cp.split(":")
        if len(cp_parts) < 2 or cp_parts[1] != "upgrade":
            continue
        axis1_groups.setdefault((prod, mod), []).append(doc)

    for (prod, mod), docs in axis1_groups.items():
        plate_name = f"{prod} {mod} 版本升级"
        plate_id = f"plate:scene:{slugify(prod)}-{slugify(mod)}-upgrade"
        _make_plate(plate_id, plate_name, prod, axis="scene", docs=docs)

    # ── 轴 2 — 出版物/手册板块 (publication) ──
    # 门控: doc_type ∈ {用户手册, 部署指南, 配置手册, 运维手册, 技术文档, 巡检手册}
    axis2_doc_types = {"用户手册", "部署指南", "配置手册", "运维手册", "技术文档", "巡检手册"}
    axis2_groups: dict[tuple, list] = {}
    for doc in doc_nodes:
        p = doc.get("properties", {})
        prod = p.get("product", "").strip()
        dt = p.get("doc_type", "").strip()
        if not (prod and dt in axis2_doc_types):
            continue
        axis2_groups.setdefault((prod, dt), []).append(doc)

    for (prod, dt), docs in axis2_groups.items():
        plate_name = f"{prod} {dt}"
        plate_id = f"plate:publication:{slugify(prod)}-{slugify(dt)}"
        _make_plate(plate_id, plate_name, prod, axis="publication", docs=docs)

    # ── 轴 3 — 组件/报错板块 (component) ──
    # 门控: article_type ∈ {排错指南, 常见问题} + module 非空
    axis3_article_types = {"排错指南", "常见问题"}
    axis3_groups: dict[tuple, list] = {}
    for doc in doc_nodes:
        p = doc.get("properties", {})
        prod = p.get("product", "").strip()
        mod = p.get("module", "").strip().removeprefix("[[").removesuffix("]]")
        at = p.get("article_type", "").strip()
        if not (prod and mod and at in axis3_article_types):
            continue
        axis3_groups.setdefault((prod, mod, at), []).append(doc)

    for (prod, mod, at), docs in axis3_groups.items():
        plate_name = f"{prod} {mod} {at}"
        plate_id = f"plate:component:{slugify(prod)}-{slugify(mod)}-{slugify(at)}"
        _make_plate(plate_id, plate_name, prod, axis="component", docs=docs)

    return nodes, edges


# ── 统计与验证 ──


def validate_graph(graph):
    nodes = graph["nodes"]
    edges = graph["edges"]
    node_ids = {n["id"] for n in nodes}
    issues = []

    # Check for dangling edge endpoints
    dangling = 0
    for e in edges:
        if e["source"] not in node_ids:
            issues.append(f"Dangling source: {e['source']} (edge type: {e['type']})")
            dangling += 1
        if e["target"] not in node_ids:
            issues.append(f"Dangling target: {e['target']} (edge type: {e['type']})")
            dangling += 1

    # WP-005：结构走属性轴——骨架边校验退役，改校验子域节点 domain_id 属性在册
    domain_nodes = {n["id"] for n in nodes if "BusinessDomain" in n["labels"]}
    for n in nodes:
        if "Subdomain" in n["labels"]:
            did = (n.get("properties") or {}).get("domain_id")
            if not did or did not in domain_nodes:
                issues.append(f"Subdomain {n['id']} 缺 domain_id 属性或所指域不在册（属性轴校验）")

    if issues:
        print(f"\n⚠️  验证发现 {len(issues)} 个问题：")
        for issue in issues[:20]:
            print(f"  - {issue}")
        if len(issues) > 20:
            print(f"  ... 还有 {len(issues) - 20} 个问题")
    else:
        print("\n✅ 图验证通过：所有边端点有效，BELONGS_TO 链完整")

    return len(issues)


def _quality_summary(edges, nodes):
    """Compact quality summary printed after --apply."""
    # Weight distribution
    strong = sum(1 for e in edges if e.get("properties", {}).get("weight", 0.5) >= 0.7)
    weak = sum(1 for e in edges if e.get("properties", {}).get("weight", 0.5) < 0.3)

    # Orphan check (non-Document, non-Team nodes with 0 edges)
    edge_endpoints = set()
    for e in edges:
        edge_endpoints.add(e["source"])
        edge_endpoints.add(e["target"])
    orphans = sum(1 for n in nodes
                  if n["id"] not in edge_endpoints
                  and "Document" not in n.get("labels", [])
                  and "Team" not in n.get("labels", []))

    if orphans == 0 and weak == 0:
        print(f"\n✅ 图质量良好: {strong}/{len(edges)} 条强边, 无孤立节点")
    else:
        parts = []
        if weak:
            parts.append(f"{weak} 条弱边 (<0.3)")
        if orphans:
            parts.append(f"{orphans} 个孤立节点")
        print(f"\n⚠️  图质量: {strong}/{len(edges)} 条强边, {', '.join(parts)}")
        print(f"   运行 python3 validate_graph.py --fix 查看详情")

# ── 同步 document_index 表（图↔向量桥接） ──

def _load_document_index_sql():
    """读取 document_index 单源 DDL（sibling document_index.sql，PR-165 单源双端执行模式）。

    非注释行＝schema 段；「-- insert-template:」行＝参数化 INSERT 模板（绑参执行）。
    文件损坏（缺 schema 或模板）即 fail-closed 抛错，不猜、不回落内联副本。
    """
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "document_index.sql")
    schema_lines, template = [], None
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            if line.startswith("-- insert-template:"):
                template = line.split(":", 1)[1].strip()
            elif not line.lstrip().startswith("--"):
                schema_lines.append(line)
    if template is None or not "".join(schema_lines).strip():
        raise RuntimeError(f"document_index.sql 单源损坏（缺 schema 段或 insert-template 行）: {path}")
    return "".join(schema_lines), template


def _populate_document_index(nodes):
    """将文档节点的 file_path 写入 SQLite document_index 表，建立图↔向量桥梁"""
    # SPEC-012 wave-2：document_index 库随图族迁 repo 侧 data/（消费链经 kb_paths.data_dir 解析——
    # runtime-scope V05 修复：空串回落改 fail-closed 解析器，路径不再随 cwd 漂移）
    from kb_paths import data_dir as _data_dir
    db_path = os.path.join(_data_dir(), "master_graph.db")
    try:
        import sqlite3
        conn = sqlite3.connect(db_path)
        conn.execute("PRAGMA journal_mode = WAL")
        schema_sql, insert_template = _load_document_index_sql()
        conn.executescript(schema_sql)
        existing_columns = {row[1] for row in conn.execute("PRAGMA table_info(document_index)")}
        for column in (
            "arch_layer", "arch_layer_canonical", "arch_category",
            "arch_category_canonical", "arch_subdomain", "arch_subdomain_canonical",
        ):
            if column not in existing_columns:
                conn.execute(f"ALTER TABLE document_index ADD COLUMN {column} TEXT NOT NULL DEFAULT ''")
        conn.execute("DELETE FROM document_index")
        indexed = 0
        for n in nodes:
            props = n.get("properties", {})
            file_path = props.get("file_path", "")
            if not file_path:
                continue
            label = props.get("title", props.get("name", n.get("id", "")))
            node_id = n.get("id", "")
            if not node_id:
                continue
            # Try to get file mtime
            full_path = os.path.join(VAULT_ROOT, file_path)
            mtime = 0
            if os.path.exists(full_path):
                mtime = os.path.getmtime(full_path)
            conn.execute(
                insert_template,
                (
                    node_id, file_path, mtime, props.get("module", ""),
                    props.get("arch_layer", ""), props.get("arch_layer_canonical", ""),
                    props.get("arch_category", ""), props.get("arch_category_canonical", ""),
                    props.get("arch_subdomain", ""), props.get("arch_subdomain_canonical", ""),
                )
            )
            indexed += 1
        conn.commit()
        conn.close()
        if indexed:
            print(f"📇 document_index 已更新: {indexed} 个文档→节点映射")
    except Exception as e:
        print(f"  ⚠️ document_index 写入失败: {e}")

# ── 主流程 ──

def main():
    global ADMISSION_COORDINATES
    mode_apply = "--apply" in sys.argv
    mode_cache = "--cache" in sys.argv
    mode_validate = "--validate" in sys.argv
    mode_incremental = "--incremental" in sys.argv
    mode_force = "--force" in sys.argv
    mode_create_stubs = "--create-stubs" in sys.argv
    keep_orphan_concepts = "--keep-orphan-concepts" in sys.argv
    article_admission_manifest = None
    if "--article-admission-manifest" in sys.argv:
        index = sys.argv.index("--article-admission-manifest")
        if index + 1 >= len(sys.argv):
            print("  [准入] --article-admission-manifest 缺少路径", file=sys.stderr)
            return 2
        article_admission_manifest = sys.argv[index + 1]
    try:
        admitted_article_paths = load_admitted_precleaned_paths(article_admission_manifest, VAULT_ROOT, VAULT)
    except ValueError as error:
        print(f"  [准入] {error}", file=sys.stderr)
        return 2
    ADMISSION_COORDINATES = {}
    if article_admission_manifest:
        try:
            with open(article_admission_manifest, "r", encoding="utf-8") as handle:
                admission_data = json.load(handle)
            batch_id = admission_data.get("batchId")
            for article in admission_data.get("articles", []):
                source_path = str(article.get("sourcePath", "") or "").replace("\\", "/")
                ADMISSION_COORDINATES[source_path] = {
                    "articleId": article.get("articleId"),
                    "sourceHash": article.get("sourceHash") or article.get("contentHash"),
                    "admissionBatchId": article.get("admissionBatchId") or batch_id,
                }
        except (OSError, json.JSONDecodeError):
            ADMISSION_COORDINATES = {}

    unclassified_docs = []  # 无 module 的文档，写入 master_graph 的 pendingReview
    version_pending_docs = []  # 有 module 但无 version 的文档

    print("开始提取知识图谱数据...")
    if admitted_article_paths is not None:
        print(f"  [准入] 本次仅抽取 {len(admitted_article_paths)} 篇当前批准文章快照")

    if mode_apply:
        lock_info = _check_pipeline_lock()
        if lock_info:
            print(f"  {yellow('⚠')} 管道锁已被持有: pid={lock_info.get('pid')}, runId={lock_info.get('runId')}, startedAt={lock_info.get('startedAt')}")
            print(f"  {yellow('⚠')} 请等待管道完成或 10 分钟后重试。使用 --force 可跳过锁检查。")
            if not mode_force:
                return 0
            print(f"  {yellow('⚠')} --force 已指定，忽略锁继续执行")
    incremental_manifest = None
    if mode_incremental:
        incremental_manifest = _build_incremental_manifest()
        previous_manifest = _read_incremental_manifest()
        diff = _diff_incremental_manifest(previous_manifest, incremental_manifest)
        changed_count = len(diff["created"]) + len(diff["deleted"]) + len(diff["changed"])
        if changed_count == 0 and mode_apply and not mode_validate and not mode_force and os.path.exists(MASTER_JSON):
            print("  [增量] Vault 文件未变化，跳过全量重建。使用 --force 可强制重建。")
            # 即使跳过重建，也同步 document_index（防止缓存表落后于 JSON）
            try:
                existing = json.load(open(MASTER_JSON))
                _populate_document_index(existing.get("nodes", []))
            except Exception:
                pass
            return 0
        print(
            "  [增量] "
            f"新增 {len(diff['created'])}，删除 {len(diff['deleted'])}，变更 {len(diff['changed'])}"
        )

    all_nodes = []
    all_edges = []
    name_to_id = {}  # wikilink name → node_id lookup

    # Pre-populate name_to_id to avoid processing-order dependency
    # WP-117 批2：信封过滤（原 :2755 os.listdir 顶层口径）——无 fm 实体页的解包崩溃形态
    # （fm, _ = None → TypeError）逐字保持，不扩不缩；迭代序由 scandir 序改文件名字典序（如实记）
    for fname, _kb_rel, _doc in _doc_envelope_flat_md_docs("wiki/entities"):
        result = parse_frontmatter(_doc["fmText"], _doc["body"])
        fm, _ = result
        aid = fm.get("architecture-node-id", fm.get("architecture_node_id", ""))
        if aid:
            name_to_id[fname.replace(".md", "")] = aid
            title = fm.get("title", "")
            if title:
                # title 注入：冲突检测而非静默覆盖（entity-disambiguation §1.2）
                # 两个 entity 共享同一 title 时，不注册该 title（连先到者一并移除），
                # 避免 wikilink 连到任意一方。冲突 title 留空 → 解析落 unresolved
                # → 现有 unresolvedWikilinks 告警通道可见（验收标准 §四-1）。
                existing = name_to_id.get(title)
                if existing and existing != aid:
                    print(f"  [WARN] title 冲突: '{title}' 被 {existing} 和 {aid} 同时声明，未注册（两个 entity 都不连）", file=sys.stderr)
                    name_to_id.pop(title, None)  # 移除先到者的映射，两个都不留
                else:
                    name_to_id[title] = aid
    # Step 1-2: BusinessDomain + Subdomain
    print("  [1-2] 提取 BusinessDomain + Subdomain 节点...")
    nodes, edges = extract_domain_nodes()
    all_nodes.extend(nodes)
    all_edges.extend(edges)
    print(f"    → {len(nodes)} 节点, {len(edges)} 边")

    # Step 3 已退役: 旧版 AnyShare.architecture.json 不再作为数据源（2026-05-03）
    arch_node_ids = set()

    # Step 4-5: Wiki entities → Module/System补全
    print("  [4-5] 提取 wiki 实体页 → System/Module 补全...")
    nodes, edges, wikilink_deps, unresolved_wikilinks, entity_exemptions = extract_entity_nodes(arch_node_ids, name_to_id)
    all_nodes.extend(nodes)
    all_edges.extend(edges)
    # WP-031：本批实体文档覆盖的节点集（豁免规则以本次文档扫描为准——防旧图残留）
    entity_doc_node_ids = {n["id"] for n in nodes} | set(entity_exemptions)
    print(f"    → {len(nodes)} 节点, {len(edges)} 边, {len(wikilink_deps)} 依赖声明")
    if MISSING_COMPONENT_IDENTITIES:
        print(
            f"    → 缺身份号组件不产出：{len(MISSING_COMPONENT_IDENTITIES)} 个"
            f"（{_brief_missing_identities()}）"
            "——身份只在唯一铸造口取号，建图侧不现编；已入待审清单交人裁"
        )

    # Step 6: Wiki concepts → Concept nodes
    print("  [6]   提取 wiki 概念页 → Concept 节点...")
    nodes, edges = extract_concept_nodes(name_to_id)
    all_nodes.extend(nodes)
    all_edges.extend(edges)
    print(f"    → {len(nodes)} 节点, {len(edges)} 边")

    # Build concept name → concept_id lookup for MENTIONS edge extraction
    concept_names = {}
    for n in all_nodes:
        if "Concept" in n.get("labels", []):
            concept_names[n["properties"]["name"]] = n["id"]

    # Step 7: Documents + DOCUMENTS/REFERENCES/MENTIONS edges
    print("  [7]   提取文档 → Document 节点 + DOCUMENTS/REFERENCES/MENTIONS 边...")

    # ── 加载旧 master_graph 做三角校验 ──
    old_doc_props = {}
    if os.path.exists(MASTER_JSON):
        try:
            with open(MASTER_JSON, "r", encoding="utf-8") as f:
                old_master = json.load(f)
            for n in old_master.get("nodes", []):
                if "Document" in n.get("labels", []):
                    old_doc_props[n["id"]] = n.get("properties", {})
        except (json.JSONDecodeError, OSError):
            pass

    nodes, edges, unclassified_docs, version_pending_docs = extract_document_nodes(
        arch_node_ids, name_to_id, concept_names, old_doc_props, admitted_article_paths
    )
    all_nodes.extend(nodes)
    all_edges.extend(edges)
    all_edges = apply_article_association_overrides(all_nodes, all_edges)
    if unclassified_docs:
        print(f"    ⚠️ {len(unclassified_docs)} 个文档缺少 module 字段，已加入待审核")
    if version_pending_docs:
        print(f"    ⚠️ {len(version_pending_docs)} 个文档缺少版本号 → cockpit「文档版本审核」")
    print(f"    → {len(nodes)} 节点, {len(edges)} 边")

    # Step 8: Placeholder Team
    print("  [8]   创建占位 Team 节点...")
    nodes = extract_team_nodes()
    all_nodes.extend(nodes)
    print(f"    → {len(nodes)} 节点")

    # Step 8.5: Plate 节点聚合 — 四轴固定门控（业务能力域 + 场景/升级 + 出版物/手册 + 组件/报错）
    print("  [8.5] 从 Document 聚合生成 Plate 节点（四轴：业务能力域 + 场景/升级 + 出版物/手册 + 组件/报错）...")
    external_ids = {
        "product_ids": {n["id"] for n in all_nodes if "Product" in n.get("labels", [])},
        "module_ids": {n["id"] for n in all_nodes if "Module" in n.get("labels", [])},
        "version_ids": {n["id"] for n in all_nodes if "ProductVersion" in n.get("labels", [])},
    }
    nodes, edges = extract_plate_nodes(all_nodes, external_ids)
    all_nodes.extend(nodes)
    all_edges.extend(edges)
    # 统计各轴数量
    axis0 = sum(1 for n in nodes if n["properties"].get("axis") == "business")
    axis1 = sum(1 for n in nodes if n["properties"].get("axis") == "scene")
    axis2 = sum(1 for n in nodes if n["properties"].get("axis") == "publication")
    axis3 = sum(1 for n in nodes if n["properties"].get("axis") == "component")
    print(f"    → {len(nodes)} Plate 节点（业务:{axis0} 升级:{axis1} 手册:{axis2} 报错:{axis3}）, {len(edges)} 边")

    # Step 9: YAML dependency edges (enriches entity-wikilink DEPENDS_ON)
    print("  [9]   从依赖规则（词表信封）富化 DEPENDS_ON 边 + 交叉验证...")
    all_edges, yaml_errors, yaml_warnings, enriched, yaml_only = generate_yaml_deps_edges(all_nodes, all_edges, wikilink_deps)
    if enriched:
        print(f"    → {enriched} 条 wikilink 被 YAML 富化")
    else:
        print(f"    → 无 YAML 条目")
    for e in yaml_errors:
        print(f"    ❌ {e}")
    for w in yaml_warnings:
        print(f"    ⚠️  {w}")
    if yaml_errors:
        print("\n❌ YAML 依赖校验失败，请修复后重试。")
        return 1

    # ── 画布遗留节点与审定模块 ID 对齐 + 占位 Team 弱连接 ──
    node_id_set = {n["id"] for n in all_nodes}

    # ── 多源推断边合并（含 display name → node ID 解析）──
    inferred_edges = load_inferred_edges(VAULT_ROOT)
    if inferred_edges:
        # 构建 name/title → node ID 查找表（覆盖所有节点类型）
        node_name_map = {}
        for n in all_nodes:
            props = n.get("properties", {})
            name = props.get("name", "")
            title = props.get("title", "")
            nid = n["id"]
            if name:
                node_name_map[name] = nid
            if title and title != name:
                node_name_map[title] = nid
        node_name_map.update(name_to_id)  # entity 文件级名称优先级更高

        resolved = 0
        skipped = 0
        for e in inferred_edges:
            src = e["source"]
            tgt = e["target"]
            src_id = node_name_map.get(src, src)
            tgt_id = node_name_map.get(tgt, tgt)
            if src_id not in node_id_set or tgt_id not in node_id_set:
                skipped += 1
                continue
            if src_id != src or tgt_id != tgt:
                resolved += 1
            e["source"] = src_id
            e["target"] = tgt_id
            all_edges.append(e)
        print(f"    → {len(inferred_edges)} 条多源推断边已合并"
              + (f"（{resolved} 条名称→ID 解析，跳过 {skipped} 条不可解析）" if (resolved or skipped) else ""))
    for src, tgt in (("workflow-center", "work-center"),):
        if src in node_id_set and tgt in node_id_set:
            all_edges.append({
                "source": src,
                "target": tgt,
                "type": "REFERENCES",
                "properties": {"source": "canvas-module-alias", "weight": 0.85},
            })
    # PR-018②（2026-09-14 定性停发）：原此处无条件造 team-unassigned→product 占位 REFERENCES 边，
    # 本体政策 working_projection: never（不该进工作投影）却实际产出 → 政策对、产出错。
    # 同族先例：USES 已裁 delete 且生产者停发（ADR009 R9）。team-unassigned 节点本身保留（分类占位有用）。

    # ── 缺陷5: 为自动发现的结构边补 source 标签与政策出生章（PR-095：政策驱动，替代一刀切 pending）──
    _STRUCTURAL_SOURCE_MAP = {
        "BELONGS_TO": "auto-discovered",
        "DOCUMENTS": "document-mount",
        "HAS_VERSION": "version-inference",
        "USES": "auto-discovered",
        "MENTIONS": "keyword-match",
        "REFERENCES": "auto-discovered",
        "APPLIES_TO": "document-frontmatter",
        "INDEXES": "auto-discovered",
        "HAS_SYMPTOM": "tag-match",
        "ASSOCIATED_WITH": "auto-discovered",
    }
    _STRUCTURAL_SOURCE_LABELS = set(_STRUCTURAL_SOURCE_MAP.values())
    # 断言政策装载（单源=ontology.yaml；装载失败整体回退 pending——产线不得自作主张）
    _relation_policies = {}
    _relation_lifecycle = {}
    try:
        for _rt_name, _rt_def in (schema_loader.ontology_relation_types() or {}).items():
            _plist = _rt_def.get("assertion_policies") or []
            if _plist:
                _relation_policies[_rt_name] = _plist
        # ADR-014 §4：已定义但非 approved 的关系不得进入新产出（含 wikilink 等自盖章来源）。
        # 装载失败与政策同待遇——整体回退、不擅删（产线不得自作主张）。
        _relation_lifecycle = schema_loader.ontology_relation_lifecycle() or {}
    except Exception as _policy_error:
        print(f"    ⚠️ 断言政策/关系生命周期装载失败（{_policy_error}）——结构边回退 pending，"
              f"非现役闸本次整体失效（与政策同待遇，不擅删）")
        _relation_policies = {}
        _relation_lifecycle = {}
    # 空表既可能是「本体未声明关系类型」也可能是装载被静默吞掉（load_the_schema 对解析失败
    # 返回空文档）——两种都要让操作者看见闸门本次无可判定，否则退役边会无告警地照常继承。
    if not _relation_lifecycle:
        print("    ⚠️ 关系生命周期表为空——非现役闸本次无可判定（本体未声明关系或装载失败）")
    _pending_count = 0
    _derived_count = 0
    _forbidden_dropped = []
    _inactive_dropped = []
    for e in all_edges:
        props = e.setdefault("properties", {})
        _inactive_reason = _inactive_relation_reason(e, _relation_lifecycle)
        if _inactive_reason:
            _inactive_dropped.append((e, _inactive_reason))
            continue
        # entity wikilink 边（reviewed 政策）出生已由 _extract_entity_references 显式置 pending，不重复处理
        # （原注释误称「已设为 approved」，PR-095 勘误——该函数实设 pending，见 988-1041 行）
        if props.get("source") == "entity-wikilink":
            continue
        # 先补 source 标签（政策对位键）再盖章——PR-095：原顺序先盖章后贴标签，政策无从对位
        if "source" not in props:
            props["source"] = _STRUCTURAL_SOURCE_MAP.get(e.get("type", ""), "auto-discovered")
        # WP-006 第3项：政策拒产闸（derived_only/forbidden ≡ working_projection=never）
        # ——违规边物理不产出（结构式，非事后过滤）；标记后统一剔除
        if _policy_forbids_production(e.get("type", ""), props, _relation_policies):
            _forbidden_dropped.append(e)
            continue
        if "reviewStatus" not in props or props.get("source") in _STRUCTURAL_SOURCE_LABELS:
            # K-P0-1 教训保留：不再默认 approved；PR-095：按断言政策 decision_mode 盖章，
            # 政策找不到 / 继承无裁定证据 → pending（fail-closed）
            # 结构源（上表登记的本文件自动产边来源）以政策为唯一事实源：生产者自盖的
            # pending 不作定论，否则生产者硬写 pending 会把 deterministic 政策的边永久
            # 钉在人裁队列（实证：HAS_VERSION/version-inference 曾被钉死为 pending）。
            props["reviewStatus"] = _policy_review_status(e.get("type", ""), props, _relation_policies)
            # 顶层同步：读侧账本合并（review-status-projection.mergeReviewStatus）只认顶层
            # reviewStatus，且只放行 deterministic/inherited_approved 白名单；派生章只写嵌套
            # properties 时顶层缺省 → 被当成「图内污染值」一律压回 pending（实证：16 条边中
            # 8 条 deterministic 有 5 条被压回待审核）。故两处必须同章。
            e["reviewStatus"] = props["reviewStatus"]
            if props["reviewStatus"] == "pending":
                _pending_count += 1
            else:
                _derived_count += 1
    if _forbidden_dropped:
        _drop_keys = {(e["source"], e["target"], e.get("type", "")) for e in _forbidden_dropped}
        all_edges = [e for e in all_edges if (e.get("source"), e.get("target"), e.get("type", "")) not in _drop_keys]
        _by_type = {}
        for e in _forbidden_dropped:
            _by_type[e.get("type", "?")] = _by_type.get(e.get("type", "?"), 0) + 1
        _detail = ", ".join(f"{k}×{v}" for k, v in sorted(_by_type.items()))
        print(f"    → 政策拒产 {len(_forbidden_dropped)} 条边（derived_only/forbidden，{ _detail}）——违规产物物理不产出")
    if _inactive_dropped:
        _inactive_keys = {(_e["source"], _e["target"], _edge_type(_e)) for _e, _ in _inactive_dropped}
        all_edges = [e for e in all_edges if (e.get("source"), e.get("target"), _edge_type(e)) not in _inactive_keys]
        _reason_counts = {}
        for _e, _reason in _inactive_dropped:
            _reason_counts[_reason] = _reason_counts.get(_reason, 0) + 1
        _detail = ", ".join(f"{k}×{v}" for k, v in sorted(_reason_counts.items()))
        print(f"    → 非现役关系拒产 {len(_inactive_dropped)} 条边（{_detail}）——非现役关系不进入新产出")
    if _pending_count or _derived_count:
        print(f"    → {_pending_count} 条边出生 pending（待人裁）；{_derived_count} 条按政策派生生效（deterministic/inherited_approved）")

    # 顶层 reviewStatus 归一：未走盖章分支的边（生产者自盖章来源：document-body/concept-body/
    # entity-wikilink/multi-source-inference）也要把章提到顶层，避免读侧账本合并只读顶层而
    # 把「嵌套有章、顶层缺省」当成污染值压回 pending（与上方盖章节同因同修）。
    for _e in all_edges:
        if "reviewStatus" not in _e:
            _e["reviewStatus"] = (_e.get("properties") or {}).get("reviewStatus") or "pending"

    # Deduplicate edges
    seen_edges = set()
    unique_edges = []
    for e in all_edges:
        key = (e["source"], e["target"], e["type"])
        if key not in seen_edges:
            seen_edges.add(key)
            unique_edges.append(e)
    all_edges = unique_edges

    # Deduplicate nodes — 撞键不再 last wins（WP-107 D1／SPEC-046 I3）；判定与登记在纯函数里，可直测
    all_nodes, _id_conflicts = dedupe_nodes_keep_conflicts(all_nodes)
    IDENTITY_CONFLICTS.clear()
    IDENTITY_CONFLICTS.extend({"id": k, "sources": v[1], "nodes": len(v[0])} for k, v in sorted(_id_conflicts.items()))
    for _k, (_group, _srcs) in sorted(_id_conflicts.items()):
        print(
            f"    → 身份撞键不产出：{len(_group)} 个节点共用 id {_k}（来源：{', '.join(_srcs[:4])}）"
            "——不静默并节点，整批不进图，已入待审清单交人裁"
        )
    if _id_conflicts:
        print(f"    → 撞键身份共 {len(_id_conflicts)} 个，涉及节点 {sum(len(v[0]) for v in _id_conflicts.values())} 个")

    # ── Assign weights to structural edges that lack them ──
    _assign_structural_weights(all_edges)

    # ── 注入溯源血统：所有节点记录 extraction_trace / source_vault_path ──
    # 此前仅在 _sync_to_master 转换时写入，导致 knowledgeGraph 中 Plate 等派生节点
    # 缺少 extraction_trace，架构图前端无法解释节点来源，形成"天外来客"节点。
    run_ts_iso = datetime.now().isoformat()
    for n in all_nodes:
        apply_minimal_lineage_props(
            n.setdefault("properties", {}), n.get("labels") or [], run_ts_iso=run_ts_iso
        )
    nodes_by_id = {node["id"]: node for node in all_nodes}
    for edge in all_edges:
        apply_derived_relation_lineage(edge, nodes_by_id)

    # ── 自动维护已关闭：模块/标签需在 enums.yaml 手动注册 ──
    if mode_create_stubs:
        _ensure_entity_stubs(name_to_id)
    else:
        print("  [维护] 跳过缺失实体占位页创建；如需补页请使用 --create-stubs 或 API 模板接口")

    # ── 写回架构图 JSON ──

    # Classify nodes by label
    domain_nodes = [n for n in all_nodes if "BusinessDomain" in n["labels"]]
    subdomain_nodes = [n for n in all_nodes if "Subdomain" in n["labels"]]
    concept_nodes = [n for n in all_nodes if "Concept" in n["labels"]]
    module_nodes = [n for n in all_nodes if "Module" in n["labels"]]
    document_nodes = [n for n in all_nodes if "Document" in n["labels"]]
    product_nodes = [n for n in all_nodes if "Product" in n["labels"]]
    version_nodes = [n for n in all_nodes if "ProductVersion" in n["labels"]]
    team_nodes = [n for n in all_nodes if "Team" in n["labels"]]
    plate_nodes = [n for n in all_nodes if "Plate" in n["labels"]]

    # Classify edges by type
    belongs_to = [e for e in all_edges if e["type"] == "BELONGS_TO"]
    depends_on = [e for e in all_edges if e["type"] == "DEPENDS_ON"]
    documents_edges = [e for e in all_edges if e["type"] == "DOCUMENTS"]
    references = [e for e in all_edges if e["type"] == "REFERENCES"]
    mentions = [e for e in all_edges if e["type"] == "MENTIONS"]
    has_version = [e for e in all_edges if e["type"] == "HAS_VERSION"]
    uses_edges = [e for e in all_edges if e["type"] == "USES"]
    applies_to = [e for e in all_edges if e["type"] == "APPLIES_TO"]
    has_symptom = [e for e in all_edges if e["type"] == "HAS_SYMPTOM"]
    indexes_edges = [e for e in all_edges if e["type"] == "INDEXES"]
    associated_with = [e for e in all_edges if e["type"] == "ASSOCIATED_WITH"]

    # ── 注入 Ontology 注册（NodeLabels + EdgeTypes）──
    ontology_node_types = schema_loader.ontology_node_types()
    ontology_relation_types = schema_loader.ontology_relation_types()

    knowledge_graph = {
        "generatedAt": datetime.now().isoformat(),
        "source": "extract_graph.py v2.0",
        "ontology": {
            "node_types": ontology_node_types,
            "relation_types": ontology_relation_types,
        },
        "stats": {
            "totalNodes": len(all_nodes),
            "totalEdges": len(all_edges),
            "nodesByLabel": {
                "BusinessDomain": len(domain_nodes),
                "Subdomain": len(subdomain_nodes),
                "System": len([n for n in all_nodes if "System" in n["labels"]]),
                "Module": len(module_nodes),
                "Concept": len(concept_nodes),
                "Document": len(document_nodes),
                "Product": len(product_nodes),
                "ProductVersion": len(version_nodes),
                "Team": len(team_nodes),
                "Plate": len(plate_nodes),
            },
            "edgesByType": {
                "BELONGS_TO": len(belongs_to),
                "DEPENDS_ON": len(depends_on),
                "DOCUMENTS": len(documents_edges),
                "REFERENCES": len(references),
                "MENTIONS": len(mentions),
                "HAS_VERSION": len(has_version),
                "USES": len(uses_edges),
                "APPLIES_TO": len(applies_to),
                "HAS_SYMPTOM": len(has_symptom),
                "INDEXES": len(indexes_edges),
                "ASSOCIATED_WITH": len(associated_with),
            },
        },
        "domainNodes": domain_nodes,
        "subdomainNodes": subdomain_nodes,
        "conceptNodes": concept_nodes,
        "moduleNodes": module_nodes,
        "documentNodes": document_nodes,
        "productNodes": product_nodes,
        "productVersionNodes": version_nodes,
        "teamNodes": team_nodes,
        "plateNodes": plate_nodes,
        "semanticEdges": all_edges,
        "unresolvedWikilinks": unresolved_wikilinks,
    }

    # ── 同步到 master_graph.json（格式转换）──

    def _sync_to_master(nodes, edges):
        lineage_ts = knowledge_graph.get("generatedAt") or datetime.now().isoformat()
        master_nodes = []
        for n in nodes:
            primary = (n.get("labels") or ["Unknown"])[0]
            props = dict(n.get("properties", {}))
            apply_minimal_lineage_props(props, n.get("labels") or [], run_ts_iso=lineage_ts)
            # 优先使用 entity frontmatter 中的 arch_category（真理源），
            # 其次按 label 类型映射，均不命中则 "其他"
            category = (
                props.get("arch_category_canonical") or
                props.get("arch_category") or
                props.get("arch-category") or
                CATEGORY_MAP.get(primary, "其他")
            )
            if primary == "Product":
                category = "产品"
            elif primary == "ProductVersion":
                category = "版本"
            elif primary == "Plate":
                category = "板块"
            elif primary == "Subdomain":
                category = "域"
            elif primary == "BusinessDomain":
                category = "域"
            master_nodes.append({
                "id": n["id"],
                "label": props.get("name", props.get("title", n["id"])),
                "sublabel": (props.get("definition") or "")[:800],
                "category": category,
                "labels": n.get("labels", []),
                "properties": props,
            })
        master_conns = []
        for e in edges:
            # 从 sources 数组提取 sourceFile（墓碑凭证）
            sf = ""
            sources = e.get("properties", {}).get("sources", [])
            if sources:
                for s in sources:
                    f = s.get("file", "")
                    if f:
                        sf = f
                        break
            conn = {
                "from": e["source"],
                "to": e["target"],
                "relationType": e.get("type", "REFERENCES"),
                "label": e.get("properties", {}).get("label", ""),
                "sourceFile": sf,
                "properties": e.get("properties", {}),
            }
            # 顶层审核章随行：连接对象只搬白名单字段，漏搬运会让「章只留在 properties.嵌套」
            # ——读侧账本合并（mergeReviewStatus）只认顶层，缺省即当污染值压回 pending
            # （实证：8 条 deterministic 边有 5 条在待审核列表里复活）。
            if "reviewStatus" in e:
                conn["reviewStatus"] = e["reviewStatus"]
            source_hash = _edge_source_hash(conn)
            line_no = _edge_line_number(conn)
            evidence_hash = _edge_evidence_hash(conn)
            conn["edgeId"] = _edge_stable_id(conn)
            if source_hash:
                conn["sourceHash"] = source_hash
            if line_no:
                conn["lineNumber"] = int(line_no)
            if evidence_hash:
                conn["evidenceHash"] = evidence_hash
            master_conns.append(conn)
        # Merge with existing master (preserve architecture visual nodes)
        existing = {}
        existing_nodes = []
        existing_conns = []
        if os.path.exists(MASTER_JSON):
            try:
                with open(MASTER_JSON, "r", encoding="utf-8") as f:
                    existing = json.load(f)
                existing_nodes = existing.get("nodes", [])
                existing_conns = existing.get("connections", [])
            except (json.JSONDecodeError, OSError):
                pass

        # Merge: existing nodes take priority for matching IDs
        new_ids = {n["id"] for n in master_nodes}
        # Drop old entity- prefix nodes whose architecture-node-id counterpart now exists
        def _keep_existing_node(n):
            if n["id"] not in new_ids:
                return True
            return False
        # Build lookup: architecture-node-id → new node id (for stale detection)
        new_arch_id_map = {}  # arch-id → new node id
        new_file_paths = {}   # file_path → architecture_node_id (from new extraction)
        for n in master_nodes:
            props = n.get("properties", {})
            aid = props.get("architecture_node_id") or props.get("architecture-node-id", "")
            fp = props.get("file_path", "")
            if aid:
                new_arch_id_map[aid] = n["id"]
            if fp and aid:
                new_file_paths[fp] = aid
        # Also consider new node ids themselves as authoritative
        authoritative_ids = new_ids | set(new_arch_id_map.keys())
        # architecture_node_ids that were valid in this extraction run
        current_arch_ids = set(new_arch_id_map.keys())

        def _is_stale_entity_node(n):
            """Remove old entity- prefix nodes whose arch-id now has a proper node."""
            nid = n["id"]
            if not nid.startswith("entity-"):
                return False
            props = n.get("properties", {})
            arch_id = props.get("architecture_node_id") or props.get("architecture-node-id", "")
            return bool(arch_id and arch_id in authoritative_ids)

        def _is_stale_renamed_node(n):
            """Remove old nodes whose architecture-node-id points to a different new node."""
            nid = n["id"]
            props = n.get("properties", {})
            arch_id = props.get("architecture_node_id") or props.get("architecture-node-id", "")
            if not arch_id:
                return False
            # Old node's arch-id exists in new nodes, but under a DIFFERENT id
            new_nid = new_arch_id_map.get(arch_id)
            return bool(new_nid and new_nid != nid)

        def _is_stale_renamed_file(n):
            """Remove old arch_component nodes whose entity file now has a different architecture_node_id.

            Case: entity file was renamed (Chinese → English ID). The old node
            shares the same file_path as a new node but has a stale arch_id that
            no longer matches any current entity frontmatter.
            """
            props = n.get("properties", {})
            if not props.get("arch_component"):
                return False
            fp = props.get("file_path", "")
            arch_id = props.get("architecture_node_id") or props.get("architecture-node-id", "")
            if not fp or not arch_id:
                return False
            # Does this file_path appear in new extraction with a DIFFERENT arch_id?
            new_arch_id = new_file_paths.get(fp)
            return bool(new_arch_id and new_arch_id != arch_id)

        def _is_stale_deleted_entity(n):
            """Remove old document-backed nodes whose source .md file no longer exists.
            ADR063 源投影原则（#1744 收口）：删除检测从仅 wiki/entities/ 扩展到全部 wiki
            受管根——受管源文件已删，其投影节点不得在增量合并中残留。此前 articles 等子树
            的已删文件节点永生，致 document_index 挂死路径（unsafe_paths），Stage 6.3
            validate-document-index 拒绝、全量重建误失败。file_path 相对 VAULT_ROOT。"""
            props = n.get("properties", {})
            fp = str(props.get("file_path", "") or "").replace(chr(92), "/")
            if not fp:
                return False
            if not fp.startswith("知识库/wiki/"):
                return False
            return not os.path.exists(os.path.join(VAULT_ROOT, fp))

        def _is_stale_plate_node(n):
            """Remove Plate nodes no longer generated by current extraction.
            Plates are regenerated on every run; any Plate not in the new extraction is stale.
            master_graph 历史行可能省略 labels，仅依赖 properties.arch_layer=='plate'。"""
            labels = n.get("labels") or []
            props = n.get("properties") or {}
            nid = str(n.get("id", ""))
            is_plate = (
                "Plate" in labels
                or props.get("arch_layer") == "plate"
                or nid.startswith("plate:")
            )
            return is_plate and nid not in new_ids

        def _is_unadmitted_article_node(n):
            """During a frozen batch, retain only current approved article snapshots."""
            if admitted_article_paths is None:
                return False
            labels = n.get("labels") or []
            props = n.get("properties") or {}
            article_id = str(props.get("article_id") or props.get("articleId") or "").strip()
            if "Document" not in labels and not article_id:
                return False
            source_path = str(props.get("source_path") or props.get("sourcePath") or props.get("file_path") or "").replace("\\", "/")
            if source_path.startswith("知识库/raw/precleaned/"):
                return True
            return source_path.startswith("知识库/wiki/articles/") and source_path not in admitted_article_paths

        def _is_stale_dict_artifact_node(n):
            """清理 ADR-008 D1 切换窗口的 dict 残影节点：注册表词条对象曾被当字符串拼接，
            id 形如 ref:{'id': 'x'}、label/name 携带 dict。此类节点不可与任何合法节点对齐，
            随增量合并剔除（端点命中 stale_ids 的边同步修剪）。"""
            nid = str(n.get("id", ""))
            if "{'" in nid or "['" in nid:
                return True
            return isinstance(n.get("label"), (dict, list))

        merged_nodes = [n for n in existing_nodes
                       if _keep_existing_node(n)
                       and not _is_stale_entity_node(n)
                       and not _is_stale_renamed_node(n)
                       and not _is_stale_renamed_file(n)
                       and not _is_stale_deleted_entity(n)
                       and not _is_stale_plate_node(n)
                       and not _is_stale_dict_artifact_node(n)
                       and not _is_unadmitted_article_node(n)]
        merged_nodes.extend(master_nodes)

        # ── 节点 ID 去重：同名 ID 保留属性更完整的（labels 非空 + 有 file_path）──
        seen_nodes = {}
        for n in merged_nodes:
            nid = n["id"]
            nscore = (len(n.get("labels", []) or []) +
                      (1 if (n.get("properties", {}) or {}).get("file_path") else 0) +
                      (1 if (n.get("properties", {}) or {}).get("arch_component") else 0))
            if nid not in seen_nodes or nscore > seen_nodes[nid][0]:
                seen_nodes[nid] = (nscore, n)
        if len(seen_nodes) < len(merged_nodes):
            dupes_removed = len(merged_nodes) - len(seen_nodes)
            merged_nodes = [entry[1] for entry in seen_nodes.values()]
            print(f"  [清理] 移除 {dupes_removed} 个重复 ID 节点（同名 ID 保留信息更完整者）")
        stale_ids = ({n["id"] for n in existing_nodes if _is_stale_entity_node(n)}
                     | {n["id"] for n in existing_nodes if _is_stale_deleted_entity(n)}
                     | {n["id"] for n in existing_nodes if _is_stale_plate_node(n)}
                     | {n["id"] for n in existing_nodes if _is_stale_dict_artifact_node(n)}
                     | {n["id"] for n in existing_nodes if _is_unadmitted_article_node(n)})

        if stale_ids:
            deleted_ids = {n["id"] for n in existing_nodes if _is_stale_deleted_entity(n)}
            if deleted_ids:
                print(f"  [清理] 移除 {len(deleted_ids)} 个已删除 entity 的残留节点: {', '.join(sorted(deleted_ids))}")
            plate_stale = {n["id"] for n in existing_nodes if _is_stale_plate_node(n)}
            if plate_stale:
                print(f"  [清理] 移除 {len(plate_stale)} 个过期 Plate 节点")
            unadmitted_articles = {n["id"] for n in existing_nodes if _is_unadmitted_article_node(n)}
            if unadmitted_articles:
                print(f"  [清理] 移除 {len(unadmitted_articles)} 个未处于当前批准快照集合的文章节点")
            dict_artifacts = {n["id"] for n in existing_nodes if _is_stale_dict_artifact_node(n)}
            if dict_artifacts:
                print(f"  [清理] 移除 {len(dict_artifacts)} 个 dict 残影节点（注册表词条误拼窗口产物）")

        def _conn_key(c):
            return _edge_merge_key(c)

        master_conn_keys = {_conn_key(c) for c in master_conns}
        # ADR009 R9：USES 已裁定删除——存量 USES 边不再保留（停发 + 合并剔除）
        # K 系列裁定（2026-09-10，架构师）：一律不继承机器章——existing_only 保留边的
        # approved/rejected 一律降级 pending。管道无法区分旧图状态的人工/机器来源，
        # 且 ADR054 D2 已裁定审核状态唯一事实源是 review_actions 账本（消费端
        # review-status-projection 账本优先合并读取），图内 approved 字段失去事实源地位；
        # 人工裁决经账本投影生效，不因管道重建丢失。
        existing_only = []
        _retired_counts = {}
        _inactive_carried_counts = {}
        for c in existing_conns:
            if _conn_key(c) in master_conn_keys:
                continue
            # ADR009 R9（USES 删除）/ PR-018②（team-placeholder 占位边）/
            # WP-005（BELONGS_TO 骨架挂载边停发）统一走退役规则表：生产者已停发的关系类型
            # 其存量边一律不继承——否则退役产物靠增量合并永生（实证 60 条僵尸边滞留）。
            _retire_reason = _retired_edge_reason(c)
            if _retire_reason:
                _retired_counts[_retire_reason] = _retired_counts.get(_retire_reason, 0) + 1
                continue
            # ADR-014 §4 承运方向：本次产出闸只拦新边，存量边若不按生命周期剔除，
            # 退役关系会靠 existing_only 每次都继承回图——「不进入新产出」沦为假绿。
            _inactive_carried_reason = _inactive_relation_reason(c, _relation_lifecycle)
            if _inactive_carried_reason:
                _inactive_carried_counts[_inactive_carried_reason] = (
                    _inactive_carried_counts.get(_inactive_carried_reason, 0) + 1)
                continue
            if c.get("from") in stale_ids or c.get("to") in stale_ids:
                continue
            _props = c.get("properties") if isinstance(c.get("properties"), dict) else None
            if _props is not None and _props.get("reviewStatus") in ("approved", "rejected"):
                _props["reviewStatus"] = "pending"
            if c.get("reviewStatus") in ("approved", "rejected"):
                c["reviewStatus"] = "pending"
            # PR-095 补口：承运边同样过政策闸——旧图章不是事实源（ADR054 D2 账本为准），
            # 政策 deterministic 的存量边必须原地派生生效，不得永久堵在人裁队列。
            _carried_stamp = _carried_edge_review_status(c, _relation_policies)
            if _props is not None:
                _props["reviewStatus"] = _carried_stamp
            c["reviewStatus"] = _carried_stamp
            existing_only.append(c)
        if _retired_counts:
            _detail = "、".join(f"{k}×{v}" for k, v in sorted(_retired_counts.items()))
            print(f"  [退役剔除] 存量边不继承：{_detail}")
        if _inactive_carried_counts:
            _detail = "、".join(f"{k}×{v}" for k, v in sorted(_inactive_carried_counts.items()))
            print(f"  [非现役剔除] 存量边不继承：{_detail}——非现役关系不进入产出")

        existing_by_key = {_conn_key(c): c for c in existing_conns}
        merged_master_conns = []
        for c in master_conns:
            # K 系列裁定（2026-09-10，架构师）：一律不继承机器章——旧图 reviewStatus
            # 不再恢复到新生成边（原「Preserve explicit human review decisions」继承块退役）。
            # 人工态以账本为准（ADR054 D2），新生成边保持生成时状态（pending）。
            merged_master_conns.append(c)

        merged_conns = existing_only + merged_master_conns

        # Human review state is restored after initial projection. An edge that
        # becomes approved here must receive the same derivation lineage as an
        # edge projected as approved from the start.
        merged_nodes_by_id = {node.get("id"): node for node in merged_nodes if node.get("id")}
        for conn in merged_conns:
            props = conn.setdefault("properties", {})
            if conn.get("reviewStatus") in ("approved", "rejected"):
                props["reviewStatus"] = conn["reviewStatus"]
            apply_derived_relation_lineage(conn, merged_nodes_by_id)

        # ── 清理「幽灵概念」：历史合并保留的 concept-* 但当前 wiki/concepts 无对应文件 ──
        if not keep_orphan_concepts:
            valid_concept_ids = {n["id"] for n in master_nodes if n.get("category") == "概念"}
            pruned_concept_ids = set()
            pruned_nodes = []
            for n in merged_nodes:
                nid = n.get("id", "")
                if (
                    n.get("category") == "概念"
                    and nid.startswith("concept-")
                    and nid not in valid_concept_ids
                ):
                    pruned_concept_ids.add(nid)
                    continue
                pruned_nodes.append(n)
            if pruned_concept_ids:
                merged_nodes = pruned_nodes
                merged_conns = [
                    c for c in merged_conns
                    if c.get("from") not in pruned_concept_ids and c.get("to") not in pruned_concept_ids
                ]
                print(
                    f"  [清理] 移除 {len(pruned_concept_ids)} 个无 wiki/concepts 支撑的概念占位节点"
                    "（若需保留请加 --keep-orphan-concepts）"
                )

        # ── 清理孤立节点：旧版本遗留、无任何连接边的节点 ──
        connected_ids = set()
        for c in merged_conns:
            connected_ids.add(c.get("from", ""))
            connected_ids.add(c.get("to", ""))
        pruned_orphan_ids = set()
        pruned_merged = []
        for n in merged_nodes:
            nid = n.get("id", "")
            # 保留新提取的节点（即使暂时无连接，它们是新生成的合法节点）
            # 只清理历史遗留的孤立节点
            if nid not in connected_ids and nid not in new_ids:
                pruned_orphan_ids.add(nid)
                continue
            pruned_merged.append(n)
        if pruned_orphan_ids:
            merged_nodes = pruned_merged
            merged_conns = [
                c for c in merged_conns
                if c.get("from") not in pruned_orphan_ids and c.get("to") not in pruned_orphan_ids
            ]
            print(f"  [清理] 移除 {len(pruned_orphan_ids)} 个孤立节点（历史遗留、无连接边）")

        # ── 为 versionable 关系补版本字段 ──
        # VERSIONABLE_TYPES 仅包含随产品版本演进的"物理架构"关系。
        # 以下类型被**刻意排除**，因为它们属于"知识组织层"，跨版本存在：
        #   - ASSOCIATED_WITH：Plate→Product/System/Module 的板块关联，是逻辑视图而非物理架构
        #   - INDEXES：Plate→Module 的知识覆盖索引，同样跨版本
        #   - APPLIES_TO：Document/Plate→Product/ProductVersion，知识适用性而非架构依赖
        # 若将这些类型加入 VERSIONABLE_TYPES，图谱会在版本切换时出现
        # 不属于该版本的逻辑连线，造成层级污染。
        VERSIONABLE_TYPES = {"DEPENDS_ON", "USES", "BACKS_UP", "STORES_IN", "CONNECTS_TO", "ENCRYPTS"}
        all_node_props = {n["id"]: n for n in merged_nodes}
        for conn in merged_conns:
            rt = conn.get("relationType", "")
            if rt not in VERSIONABLE_TYPES:
                continue
            props = conn.get("properties") or {}
            if props.get("since") or props.get("until"):
                continue
            src_id = conn.get("from", "")
            src_node = all_node_props.get(src_id)
            if src_node:
                src_props = src_node.get("properties", {})
                ver = src_props.get("version", "") or src_props.get("versionRange", "") or ""
                if ver:
                    conn["properties"] = {**props, "since": str(ver).split("→")[0].strip().split(",")[0].strip(),
                                                  "source_version": ver}
            if not conn.get("properties", {}).get("since"):
                pass  # 无版本约束 → 通用边，前端不做过期过滤

        for conn in merged_conns:
            props = conn.get("properties") if isinstance(conn.get("properties"), dict) else {}
            source_hash = _edge_source_hash(conn)
            if source_hash:
                conn["sourceHash"] = source_hash
            for field in ("since", "until"):
                value = props.get(field)
                if isinstance(value, str) and value.strip():
                    conn[field] = value.strip()

        # 合并待审核数据（无 module 的文档、待分类实体等）
        existing_pending = existing.get("pendingReview", []) if existing else []
        existing_pending_ids = {p["id"] for p in existing_pending if isinstance(p, dict)}
        # 保留历史待审核（未被新数据覆盖的）
        merged_pending = [p for p in existing_pending if p.get("id") not in existing_pending_ids]
        merged_pending.extend(unclassified_docs)
        # WP-107 D1：身份撞键条目并入待审面（id 前缀 conflict: 不与文档节点 id 相撞）
        merged_pending.extend(
            {
                "id": "conflict:" + _c["id"],
                "reason": "identity_conflict",
                "architectureNodeId": _c["id"],
                "sources": _c["sources"],
                "nodeCount": _c["nodes"],
                "title": "身份撞键：" + _c["id"],
            }
            for _c in IDENTITY_CONFLICTS
        )

        # WP-113 M4：缺身份号的组件并入同一条待审出口（条目在扫描侧已按 D1 形状组好，
        # id 前缀 missing-identity: 与 conflict:/文档节点 id 都不相撞）——图上不出现，但这里点名
        merged_pending.extend(MISSING_COMPONENT_IDENTITIES)

        # 去重
        seen_ids = set()
        deduped_pending = []
        for p in merged_pending:
            pid = p.get("id", "")
            if pid and pid not in seen_ids:
                seen_ids.add(pid)
                deduped_pending.append(p)

        # WP-031：文档级缺口豁免规则入图——单通道 merge（有则写、删则清，以本次实体文档扫描为准，
        # 防旧图残留与豁免幽灵）。覆盖两类形态：自建节点与 is_system 他建节点（后者当前不可达——
        # Step 3 退役后 arch_node_ids 恒空集，is_system 恒 False；分支保留以备 Step 3 复活）。
        applied = 0
        for n in merged_nodes:
            if n.get("id") not in entity_doc_node_ids:
                continue
            props = n.setdefault("properties", {})
            rules = entity_exemptions.get(n["id"])
            if rules:
                props["exempt_rules"] = rules
                applied += 1
            elif "exempt_rules" in props:
                del props["exempt_rules"]
        if entity_exemptions or applied:
            print(f"  [豁免] 文档豁免规则入图 {applied}/{len(entity_doc_node_ids)} 实体文档节点")

        extract_applied_iso = datetime.now().isoformat(timespec="seconds")
        # Atomic write
        os.makedirs(os.path.dirname(MASTER_JSON), exist_ok=True)
        tmp = MASTER_JSON + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({
                "_format_version": MASTER_GRAPH_FORMAT_VERSION,
                "_vault_extract_applied_at": extract_applied_iso,
                "ontology": knowledge_graph.get("ontology", {}),
                "nodes": merged_nodes,
                "connections": merged_conns,
                "pendingReview": deduped_pending,
                "unresolvedWikilinks": unresolved_wikilinks,
            }, f, ensure_ascii=False, indent=2)
        os.rename(tmp, MASTER_JSON)
        print(f"✅ master_graph.json 已同步: {len(merged_nodes)} 节点, {len(merged_conns)} 连接")
        if deduped_pending:
            print(f"📋 待审核: {len(deduped_pending)} 个无 module 的文档（在架构图系统 KGPanel → 同步 中查看）")
        if version_pending_docs:
            print(f"\n⚠️  WARNING: {len(version_pending_docs)} 个文档缺少版本号 → cockpit「文档版本审核」面板")

        # ── 同步 document_index 表（图↔向量桥接） ──
        _populate_document_index(merged_nodes)

    if mode_apply:

        # Optionally write flat cache
        if mode_cache:
            flat_graph = {
                "meta": {
                    "generated_at": datetime.now().isoformat(),
                    "source": "extract_graph.py v2.0 (cache)",
                    "note": "Derived from architecture JSON knowledgeGraph section",
                },
                "nodes": all_nodes,
                "edges": all_edges,
            }
            os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
            tmp = OUTPUT + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(flat_graph, f, ensure_ascii=False, indent=2)
            os.rename(tmp, OUTPUT)
            print(f"✅ 查询缓存已写入: {OUTPUT}")

        # Sync to master_graph.json (triggers Electron auto-refresh via fs.watch)

        # ── 节点去重：同一 ID 的架构 JSON 节点与 entity 节点合并 ──
        # entity 文件为语义真理源（有 arch_component=true），架构 JSON 贡献视觉布局属性
        VISUAL_PROPS = {"style", "x", "y", "width", "height", "accent", "sublabels", "lines", "wiki_path"}
        deduped = {}
        for n in all_nodes:
            nid = n["id"]
            if nid not in deduped:
                deduped[nid] = n
                continue
            existing = deduped[nid]
            n_is_entity = n.get("properties", {}).get("arch_component")
            existing_is_entity = existing.get("properties", {}).get("arch_component")
            # entity 节点是真理源 → 保留它，补充视觉属性
            if n_is_entity and not existing_is_entity:
                for k in VISUAL_PROPS:
                    if k in existing.get("properties", {}) and k not in n.get("properties", {}):
                        n["properties"][k] = existing["properties"][k]
                deduped[nid] = n
            elif existing_is_entity and not n_is_entity:
                for k in VISUAL_PROPS:
                    if k in n.get("properties", {}) and k not in existing.get("properties", {}):
                        existing["properties"][k] = n["properties"][k]
            else:
                # 都不是 entity（两个架构 JSON 源 或 两个非架构节点），保留已有
                pass
            # 合并 labels（取并集）
            deduped[nid]["labels"] = list(set(existing.get("labels", [])) | set(n.get("labels", [])))
        all_nodes = list(deduped.values())

        _sync_to_master(all_nodes, all_edges)
        if mode_incremental and incremental_manifest:
            incremental_manifest = _build_incremental_manifest()
            _d3 = _pipeline_context_status(*_architecture_product_version())
            if _d3:
                incremental_manifest["pipeline_status"] = _d3
                print(f"⚠️  降级运行: {_d3['status']}——{_d3['next_action']}")
            _write_incremental_manifest(incremental_manifest)
            print(f"✅ 增量指纹已更新: {INCREMENTAL_MANIFEST}")
    else:
        print(f"\n⚠️  预览模式（使用 --apply 写入，--apply --cache 同时写入缓存）")

    # Print stats
    print(f"\n{'='*50}")
    print(f"图数据统计")
    print(f"{'='*50}")
    print(f"总节点数: {len(all_nodes)}")
    for label, count in knowledge_graph["stats"]["nodesByLabel"].items():
        print(f"  {label}: {count}")
    print(f"\n总边数: {len(all_edges)}")
    for etype, count in knowledge_graph["stats"]["edgesByType"].items():
        print(f"  {etype}: {count}")

    if mode_validate:
        graph = {"nodes": all_nodes, "edges": all_edges}
        validate_graph(graph)

    # Auto-validate after apply: compact quality summary
    if mode_apply:
        _quality_summary(all_edges, all_nodes)

        # Auto-refresh graph-status.md dashboard
        try:
            gs_script = os.path.join(os.path.dirname(__file__), "graph-status.py")
            import subprocess
            subprocess.run(
                [sys.executable, gs_script, "--write"],
                capture_output=True, timeout=30,
                env={**os.environ, "KB_VAULT": str(VAULT_ROOT)},
            )
            print("✅ graph-status.md 已刷新")
        except Exception:
            pass  # 非关键路径，失败不阻塞主流程

        # SPEC-012 WP-I（2026-10-14）：change_logs 两件（extract_change_logs/＋latest_change_log.json）
        # 退役——全仓零读者（勘察实证），B 类脚本零 vault 直写；如需变更审计由编排者追加⑤类流水。
        # 增量 manifest 只服务 --incremental 跳过判定：product/version 解析不出（注册表空＋
        # 无 env 注入）时告警跳过——旧 manifest 缺席/过期会让下次增量自然回落全量重建，语义安全；
        # 不让优化输入把已完成的抽取以非零退出收场（与上方 graph-status 同款非关键路径口径）。
        try:
            incremental_manifest = _build_incremental_manifest()
            _write_incremental_manifest(incremental_manifest)
        except RuntimeError as manifest_error:
            print(f"  [告警] 增量 manifest 跳过：{manifest_error}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
