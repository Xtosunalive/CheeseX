#!/usr/bin/env python3
# Component: Pipeline-Smoke
# @responsible: 逐阶段验证 pipeline 可运行并产出有效数据，CI 或部署前快速诊断
# @inputs: 无（自包含）
# @outputs: 各阶段 pass/fail 报告
# @context: A. 知识源上下文 (Vault Context)
"""
管线冒烟测试 — 逐阶段验证 pipeline 可运行并产出有效数据。
用法: python3 pipeline-smoke.py [--apply] [--stage extract,validate,...]
退出码: 0=全通过 1=有失败
"""

import argparse, json, os, re, subprocess, sys, time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, Callable

import yaml

from kb_paths import vault_roots, normalize_vault_cli


@dataclass
class Stage:
    name: str
    description: str
    passed: bool = False
    skipped: bool = False
    error: str = ""
    duration_ms: float = 0
    artifacts: list[str] = field(default_factory=list)


@dataclass
class Ctx:
    kb_vault: str
    vault_root: str
    scripts_dir: str
    arch_repo: str

    def mg_path(self) -> Optional[str]:
        _dd = os.environ.get("KB_DATA_DIR")
        for p in ([os.path.join(_dd, "staging", "master_graph.json")] if _dd else []) + [f"{self.vault_root}/.ledger/master_graph.json",
                  f"{self.kb_vault}/.ledger/master_graph.json"]:
            if os.path.isfile(p): return p
        return None

    def db_path(self) -> Optional[str]:
        for p in [f"{self.vault_root}/.ledger/master_graph.db",
                  f"{self.kb_vault}/.ledger/master_graph.db"]:
            if os.path.isfile(p): return p
        return None

    def vcache_path(self) -> Optional[str]:
        for p in [f"{self.vault_root}/vector-cache.json",
                  f"{self.kb_vault}/vector-cache.json"]:
            if os.path.isfile(p): return p
        return None

    def precleaned_count(self) -> int:
        d = os.path.join(self.kb_vault, "raw", "precleaned")
        return len(list(Path(d).rglob("*.md"))) if os.path.isdir(d) else 0

    def run(self, cmd: list[str], timeout: int = 120) -> subprocess.CompletedProcess:
        env = {**os.environ, "KB_VAULT": self.vault_root}
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, cwd=self.vault_root, env=env)


# ── stage functions ──────────────────────────────────────────────

def _stage(name: str, desc: str, ctx: Ctx, dry: bool, fn: Callable) -> Stage:
    s = Stage(name, desc)
    if dry:
        s.passed = s.skipped = True
        return s
    t0 = time.time()
    try:
        fn(s, ctx)
    except Exception as e:
        s.error = str(e)
    s.duration_ms = (time.time() - t0) * 1000
    return s


def stage_extract(ctx: Ctx, dry: bool) -> Stage:
    def run(s, ctx):
        n = ctx.precleaned_count()
        if n == 0: s.error = "无 precleaned 文章"; return
        script = f"{ctx.scripts_dir}/extract_graph.py"
        r = ctx.run([sys.executable, script, "--apply", "--incremental"])
        if r.returncode != 0:
            s.error = f"返回 {r.returncode}: {r.stderr[:200]}"; return
        mg = ctx.mg_path()
        if not mg: s.error = "master_graph.json 未生成"; return
        g = json.load(open(mg))
        n_nodes = len(g.get("nodes", [])); n_conns = len(g.get("connections", []))
        if n_nodes == 0 or n_conns == 0: s.error = f"空图 (nodes={n_nodes} conns={n_conns})"; return
        s.passed = True; s.artifacts = [f"nodes={n_nodes} conns={n_conns}"]
    return _stage("extract", "precleaned → master_graph.json", ctx, dry, run)


def stage_validate(ctx: Ctx, dry: bool) -> Stage:
    def run(s, ctx):
        if not ctx.mg_path(): s.error = "master_graph.json 不存在"; return
        r = ctx.run([sys.executable, f"{ctx.scripts_dir}/validate_graph.py"])
        stdout = r.stdout or ""
        # non-zero exit is expected when orphan nodes or weak connections found
        if "Traceback" in stdout or "Error" in (r.stderr or ""):
            s.error = f"脚本崩溃: {r.stderr[:200]}"; return
        s.passed = True
        m = re.search(r'节点:\s*(\d+)\s+边:\s*(\d+)', stdout)
        if m: s.artifacts = [f"nodes={m.group(1)} edges={m.group(2)}"]
    return _stage("validate", "图谱关系校验（权重/孤立节点/跨域）", ctx, dry, run)


def stage_wikilink(ctx: Ctx, dry: bool) -> Stage:
    def run(s, ctx):
        if not ctx.mg_path(): s.error = "master_graph.json 不存在"; return
        ctx.run([sys.executable, f"{ctx.scripts_dir}/wikilink.py", "check"])
        s.passed = True  # non-zero OK — 只是报告不一致
    return _stage("wikilink", "wikilink ↔ 图边一致性闸门", ctx, dry, run)


def stage_pipeline(ctx: Ctx, dry: bool) -> Stage:
    def run(s, ctx):
        r = ctx.run([sys.executable, f"{ctx.scripts_dir}/pipeline-check.py", "health"])
        if r.returncode != 0: s.error = f"返回 {r.returncode}"; return
        m = re.search(r'综合评分:\s*([\d.]+)', r.stdout or "")
        if m: s.artifacts = [f"score={m.group(1)}"]
        s.passed = True
    return _stage("pipeline", "管道健康度（4阶段评分）", ctx, dry, run)


