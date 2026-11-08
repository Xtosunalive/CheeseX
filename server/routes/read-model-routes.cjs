// Component: Read-Model-Routes（查询入口读模型版本身份——WP-055／SPEC-049）
// @responsible: GET /api/read-model/version——读模型版本身份一等查询出口（现场计算聚合，
//   ADR-015 零落库）；重建即翻新由 data-roles-routes rebuild 响应携带同一 port 版本（同源）。
// @inputs: vaultPath（阶梯＋derived 库寻址）、dataDir（staging 寻址）
// @outputs: 200 { readModelVersion: { version, components, computedAt } }
// @context: Sync——新端点出生即账（OpenAPI＋error factory；SPEC-049 Q4）
const { sendJSON } = require("../shared/api-envelope.cjs");
const { logger } = require("../shared/json-logger.cjs");
const { getReadModelVersion } = require("../shared/read-model-port.cjs");

function register(registerRoute, deps) {
  const vaultPath = deps.vaultPath;
  const dataDir = deps.dataDir;

  registerRoute("GET", "/api/read-model/version", function (_req, res) {
    try {
      const readModelVersion = getReadModelVersion({ vaultPath, dataDir });
      return sendJSON(res, 200, { readModelVersion });
    } catch (e) {
      logger.error({ event: "read-model-version-failed", error: e.message });
      return sendJSON(res, 500, { error_code: "READ_MODEL_VERSION_FAILED", message: e.message });
    }
  });
}

module.exports = { register };
