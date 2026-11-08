#!/usr/bin/env python3
# Component: Article-Classifier
# @responsible: entity↔module 映射维护 + 待审核文档批量归类，支持基于关键词的自动映射建议
# @inputs: entity 列表 / 待审核文档
# @outputs: module 映射 / frontmatter 写入
# @context: A. 知识源上下文 (Vault Context)
"""
分类管理 CLI — entity 映射维护 + 待审核文档批量归类
  python3 classify.py entity list                      # 列出所有实体的映射状态
  python3 classify.py entity list --unmapped           # 只列出未映射的实体
  python3 classify.py entity list --module <name>      # 列出某 module 下的实体
  python3 classify.py entity suggest                    # 基于关键词自动建议映射
  python3 classify.py entity map <id> <module>          # 建立实体→module 映射
  python3 classify.py entity unmap <id>                 # 解除映射
  python3 classify.py entity apply --confirm            # 批量写入建议映射
  python3 classify.py entity modules                    # 列出已有 module
  python3 classify.py entity module-add <name> <system> <subdomain>  # 新增 module
  python3 classify.py pending                           # 预览待审核文档归类建议
  python3 classify.py pending --apply                   # 写入 frontmatter
  python3 classify.py pending --apply --sources-only    # 只处理 wiki/sources
"""

# PR-132：自举先于导入＋锚在目录（原 65aee107 版两病齐发：导入在前、_H 锚文件 parents[1] 差一层）
import sys as _sys
from pathlib import Path as _Path
_HERE = _Path(__file__).resolve().parent
for _dep in (_HERE, _HERE.parents[1] / "vault-runtime"):
    _s = str(_dep)
    if _s not in _sys.path: _sys.path.insert(0, _s)
from write_gateway import write_text_atomic, append_line, write_bytes_atomic

import json
import os
import re
import shutil
import sys
import yaml

from kb_paths import vault_roots, ledger_dir
import doc_consumption  # WP-155：文档面改吃文档信封（ADR-016 §二装载入口——本件不 open 任何 .md）

VAULT_ROOT, VAULT = vault_roots()  # WP-049 L3：词表经 schema_loader→信封取数，不再构造词表文件路径
ENTITIES_DIR = os.path.join(VAULT, "wiki", "entities")
MASTER_JSON = os.path.join(ledger_dir(VAULT_ROOT), "master_graph.json")  # PR-243 批B：单源


# ── shared: enums I/O ──────────────────────────────────

def load_enums():
    import schema_loader  # WP-049 L3：读侧经信封（ADR-016 §四-2 同宿主裁决）
    return schema_loader.load_the_schema("enums")[0] or {}


# 〔SPEC-021 波 B 退役〕save_enums：enums 直写自实现已由统一写客户端取代（schema-write-client.mjs）——协议单源。读侧 load_enums 保留。

def collect_entities():
    """实体页面清单（WP-155 信封口径——经 doc_consumption，本件零 .md 直读）。

    语义对齐：原 os.listdir(ENTITIES_DIR) 逐文件「无块/坏 YAML → continue」；信封口径
    parse 返回 None 分支同址 continue。content 键＝fmText+body 重建（信封切分点同址，
    逐字节同源——write_module_to_frontmatter 素材与原文件全文一致）。"""
    envelope = doc_consumption.load_for_vault(VAULT_ROOT)
    kb_prefix = doc_consumption.knowledge_prefix(VAULT_ROOT, VAULT)
    entities = {}
    for rel, doc in doc_consumption.iter_documents(envelope, prefixes=(kb_prefix + "wiki/entities/",)):
        fname = rel.rsplit("/", 1)[-1]
        if not fname.endswith(".md"):
            continue  # 信封只收 .md——防御保留，同原后缀过滤
        name = fname.replace(".md", "")
        parsed = doc_consumption.parse_frontmatter(doc["fmText"], doc["body"])
        if parsed is None:
            continue
        fm, _body = parsed
        entities[name] = {
            "arch_id": fm.get("architecture-node-id", ""),
            "fm": fm,
            "rel_path": doc_consumption.to_knowledge_rel(rel, kb_prefix),
            "content": doc["fmText"] + doc["body"],
        }
    return entities


