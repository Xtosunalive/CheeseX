#!/bin/sh
# wp-tree.sh — 写任务开树即接线：git worktree add + gov:setup 一次完成。
#
# 起因（WP-160 实测）：治理层以符号链接外挂、不入库；git worktree add 建出的新树
# 不带 .githooks，post-commit 记账静默失效，产品提交会漏进 dev-log 台账。
# 本脚本把「开树」与「接线」合成一个动作，不依赖任何人记得额外跑一步。
#
# 用法: scripts/quality/wp-tree.sh <task-id> [base-ref]
set -eu
TASK_ID="${1:?用法: wp-tree.sh <task-id> [base-ref]}"
BASE="${2:-main}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [ -f .governance-kit ]; then
  NEED_MOUNT=1
  KIT_DIR="$(node -p "JSON.parse(require('fs').readFileSync('.governance-kit','utf8')).kitDir")"
elif [ -f GOVERNANCE-KIT.md ]; then
  NEED_MOUNT=0
else
  echo "wp-tree: 当前树既无 .governance-kit 也无 GOVERNANCE-KIT.md——治理层未接线，拒绝开树" >&2
  exit 1
fi

TREE="../cheeseh-${TASK_ID}"
git worktree add "$TREE" -b "task/${TASK_ID}" "$BASE"
TREE_ABS="$(cd "$TREE" && pwd)"

if [ "$NEED_MOUNT" = "1" ]; then
  node "$TREE_ABS/scripts/governance-kit/kit.mjs" setup "$KIT_DIR" --with-hooks
  echo "wp-tree: 治理层已挂载，post-commit 台账记账生效"
else
  echo "wp-tree: 当前为治理仓，.githooks 是树内真实目录，无需挂载"
fi
echo "wp-tree: 开树完成 $TREE_ABS"
