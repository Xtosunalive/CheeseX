// Component: Releases-Dir-Resolver — 发布制品目录唯一解析点（WP-023/PR-127）。
// @responsible: 「发布定版住哪」的唯一答案；全库禁止调用点各自拼接 releases 路径
//   （resolver 族纪律——见 docs/reuse-patterns.md 模式一）。
// @inputs: vaultPath ＋ 可选显式 releasesDir（测试注入）
// @outputs: resolveReleasesDir({ vaultPath, releasesDir }) → { dir, legacy, migrated }
// @context: 迁址判决（Master 2026-10-26 采纳批评）：发布定版是业务资产非 git 元数据——
//   不得住 .git/（clone 不可得、备份默认跳过、所有权越界）。新家＝vault 同级 .releases/；
//   旧家 .git/anyshare-releases 仅作存量回落（在场且新家空 → 读取旧家并一次性搬迁至新家；
//   搬迁后旧家保留原地不动——不删 git 内部任何内容）。写入恒新家。
//   env 钉扎：RELEASES_DIR 显式注入即生效（测试/特殊部署），优先级最高。
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const NEW_HOME = ".releases";
const LEGACY_HOME = path.join(".git", "anyshare-releases");

function resolveReleasesDir({ vaultPath, releasesDir } = {}) {
  const root = path.resolve(vaultPath || process.env.VAULT_PATH || ".");
  if (releasesDir) return { dir: path.resolve(releasesDir), legacy: false, migrated: false };
  const injected = process.env.RELEASES_DIR;
  if (injected) return { dir: path.resolve(injected), legacy: false, migrated: false };

  const next = path.join(root, NEW_HOME);
  const legacy = path.join(root, LEGACY_HOME);
  const legacyExists = fs.existsSync(legacy);
  const nextExists = fs.existsSync(next);

  // 新家在场（或两家皆无）→ 新家
  if (nextExists || !legacyExists) return { dir: next, legacy: false, migrated: false };

  // 仅旧家在场 → 存量库：一次性搬迁（rename 原子；跨设备回落 copy）
  try {
    fs.mkdirSync(path.dirname(next), { recursive: true });
    fs.renameSync(legacy, next);
    return { dir: next, legacy: true, migrated: true };
  } catch (_error) {
    fs.cpSync(legacy, next, { recursive: true });
    return { dir: next, legacy: true, migrated: false }; // 旧家保留（不删 .git 内容），读取已切新家
  }
}

module.exports = { resolveReleasesDir, RELEASES_NEW_HOME: NEW_HOME, RELEASES_LEGACY_HOME: LEGACY_HOME };
