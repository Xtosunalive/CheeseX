// Component: Release-Governance-Assembly
// @responsible: 装配 release 治理基础（release-runtime），从 main.cjs 拆出（规则 2 行数上限）。
// E4'a：git-proposal 退役（ADR043 状态机 + 直接写回取代），assembly 只创建 release-runtime。
// D9-1（2026-08-31）：Vault HEAD 提供器注入随 runtime 死传参退役一并删除；
// 本文件内不得再出现该提供器标识符（grep 清零守卫）。
const path = require("node:path");
const { resolveReleasesDir } = require("../../shared/releases-dir.cjs");

function createReleaseGovernanceFoundation({ vaultPath, logger }) {
  const releaseRuntime = require("./release-runtime.cjs").createReleaseRuntime({
    vaultPath,
    logger,
    releasesDir: resolveReleasesDir({ vaultPath }).dir, // WP-023：唯一解析点
  });
  return { releaseRuntime };
}

module.exports = { createReleaseGovernanceFoundation };
