#!/bin/sh
# wp-tree.sh — 写任务开树即接线：git worktree add + gov:setup 一次完成。
#
# 起因（WP-160 实测）：治理层以符号链接外挂、不入库；git worktree add 建出的新树
# 不带 .githooks，post-commit 记账静默失效，产品提交会漏进 dev-log 台账。
# 本脚本把「开树」与「接线」合成一个动作，不依赖任何人记得额外跑一步。
#
# 目录前缀按当前树身份自动选择，只用于人眼分辨工作树归属；分支名 task/<id> 始终不变
# （post-commit 记账、对账脚本与历史合同均依赖该分支命名）：
#   治理仓自身（有 GOVERNANCE-KIT.md，NEED_MOUNT=0）→ ../gov-wp-<task-id>
#   挂载治理 kit 的开发仓（有 .governance-kit，NEED_MOUNT=1）→ ../cheesex-wp-<task-id>
# WP-224（2026-11-23）前的旧目录名 ../cheeseh-<task-id> 是旧项目名前缀残留；
# 已存在的旧树不自动改名/迁移，处置见 WP-224 只读取证清单。
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

# 前缀只决定新树目录名；git 分支名保持 task/${TASK_ID} 不变。
if [ "$NEED_MOUNT" = "1" ]; then
  TREE="../cheesex-wp-${TASK_ID}"
else
  TREE="../gov-wp-${TASK_ID}"
fi
git worktree add "$TREE" -b "task/${TASK_ID}" "$BASE"
TREE_ABS="$(cd "$TREE" && pwd)"

if [ "$NEED_MOUNT" = "1" ]; then
  node "$TREE_ABS/scripts/governance-kit/kit.mjs" setup "$KIT_DIR" --with-hooks
  echo "wp-tree: 治理层已挂载，post-commit 台账记账生效"
else
  echo "wp-tree: 当前为治理仓，.githooks 是树内真实目录，无需挂载"
fi
echo "wp-tree: 开树完成 $TREE_ABS"
