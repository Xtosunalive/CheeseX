// @responsible: 装配 Release 构建、读取、发布服务并注册当前版本恢复接口（ADR-004/W2-WP2：注册端点属 routes 层职责，自 services 归位）。
// Assembles the release consumption trio (builder/reader/publisher) + current-restore route.
// E4'a：schema/complete-release 旧 proposal 发布链退役，本 runtime 只保留 release 三件套（ADR043 D3'/D5'）
//        + /api/releases/current/restore（T3）。proposalService/preview-release/complete-release 依赖全部移除。
const path = require("node:path");
const { resolveReleasesDir } = require("../shared/releases-dir.cjs");
const { sendJSON } = require("../shared/api-envelope.cjs");
const { createError } = require("../shared/error-factory.cjs");
// WP-048 Wave 1 W1-C：mint / current-restore 经统一执行工厂——原 handler 逻辑原样迁入登记执行器。
const { registerActionExecutor, executeAction } = require("../shared/action-execution-factory.cjs");
const { createReleaseBuilderService } = require("../services/release-governance/release-builder-service.cjs");
const { createReleaseReaderService } = require("../services/release-governance/release-reader-service.cjs");
const { createReleasePublisherService } = require("../services/release-governance/release-publisher-service.cjs");
const { createEntityParentReleaseReader } = require("../services/release-governance/entity-parent-release-reader.cjs");

function registerSchemaReleaseRuntime({
  registerRoute,
  vaultPath,
  logger,
  operatorContext = { getOperatorId: () => "local-architect" },
  architectIdentities = new Set(["local-architect"]),
  releasesDir,
  builderService: injectedBuilderService,
  readerService: injectedReaderService,
  publisherService: injectedPublisherService,
  mintRelease,
}) {
  // WP-023/PR-127：经唯一解析点——新家 .releases/（存量库自动自旧家搬迁）；见 server/shared/releases-dir.cjs
  const dir = resolveReleasesDir({ vaultPath, releasesDir }).dir;
  const builderService = injectedBuilderService || createReleaseBuilderService({ releasesDir: dir, logger });
  const readerService = injectedReaderService || createReleaseReaderService({ builderService, releasesDir: dir });
  const entityParentReader = createEntityParentReleaseReader({ releaseReader: readerService });
  const publisherService = injectedPublisherService || createReleasePublisherService({
    builderService, readerService, releasesDir: dir, logger,
  });

  // WP-017 独立发布入口：人工触发全库定版（不绑文章审批——Master 裁①选项 B）。铸版语义与文章发布
  // 完全同源（同 mintRelease 核心：阶段失败账/取代失败账/发布后图谱重建联动）。
  if (typeof mintRelease === "function") {
    // WP-048 W1-C 动作化：releases.mint（WP-017 独立发布入口语义不变）
    const __exec_releases_mint = function () {
      try {
        return mintRelease();
      } catch (error) {
        throw createError((error && error.code) || "RELEASE_MINT_FAILED", (error && error.message) || "发布失败", (error && error.status) ? error.status : 500);
      }
    };
    registerActionExecutor("releases.mint", __exec_releases_mint);

    registerRoute("POST", "/api/releases/mint", (_req, res) => {
      return executeAction({ actionId: "releases.mint", executor: __exec_releases_mint, request: _req, reply: res });
    });
  }


  // T3/#822：current 指针恢复（WP-048 W1-C 动作化：releases.current-restore——角色 admin 由动作定义
  // 供源；操作者白名单（架构师身份）为业务前置，随执行器原样保留）
  const __exec_releases_current_restore = function (ctx) {
    const operator = operatorContext && typeof operatorContext.getOperatorId === "function" ? operatorContext.getOperatorId() : "local-architect";
    const allowed = operatorContext && Array.isArray(operatorContext.architectIdentities)
      ? operatorContext.architectIdentities.has(operator)
      : operator === "local-architect";
    if (!allowed) {
      throw createError("FORBIDDEN", "仅架构师可执行 current 恢复", 403);
    }
    const body = ctx.body;
    try {
      return publisherService.restoreCurrent({ releaseId: body.releaseId });
    } catch (error) {
      if (error && error.code) throw error;
      throw createError(error.code || "INTERNAL_ERROR", error.message, error.status || 500, error.details);
    }
  };
  registerActionExecutor("releases.current-restore", __exec_releases_current_restore);

  registerRoute("POST", "/api/releases/current/restore", (req, res) => {
    return executeAction({ actionId: "releases.current-restore", executor: __exec_releases_current_restore, request: req, reply: res });
  });

  return {
    builderService,
    readerService,
    entityParentReader,
    publisherService,
  };
}

module.exports = { registerSchemaReleaseRuntime };
