// Component: Release-Runtime
// @responsible: 装配 release 三件套（builder/reader/publisher），releasesDir 可配置。
// D9-1（2026-08-31）：发布器死校验钩子传参已随绞杀者终式删除——publisher 自 E2'/E4' 起
// 不接收该 option（发布器不校验 sourceCommit，白名单守卫见 __tests__/release-runtime.test.cjs）；
// 本文件内不得再出现该钩子标识符（grep 清零守卫）。
const path = require("node:path");
const { resolveReleasesDir } = require("../../shared/releases-dir.cjs");
const { createReleaseBuilderService } = require("./release-builder-service.cjs");
const { createReleaseReaderService } = require("./release-reader-service.cjs");
const { createReleasePublisherService } = require("./release-publisher-service.cjs");

function createReleaseRuntime({ vaultPath, logger, releasesDir }) {
  const dir = resolveReleasesDir({ vaultPath, releasesDir }).dir; // WP-023：经唯一解析点（新家 .releases/，存量自动搬迁）
  const builderService = createReleaseBuilderService({ releasesDir: dir, logger });
  const readerService = createReleaseReaderService({ builderService, releasesDir: dir });
  const publisherService = createReleasePublisherService({
    builderService,
    readerService,
    releasesDir: dir,
    logger,
  });
  return { releasesDir: dir, builderService, readerService, publisherService };
}

module.exports = { createReleaseRuntime };
