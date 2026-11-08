#!/usr/bin/env python3
"""
Vault Git Ledger (Python 侧，语义对齐 vault-git-ledger.cjs)
SPEC-011-W11 WP2：CLI 脚本收尾钩子

Usage:
    from _vault_ledger import ledger
    ledger("cli", "classify 执行", ["知识库/wiki/entities/示例.md"])
"""
import os
import subprocess
import sys


def ledger(domain: str, summary: str, paths: list[str]) -> None:
    """
    记账并提交 vault 变更。

    Args:
        domain: 域前缀（如 "cli", "pipeline"）
        summary: 提交摘要
        paths: 相对 vault 根的文件路径列表

    行为：
    - 验真：git status 查指定路径，无变更跳过
    - git add → git commit -m "<domain>: <summary>"
    - git push（失败仅警告，不抛异常）
    - 环境开关 VAULT_GIT_LEDGER_DISABLE=1 时跳过全部操作
    """
    if os.environ.get("VAULT_GIT_LEDGER_DISABLE") == "1":
        return

    # vault 根目录：KB_VAULT（与 kb_paths 同源）优先，兼容旧 VAULT_PATH；缺省走 vault_roots()
    # 存在性校验（设计 4）——防在代码仓里误执行 git add/commit（原缺省按脚本位置上推两层=仓根）。
    vault_root = os.environ.get("KB_VAULT") or os.environ.get("VAULT_PATH")
    if not vault_root:
        from kb_paths import vault_roots
        vault_root, _ = vault_roots()

    # 验真：检查指定路径是否有变更
    try:
        result = subprocess.run(
            ["git", "status", "--porcelain", "--"] + paths,
            cwd=vault_root,
            capture_output=True,
            text=True,
            check=True,
        )
        if not result.stdout.strip():
            # 无变更，跳过
            return
    except subprocess.CalledProcessError as e:
        print(f"Warning: git status failed: {e}", file=sys.stderr)
        return

    # git add
    try:
        subprocess.run(
            ["git", "add"] + paths,
            cwd=vault_root,
            check=True,
            capture_output=True,
        )
    except subprocess.CalledProcessError as e:
        print(f"Warning: git add failed: {e}", file=sys.stderr)
        return

    # git commit
    commit_message = f"{domain}: {summary}"
    try:
        subprocess.run(
            ["git", "commit", "-m", commit_message],
            cwd=vault_root,
            check=True,
            capture_output=True,
        )
    except subprocess.CalledProcessError as e:
        print(f"Warning: git commit failed: {e}", file=sys.stderr)
        return

    # git push（失败仅警告，不阻断脚本退出）
    try:
        subprocess.run(
            ["git", "push"],
            cwd=vault_root,
            check=True,
            capture_output=True,
            timeout=30,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        print(f"Warning: git push failed or timed out: {e}", file=sys.stderr)
        # 不 return，继续正常退出


if __name__ == "__main__":
    # 自测：python _vault_ledger.py
    print("_vault_ledger.py 自测")
    print(f"VAULT_GIT_LEDGER_DISABLE={os.environ.get('VAULT_GIT_LEDGER_DISABLE')}")
    ledger("cli", "test ledger", ["scripts/vault-runtime/_vault_ledger.py"])
    print("完成（如环境变量未设置，应产生一笔 cli: test ledger 提交）")
