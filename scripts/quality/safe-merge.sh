#!/bin/sh
# safe-merge — 治理投影感知的合并包装（WP-132，Master 裁选项 1）。
# 解决的摩擦：治理投影（dashboard/progress/decisions-mirror）随钩子重算，合并时工作树常脏被拦；
# 投影类合并冲突（两分支各自重算的生成物）不该手工解——重算即正典。
# 用法: scripts/quality/safe-merge.sh <branch> [--push]
#   ① 丢弃本地派生投影脏态（可再生，源数据不动）
#   ② git merge --no-ff <branch>
#   ③ 若冲突全部为投影类 → 取对侧＋重算＋继续；源数据冲突 → 中止并列出文件（人工裁决）
#   ④ 重算投影；台账/投影尾巴有变化则自动入账
#   ⑤ --push 时推送
set -u

BRANCH="${1:?用法: safe-merge.sh <branch> [--push]}"
PROJ_PATHS="docs/dev-log/dashboard docs/dev-log/progress.json data/governance/decisions-mirror.jsonl"

regen() {
  node scripts/dev-log/fold-progress.mjs >/dev/null 2>&1 || true
  node scripts/quality/dev-log/project-to-vault.mjs >/dev/null 2>&1 || true
  node scripts/problem-board/generate-board.mjs >/dev/null 2>&1 || true
  node -e "try{const{mirrorDecisions}=require('./server/shared/decisions-mirror.cjs');mirrorDecisions(process.env.VAULT_PATH||require('fs').readFileSync('.env','utf8').match(/VAULT_PATH=(.+)/)[1].trim())}catch(e){}" >/dev/null 2>&1 || true
}

# ⓪ 台账源数据尾巴暂存（entries jsonl＝源事件，不可丢弃；直接提交会因 post-commit emit 自再生尾巴——
#   移动靶实录，stash 方案：暂存→合并→回放，回放冲突时留 stash 指引人工并集）
STASHED_ENTRIES=0
if ! git diff --quiet -- docs/dev-log/entries 2>/dev/null; then
  git stash push -m "safe-merge 台账尾巴暂存" -- docs/dev-log/entries && STASHED_ENTRIES=1
fi
# ① 丢弃本地投影脏态（可再生件，源数据不动）
git checkout -- $PROJ_PATHS 2>/dev/null || true

# ② 合并
if ! git merge --no-ff "$BRANCH" 2>&1; then
  UNMERGED=$(git -c core.quotepath=false diff --name-only -z --diff-filter=U | tr "\0" "\n")
  [ -z "$UNMERGED" ] && { echo "safe-merge: 合并失败但无未解决文件——通常为目标工作树有未提交改动（git status 核查）"; git status --short | grep -v "^??" >&2 | head -5; exit 1; }
  # ③ 冲突分类：全部为投影类 → 自动消解；含源数据 → 中止
  SRC_CONFLICTS=$(echo "$UNMERGED" | grep -v "^docs/dev-log/dashboard/" | grep -v "^docs/dev-log/progress.json$" | grep -v "^data/governance/decisions-mirror" || true)
  if [ -n "$SRC_CONFLICTS" ]; then
    echo "safe-merge: 存在源数据冲突（人工裁决，投影已代解）：" >&2
    echo "$SRC_CONFLICTS" >&2
    exit 1
  fi
  git checkout --theirs $UNMERGED
  regen
  git add docs/dev-log data/governance/decisions-mirror.jsonl
  git commit -m "merge: safe-merge 自动消解投影类冲突（重算即正典）" --no-edit
fi

# ④ 重算投影＋台账尾巴回放＋入账（合并引入对侧台账条目 → 投影重算为正典）
if [ "$STASHED_ENTRIES" = "1" ]; then
  git stash pop 2>/dev/null || echo "safe-merge: 台账尾巴 stash 回放冲突——手工并集：git stash show -p | git apply；丢stash=丢事件，勿 drop"
fi
regen
if ! git diff --quiet -- $PROJ_PATHS docs/dev-log/entries 2>/dev/null; then
  git add docs/dev-log data/governance/decisions-mirror.jsonl
  git diff --cached --quiet || git commit -m "chore(ledger): 合并后台账与投影尾巴入账（safe-merge 自动）" --no-edit
fi

# ⑤ 可选推送
if [ "${2:-}" = "--push" ]; then
  git push origin HEAD
fi
echo "safe-merge: 完成（$BRANCH → $(git rev-parse --abbrev-ref HEAD)）"