def system_to_modules(enums):
    m = {}
    for mname, minfo in enums["modules"].items():
        sys_id = minfo.get("system", "None")
        if sys_id and sys_id != "None":
            m.setdefault(sys_id, []).append(mname)
    return m


def write_module_to_frontmatter(content, module_name):
    """在 frontmatter 中写入/替换 module 字段。"""
    if not content.startswith("---"):
        return f"---\nmodule: [[{module_name}]]\n---\n\n{content}"
    parts = content.split("---", 2)
    if len(parts) < 3:
        return content
    fm_part = parts[1]
    if "module:" in fm_part:
        new_fm = re.sub(r'^module\s*:\s*.*$', f'module: [[{module_name}]]', fm_part,
                        count=1, flags=re.MULTILINE)
    else:
        new_fm = fm_part.rstrip() + f"\nmodule: [[{module_name}]]\n"
    return f"---{new_fm}---{parts[2]}"


# ── suggest: shared alias + keyword logic ──────────────

ALIAS_MAP = {
    "user-terminal": ["客户端", "控制台"],
    "ingress-controller": ["Kubernetes"],
    "load-balancer": ["负载均衡"],
    "docker": ["Docker"],
    "xtrabackup": ["MySQL"],
    "online-edit": ["Office Online"],
    "knowledge-center": ["KnowledgeCenter", "智能搜索", "认知助手"],
    "sailor-extension": ["客户端"],
    "sensitive-content": ["智能搜索"],
    "workflow-center": ["工作中心"],
    "smart-search": ["智能搜索"],
    "crm-ticket": ["Bot"],
    "workload-orchestration": ["Kubernetes"],
    "data-encrypt": ["数据加密"],
    "access-control": ["认证服务"],
    "vuln-mgmt": ["漏洞管理"],
    "cert-mgmt": ["证书管理"],
    "yisaitong": ["亿赛通"],
    "redis": ["Redis"],
    "zabbix": ["Zabbix"],
    "ecoindex": ["可观测性"],
    "mongodb": ["MySQL"],
    "nas-gateway": [""],
    "storcli": ["磁盘管理"],
    "wps": ["WPS"],
    "oauth2-ui": ["认证服务"],
    "anyshare同步客户端": ["客户端"],
    "anyshare客户端": ["AnyShare客户端"],
    "crm-workorder": ["Bot"],
    "jvm内存管理": ["可观测性"],
    "ecms-cluster": ["ECMS集群", "主模块"],
    "ceph-eceph": ["Ceph", "磁盘管理"],
    "opensearch": ["OpenSearch", "搜索"],
    "mysql": ["MySQL", "数据库"],
    "office-online": ["Office Online"],
    "document-flow": ["文档同步"],
    "content-service": ["Content服务"],
    "oss-gateway": ["OSS网关"],
    "os-support": ["麒麟OS"],
    "calico": ["Calico"],
    "kubernetes": ["Kubernetes"],
    "ceph": ["Ceph", "磁盘管理"],
    "anyrobot": ["Bot"],
    "java": ["Kubernetes"],
    "oom排查": ["可观测性"],
    "nas网关": ["OSS网关"],
    "sap智能内容管理": ["Content服务"],
    "物理盘接口类型": ["磁盘管理"],
    "数据盘更换": ["磁盘管理"],
    "进程识别与分析": ["可观测性"],
    "主从复制": ["MySQL"],
    "资源使用模式分析": ["可观测性"],
    "运营指标": ["可观测性"],
    "北极星指标": ["可观测性"],
    "文件冲突机制": ["文档同步"],
    "流式下载优化": ["Content服务"],
    "系统备份与升级": ["安装部署"],
    "滚动重启": ["Kubernetes"],
    "证书链": ["证书管理"],
    "全文索引重建": ["OpenSearch"],
    "k8s配置变更": ["Kubernetes"],
    "yaml配置排查": ["Kubernetes"],
    "存储巡检": ["磁盘管理"],
    "数据备份策略": ["数据库"],
    "linux性能排查": ["麒麟OS"],
    "磁盘空间管理": ["磁盘管理"],
    "在线预览与编辑代理服务": ["Office Online"],
    "日志分析": ["可观测性"],
    "zerotier": ["Kubernetes"],
    "zettelkasten-box插件开发参考": ["搜索"],
    "ecindex": ["可观测性"],
    "docsync": ["文档同步"],
}


