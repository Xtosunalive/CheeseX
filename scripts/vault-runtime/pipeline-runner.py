#!/usr/bin/env python3
# Component: Pipeline-Runner
# @responsible: 按 Stage 0-7 顺序执行全管道，每阶段独立门控，断链即停。内置 SA 新鲜度检查和自动重试
# @inputs: 用户触发（`--force` / `--incremental` / `--dry-run` / `--diagnostic`）
# @outputs: 各阶段门控通过/失败，Stage 7 自动写 memory
# @context: B. 逻辑中枢上下文 (Pipeline Context)
"""graph-pipeline 契约执行器 — 8 阶段程序化门控，断链即停。

用法:
  python3 pipeline-runner.py              # 全量执行
  python3 pipeline-runner.py --resume     # 从上次失败阶段续跑
  python3 pipeline-runner.py --dry-run    # 预览各阶段但不执行
  python3 pipeline-runner.py --diagnostic # 只读全局诊断，不发布派生数据
  python3 pipeline-runner.py --from 3     # 从指定阶段开始执行
  python3 pipeline-runner.py --force     # 强制全量提取（透传 --force 到 extract_graph.py）
  python3 pipeline-runner.py --rules     # 打印当前晋升规则摘要

替代 AI 手动跑 bash + grep 输出的脆弱门控。
每阶段独立校验退出码和输出数据，失败立即终止并写 state 文件。
"""

from write_gateway import write_text_atomic, append_line, write_bytes_atomic
import hashlib
import json
import os
import shlex
import subprocess
import sys
import time
import urllib.request
import urllib.error
import glob
import shutil
from datetime import datetime, timezone
from _vault_ledger import ledger
import _runtime_state_db

