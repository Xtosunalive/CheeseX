// @responsible: 注册产品版本列表、架构版本详情及版本比较接口。
const { sendJSON } = require("../shared/api-envelope.cjs");
const { logger } = require("../shared/json-logger.cjs");

function routeError(res, event, error) {
  logger.error({ event, error: error.message, code: error.code });
  return sendJSON(res, error.status || 500, { error_code: error.code || "INTERNAL_ERROR", message: error.message, details: error.details });
}

function required(url, names) {
  const values = {};
  for (const name of names) {
    const value = url.searchParams.get(name);
    if (!value || !value.trim()) {
      const error = new Error(names.join("、") + " 不能为空");
      error.code = "INVALID_QUERY";
      error.status = 400;
      throw error;
    }
    values[name] = value.trim();
  }
  return values;
}

function register(registerRoute, dependencies) {
  const service = dependencies.architectureVersionService;
  const formalConsumer = dependencies.formalConsumer || null;
  const serviceFactory = dependencies.serviceFactory || null;
  const computeFallbackMetadata = dependencies.computeFallbackMetadata || function () { return { dataSource: "worktree" }; };
  function execute(callback) {
    return formalConsumer
      ? formalConsumer.withPinnedRelease((context) => callback(serviceFactory(context), context))
      : callback(service, null, computeFallbackMetadata());
  }
  registerRoute("GET", "/api/kg/product-versions", (_req, res) => {
    try { return sendJSON(res, 200, execute((selected, context, metadata) => ({ ...selected.listVersions(), ...(context ? { releaseId: context.releaseId, sourceCommit: context.sourceCommit } : metadata || {}) }))); }
    catch (error) { return routeError(res, "architecture-versions-list-failed", error); }
  });
  registerRoute("GET", "/api/kg/architecture-version", (req, res) => {
    try {
      const values = required(new URL(req.url, "http://127.0.0.1"), ["product", "version"]);
      return sendJSON(res, 200, execute((selected, context, metadata) => ({ ...selected.getVersion(values.product, values.version), ...(context ? { releaseId: context.releaseId, sourceCommit: context.sourceCommit } : metadata || {}) })));
    } catch (error) { return routeError(res, "architecture-version-get-failed", error); }
  });
  registerRoute("GET", "/api/kg/architecture-version-compare", (req, res) => {
    try {
      const values = required(new URL(req.url, "http://127.0.0.1"), ["product", "source", "target"]);
      return sendJSON(res, 200, execute((selected, context, metadata) => ({ ...selected.compare(values.product, values.source, values.target), ...(context ? { releaseId: context.releaseId, sourceCommit: context.sourceCommit } : metadata || {}) })));
    } catch (error) { return routeError(res, "architecture-version-compare-failed", error); }
  });
}

module.exports = { register };