def suggest_modules(entity_name, arch_id, all_modules, version_str=""):
    enums = load_enums()
    sys2mod = system_to_modules(enums)
    if arch_id in sys2mod:
        return sys2mod[arch_id]
    if arch_id in ALIAS_MAP:
        valid = [m for m in ALIAS_MAP[arch_id] if m in all_modules]
        if valid:
            return valid
    if version_str:
        try:
            import schema_loader as sl
            version_ok = set(sl.modules_for_version(version_str))
            all_modules = [m for m in all_modules if m in version_ok]
        except Exception:
            pass
    kw = (entity_name + " " + (arch_id or "")).lower().replace("-", " ").replace("_", " ")
    for mname in sorted(all_modules):
        mkw = mname.lower().replace("-", " ").replace("_", " ")
        if mkw in kw or kw in mkw:
            return [mname]
    for mname in sorted(all_modules):
        info = enums["modules"].get(mname, {})
        sub = info.get("subdomain", "")
        if sub and sub.lower() in kw:
            return [mname]
    return []


def build_entity_map(entities, enums):
    all_modules = set(enums["modules"].keys())
    results = []
    for name, info in entities.items():
        aid = info["arch_id"]
        fm = info["fm"]
        current_module = fm.get("module", "")
        if isinstance(current_module, list):
            current_module = current_module[0] if current_module else ""
        current_module = str(current_module).strip("[]\"'")
        version_str = str(fm.get("version", fm.get("version_range", "")) or "")
        suggested = suggest_modules(name, aid, all_modules, version_str)
        results.append({
            "entity_id": name, "entity_name": name, "arch_id": aid,
            "current_module": current_module or "",
            "suggested_modules": suggested,
            "has_module": bool(current_module), "has_arch_id": bool(aid),
            "sourcePath": info.get("rel_path", ""),
        })
    return results


# ── subcommand: entity ─────────────────────────────────

def cmd_entity(args):
    if not args:
        print("用法: classify.py entity {list|suggest|modules|module-add|map|unmap|apply}")
        sys.exit(1)
    sub = args[0]
    rest = args[1:]

    if sub == "list":
        cmd_entity_list(rest)
    elif sub == "suggest":
        cmd_entity_suggest(rest)
    elif sub == "modules":
        cmd_entity_modules(rest)
    elif sub == "module-add":
        cmd_entity_module_add(rest)
    elif sub == "map":
        cmd_entity_map(rest)
    elif sub == "unmap":
        cmd_entity_unmap(rest)
    elif sub == "apply":
        cmd_entity_apply(rest)
    else:
        print(f"未知命令: entity {sub}")
        sys.exit(1)


