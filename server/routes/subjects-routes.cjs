// Component: Subjects-Routes（SPEC-019 A 档）——主体注册表透传（导航树 subjects/ 目录数据源）。
const { sendJSON } = require("../shared/api-envelope.cjs");
const { logger } = require("../shared/json-logger.cjs");
const { readSubjects } = require("../shared/schema-config.cjs");

function register(registerRoute, deps) {
  registerRoute("GET", "/api/schema/subjects", function (_req, res) {
    try {
      return sendJSON(res, 200, readSubjects(deps.vaultPath));
    } catch (e) {
      logger.error({ event: "subjects-get-failed", error: e.message });
      return sendJSON(res, e.status || 500, { error_code: e.code || "SUBJECTS_UNAVAILABLE", message: e.message, details: e.details });
    }
  });
}

module.exports = { register };
