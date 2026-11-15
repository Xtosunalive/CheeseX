// Component: Releases-Dir-Resolver — 发布制品目录唯一解析点（WP-023/PR-127）。
// @responsible: 「发布定版住哪」的唯一答案；全库禁止调用点各自拼接 releases 路径
//   （resolver 族纪律——见 docs/reuse-patterns.md 模式一）。
// @inputs: vaultPath ＋ 可选显式 releasesDir（测试注入）
// @outputs: resolveReleasesDir({ vaultPath, releasesDir }) → { dir }
// @context: 迁址判决（Master 2026-10-26 采纳批评）：发布定版是业务资产非 git 元数据——
//   不得住 .git/（clone 不可得、备份默认跳过、所有权越界）。新家＝vault 同级 .releases/，写入恒新家。
//   env 钉扎：RELEASES_DIR 显式注入即生效（测试/特殊部署），优先级最高。
//   旧家 .git/anyshare-releases 回落与一次性搬迁已随 2026-11-15 PR-243 终裁退役（Master「都清」）——
//   真仓实测旧目录无存量数据（vault/主仓两处均不在场），旧家路径从此不读不迁不建。
"use strict";

const path = require("node:path");

const NEW_HOME = ".releases";

function resolveReleasesDir({ vaultPath, releasesDir } = {}) {
  const root = path.resolve(vaultPath || process.env.VAULT_PATH || ".");
  if (releasesDir) return { dir: path.resolve(releasesDir) };
  const injected = process.env.RELEASES_DIR;
  if (injected) return { dir: path.resolve(injected) };
  return { dir: path.join(root, NEW_HOME) };
}

module.exports = { resolveReleasesDir, RELEASES_NEW_HOME: NEW_HOME };