def cmd_entity_list(args):
    entities = collect_entities()
    enums = load_enums()
    results = build_entity_map(entities, enums)
    unmapped_only = "--unmapped" in args
    module_filter = None
    if "--module" in args:
        idx = args.index("--module")
        if idx + 1 < len(args):
            module_filter = args[idx + 1]

    if "--json" in args:
        filtered = []
        for r in results:
            if unmapped_only and r["has_module"]:
                continue
            if module_filter and r["current_module"] != module_filter:
                continue
            filtered.append(r)
        print(json.dumps(filtered, ensure_ascii=False))
        return

    for r in results:
        if unmapped_only and r["has_module"]:
            continue
        if module_filter and r["current_module"] != module_filter:
            continue
        status = "✅" if r["has_module"] else "⬜"
        arch = f" [{r['arch_id']}]" if r["arch_id"] else ""
        curr = r["current_module"] if r["current_module"] else "(无)"
        sugg = ", ".join(r["suggested_modules"]) if r["suggested_modules"] else "(无可建议)"
        print(f"{status} {r['entity_name']}{arch}")
        print(f"     module: {curr}")
        if sugg and not r["has_module"]:
            print(f"     建议: {sugg}")
        print()
    total = len(results)
    mapped = sum(1 for r in results if r["has_module"])
    if total == 0:
        # 空数据态（WP-155 验收⑤）：零实体不除零，给显式指引——去哪建实体、用什么命令核实
        print("总计: 0 实体（wiki/entities/ 下无实体页）")
        print("     → 先在 vault 的 wiki/entities/ 建含 frontmatter 的实体文档，再跑本命令核实")
        return
    print(f"总计: {total} 实体, 已映射: {mapped} ({mapped/total*100:.0f}%), 未映射: {total-mapped}")


def cmd_entity_suggest(args):
    entities = collect_entities()
    enums = load_enums()
    results = build_entity_map(entities, enums)
    for r in results:
        if r["has_module"]:
            continue
        if r["suggested_modules"]:
            print(f"⬜ {r['entity_name']} [{r['arch_id']}] → {', '.join(r['suggested_modules'])}")


def cmd_entity_modules(args):
    enums = load_enums()
    print(f"已有 {len(enums['modules'])} 个 module:\n")
    entities = collect_entities()
    for mname, minfo in sorted(enums["modules"].items()):
        sys_id = minfo.get("system", "None")
        sub = minfo.get("subdomain", "")
        mapped_entities = []
        for ename, einfo in entities.items():
            fm_module = str(einfo["fm"].get("module", "")).strip("[]\"'")
            if fm_module == mname:
                mapped_entities.append(ename)
        ent_str = f" → 实体: {', '.join(mapped_entities[:5])}" if mapped_entities else ""
        print(f"  {mname}")
        print(f"    system: {sys_id}, subdomain: {sub}{ent_str}")
        print()


def cmd_entity_module_add(args):
    if len(args) < 3:
        print("用法: classify.py entity module-add <name> <system> <subdomain>")
        sys.exit(1)
    name, system, subdomain = args[0], args[1], args[2]
    enums = load_enums()
    if name in enums["modules"]:
        print(f"⚠️ module '{name}' 已存在")
        sys.exit(1)
    # SPEC-021 波 B：enums 写收敛统一客户端（同目录 A 类 symlink schema-write-client.mjs）——
    # 协议（原子/快照/canonical/解析物联动）单源；原 save_enums 自实现退役。
    import subprocess
    client = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schema-write-client.mjs")
    if not os.path.exists(client):
        print("❌ schema-write-client.mjs 未部署（等 cheeseh-runtime 更新到含 SPEC-021 的 main 后 symlink 生效）", file=sys.stderr)
        sys.exit(1)
    proc = subprocess.run(["node", client, "revision", "--segment", "enums", "--vault", VAULT_ROOT], capture_output=True, text=True)
    if proc.returncode != 0:
        print(f"❌ enums 乐观锁基线读取失败（统一写客户端）: {proc.stderr.strip()}", file=sys.stderr)
        sys.exit(1)
    enums_revision = json.loads(proc.stdout)["revision"]
    # PR-200：写侧乐观锁基线必填——基线经同一客户端读出后原样回传（Python 侧不另起哈希配方）
    proc = subprocess.run(["node", client, "modules-upsert", "--vault", VAULT_ROOT, "--name", name, "--system", system, "--subdomain", subdomain, "--revision", enums_revision], capture_output=True, text=True)
    if proc.returncode != 0:
        print(f"❌ module 写入失败（统一写客户端）: {proc.stderr.strip()}", file=sys.stderr)
        sys.exit(1)
    print(f"✅ 已添加 module: {name} (system={system}, subdomain={subdomain}，经统一写客户端)")