VAULT_ROOT = os.environ.get("KB_VAULT", os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))
ARCH_REPO = os.environ.get("ARCH_REPO", os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
# W2（SPEC-025 C1/ADR-011 D1 修订）：B 类编排生态随迁仓内——SCRIPTS_DIR 指仓内 vault-py/pipeline
# （原 vault 位已退役 84e14a3/本批；vault 侧仅余 W3 白名单件，不再承载编排）。
_SCRIPTS_CANDIDATES = [
    os.path.join(ARCH_REPO, "scripts", "vault-py", "pipeline"),  # 注入 ARCH_REPO 时首选（e2e/服务端链路）
    os.path.join(os.path.dirname(os.path.dirname(os.path.realpath(__file__))), "vault-py", "pipeline"),  # 真身推导（symlink 启动时 abspath 是 vault 路径——用 realpath）
    os.path.join(VAULT_ROOT, "知识库/.claude/scripts"),  # vault 旧位兜底（W3 后应为空）
]
SCRIPTS_DIR = next((c for c in _SCRIPTS_CANDIDATES if os.path.isfile(os.path.join(c, "merge-inferred.py"))), _SCRIPTS_CANDIDATES[0])
# W3：graph 族（extract_graph/validate_graph/graph-status）住 vault-py/graph/（pipeline 同源候选链对应位）
_GRAPH_CANDIDATES = [c.replace("/pipeline", "/graph") for c in _SCRIPTS_CANDIDATES]
GRAPH_DIR = next((c for c in _GRAPH_CANDIDATES if os.path.isfile(os.path.join(c, "extract_graph.py"))), _GRAPH_CANDIDATES[0])
# A 类运行时脚本事实源（PR-016 方案甲）：服务端装配注入 ARCH_REPO=cheeseh 仓根，其 scripts/vault-runtime/
# 是 generate-sa 等 7 个 A 类脚本的唯一权威。runner 内部调 A 类脚本必须走此目录（不再经 SCRIPTS_DIR 相对
# 路径解析到 vault 双轨副本——2026-10-11 实证该相对调用使 repo 侧修复不在执行链上，SSOT 失效）。
# B/C 类脚本（vault 编排生态与人工工具）仍走 SCRIPTS_DIR，不变。ARCH_REPO 缺省指向旧库时回退 SCRIPTS_DIR
# 保持兼容（该缺省仅在仓外手工运行 runner 时触发；服务端链路恒注入）。
RUNTIME_FACTSOURCE_DIR = os.path.join(ARCH_REPO, "scripts", "vault-runtime") if os.path.isdir(
    os.path.join(ARCH_REPO, "scripts", "vault-runtime")) else SCRIPTS_DIR
# SPEC-012 WP-A：STATE_FILE（.ledger/pipeline_state.json）随迁移退役——状态经 _runtime_state_db
MEMORY_DIR = os.path.join(VAULT_ROOT, ".claude", "memory")
SNAPSHOT_DIR = os.path.join(VAULT_ROOT, ".pipeline", "intermediates")
# 工件落点单源（SPEC-012 wave-2 类消收敛）：staging 族路径唯一推导入口＝kb_paths.staging_path。
# 原本地实现带「无 env 回退 vault .ledger 旧位」分支——旧位自 wave-2 起无写者，回退＝静默读
# 空路径（Stage 1 假失败根源），随本收敛删除；缺 env 与 extract_graph/generate-sa 同款 fail-closed。
from kb_paths import staging_path, theschema_dir

ARCHIVED_NODES_PATH = staging_path("archived_nodes.json")
API_PORT = None  # 由 Stage 0 探测


def _candidate_api_ports(preferred):
    """PR-133：发起方端口优先——run-service 经 env 注入 API_PORT（发起重建的服务自身端口）。
    有 preferred 时只验发起方（不扫邻居——多实例并存时扫到别的库＝跨服务假验证）；
    缺席（手工跑 runner）维持旧范围扫描。非法值回落扫描并保留告警语义（探测处打印）。"""
    try:
        return [int(preferred)] if preferred else list(range(18080, 18090))
    except (TypeError, ValueError):
        return list(range(18080, 18090))
FORCE_EXTRACT = False  # --force 透传到 extract_graph.py，跳过 incremental 检查
ARTICLE_ADMISSION_MANIFEST = None  # Web 批次冻结的标准文章候选清单

REQUIRED_PATHS = {
    "master_graph.json": staging_path("master_graph.json"),
    # WP-049 L3（ADR-016 §四-2）：词表经信封递入（Node 拉起点物化）——启动自检改验信封件，
    # 不再逐一词表文件存在性探测（信封含五件载荷与指纹，粒度更全）。
    "vocab-envelope.json": os.path.join(VAULT_ROOT, ".ledger", "vocab-envelope.json"),
    # PR-082：SA 族门控路径改派生通用槽（staging/sa/）——与 generate-sa 落位一致
    "semantic_architecture.json": staging_path("sa/semantic_architecture.json"),
    "architecture_layout.json": staging_path("sa/architecture_layout.json"),
}
BOOTSTRAP_OUTPUTS = {
    "master_graph.json",
    "semantic_architecture.json",
    "architecture_layout.json",
}
# 骨架数据为可选注入源 — 缺失时 Stage 0 仅警告不阻断，Stage 1.5 inject_skeleton_data() 自动跳过
SKELETON_PATHS = {
    "skeleton_components.json": os.path.join(VAULT_ROOT, ".ledger/skeleton/components.json"),
    "skeleton_middleware.json": os.path.join(VAULT_ROOT, ".ledger/skeleton/middleware.json"),
    "skeleton_business_flows.json": os.path.join(VAULT_ROOT, ".ledger/skeleton/business_flows.json"),
    "skeleton_alias_map.json": os.path.join(VAULT_ROOT, ".ledger/skeleton/alias_map.json"),
    "skeleton_manifest.json": os.path.join(VAULT_ROOT, ".ledger/skeleton/manifest.json"),
}
BOARD_CACHE = os.path.join(VAULT_ROOT, "知识库/raw/boards/_enums-cache.md")

# PR-110：TheSchema 族派生物——经唯一解析点定位（gen-system-components 写侧已随 PR-237 退役；
# 旧 vault 侧位迁仓后不存在，钉旧位恒报「未生成」）
STATUS_FILE = os.path.join(VAULT_ROOT, "知识库/wiki/graph-status.md")
LOG_FILE = os.path.join(VAULT_ROOT, "知识库/wiki/log.md")





def green(msg):
    return f"\033[32m{msg}\033[0m"


def red(msg):
    return f"\033[31m{msg}\033[0m"


def yellow(msg):
    return f"\033[33m{msg}\033[0m"


def banner(stage, label):
    print(f"\n{'━' * 60}")
    print(f"  Stage {stage}: {label}")
    print(f"{'━' * 60}")


def run(cmd, cwd=None, capture=True, timeout=120, env=None):
    """运行命令，返回 (exit_code, stdout, stderr)."""
    try:
        r = subprocess.run(
            cmd,
            shell=True,
            cwd=cwd,
            capture_output=capture,
            text=True,
            timeout=timeout,
            env=env,
        )
        return r.returncode, r.stdout, r.stderr
    except subprocess.TimeoutExpired:
        return -1, "", f"超时 ({timeout}s)"
    except Exception as e:
        return -1, "", str(e)


def _print_subprocess_output(label, stdout, stderr, exit_code):
    """Print captured subprocess output; always on failure, condensed on success."""
    if stderr:
        stderr_lines = [l for l in stderr.strip().split("\n") if l.strip()]
        if stderr_lines:
            print(f"    [{label} stderr]:")
            for l in stderr_lines[:8]:
                print(f"       {l}")
            if len(stderr_lines) > 8:
                print(f"       ... 还有 {len(stderr_lines) - 8} 行")
    if exit_code != 0 and stdout:
        stdout_lines = [l for l in stdout.strip().split("\n") if l.strip()]
        if stdout_lines:
            print(f"    [{label} stdout]:")
            for l in stdout_lines[-10:]:
                print(f"       {l}")


# SPEC-012 WP-A：run 阶段状态迁 runtime-state.db（repo data/，SQLite）——与 Node 侧
# pending_refresh 各占 pipeline_state 键，双进程互踩覆写构造性消失。
def load_state():
    try:
        return _runtime_state_db.load_stage()
    except RuntimeError:
        raise  # KB_DATA_DIR 缺失＝fail-closed（附指引）
    except Exception as exc:  # 库异常按「无恢复点」处理（fresh start），不静默装作旧文件语义
        print(f"    [state] 读取运行时状态失败，按无恢复点处理: {exc}")
        return {"last_stage": -1, "stage_data": {}}


def save_state(stage, data=None):
    _runtime_state_db.save_stage(stage, data)


def clear_state():
    try:
        _runtime_state_db.clear_stage()
    except Exception as exc:
        print(f"    [state] 清理运行时状态失败: {exc}")


def write_log(line):
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
    ts = datetime.now().strftime("%Y-%m-%d %H:%M")
    append_line(LOG_FILE, f"- {ts} | graph-pipeline | {line}\n")


def write_memory(success, stage, detail, stats=None):
    """Stage 7: 写入持久化 memory — 含管道执行上下文和诊断快照."""
    os.makedirs(MEMORY_DIR, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")

    mode = "force" if FORCE_EXTRACT else "incremental"
    retried = stats.get("_sa_retried", False)

    if success:
        name = f"graph-pipeline-exec-{ts}"
        n = stats.get("nodes", "?")
        c = stats.get("connections", "?")
        comps = stats.get("components", "?")
        plates = stats.get("plates", "?")
        desc = f"图谱管道执行成功 ({mode}) — nodes={n} connections={c} components={comps}"
        content = (
            f"管道全阶段通过 (Stage 0-8, mode={mode})。\n"
            f"nodes={n}, connections={c}, components={comps}, plates={plates}。"
        )
        if retried:
            content += "\n\n⚠️ Stage 3 首次 SA 同步未更新文件，已自动重试成功。"
        mem_type = "project"
    else:
        name = f"graph-pipeline-fail-{ts}"
        desc = f"图谱管道 Stage {stage} 失败 ({mode}) — {detail[:60]}"
        content = f"管道在 Stage {stage} 中断 (mode={mode}): {detail}。已暂停，待修复后重新执行。"
        mem_type = "project"

    filename = f"{name}.md"
    filepath = os.path.join(MEMORY_DIR, filename)

    body = f"""---
name: {name}
description: {desc}
type: {mem_type}
---

{content}
"""
    write_text_atomic(filepath, body)

    # 更新 MEMORY.md 索引
    index_path = os.path.join(MEMORY_DIR, "MEMORY.md")
    entry = f"- [{name}]({filename}) — {desc}"

    if os.path.exists(index_path):
        with open(index_path) as f:
            idx_content = f.read()
        if filename not in idx_content:
            lines = idx_content.split("\n")
            inserted = False
            for i, line in enumerate(lines):
                if line.startswith("- ") and not inserted:
                    lines.insert(i, entry)
                    inserted = True
                    break
            if not inserted:
                lines.append(entry)
            write_text_atomic(index_path, "\n".join(lines))
    else:
        write_text_atomic(index_path, f"# Memory Index\n\n{entry}\n")

    print(f"    {green('✓')} Memory 已写入: {filepath}")


# ══════════════════════════════════════════════════════════════
#  Stage 0: PRE-FLIGHT
# ══════════════════════════════════════════════════════════════

def _load_archive_dirs():
    """从 pipeline-manifest.yaml 加载 archive_dirs 配置。"""
    try:
        import yaml
        with open(MANIFEST_PATH) as f:
            mf = yaml.safe_load(f)
        return mf.get("archive_dirs", [])
    except Exception:
        return []


def _scan_archive_dirs():
    """Archive Sentinel: 扫描 ARCHIVE_DIRS 下的 .md 文件，生成 archived_nodes.json。

    对每个归档 .md 文件，尝试从 frontmatter 提取 id 字段作为 node_id，
    无法提取时从文件名推导。输出格式:
      [{"nodeId": "...", "filePath": "相对路径", "reason": "file-in-archive-dir"}]
    """
    archive_dirs = _load_archive_dirs()
    if not archive_dirs:
        print(f"    {yellow('⚠')} archive_dirs 未配置，跳过 Archive Sentinel 扫描")
        return []

    archived_nodes = []
    scanned_files = 0

    for ad in archive_dirs:
        # 支持相对于 vault 根目录的路径
        archive_path = os.path.join(VAULT_ROOT, ad)
        if not os.path.isdir(archive_path):
            continue

        for root, dirs, files in os.walk(archive_path):
            # 跳过隐藏目录
            dirs[:] = [d for d in dirs if not d.startswith(".")]
            for fname in files:
                if not fname.endswith(".md"):
                    continue
                scanned_files += 1
                file_path = os.path.join(root, fname)
                rel_path = os.path.relpath(file_path, VAULT_ROOT)

                # 尝试从 frontmatter 提取 id
                node_id = None
                try:
                    with open(file_path, encoding="utf-8") as f:
                        content = f.read(2048)  # 只读前 2KB 取 frontmatter
                    if content.startswith("---"):
                        end = content.find("\n---", 3)
                        if end >= 0:
                            fm_text = content[3:end]
                            for line in fm_text.split("\n"):
                                kv = line.strip().split(":", 1)
                                if len(kv) == 2 and kv[0].strip() == "id":
                                    node_id = kv[1].strip().strip("\"'")
                                    break
                except Exception:
                    pass

                # fallback: 从文件名推导
                if not node_id:
                    node_id = os.path.splitext(fname)[0]

                archived_nodes.append({
                    "nodeId": node_id,
                    "filePath": rel_path,
                    "reason": "file-in-archive-dir",
                })

    if archived_nodes:
        os.makedirs(os.path.dirname(ARCHIVED_NODES_PATH), exist_ok=True)
        write_text_atomic(ARCHIVED_NODES_PATH, json.dumps(archived_nodes, indent=2, ensure_ascii=False))
        print(f"    {green('✓')} Archive Sentinel: {len(archived_nodes)} 归档节点 (扫描 {scanned_files} .md 文件)")
    else:
        # 删除旧文件避免 Electron 端重复处理
        if os.path.isfile(ARCHIVED_NODES_PATH):
            os.remove(ARCHIVED_NODES_PATH)

    return archived_nodes


def stage_0_preflight():
    banner("0", "PRE-FLIGHT — 路径与端口探活")
    missing = []

    for label, path in REQUIRED_PATHS.items():
        if os.path.isfile(path):
            print(f"    {green('✓')} {label}")
        elif label in BOOTSTRAP_OUTPUTS:
            print(f"    {yellow('⚠')} {label} 尚未生成 — 后续 Stage 将创建")
        else:
            print(f"    {red('✗')} {label} 缺失: {path}")
            missing.append(label)

    if missing:
        return False, f"关键路径缺失: {', '.join(missing)}", {}

    # 骨架数据为可选注入源 — 缺失仅警告不阻断
    for label, path in SKELETON_PATHS.items():
        if os.path.isfile(path):
            print(f"    {green('✓')} {label}")
        else:
            print(f"    {yellow('⚠')} {label} 缺失 (可选)，Stage 1.5 将跳过骨架注入")

    # Archive Sentinel 扫描
    archived = _scan_archive_dirs()

    # 端口探活（PR-133：env API_PORT＝发起方端口优先，只验发起方不扫邻居）
    global API_PORT
    _preferred = os.environ.get("API_PORT")
    for port in _candidate_api_ports(_preferred):
        try:
            req = urllib.request.Request(
                f"http://127.0.0.1:{port}/api/health", method="GET"
            )
            with urllib.request.urlopen(req, timeout=3) as resp:
                if resp.status == 200:
                    API_PORT = port
                    print(f"    {green('✓')} Web API 在线: port {port}" + ("（发起方）" if _preferred else ""))
                    break
        except Exception:
            continue

    if API_PORT is None:
        if _preferred:
            print(f"    {yellow('⚠')} 发起方 Web API (port {_preferred}) 不可达 — Stage 5/6 将跳过运行态检查（不扫邻居防跨服务假验证）")
        else:
            print(f"    {yellow('⚠')} Web API 未运行 — Stage 5/6 将跳过运行态检查")

    return True, "PRE-FLIGHT 通过", {"api_port": API_PORT, "archived_nodes": len(archived)}


# ══════════════════════════════════════════════════════════════
#  Stage 0.5: ADMISSION READINESS
# ══════════════════════════════════════════════════════════════

def stage_0_5_admission_readiness():
    """调用前端仓库的同源 Node 合规服务；失败时 fail closed。

    入图资格是"当前 Vault 业务现状"的校验（当前实体是否可入图），与 release 构建内容无关。
    因此 readiness 用当前 Vault（VAULT_PATH），而非 release 临时 tree（VAULT_ROOT）——
    临时 tree 携带文章提交时的旧规则文件（如旧 ontology），用它会读到 schema 改造前的
    旧能力定义而误报 capability 缺失。校验器永远用当前规则，被校验对象用 release 内容。
    """
    banner("0.5", "ADMISSION READINESS — 入图资格门控")
    cli = os.path.join(ARCH_REPO, "scripts", "quality", "check-entity-readiness.mjs")
    if not os.path.isfile(cli):
        return False, f"readiness CLI 不存在: {cli}", {}
    live_vault = os.environ.get("VAULT_PATH") or VAULT_ROOT
    exit_code, stdout, stderr = run(
        f'node "{cli}" --vault "{live_vault}" --json',
        cwd=ARCH_REPO,
        timeout=60,
    )
    raw = (stdout or stderr or "").strip().splitlines()
    try:
        readiness = json.loads(raw[-1]) if raw else {}
    except json.JSONDecodeError:
        return False, "readiness CLI 未返回合法 JSON", {"stdout": stdout, "stderr": stderr}
    if exit_code != 0 or readiness.get("ready") is not True:
        if readiness.get("success") is False or readiness.get("error_code"):
            detail = readiness.get("message") or readiness.get("error_code") or "readiness CLI 执行失败"
            return False, f"readiness CLI 失败: {detail}", {"readiness": readiness}
        count = readiness.get("blockerCount")
        if count is None:
            return False, "readiness 响应缺少 blockerCount", {"readiness": readiness}
        return False, f"入图资格未通过: blockerCount={count}", {"readiness": readiness}
    print(f"    {green('✓')} 入图资格通过")
    return True, "ADMISSION READINESS 通过", {"readiness": readiness}


# ══════════════════════════════════════════════════════════════
#  Stage 1: EXTRACT
# ══════════════════════════════════════════════════════════════

def _ensure_doc_envelope():
    """WP-117 批3（SPEC-084 §二.2）：extract_graph 文档面走信封——runner 手工/测试运行时
    拉起前自动物化（Node 服务链经 buildVaultRuntimeEnv docEnvelope:true 已注入；本函数补
    py 侧直拉链同款语义）。物化失败即显式报错退出（零回落——extract_graph 会以
    DOC_ENVELOPE_FAIL_CLOSED exit 2 拒跑，此处提前给出可行动指引）。"""
    if os.environ.get("DOC_ENVELOPE_PATH"):
        return
    dump = os.path.join(RUNTIME_FACTSOURCE_DIR, "dump-doc-envelope.mjs")
    if not os.path.isfile(dump):
        print("❌ DOC_ENVELOPE_PATH 未设置且物化工具缺席: %s" % dump, file=sys.stderr)
        sys.exit(2)
    out = os.path.join(VAULT_ROOT, ".ledger", "doc-envelope.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    r = subprocess.run(
        ["node", dump, "--vault", VAULT_ROOT, "--out", out],
        capture_output=True, text=True, timeout=120,
    )
    if r.returncode != 0:
        print("❌ 文档信封物化失败（dump-doc-envelope exit %s）:\n%s" % (r.returncode, r.stderr[-800:]), file=sys.stderr)
        sys.exit(2)
    os.environ["DOC_ENVELOPE_PATH"] = out
    print(f"    📄 文档信封已物化: {out}")


def stage_1_extract():
    banner("1", "EXTRACT — 图谱抽取")
    _ensure_doc_envelope()
    extract_flag = "--force" if FORCE_EXTRACT else "--incremental"
    manifest_arg = ""
    if ARTICLE_ADMISSION_MANIFEST:
        manifest_arg = f" --article-admission-manifest {shlex.quote(ARTICLE_ADMISSION_MANIFEST)}"
    print(f"    运行 extract_graph.py --apply {extract_flag}{manifest_arg} ...")

    exit_code, stdout, stderr = run(
        f"{shlex.quote(sys.executable)} extract_graph.py --apply {extract_flag}{manifest_arg}",
        cwd=GRAPH_DIR,
        timeout=300,
    )
    _print_subprocess_output("extract", stdout, stderr, exit_code)

    if exit_code != 0:
        return False, f"extract_graph.py 退出码 {exit_code}", {}

    # 门控: master_graph.json 至少有一个节点；零连接对单实体知识体系是合法状态。
    mg_path = REQUIRED_PATHS["master_graph.json"]
    if not os.path.isfile(mg_path):
        return False, "master_graph.json 未生成", {}

    with open(mg_path) as f:
        g = json.load(f)
    nodes_n = len(g.get("nodes", []))
    conns_n = len(g.get("connections", []))

    print(f"    nodes={nodes_n} connections={conns_n}")

    if nodes_n == 0:
        # ADR063 空态三值：抽取成功但零节点 = 合法空态（源无可用节点），空投影忠实于源；抽取失败由退出码门控拦截。
        print(f"    {yellow('⚠')} nodes=0 — 合法空态（源无图谱节点），通过（ADR063）")
    # 统计 plates
    plates_n = sum(1 for n in g["nodes"] if "Plate" in n.get("labels", []))

    print(f"    {green('✓')} 门控通过")

    return True, "EXTRACT 通过", {
        "nodes": nodes_n,
        "connections": conns_n,
        "plates": plates_n,
    }


def _write_final_pipeline_version(mg_path, run_ts):
    """F.5.21.4: 所有 stage 完成后写 pipeline_version.json。
    包含 master_graph / SA / layout 三个文件的 SHA256 + run_id + generated_at。"""
    sa_path = REQUIRED_PATHS.get("semantic_architecture.json", "")
    layout_path = REQUIRED_PATHS.get("architecture_layout.json", "")
    try:
        pv = _runtime_state_db.read_pipeline_version()

        def _sha256(filepath):
            h = hashlib.sha256()
            with open(filepath, "rb") as f:
                for chunk in iter(lambda: f.read(65536), b""):
                    h.update(chunk)
            return h.hexdigest()

        pv["pipeline_run_id"] = run_ts
        pv["master_graph_sha256"] = _sha256(mg_path)
        if sa_path and os.path.isfile(sa_path):
            pv["semantic_architecture_sha256"] = _sha256(sa_path)
        if os.path.isfile(layout_path):
            pv["architecture_layout_sha256"] = _sha256(layout_path)
        pv["generated_at"] = datetime.now(timezone.utc).isoformat()

        _runtime_state_db.upsert_pipeline_version(pv)
        print(f"    {green('✓')} pipeline_version 已写入 runtime-state.db (run={run_ts})")
    except Exception as exc:
        print(f"    {yellow('⚠')} pipeline_version.json 写入失败: {exc}")


# ══════════════════════════════════════════════════════════════
#  Stage 1.5: INFER
# ══════════════════════════════════════════════════════════════

PIPELINE_VERSION_FILE = os.path.join(VAULT_ROOT, ".pipeline", "pipeline_version.json")
INFER_DIR = os.path.join(VAULT_ROOT, ".pipeline", "intermediates")
INFER_TIMEOUT = 30


def inject_skeleton_data(mg_path, components_path, middleware_path):
    """将骨架 JSON 的属性注入 master_graph.json 节点。

    匹配策略:
      1. 加载 entity_alias.json 构建归一化映射表
      2. 对每个骨架组件/中间件，用 label 在 master_graph 节点中做
         case-insensitive 精确匹配（先归一化 label）。命中则合并骨架属性，
         未命中则创建新节点。
    """
    if not os.path.isfile(mg_path):
        print(f"    {yellow('⚠')} master_graph.json 不存在，跳过骨架注入")
        return

    skel_dir = os.path.dirname(components_path)

    # ── 加载 entity_alias.json 归一化映射 ──
    alias_map = {}
    alias_path = os.path.join(skel_dir, "entity_alias.json")
    if os.path.isfile(alias_path):
        with open(alias_path, "r", encoding="utf-8") as f:
            raw_aliases = json.load(f)
        for k, v in raw_aliases.items():
            if isinstance(v, dict):
                continue  # 跳过非字符串值（如 _merge_ids）
            alias_map[k.strip().lower()] = v.strip().lower()
        print(f"    {green('✓')} 加载归一化映射: {len(alias_map)} 条")

    def normalize_label(lbl):
        """应用 alias_map 归一化标签."""
        key = lbl.strip().lower()
        return alias_map.get(key, key)

    skeleton_items = []
    for path, kind in [(components_path, "component"), (middleware_path, "middleware")]:
        if not os.path.isfile(path):
            print(f"    {yellow('⚠')} {os.path.basename(path)} 不存在，跳过")
            continue
        with open(path, "r", encoding="utf-8") as f:
            items = json.load(f)
        for item in items:
            item["_sk_kind"] = kind
            skeleton_items.append(item)

    if not skeleton_items:
        print(f"    {yellow('⚠')} 无骨架数据可注入")
        return

    with open(mg_path, "r", encoding="utf-8") as f:
        g = json.load(f)

    nodes = g.setdefault("nodes", [])

    # ── 归一化合并: 同一 canonical label 的重复节点 ──
    if alias_map:
        canonical_groups = {}  # canonical_label → [indices]
        redirect_map = {}      # duplicate_id → canonical_id
        for i, n in enumerate(nodes):
            raw_lbl = (n.get("label") or "").strip().lower()
            canonical = normalize_label(raw_lbl)
            canonical_groups.setdefault(canonical, []).append(i)
        merges_done = 0
        for canonical, indices in list(canonical_groups.items()):
            if len(indices) < 2:
                continue
            # 过滤因前序合并已失效的索引
            valid_indices = [i for i in indices if i < len(nodes)]
            if len(valid_indices) < 2:
                continue
            # 保留第一个（或已有 skeleton 属性的），其余重定向
            keep_idx = valid_indices[0]
            for dup_idx in valid_indices[1:]:
                dup_id = nodes[dup_idx]["id"]
                keep_id = nodes[keep_idx]["id"]
                redirect_map[dup_id] = keep_id
                # 迁移边
                for conn in g.get("connections", []):
                    if conn.get("from") == dup_id:
                        conn["from"] = keep_id
                    if conn.get("to") == dup_id:
                        conn["to"] = keep_id
                merges_done += 1
            # 删除重复节点
            dup_ids = {nodes[i]["id"] for i in valid_indices[1:]}
            g["nodes"] = [n for n in nodes if n["id"] not in dup_ids]
            nodes = g["nodes"]
            # 删除自环边
            g["connections"] = [c for c in g.get("connections", [])
                              if c.get("from") != c.get("to")]
            # 去重边
            seen_edges = set()
            deduped = []
            for c in g.get("connections", []):
                key = (c.get("from"), c.get("to"), c.get("relationType", ""))
                if key not in seen_edges:
                    seen_edges.add(key)
                    deduped.append(c)
            g["connections"] = deduped
        if merges_done > 0:
            print(f"    {green('✓')} 归一化合并: {merges_done} 个重复节点已合并")

    # 构建 label → index 索引 (case-insensitive, 归一化后)
    label_index = {}
    for i, n in enumerate(nodes):
        raw_lbl = (n.get("label") or "").strip().lower()
        lbl = normalize_label(raw_lbl)
        if lbl:
            label_index.setdefault(lbl, []).append(i)

    matched = 0
    created = 0
    for sk in skeleton_items:
        raw_sk_label = (sk.get("label") or "").strip().lower()
        sk_label = normalize_label(raw_sk_label)
        sk_id = sk.get("id", "")
        kind = sk.get("_sk_kind", "component")

        # 骨架事实: domain/namespace/deployment_type/replicas/ports/anti_affinity/type/version
        sk_facts = {}
        for key in ("namespace", "domain", "deployment_type", "replicas", "ports",
                     "anti_affinity", "description", "type", "version",
                     "connection_string", "databases", "backup_schedule", "failure_impact"):
            if key in sk and sk[key] is not None:
                sk_facts[key] = sk[key]
        sk_facts["skeleton_id"] = sk_id
        sk_facts["skeleton_source"] = "运维报告 7.0.6.5"

        indices = label_index.get(sk_label, [])
        if indices:
            for idx in indices:
                node = nodes[idx]
                props = node.setdefault("properties", {})
                # 骨架权威事实优先覆盖
                props.update(sk_facts)
                node["category"] = "服务" if kind == "component" else "中间件"
            matched += 1
        else:
            # 创建新骨架节点
            new_node = {
                "id": sk_id,
                "label": sk.get("label", sk_id),
                "sublabel": sk.get("description", ""),
                "category": "服务" if kind == "component" else "中间件",
                "properties": sk_facts,
                "updatedAt": datetime.now(timezone.utc).isoformat(),
            }
            nodes.append(new_node)
            created += 1

    # 原子写入
    write_text_atomic(mg_path, json.dumps(g, ensure_ascii=False, indent=2))

    print(f"    {green('✓')} 骨架注入: {matched} 匹配, {created} 新建 (共 {len(skeleton_items)} 骨架条目)")


def stage_1_5_infer(mode=None):
    """三路推断 (body/wiki/config parallel) + merge (serial)."""
    import concurrent.futures

    banner("1.5", "INFER — 多源关系推断 + 骨架注入")

    # 骨架注入: 将 skeleton JSON 的属性合并到 master_graph 节点
    inject_skeleton_data(
        REQUIRED_PATHS["master_graph.json"],
        SKELETON_PATHS["skeleton_components.json"],
        SKELETON_PATHS["skeleton_middleware.json"],
    )

    # D-35: cold start → full
    if mode is None:
        if os.path.isfile(PIPELINE_VERSION_FILE):
            mode = "quick"
        else:
            print(f"    冷启动: pipeline_version.json 不存在 → mode=full")
            mode = "full"

    print(f"    mode={mode}")

    os.makedirs(INFER_DIR, exist_ok=True)
    body_json = os.path.join(INFER_DIR, "body_edges.json")
    wiki_json = os.path.join(INFER_DIR, "wiki_edges.json")
    config_json = os.path.join(INFER_DIR, "config_edges.json")
    merged_json = os.path.join(INFER_DIR, "merged_edges.json")

    status = {"body": "ok", "wiki": "ok", "config": "ok", "merge": "ok"}

    def _run_infer(label, script):
        # Wiki 推断的 quick 模式要求文件清单，编排入口统一重建这一路结果。
        infer_mode = "full" if os.path.basename(script) == "infer-from-wiki.py" else mode
        cmd = f'{shlex.quote(sys.executable)} "{script}" --mode {infer_mode} --output "{label}"'
        exit_code, stdout, stderr = run(cmd, timeout=INFER_TIMEOUT)
        _print_subprocess_output(f"infer:{os.path.basename(label).replace('.json','')}", stdout, stderr, exit_code)
        if exit_code == -1:
            return "error"
        elif exit_code != 0:
            return "degraded"
        return "ok"

    # 三个 infer-* 并行 (D-37)
    infer_scripts = {
        "body": (body_json, os.path.join(SCRIPTS_DIR, "infer-from-body.py")),
        "wiki": (wiki_json, os.path.join(SCRIPTS_DIR, "infer-from-wiki.py")),
        "config": (config_json, os.path.join(SCRIPTS_DIR, "infer-from-config.py")),
    }

    print(f"    并行推断 body/wiki/config (timeout={INFER_TIMEOUT}s) ...")
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        futures = {
            executor.submit(_run_infer, out, script): name
            for name, (out, script) in infer_scripts.items()
        }
        for future in concurrent.futures.as_completed(futures):
            name = futures[future]
            try:
                status[name] = future.result()
            except Exception as e:
                print(f"    {yellow('⚠')} {name} 推断异常: {e}")
                status[name] = "error"

    # merge 串行（pipe 模式: 合并结果同时输出到 stdout，消除磁盘往返）
    print(f"    合并推断结果 ...")
    pipe_mode = os.environ.get("PIPELINE_DEBUG", "0") != "1"
    merge_script = os.path.join(SCRIPTS_DIR, "merge-inferred.py")
    # 失败的 Wiki 路径可能留着上一轮（另一产品）的输出，合并只消费本轮成功结果。
    wiki_input = wiki_json if status["wiki"] == "ok" else ""
    merge_cmd = (
        f'{shlex.quote(sys.executable)} "{merge_script}" '
        f'--body "{body_json}" --wiki "{wiki_input}" --config "{config_json}" '
        f'--output "{merged_json}"'
    )
    if pipe_mode:
        merge_cmd += " --stdout"
    exit_code, stdout, stderr = run(merge_cmd, timeout=60)
    _print_subprocess_output("merge", stdout, stderr, exit_code)
    if exit_code != 0:
        status["merge"] = "degraded"

    degraded = [k for k, v in status.items() if v != "ok"]
    if degraded:
        print(f"    {yellow('⚠')} 降级: {degraded}")
    else:
        print(f"    {green('✓')} 推断完成")

    return True, f"INFER body={status['body']} wiki={status['wiki']} config={status['config']} merge={status['merge']}", {
        "inference_status": status,
    }


# ══════════════════════════════════════════════════════════════
#  Stage 2: VALIDATE
# ══════════════════════════════════════════════════════════════

def validate_explicit_versions(mg_path):
    """检查显式版本字段格式，不为缺失版本伪造产品版本。"""
    if not os.path.isfile(mg_path):
        print(f"    {yellow('⚠')} master_graph.json 不存在，跳过版本校验")
        return

    with open(mg_path, "r", encoding="utf-8") as f:
        g = json.load(f)

    invalid = []
    for item_type, items in (("node", g.get("nodes", [])), ("connection", g.get("connections", []))):
        for item in items:
            props = item.get("properties", {}) or {}
            for field in ("version",) if item_type == "node" else ("fromVersion", "toVersion"):
                value = props.get(field)
                if value is not None and not isinstance(value, str):
                    invalid.append(f"{item_type}:{item.get('id') or item.get('edgeId') or '?'}:{field}")
    if invalid:
        raise ValueError("版本字段必须是字符串: " + ", ".join(invalid[:5]))
    print(f"    {green('✓')} 显式版本字段格式有效；缺失版本保持未知")


def stage_2_validate():
    banner("2", "VALIDATE — 图谱质量校验")

    # 先校验结构，再检查显式版本字段，保持缺失版本为未知。
    print("    运行 validate_graph.py --structural ...")
    exit_code, stdout, stderr = run(
        f"{shlex.quote(sys.executable)} validate_graph.py --structural", cwd=GRAPH_DIR, timeout=120
    )
    if exit_code != 0:
        _print_subprocess_output("validate_graph", stdout, stderr, exit_code)
        return False, f"validate_graph 结构校验失败（exit={exit_code}）", {}

    try:
        validate_explicit_versions(REQUIRED_PATHS["master_graph.json"])
    except (OSError, TypeError, AttributeError, ValueError) as error:
        return False, f"图谱版本字段校验失败：{error}", {}

    print(f"    {green('✓')} validate_graph 通过")

    # 2.2 pipeline-check.py health
    print("    运行 pipeline-check.py health ...")
    exit_code, stdout, stderr = run(
        f"{shlex.quote(sys.executable)} pipeline-check.py health", cwd=SCRIPTS_DIR, timeout=120
    )

    if exit_code != 0:
        print(f"    pipeline-check 质量评分未达建议阈值（非结构门控，exit={exit_code}）")

    print(f"    {green('✓')} 门控通过")
    return True, "VALIDATE 通过", {}


# ══════════════════════════════════════════════════════════════
#  Stage 2.5: BACKWRITE FRONTMATTER
# ══════════════════════════════════════════════════════════════

def stage_2_5_backwrite():
    banner("2.5", "BACKWRITE — Frontmatter 反向回写")

    # F.5.21.2: 安全开关 — 生产验收时跳过 backwrite
    if os.environ.get("PIPELINE_SKIP_BACKWRITE") == "1":
        print(f"    {yellow('⚠')} PIPELINE_SKIP_BACKWRITE=1 — 跳过 backwrite")
        return True, "BACKWRITE 跳过(安全开关)", {}

    script = os.path.join(SCRIPTS_DIR, "backwrite-frontmatter.py")
    if not os.path.isfile(script):
        print(f"    {yellow('⚠')} backwrite-frontmatter.py 不存在，跳过")
        return True, "BACKWRITE 跳过(脚本不存在)", {}

    is_dry = "--dry-run" in sys.argv
    cmd = f"{shlex.quote(sys.executable)} '{script}' --vault '{VAULT_ROOT}'"
    if not is_dry:
        cmd += " --apply"

    exit_code, stdout, stderr = run(cmd, timeout=120)
    _print_subprocess_output("backwrite", stdout, stderr, exit_code)

    # 非阻塞 — 回写失败不中断管道
    if exit_code != 0:
        print(f"    {yellow('⚠')} backwrite 退出码 {exit_code}（非阻塞）")
    else:
        # 解析 JSON 输出了解回写数量
        try:
            result = json.loads(stdout.strip().split("\n")[-1])
            n = result.get("backwrite_count", 0)
            w = result.get("written", 0)
            if w > 0:
                print(f"    {green('✓')} {w} 篇 frontmatter 已回写")
            else:
                print(f"    {green('✓')} 无需回写 ({n} 候选)")
        except Exception:
            print(f"    {green('✓')} 回写完成")

    return True, "BACKWRITE 通过", {}


# ══════════════════════════════════════════════════════════════
#  Stage 3: SYNC SA
# ══════════════════════════════════════════════════════════════

def stage_3_sync_sa():
    banner("3", "SYNC SA — 语义架构同步")
    # A 类脚本走事实源目录（PR-016 方案甲）：repo 侧 scripts/vault-runtime 是 generate-sa 的
    # 唯一权威；vault 侧同名副本仅双轨回退。相对文件名 + cwd 形式保留（generate-sa 经
    # kb_paths.vault_roots 解析 KB_VAULT 定位数据，不依赖 cwd 中的 vault 副本）。
    sa_cmd = f"{shlex.quote(sys.executable)} generate-sa.py --apply --sync-enums"
    if FORCE_EXTRACT:
        sa_cmd += " --force"
    print(f"    运行 {sa_cmd} ...")

    stage_start = time.time()
    exit_code, stdout, stderr = run(
        sa_cmd,
        cwd=RUNTIME_FACTSOURCE_DIR,
        timeout=120,
    )

    _print_subprocess_output("generate-sa", stdout, stderr, exit_code)

    # ── SA 同步失败或 SA 未被更新 → 使用同一本地入口重试 ──
    sa_retried = False

    need_retry = (exit_code != 0)
    if not need_retry:
        # exit 0 但 SA 可能静默跳过写入 → 检查文件新鲜度
        sa_path = REQUIRED_PATHS["semantic_architecture.json"]
        if os.path.isfile(sa_path):
            sa_age = stage_start - os.path.getmtime(sa_path)
            need_retry = (sa_age > 5)

    if need_retry:
        if exit_code != 0:
            print(f"    {yellow('⚠')} generate-sa.py 退出码 {exit_code} — 自动重试 --force --reset-layout ...")
        else:
            print(f"    {yellow('⚠')} SA 文件未被更新 — 自动重试 --force --reset-layout ...")

        retry_exit, retry_out, retry_err = run(
            f"{shlex.quote(sys.executable)} generate-sa.py --apply --sync-enums --force --reset-layout",
            cwd=RUNTIME_FACTSOURCE_DIR,
            timeout=120,
        )
        _print_subprocess_output("sync-sa-retry", retry_out, retry_err, retry_exit)

        if retry_exit != 0:
            return False, f"自动重试失败: exit {retry_exit}", {}
        sa_retried = True

    # 门控: semantic_architecture.json components > 0
    sa_path = REQUIRED_PATHS["semantic_architecture.json"]
    if not os.path.isfile(sa_path):
        return False, "semantic_architecture.json 未生成", {}

    with open(sa_path) as f:
        sa = json.load(f)
    comps = len(sa.get("components", []))

    print(f"    components={comps}")

    if comps == 0:
        # ADR063 空态三值：抽取成功但零架构组件 = 合法空态（如 wiki 实体源被清空），
        # 通过而非 FATAL——空投影是真实源状态的忠实投影；抽取失败仍由上方退出码门控拦截。
        print(f"    {yellow('⚠')} components=0 — 合法空态（源无架构组件），通过（ADR063）")
        return True, "SYNC SA 通过（空态）", {"components": 0, "_sa_retried": sa_retried, "_empty_state": True}

    print(f"    {green('✓')} 门控通过")
    return True, "SYNC SA 通过", {"components": comps, "_sa_retried": sa_retried}


# ══════════════════════════════════════════════════════════════
#  Stage 3.5: SYNC BOARD CACHE
# ══════════════════════════════════════════════════════════════

def stage_3_5_sync_board():
    banner("3.5", "SYNC BOARD CACHE — Board 枚举缓存同步")
    print("    运行 sync-board-enums.py --apply ...")

    exit_code, stdout, stderr = run(
        f"{shlex.quote(sys.executable)} sync-board-enums.py --apply", cwd=SCRIPTS_DIR, timeout=60
    )

    if exit_code != 0:
        return False, f"sync-board-enums.py 退出码 {exit_code}", {}

    # 门控: _enums-cache.md 存在且至少声明一个模块；模块规模属于产品数据，不是管道能力门槛。
    if not os.path.isfile(BOARD_CACHE):
        return False, "_enums-cache.md 未生成", {}

    with open(BOARD_CACHE) as f:
        content = f.read()

    # 解析 frontmatter
    try:
        _, fm_str, _ = content.split("---", 2)
        import yaml

        fm = yaml.safe_load(fm_str)
        # PR-110：零模块空态写出「modules:」（YAML null）——get 默认值不生效，len(None) 崩；
        # ADR063 空态三值本意放行零模块，此前从未被真跑过
        modules_n = len(fm.get("modules") or [])
    except Exception as e:
        return False, f"_enums-cache.md 解析失败: {e}", {}

    print(f"    modules={modules_n}")

    if modules_n == 0:
        # ADR063 空态三值：缓存解析成功但零模块 = 合法空态（枚举源无模块），通过而非 FATAL。
        print(f"    {yellow('⚠')} modules=0 — 合法空态（源无模块），通过（ADR063）")
        return True, "SYNC BOARD 通过（空态）", {"cached_modules": 0, "_empty_state": True}

    print(f"    {green('✓')} 门控通过")
    return True, "SYNC BOARD 通过", {"cached_modules": modules_n}


# ══════════════════════════════════════════════════════════════
#  Stage 4: REFRESH DASHBOARD
# ══════════════════════════════════════════════════════════════

def stage_4_refresh_dashboard():
    banner("4", "REFRESH DASHBOARD — 仪表盘刷新")
    print("    运行 graph-status.py --write ...")

    exit_code, stdout, stderr = run(
        f"{shlex.quote(sys.executable)} graph-status.py --write", cwd=GRAPH_DIR, timeout=60  # W3 graph 族住 GRAPH_DIR（PR-110：此前钉 SCRIPTS_DIR 漏网）
    )

    # 门控: graph-status.md 时间戳在 120 秒内
    if os.path.isfile(STATUS_FILE):
        age = time.time() - os.path.getmtime(STATUS_FILE)
        print(f"    graph-status.md 更新于 {int(age)}s 前")
        if age < 120:
            print(f"    {green('✓')} 门控通过")
            return True, "REFRESH DASHBOARD 通过", {}
        else:
            print(f"    {yellow('⚠')} graph-status.md 可能未刷新 ({int(age)}s ago)")
            return True, "REFRESH DASHBOARD 通过(陈旧警告)", {}
    else:
        return False, "graph-status.md 不存在", {}


# ══════════════════════════════════════════════════════════════
#  Stage 5: RELOAD FRONTEND
# ══════════════════════════════════════════════════════════════

def stage_5_reload_frontend():
    banner("5", "RELOAD FRONTEND — 前端热重载")

    if API_PORT is None:
        print(f"    {yellow('⚠')} 跳过 — Electron API 未运行")
        return True, "RELOAD 跳过 (API 离线)", {}

    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:{API_PORT}/api/health", method="GET"
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status == 200:
                print(f"    {green('✓')} Web API 在线且按请求读取最新产物 (port {API_PORT})")
                return True, "RELOAD 无需显式缓存刷新", {}
            else:
                print(f"    {yellow('⚠')} 前端重载返回 {resp.status}")
                return True, f"RELOAD 返回 {resp.status}", {}
    except Exception as e:
        print(f"    {yellow('⚠')} 前端重载失败: {e}")
        return True, f"RELOAD 异常: {e}", {}  # 不阻塞


# ══════════════════════════════════════════════════════════════
#  Stage 6: VERIFY
# ══════════════════════════════════════════════════════════════

def _resolve_data_chain_path():
    """解析 canonical checker 路径: scripts/quality/check-data-chain.mjs."""
    return os.path.join(ARCH_REPO, "scripts", "quality", "check-data-chain.mjs")


def _run_data_chain(checker_path, timeout=60):
    """运行数据链检查，返回 (exit_code, stdout, stderr, report_or_none).
    report 仅在 JSON 解析成功时返回 dict，否则为 None。
    """
    try:
        env = os.environ.copy()
        env["KB_VAULT"] = VAULT_ROOT
        r = subprocess.run(
            ["node", checker_path, "--skip-api"],
            cwd=ARCH_REPO,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env,
        )
        stdout = r.stdout or ""
        stderr = r.stderr or ""
        report = None
        try:
            report = json.loads(stdout.strip() or "{}")
        except json.JSONDecodeError:
            pass
        return r.returncode, stdout, stderr, report
    except subprocess.TimeoutExpired:
        return -1, "", f"超时 ({timeout}s)", None
    except FileNotFoundError:
        return -1, "", "node 命令不可用", None
    except Exception as e:
        return -1, "", f"spawn 异常: {type(e).__name__}: {e}", None


def _evaluate_data_chain(exit_code, stdout, stderr, report, checker_path):
    """评估数据链检查结果。返回 (ok, msg).
    只有 JSON report.ok === true 且 exit_code === 0 才通过（fail-closed）。
    """
    # 1. checker 缺失
    if not os.path.isfile(checker_path):
        return False, f"数据链 checker 缺失: {checker_path}"

    # 2. spawn 异常
    if exit_code == -1:
        diag = _data_chain_diag(stderr or stdout)
        return False, f"数据链 checker 未执行: {diag[:120]}"

    # 3. 非零退出码
    if exit_code != 0:
        diag = _data_chain_diag(stdout)
        return False, f"数据链 checker 退出码 {exit_code}"

    # 4. 非法 JSON
    if report is None or not isinstance(report, dict):
        diag = _data_chain_diag(stdout)
        return False, f"数据链 checker 输出非法 JSON"

    # 5. ok 字段
    ok_value = report.get("ok")
    if ok_value is not True:
        reason_parts = []
        if ok_value is False:
            blockers = report.get("blockers", {})
            if isinstance(blockers, dict):
                active = {k: v for k, v in blockers.items() if v}
                if active:
                    reason_parts.append(f"blockers={json.dumps(active, ensure_ascii=False)}")
        reason = "; ".join(reason_parts) if reason_parts else f"ok={ok_value}"
        return False, f"数据链不一致: {reason}"

    # 6. ok === true, exit 0 → 通过
    return True, "数据链一致"


def _data_chain_diag(text, max_lines=10):
    """截断诊断输出，保留摘要，过滤环境变量/凭据。
    采用大小写不敏感匹配，覆盖 token/password/secret/key/authorization/bearer 等常见凭据模式。
    """
    if not text:
        return ""
    lines = [l for l in text.strip().split("\n") if l.strip()]

    # 大小写不敏感的凭据模式
    _CREDENTIAL_PATTERNS = (
        "token=", "password=", "passwd=", "secret=", "api_key=",
        "api-key", "authorization:", "bearer ", "private_key",
        "access_key", "credential=", "home=",
    )

    safe = []
    for l in lines:
        ll = l.lower()
        if any(p in ll for p in _CREDENTIAL_PATTERNS):
            continue
        safe.append(l)
    return "\n".join(safe[:max_lines])


def stage_6_verify():
    banner("6", "VERIFY — 端到端验证")

    # 6.1 数据链检查（canonical path + fail-closed）
    checker_path = _resolve_data_chain_path()
    print(f"    数据链 checker: {checker_path}")
    print(f"    运行 check-data-chain.mjs --skip-api ...")

    exit_code, stdout, stderr, report = _run_data_chain(checker_path)
    ok, msg = _evaluate_data_chain(exit_code, stdout, stderr, report, checker_path)

    if ok:
        # 打印统计摘要
        if isinstance(report, dict):
            m = report.get("master", {})
            s = report.get("semantic", {})
            print(f"    master: nodes={m.get('nodes', '?')} connections={m.get('connections', '?')}")
            print(f"    semantic: components={s.get('components', '?')} dependencies={s.get('dependencies', '?')}")
            blk = report.get("blockers", {})
            if isinstance(blk, dict) and any(blk.values()):
                print(f"    blockers: {json.dumps(blk, ensure_ascii=False)}")
        print(f"    {green('✓')} 数据链一致")
    else:
        diag = _data_chain_diag(stderr or stdout)
        if diag:
            print(f"    {red('✗')} {msg}")
            for l in diag.split("\n")[:8]:
                print(f"       {l}")
        else:
            print(f"    {red('✗')} {msg}")
        return False, msg, {}

    # 6.2 图谱查询
    if API_PORT is not None:
        try:
            req = urllib.request.Request(
                f"http://127.0.0.1:{API_PORT}/api/dashboard/topology?scope=full",
                method="GET",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read())
                total_nodes = ((data.get("data") or {}).get("totalNodes"))
                print(f"    {green('✓')} 总览 API 正常: totalNodes={total_nodes}")
        except Exception as e:
            print(f"    {yellow('⚠')} 总览 API 检查失败: {e}")
    else:
        print(f"    {yellow('⚠')} 跳过总览 API 检查 — API 离线")

    # 6.3 JSON ↔ SQLite document_index 一致性
    index_validator = os.path.join(SCRIPTS_DIR, "validate-document-index.py")
    exit_code, stdout, stderr = run(f'{shlex.quote(sys.executable)} "{index_validator}" --vault "{VAULT_ROOT}"', cwd=VAULT_ROOT, timeout=60)
    try:
        index_report = json.loads((stdout or "{}").strip().splitlines()[-1])
    except (json.JSONDecodeError, IndexError):
        index_report = None
    if exit_code != 0 or not isinstance(index_report, dict) or index_report.get("ok") is not True:
        return False, "document_index 与 master_graph 不一致", {"document_index": index_report, "stderr": stderr}
    print(f"    {green('✓')} document_index 一致: {index_report.get('actual_rows', 0)} rows")

    # 6.4 已确认关系必须形成预期边；成功后消费本批期望
    # W3：关系期望校验器住 vault-py/rules/（D6 版本门同批）——按候选链同源推导
    relation_validator = os.path.join(os.path.dirname(_SCRIPTS_CANDIDATES[0]), "rules", "validate-relation-expectations.py")
    if not os.path.isfile(relation_validator):
        relation_validator = os.path.join(SCRIPTS_DIR, "..", "rules", "validate-relation-expectations.py")
    # #76 语义拆分：每轮管线期望=运行时数据走 --expectations-file（vault .ledger 运行位，可 consume）；
    # 版本门（--rules-version）专属人工规则资产，管线不触。
    _rt_exp = os.path.join(VAULT_ROOT, ".ledger", "relation_write_expectations.json")
    exit_code, stdout, stderr = run(f'{shlex.quote(sys.executable)} "{relation_validator}" --vault "{VAULT_ROOT}" --expectations-file "{_rt_exp}" --consume', cwd=VAULT_ROOT, timeout=60)
    try:
        relation_report = json.loads((stdout or "{}").strip().splitlines()[-1])
    except (json.JSONDecodeError, IndexError):
        relation_report = None
    if exit_code != 0 or not isinstance(relation_report, dict) or relation_report.get("ok") is not True:
        return False, "已确认关系未形成预期边", {"relations": relation_report, "stderr": stderr}
    print(f"    {green('✓')} 关系期望验证: {relation_report.get('checked', 0)} edges")

    return True, "VERIFY 通过", {}


# ══════════════════════════════════════════════════════════════
#  Stage 7: RECORD MEMORY
# ══════════════════════════════════════════════════════════════

def stage_7_record_memory(success, failed_stage, failed_reason, stats):
    banner("7", "RECORD MEMORY — 自动经验记录")

    if success:
        write_memory(True, -1, "", stats)
        write_log(f"pipeline-exec | Stage 0-8 全部通过 | "
                  f"nodes={stats.get('nodes', '?')} connections={stats.get('connections', '?')}")
    else:
        write_memory(False, failed_stage, failed_reason, stats)
        write_log(f"pipeline-fail | Stage {failed_stage} 失败: {failed_reason} | 已暂停")

    return True, "RECORD MEMORY 完成", {}


# ══════════════════════════════════════════════════════════════
#  Stage 8: PROJECT REPORTING
# ══════════════════════════════════════════════════════════════

def stage_8_reporting():
    # SPEC-012 wave-2（2026-10-14）：dashboard_data.json 投影退役——Node 侧零读者
    # （仪表盘 API 恒活读 master_graph.json，ADR067），②类无消费面即不再生成。
    banner("8", "PROJECT REPORTING — 项目仪表盘数据生成（dashboard_data 投影已退役）")
    print("    dashboard_data.json 不再生成（SPEC-012：零读者②类投影退役）")
    return True, "PROJECT REPORTING 跳过(投影退役)", {}


# ══════════════════════════════════════════════════════════════
#  Promotion Rules
# ══════════════════════════════════════════════════════════════

PROMOTION_RULES = """
晋升规则摘要（权威定义: graph-pipeline SKILL.md §一）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

R1  Domain/Subdomain → 图谱节点
    源: extract_graph.py:extract_domain_nodes L424
    数据: 词表 enums 的 domains/subdomains（经信封）
    门控: 词表注册即收录
    输出: BusinessDomain / Subdomain

R2  架构图节点晋升总纲 (4 源 → 2 DB → SA 投影 → 画布)
    源 A: wiki/entities/*.md — arch_component gate → SA → 画布 ✅
    源 B: 产品名自动识别 — System 根节点 → SA → 画布 ✅
    源 C: wiki/concepts/*.md — arch_component → master_graph ✅ SA 排除 Concept ❌
    源 D: Plate (R5) — 三轴门控 → master_graph ✅ SA 无 Plate 投影 ❌
    DB: SQLite(master_graph.db)=前端查询, NetworkX=图算法
    画布属性: arch_layer(分层), arch_category(颜色)

R3  Concept → Concept 节点
    源: extract_graph.py:extract_concept_nodes L789
    数据: wiki/concepts/**/*.md
    门控: 路径即收录（无额外门槛）
    架构晋升: 满足 R2 条件时附加 arch_component 属性

R4  Document → Document 节点
    源: extract_graph.py:extract_document_nodes L860
    数据: raw/precleaned, wiki/sources, wiki/overview, wiki/queries, wiki/comparisons, wiki/todo
    门控: 有 product 字段
    module 兜底: 自动推断 → 标记 _inferred_module → 待审核
    version 缺失: 标记 version_pending → 待审核

R5  Document → Plate 板块（概念晋升硬门控）
    源: extract_graph.py:extract_plate_nodes L1427
    核心理念: 文档满足质量门槛才从碎片概念晋升为板块实体
    轴1 场景/升级 [已激活]:
      门控: article_type=="升级经验" + subdomain=="upgrade" + version 含 "→"
      聚合: (product, module) → "{产品} {模块} 版本升级板块"
    轴2 出版物/手册 [待定义]:
      门控: 未激活
      聚合: (product, doc_type)
    轴3 组件/报错 [待定义]:
      门控: 未激活
      聚合: (product, module, article_type)

修改规则: 编辑 graph-pipeline SKILL.md §一 → 同步 extract_graph.py → 跑管道
"""


# ══════════════════════════════════════════════════════════════
#  Main
# ══════════════════════════════════════════════════════════════

# ── 阶段注册表 ──
# 每个已实现的阶段在此注册。manifest 可覆盖顺序/启用状态，
# 但 handler 函数必须在 runner 中定义。

STAGE_HANDLERS = {
    "0": stage_0_preflight,
    "0.5": stage_0_5_admission_readiness,
    "1.5": stage_1_5_infer,
    "1": stage_1_extract,
    "2": stage_2_validate,
    "2.5": stage_2_5_backwrite,
    "3": stage_3_sync_sa,
    "3.5": stage_3_5_sync_board,
    "4": stage_4_refresh_dashboard,
    "5": stage_5_reload_frontend,
    "6": stage_6_verify,
    "8": stage_8_reporting,
    # Stage 7 (RECORD MEMORY) 是后处理 meta-stage，由 main() 在循环结束后
    # 调用 stage_7_record_memory()，不作为独立管道阶段执行。
}

MANIFEST_PATH = os.path.join(SCRIPTS_DIR, "pipeline-manifest.yaml")


def _load_stages_from_manifest():
    """从 pipeline-manifest.yaml 动态构建阶段列表。
    manifest 存在且有效时使用其阶段顺序；否则 fallback 到硬编码顺序。"""
    if not os.path.isfile(MANIFEST_PATH):
        return None
    try:
        import yaml

        with open(MANIFEST_PATH) as f:
            mf = yaml.safe_load(f)
    except Exception:
        return None

    pipeline_stages = mf.get("pipeline_stages", [])
    if not pipeline_stages:
        return None

    stages = []
    for s in pipeline_stages:
        sid = str(s["id"])
        if s.get("meta") or s.get("enabled") is False:
            continue  # meta-stage，不参与管道循环
        handler = STAGE_HANDLERS.get(sid)
        if handler is None:
            print(f"  {yellow('⚠')} manifest Stage {sid} ({s.get('name', '?')}) — runner 中无对应 handler，跳过")
            continue
        stages.append((sid, handler))

    if not stages:
        return None
    return stages


def _build_stages():
    """构建最终阶段列表：manifest 优先，fallback 到硬编码顺序."""
    manifest_stages = _load_stages_from_manifest()
    if manifest_stages:
        print(f"  {green('✓')} 从 manifest 加载 {len(manifest_stages)} 个阶段")
        return manifest_stages

    # fallback: 按 stage id 排序
    fallback = sorted(STAGE_HANDLERS.items(), key=lambda x: float(x[0]))
    return fallback


def write_pipeline_run_summary(run_ts, status, stats, failed_stage, error, duration_ms):
    """写入 run 级摘要到 runtime-state.db pipeline_runs（保留最近 20 条；SPEC-012 WP-A）。"""
    entry = {
        "run_ts": run_ts,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "status": status,
        "nodes": stats.get("nodes", 0),
        "connections": stats.get("connections", 0),
        "components": stats.get("components", 0),
        "plates": stats.get("plates", 0),
        "failed_stage": failed_stage,
        "error": error,
        "duration_ms": duration_ms,
    }
    _runtime_state_db.insert_run_summary(entry)


def write_stage_snapshot(stage_label, ok, msg, data, stats, run_ts):
    """每个 stage handler 返回后调用，写入结构化快照。"""
    run_dir = os.path.join(SNAPSHOT_DIR, f"run-{run_ts}")
    os.makedirs(run_dir, exist_ok=True)
    safe_label = stage_label.replace(".", "_")
    snapshot = {
        "stage": stage_label,
        "ok": ok,
        "msg": msg,
        "data": data,
        "cumulative_stats": {k: v for k, v in stats.items()
                               if isinstance(v, (int, float, str, bool, type(None)))},
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    filename = f"stage_{safe_label}_snapshot.json"
    write_text_atomic(os.path.join(run_dir, filename), json.dumps(snapshot, indent=2, ensure_ascii=False))


def cleanup_old_snapshots(keep=5):
    """保留最近 N 个 run-* 目录，删除其余。

    缓存卫生没有中断管道的权力：删除失败（只读挂载、权限、安全护栏要求批量确认等）
    一律跳过并告警，绝不让 rmtree 的异常/SystemExit 冒泡成管道失败。

    实证（2026-10-28）：受限环境下批量删除护栏对「单目录 52 条目 > 阈值 50」要求确认，
    rmtree 直接 SystemExit(1)——无 traceback、无 run 摘要落库，日志停在 Stage 8 的最后一
    行，看起来像 Stage 8 失败，其实是收尾清缓存；而每个 run 都会新增一个 run-* 目录、
    keep=5 恒删 1 个，于是每次都失败（同一内容连跑三次三连败）。同源护栏提示：
    `[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED] {"count":52,"threshold":50,...}`。
    """
    pattern = os.path.join(SNAPSHOT_DIR, "run-*")
    try:
        dirs = sorted(glob.glob(pattern), key=os.path.getmtime, reverse=True)
    except OSError:
        return
    for d in dirs[keep:]:
        try:
            shutil.rmtree(d, ignore_errors=True)
        except BaseException as exc:  # noqa: BLE001 —— 含 SystemExit：护栏不得中断管道
            detail = str(exc) or type(exc).__name__
            print(f"    ⚠ 旧快照清理跳过: {os.path.basename(d)}（{detail}）")


def run_global_diagnostic():
    """只读扫描来源和门禁；内容阻断只报告，不发布任何派生数据。"""
    print(f"{'═' * 60}")
    print("  graph-pipeline global diagnostic")
    print(f"  vault: {VAULT_ROOT}")
    print(f"  arch:  {ARCH_REPO}")
    print(f"{'═' * 60}")

    banner("0", "DIAGNOSTIC PRE-FLIGHT — 路径检查")
    missing = []
    for label, source_path in REQUIRED_PATHS.items():
        if os.path.isfile(source_path):
            print(f"    {green('✓')} {label}")
        elif label in BOOTSTRAP_OUTPUTS:
            print(f"    {yellow('⚠')} {label} 尚未生成")
        else:
            print(f"    {red('✗')} {label} 缺失: {source_path}")
            missing.append(label)
    if missing:
        print(f"\n{red('█ 管道中断')} — Stage 0 失败: 关键路径缺失: {', '.join(missing)}")
        return 1

    banner("0.5", "DIAGNOSTIC READINESS — 内容阻断采集")
    readiness_cli = os.path.join(ARCH_REPO, "scripts", "quality", "check-entity-readiness.mjs")
    if not os.path.isfile(readiness_cli):
        print(f"\n{red('█ 管道中断')} — Stage 0.5 失败: readiness CLI 不存在")
        return 1
    exit_code, stdout, stderr = run(
        f'node "{readiness_cli}" --vault "{VAULT_ROOT}" --json',
        cwd=ARCH_REPO,
        timeout=60,
    )
    raw = (stdout or stderr or "").strip().splitlines()
    try:
        readiness = json.loads(raw[-1]) if raw else {}
    except json.JSONDecodeError:
        print(f"\n{red('█ 管道中断')} — Stage 0.5 失败: readiness CLI 未返回合法 JSON")
        return 1
    if readiness.get("success") is False or readiness.get("error_code"):
        detail = readiness.get("message") or readiness.get("error_code") or "readiness CLI 执行失败"
        print(f"\n{red('█ 管道中断')} — Stage 0.5 失败: {detail}")
        return 1
    blocker_count = readiness.get("blockerCount", 0)
    print(f"    内容阻断={blocker_count}，已交由待处理问题统一治理")
    # PR-086：readiness CLI 退出码语义 0=就绪／2=有阻断（数据，采集后继续）／3=执行错误（真失败）——
    # 本阶段是「内容阻断采集」，阻断正是要采集的数据；旧容忍表 (0,1) 把 2 当致命中断（1 在 CLI 中不存在），
    # e2e 夹具刻意携带缺字段可修复实体（Step 6b 断言面）→ 新夹具首跑必红。致命面只留 3。
    if exit_code not in (0, 2):
        print(f"\n{red('█ 管道中断')} — Stage 0.5 失败: readiness CLI 退出码 {exit_code}")
        return 1

    banner("1", "DIAGNOSTIC EXTRACT — 内存抽取与结构校验")
    exit_code, stdout, stderr = run(
        f"{shlex.quote(sys.executable)} extract_graph.py --validate",
        cwd=GRAPH_DIR,  # W3 graph 族住 GRAPH_DIR——与 :442 --apply 同位（PR-110：诊断支路此前仍钉 SCRIPTS_DIR，新库 Stage 1 必败）
        timeout=300,
        env={**os.environ, "PIPELINE_SKIP_BACKWRITE": "1"},
    )
    _print_subprocess_output("diagnostic-extract", stdout, stderr, exit_code)
    if exit_code != 0:
        print(f"\n{red('█ 管道中断')} — Stage 1 失败: extract_graph.py --validate 退出码 {exit_code}")
        return 1

    print(f"\n{green('█ 全局管道诊断完成')} — 未发布主图、SQLite、语义架构或文档索引")
    return 0


def main():
    if "--rules" in sys.argv:
        print(PROMOTION_RULES)
        return

    if "--diagnostic" in sys.argv:
        return run_global_diagnostic()

    dry_run = "--dry-run" in sys.argv
    resume = "--resume" in sys.argv
    global FORCE_EXTRACT, ARTICLE_ADMISSION_MANIFEST
    FORCE_EXTRACT = "--force" in sys.argv
    if "--article-admission-manifest" in sys.argv:
        index = sys.argv.index("--article-admission-manifest")
        if index + 1 >= len(sys.argv):
            print("用法: --article-admission-manifest <path>")
            return 2
        ARTICLE_ADMISSION_MANIFEST = os.path.abspath(sys.argv[index + 1])

    stages = _build_stages()

    # 确定起始阶段
    start_idx = 0
    if "--from" in sys.argv:
        try:
            idx = sys.argv.index("--from")
            start_label = sys.argv[idx + 1]
            for i, (label, _) in enumerate(stages):
                if label == start_label:
                    start_idx = i
                    break
        except (IndexError, ValueError):
            print(f"用法: --from <stage>  有效阶段: {[s[0] for s in stages]}")
            sys.exit(1)

    if resume:
        state = load_state()
        last = state.get("last_stage", -1)
        if last >= 0:
            # 找到失败阶段的下一个
            for i, (label, _) in enumerate(stages):
                if label == str(last):
                    start_idx = i + 1
                    break
            print(f"续跑: 从 Stage {stages[start_idx][0]} 开始")
        else:
            print("无中断状态，从头执行")

    print(f"{'═' * 60}")
    print(f"  graph-pipeline runner")
    print(f"  vault: {VAULT_ROOT}")
    print(f"  arch:  {ARCH_REPO}")
    if dry_run:
        print(f"  mode:  DRY-RUN (仅预览)")
    if FORCE_EXTRACT:
        print(f"  extract: FORCE (跳过 incremental 检查)")
    print(f"{'═' * 60}")

    stats = {}
    stage_data = {}
    run_ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    run_start = time.time()

    for i in range(start_idx, len(stages)):
        label, func = stages[i]

        if dry_run:
            print(f"\n  [Stage {label}] {func.__doc__ or func.__name__}  (dry-run skip)")
            continue

        ok, msg, data = func()
        stage_data[label] = {"ok": ok, "msg": msg}

        if data:
            stats.update(data)

        if not dry_run:
            write_stage_snapshot(label, ok, msg, data, stats, run_ts)

        if not ok:
            print(f"\n{red('█ 管道中断')} — Stage {label} 失败: {msg}")
            save_state(label, stage_data)
            duration_ms = int((time.time() - run_start) * 1000)
            write_pipeline_run_summary(run_ts, "failed", stats, label, msg, duration_ms)
            stage_7_record_memory(False, label, msg, stats)
            sys.exit(1)

    # 全部通过
    if not dry_run:
        clear_state()
        cleanup_old_snapshots(keep=5)
        duration_ms = int((time.time() - run_start) * 1000)
        write_pipeline_run_summary(run_ts, "success", stats, None, None, duration_ms)
        # F.5.21.4: 所有 stage 完成后统一写 pipeline_version.json（含三文件 hash）
        _write_final_pipeline_version(REQUIRED_PATHS["master_graph.json"], run_ts)
        stage_7_record_memory(True, -1, "", stats)
        # SPEC-011-W11 WP2: CLI 收尾记账
        ledger("cli", "pipeline-runner success", [
            "知识库",
            ".ledger",
        ])
        print(f"\n{green('█ 管道完成')} — Stage 0-8 全部通过")
        print(f"  nodes={stats.get('nodes', '?')}  "
              f"connections={stats.get('connections', '?')}  "
              f"plates={stats.get('plates', '?')}")
    else:
        print(f"\n  dry-run 完成 — 未实际执行")


if __name__ == "__main__":
    sys.exit(main() or 0)