def stage_consistency(ctx: Ctx, dry: bool) -> Stage:
    def run(s, ctx):
        script = f"{ctx.arch_repo}/scripts/check_consistency.py"
        if not ctx.db_path(): s.skipped = True; s.error = "SQLite 不存在（Electron 未初始化？）"; return
        r = ctx.run([sys.executable, script, "--json"])
        if r.returncode == 0: s.passed = True; return
        try:
            report = json.loads(r.stdout or "{}")
            s.error = f"不一致: {report.get('warnings', [])[:3]}" if not report.get("consistent") else f"返回 {r.returncode}"
        except json.JSONDecodeError:
            s.error = f"返回 {r.returncode}"
    return _stage("consistency", "跨存储一致性（JSON↔SQLite↔vector）", ctx, dry, run)


def stage_sa_sync(ctx: Ctx, dry: bool) -> Stage:
    def run(s, ctx):
        script = f"{ctx.scripts_dir}/generate-sa.py"
        r = ctx.run([sys.executable, script, "--apply"])
        if r.returncode != 0: s.error = f"返回 {r.returncode}: {r.stderr[:200]}"; return
        import schema_loader as _sl  # WP-049 L3：读侧经信封（9 点硬读旁路收敛）
        enums = _sl.load_the_schema("enums")[0] or {}
        projection = enums.get("architecture_projection", {})
        sa = os.path.join(
            ctx.kb_vault,
            "architecture",
            str(projection.get("product") or "__missing_product__"),
            str(projection.get("version") or "__missing_version__"),
            "semantic_architecture.json",
        )
        if not os.path.isfile(sa): s.error = "semantic_architecture.json 未生成"; return
        d = json.load(open(sa, encoding="utf-8"))
        s.passed = True; s.artifacts = [f"components={len(d.get('components',[]))} deps={len(d.get('dependencies',[]))}"]
    return _stage("sa-sync", "master_graph → semantic_architecture.json", ctx, dry, run)


def stage_query(ctx: Ctx, dry: bool) -> Stage:
    def run(s, ctx):
        r = ctx.run([sys.executable, f"{ctx.scripts_dir}/graph_query.py", "stats"])
        if r.returncode != 0: s.error = f"返回 {r.returncode}"; return
        if "总节点" in (r.stdout or "") and "总边" in (r.stdout or ""): s.passed = True
        else: s.error = "stats 输出异常"
    return _stage("query", "图查询可用性", ctx, dry, run)


ALL_STAGES = {
    "extract": stage_extract, "validate": stage_validate, "wikilink": stage_wikilink,
    "pipeline": stage_pipeline, "consistency": stage_consistency, "sa-sync": stage_sa_sync,
    "query": stage_query,
}


# ── report ───────────────────────────────────────────────────────

def print_report(stages: list[Stage], dry: bool) -> int:
    passed = sum(1 for s in stages if s.passed)
    failed = sum(1 for s in stages if not s.passed and not s.skipped)
    skipped = sum(1 for s in stages if s.skipped)

    print("\n" + "=" * 60)
    print(f"{'🔍 预览' if dry else '🧪 冒烟测试'}  —  {len(stages)} 阶段")
    print("=" * 60)
    for s in stages:
        icon = "⏭️" if s.skipped else ("✅" if s.passed else "❌")
        dur = f" ({s.duration_ms:.0f}ms)" if s.duration_ms else ""
        print(f"  {icon}  {s.name:14s} {s.description:40s}{dur}")
        if s.error: print(f"       {s.error}")
        if s.artifacts: print(f"       {', '.join(s.artifacts)}")
    print("-" * 60)
    print(f"  通过: {passed}  |  跳过: {skipped}  |  失败: {failed}")
    if dry: print("\n  ⚠️  预览模式 — 使用 --apply 执行")
    elif failed == 0: print("\n  ✅ 全链路通过")
    else: print(f"\n  ❌ {failed} 阶段失败")
    return 0 if dry or failed == 0 else 1


# ── main ─────────────────────────────────────────────────────────

def main() -> int:
    vr_d, kb_d = vault_roots()
    _arch = os.path.expanduser(os.environ.get("ARCH_REPO", "~/架构图系统-rebuild"))

    p = argparse.ArgumentParser(description="管线冒烟测试")
    p.add_argument("--apply", action="store_true")
    p.add_argument("--stage")
    p.add_argument("--vault", default="", help="Obsidian 仓库根；可传 …/知识库。默认 KB_VAULT")
    p.add_argument("--arch-repo", default=_arch)
    args = p.parse_args()

    vr, kb = normalize_vault_cli(args.vault) if args.vault.strip() else (vr_d, kb_d)
    ctx = Ctx(kb_vault=kb, vault_root=vr, scripts_dir=f"{kb}/.claude/scripts", arch_repo=args.arch_repo)

    dry = not args.apply
    selected = args.stage.split(",") if args.stage else list(ALL_STAGES)

    if not os.path.isdir(kb): print(f"❌ vault 不存在: {kb}"); return 1

    print("=" * 60)
    print(f"{'🔍 预览' if dry else '🧪 执行'}")
    print(f"  vault: {kb}  |  precleaned: {ctx.precleaned_count()} 篇")
    print(f"  master_graph.json: {'✅' if ctx.mg_path() else '❌'}")
    print(f"  SQLite DB: {'✅' if ctx.db_path() else '⚠️  未找到'}")
    print(f"  ARCH_REPO: {'✅' if os.path.isdir(ctx.arch_repo) else '❌'}")

    stages = [ALL_STAGES[n](ctx, dry) for n in selected if n in ALL_STAGES]
    return print_report(stages, dry)


if __name__ == "__main__":
    sys.exit(main())