def cmd_entity_map(args):
    if len(args) < 2:
        print("用法: classify.py entity map <entity_id> <module_name>")
        sys.exit(1)
    entity_id, module_name = args[0], args[1]
    enums = load_enums()
    if module_name not in enums["modules"]:
        print(f"⚠️ module '{module_name}' 不存在，请先用 module-add 创建")
        sys.exit(1)
    entities = collect_entities()
    if entity_id not in entities:
        print(f"⚠️ 实体 '{entity_id}' 不存在")
        sys.exit(1)
    fp = os.path.join(ENTITIES_DIR, entity_id + ".md")
    new_content = write_module_to_frontmatter(entities[entity_id]["content"], module_name)
    write_text_atomic(fp, new_content)
    print(f"✅ {entity_id} → module: {module_name}")


def cmd_entity_unmap(args):
    if len(args) < 1:
        print("用法: classify.py entity unmap <entity_id>")
        sys.exit(1)
    entity_id = args[0]
    entities = collect_entities()
    if entity_id not in entities:
        print(f"⚠️ 实体 '{entity_id}' 不存在")
        sys.exit(1)
    new_content = re.sub(r'^module\s*:\s*.*\n?', '', entities[entity_id]["content"],
                         count=1, flags=re.MULTILINE)
    fp = os.path.join(ENTITIES_DIR, entity_id + ".md")
    write_text_atomic(fp, new_content)
    print(f"✅ {entity_id} → 已解除 module 映射")


def cmd_entity_apply(args):
    confirm = "--confirm" in args
    entities = collect_entities()
    enums = load_enums()
    results = build_entity_map(entities, enums)
    changes = [r for r in results if not r["has_module"] and r["suggested_modules"]]
    if not changes:
        print("✅ 所有实体已映射，无需操作")
        return
    if not confirm:
        print(f"将应用 {len(changes)} 个建议映射:\n")
        for r in changes:
            print(f"  {r['entity_name']} → {', '.join(r['suggested_modules'])}")
        print("\n使用 --confirm 确认写入")
        return
    for r in changes:
        cmd_entity_map([r["entity_name"], r["suggested_modules"][0]])
    print(f"\n✅ 已应用 {len(changes)} 个映射")


# ── subcommand: pending ────────────────────────────────

