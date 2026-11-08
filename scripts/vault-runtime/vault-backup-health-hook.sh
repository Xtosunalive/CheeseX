#!/bin/sh
# Component: Vault-Backup-Health-Check（备份健测 post-commit hook）
# @responsible: SPEC-011-W11 WP5·备份健测——提交后非阻塞 push，push 失败写 stalled 文件
# @context: A. 知识源上下文（cheese vault 侧 git hook，进版本控制，符号链接到 .git/hooks/post-commit）
#
# 安装步骤：
#   1. 本文件进 cheese 仓版本控制：知识库/.hooks/post-commit
#   2. 在 cheese 仓目录执行：
#      chmod +x 知识库/.hooks/post-commit
#      ln -s "$(git rev-parse --show-toplevel)/知识库/.hooks/post-commit" .git/hooks/post-commit
#
# 行为：
#   - 提交后后台 push（非阻塞）
#   - push 失败 → 写 .ledger/health/backup-stalled.json（stalledAt + reason）
#   - push 成功 → 确保 stalled 文件不存在（清除旧告警）
#   - 不阻断 git commit，退出码永远为 0
#
# 递归安全：git push 不触发 post-commit，此路径无递归风险（2026-10-12 临时仓验证）

VAULT_ROOT="$(git rev-parse --show-toplevel)"
STALLED_FILE="$VAULT_ROOT/.ledger/health/backup-stalled.json"

# 后台 push + 等待结果
git push > /tmp/vault-post-commit-push.$$.log 2>&1 &
PUSH_PID=$!
wait $PUSH_PID
PUSH_EXIT=$?

if [ $PUSH_EXIT -ne 0 ]; then
  # push 失败：写 stalled 文件
  mkdir -p "$VAULT_ROOT/.ledger/health"
  STALLED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  PUSH_ERR="$(cat /tmp/vault-post-commit-push.$$.log 2>/dev/null | head -3 | tr '\n' ' ')"
  printf '{"stalledAt":"%s","reason":"push-failed","detail":"%s"}\n' \
    "$STALLED_AT" "$PUSH_ERR" > "$STALLED_FILE"
else
  # push 成功：清除旧 stalled 文件（如有）
  if [ -f "$STALLED_FILE" ]; then
    rm -f "$STALLED_FILE"
  fi
fi

# 清理临时日志
rm -f /tmp/vault-post-commit-push.$$.log

# post-commit hook 永远以 0 退出（不干扰 commit 结果）
exit 0
