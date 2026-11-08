'use strict';
// Component: Article-Health-Routes（WP-156——查询面健康度读模型入口）
// @responsible: GET /api/articles/health——按契约全量规则筛违规文章清单＋JSON 导出（响应即导出物）。
// @inputs: vaultPath（库根）；enums-loader loadRuleSetForVault（词表枚举面——与实时面同源）
// @outputs: sendJSON 200 { scope, total, healthy, unhealthyCount, files[], generatedAt }；500 ARTICLES_HEALTH_UNAVAILABLE
// @context: 现算读模型（覆盖存量——watcher 事件面只覆盖变更文件）；MVP＝API＋JSON 导出，页面后续批（WP-156 non_goals）。

const { sendJSON } = require("../shared/api-envelope.cjs");
const { logger } = require("../shared/json-logger.cjs");
// 词表枚举面与实时面同源（compliance-rule-set-service 经词表装载端口 loadVocabBundle——WP-049 通道）
const { loadRuleSetForVault } = require("../services/schema-manager/compliance-rule-set-service.cjs");
const { computeArticleHealth } = require("../services/article-health/article-health-service.cjs");
const { createError } = require("../shared/error-factory.cjs"); // EG-1b 唯一错误工厂——禁本地错误对象定义

function register(registerRoute, deps) {
  const vaultPath = deps.vaultPath;
  registerRoute("GET", "/api/articles/health", function (_req, res) {
    try {
      const health = computeArticleHealth({
        vaultPath,
        ruleSetProvider: () => loadRuleSetForVault(vaultPath),
      });
      return sendJSON(res, 200, health);
    } catch (e) {
      logger.error({ event: "articles-health-failed", error: e.message });
      // EG-1b：错误经唯一工厂构造，http-app 错误处理器统一转 ApiError 响应（OpenAPI 500 已登记该码）
      throw createError("ARTICLES_HEALTH_UNAVAILABLE", e.message, 500);
    }
  });
}

module.exports = { register };