MODULE_RULES = [
    (lambda p, t: "KnowledgeCenter" in t or "认知助手" in t, "认知助手"),
    (lambda p, t: "智能搜索" in t or "smart-search" in t or "smart_search" in t, "智能搜索"),
    (lambda p, t: "工作中心" in t or "workflow" in t.lower(), "工作中心"),
    (lambda p, t: "WPS" in t or "wps中台" in t.lower(), "WPS"),
    (lambda p, t: "Office Online" in t or "office-online" in t.lower() or "在线编辑" in t, "Office Online"),
    (lambda p, t: "MySQL" in t or "mysql" in t.lower() or "主从复制" in t or "数据库热备份" in t or "数据库脏数据" in t or "Xtrabackup" in t or "xtrabackup" in t.lower(), "MySQL"),
    (lambda p, t: "MongoDB" in t or "mongodb" in t.lower(), "MySQL"),
    (lambda p, t: "MariaDB" in t or "mariadb" in t.lower(), "MariaDB"),
    (lambda p, t: "Redis" in t or "redis" in t.lower(), "Redis"),
    (lambda p, t: "OpenSearch" in t or "opensearch" in t.lower() or "全文索引" in t or "搜索" in t, "OpenSearch"),
    (lambda p, t: "Ceph" in t or "ceph" in t.lower() or "eceph" in t.lower() or "磁盘空间" in t or "OSD" in t or "磁盘管理" in t or "存储巡检" in t or "磁盘" in t, "Ceph"),
    (lambda p, t: "Calico" in t or "calico" in t.lower() or "证书到期" in t or "网络" in t, "Calico"),
    (lambda p, t: "Docker" in t or "docker" in t.lower(), "Docker"),
    (lambda p, t: "Kubernetes" in t or "kubernetes" in t.lower() or "k8s" in t.lower() or "K8s" in t or "滚动重启" in t or "ingress" in t.lower() or "load-balancer" in t.lower() or "负载均衡" in t or "Deployment" in t or "YAML" in t or "yaml" in t, "Kubernetes"),
    (lambda p, t: "客户端" in t or "Sailor" in t or "sailor" in t.lower() or "同步盘" in t or "用户终端" in t or "兼容性" in t or "anyShare同步" in t.lower() or "anyShare客户" in t.lower(), "客户端"),
    (lambda p, t: "亿赛通" in t or "yisaitong" in t.lower(), "亿赛通"),
    (lambda p, t: "证书" in t or "cert" in t.lower() or "证书链" in t, "证书管理"),
    (lambda p, t: "漏洞" in t or "vuln" in t.lower(), "漏洞管理"),
    (lambda p, t: "数据加密" in t or "加密" in t or "data-encrypt" in t.lower(), "数据加密"),
    (lambda p, t: "Content服务" in t or "content-service" in t.lower() or "SAP" in t or "流式下载" in t or "文件冲突" in t, "Content服务"),
    (lambda p, t: "OSS网关" in t or "oss-gateway" in t.lower() or "NAS" in t or "nas" in t.lower(), "OSS网关"),
    (lambda p, t: "ECMS" in t or "ecms" in t.lower(), "ECMS集群"),
    (lambda p, t: "Zabbix" in t or "zabbix" in t.lower(), "Zabbix"),
    (lambda p, t: "麒麟" in t or "Linux" in t or "linux" in t.lower() or "os-support" in t.lower(), "麒麟OS"),
    (lambda p, t: "CRM" in t or "Bot" in t or "crm" in t.lower() or "工单" in t, "Bot"),
    (lambda p, t: "可观测" in t or "OOM" in t or "oom" in t.lower() or "ecoindex" in t.lower() or "北极星" in t or "运营指标" in t or "资源使用" in t or "进程识别" in t or "JVM" in t or "jvm" in t.lower() or "日志" in t, "可观测性"),
    (lambda p, t: "文档同步" in t or "文档流转" in t or "docsync" in t.lower() or "document-flow" in t.lower(), "文档同步"),
    (lambda p, t: "认证" in t or "oauth2" in t.lower() or "访问控制" in t or "access-control" in t.lower(), "认证服务"),
    (lambda p, t: "备份" in t or "升级" in t or "安装" in t or "部署" in t or "系统备份" in t or "更新指导" in t, "安装部署"),
    (lambda p, t: "/03-实施指导/" in p, "安装部署"),
    (lambda p, t: "/04-更新指导/" in p or "/05-升级/" in p, "安装部署"),
    (lambda p, t: "/06-巡检/" in p or "/07-监控/" in p or "/08-运维/" in p, "Kubernetes"),
    (lambda p, t: "/09-功能列表/" in p or "功能对比" in t or "功能列表" in t, "主模块"),
    (lambda p, t: "Office插件" in p, "Office Online"),
    (lambda p, t: "在线编辑与预览" in p, "Office Online"),
    (lambda p, t: "SailorExtension" in p, "客户端"),
    (lambda p, t: "升级" in t, "安装部署"),
    (lambda p, t: "部署" in t or "实施" in t, "安装部署"),
    (lambda p, t: "mysql" in t.lower() or "数据库" in t or "xtrabackup" in t.lower(), "MySQL"),
    (lambda p, t: "opensearch" in t.lower() or "索引" in t, "OpenSearch"),
    (lambda p, t: "ceph" in t.lower() or "存储" in t or "磁盘" in t or "osd" in t.lower(), "Ceph"),
    (lambda p, t: "k8s" in t.lower() or "kubernetes" in t.lower() or "pod" in t.lower() or "容器" in t or "命名空间" in t, "Kubernetes"),
    (lambda p, t: "网关" in t or "proxy" in t.lower() or "反向代理" in t, "OSS网关"),
    (lambda p, t: "证书" in t or "https" in t.lower() or "tls" in t.lower(), "证书管理"),
    (lambda p, t: "client" in t.lower() or "终端" in t or "pc" in t.lower() or "windows" in t.lower() or "mac" in t.lower() or "桌面" in t, "客户端"),
    (lambda p, t: "ecms" in t.lower() or "主模块" in t, "ECMS集群"),
    (lambda p, t: "oauth2" in t.lower() or "认证" in t or "登录" in t, "认证服务"),
    (lambda p, t: "calico" in t.lower() or "网络" in t, "Calico"),
    (lambda p, t: "license" in t.lower() or "许可" in t, "证书管理"),
    (lambda p, t: "上传文件" in t or "下载" in t or "卡" in t or "ov无法访问" in t or "报错" in t or "异常" in t or "失败" in t or "无法" in t or "Internal" in t or "错误" in t or "不能" in t or "超时" in t or "timeout" in t.lower() or "pending" in t.lower() or "crash" in t.lower() or "宕机" in t or "down" in t.lower() or "overflow" in t.lower() or "OOM" in t or "oom" in t.lower(), "Kubernetes"),
    (lambda p, t: "地" in t and ("址" in t or "IP" in t or "域名" in t), "Kubernetes"),
    (lambda p, t: "测试报告" in t or "稳定性测试" in t, "安装部署"),
    (lambda p, t: "README" in t or "readme" in t.lower() or t == "test_file", None),
    (lambda p, t: "商标声明" in t or "trademark" in t.lower() or "版权" in t, None),
    (lambda p, t: "知识库" in t or "知识图谱" in t or "Lint" in t, None),
    (lambda p, t: p.startswith("wiki/todo/") or p.startswith("wiki/queries/") or p.startswith("wiki/overview/"), None),
]


def load_pending_entities():
    entities = {}
    if os.path.exists(MASTER_JSON):
        with open(MASTER_JSON, "r") as f:
            data = json.load(f)
        for p in data.get("pendingReview", []):
            fp = p.get("file_path", "")
            if fp:
                entities[fp] = {"title": p.get("title", ""), "product": p.get("product", ""),
                                "version": p.get("version", ""), "module": None}
    envelope = doc_consumption.load_for_vault(VAULT_ROOT)
    kb_prefix = doc_consumption.knowledge_prefix(VAULT_ROOT, VAULT)
    # WP-155 信封口径：组序保持原 walk 序（wiki/sources 全部 → raw/precleaned 全部）；组内原为
    # 文件系统枚举序，信封口径＝path 字典序（更确定；集合与每条内容逐字同源，顺序差异随批注记）。
    # 目录缺失形态：信封 paths 放行（空清单继续），对齐原 isdir continue（SPEC-084 §八-3 口径）。
    for base_dir in ["wiki/sources", "raw/precleaned"]:
        # （单元素元组必须带逗号——(x) 是分组不是元组，字符串入过滤会逐字符迭代恒真，WP-155 对拍实录）
        for rel, doc in doc_consumption.iter_documents(envelope, prefixes=(kb_prefix + base_dir + "/",)):
            fp_rel = doc_consumption.to_knowledge_rel(rel, kb_prefix)
            if fp_rel is None:
                continue  # 语料外信封件——显式跳过，不当库内文件用
            fname = fp_rel.rsplit("/", 1)[-1]
            if fp_rel not in entities:
                entities[fp_rel] = {"title": None, "product": None, "version": None, "module": None}
            parsed = doc_consumption.parse_frontmatter(doc["fmText"], doc["body"])
            if parsed is not None:
                fm, _body = parsed
                entities[fp_rel]["title"] = fm.get("title") or entities[fp_rel]["title"] or fname.replace(".md", "")
                entities[fp_rel]["product"] = fm.get("product") or entities[fp_rel]["product"]
                entities[fp_rel]["version"] = fm.get("version") or entities[fp_rel]["version"]
                mod = fm.get("module", "")
                if isinstance(mod, list):
                    mod = mod[0] if mod else ""
                mod = str(mod).strip("[]\"'")
                if mod:
                    entities[fp_rel]["module"] = mod
            if entities[fp_rel]["title"] is None:
                entities[fp_rel]["title"] = fname.replace(".md", "")
    return entities


def suggest_module_pending(file_path, title):
    for rule_fn, module_name in MODULE_RULES:
        if rule_fn(file_path, title):
            return module_name
    return None


def cmd_pending(args):
    mode_apply = "--apply" in args
    sources_only = "--sources-only" in args
    entities = load_pending_entities()
    if sources_only:
        entities = {k: v for k, v in entities.items() if k.startswith("wiki/sources/")}

    total = len(entities)
    has_module = sum(1 for v in entities.values() if v["module"])
    suggested = 0
    changes = []
    for fp, info in sorted(entities.items()):
        title = info["title"] or os.path.basename(fp).replace(".md", "")
        if info["module"]:
            continue
        mod = suggest_module_pending(fp, title)
        if mod:
            suggested += 1
            changes.append((fp, title, mod))
        else:
            changes.append((fp, title, None))

    print(f"总文档: {total}, 已有 module: {has_module}, 待处理: {total - has_module}")
    print(f"有建议: {suggested}, 跳过: {total - has_module - suggested}\n")

    if not mode_apply:
        print("=== 预览（使用 --apply 写入）===\n")
        for fp, title, mod in changes:
            if mod is None:
                status = "⏭️ 跳过"
            elif mod == "":
                status = "⚠️ 无建议"
            else:
                status = f"→ {mod}"
            print(f"  {title[:40]:40s}  {status}")
        print(f"\n总计: {len([c for c in changes if c[2]])} 个建议")
        return

    applied = skipped = 0
    for fp, title, mod in changes:
        if not mod:
            skipped += 1
            continue
        full_path = os.path.join(VAULT, fp)
        if not os.path.exists(full_path):
            print(f"⚠️ 文件不存在: {full_path}")
            skipped += 1
            continue
        # 写前自读（WP-155 定性，human_edit_guard 同族先例）：读现盘页原文做写前裁决与
        # 变换素材——写主权面自读，非文档装载消费链，不经信封（落笔瞬间的现盘真相优先于快照）。
        content = open(full_path, "r", encoding="utf-8").read()
        new_content = write_module_to_frontmatter(content, mod)
        write_text_atomic(full_path, new_content)
        applied += 1
        print(f"  ✅ {fp} → [[{mod}]]")

    print(f"\n已应用: {applied}, 跳过: {skipped}")


# ── main ────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    # WP-155：文档面统一走文档信封——人工 CLI 直拉时信封缺失即自动物化一次，
    # 失败显式退出（零回落——本件消费面不 open 任何 .md）。
    doc_consumption.ensure_doc_envelope(VAULT_ROOT)

    cmd = sys.argv[1]
    args = sys.argv[2:]

    if cmd == "entity":
        cmd_entity(args)
    elif cmd == "pending":
        cmd_pending(args)
    else:
        print(f"未知命令: {cmd}")
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
