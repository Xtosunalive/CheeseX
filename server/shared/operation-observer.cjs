// Component: Operation-Observer
// @responsible: Add consistent passive logs and Langfuse spans around a business operation.

const { performance } = require("node:perf_hooks");

function withOptionalSpan(name, fields, resultFields, operation) {
  const configured = process.env.LANGFUSE_DISABLED !== "1"
    && process.env.LANGFUSE_PUBLIC_KEY
    && process.env.LANGFUSE_SECRET_KEY
    && process.env.LANGFUSE_BASE_URL;
  if (!configured) return operation();
  return require("./langfuse-tracer.cjs").span(name, { input: fields, output: resultFields }, operation);
}

function safeResultFields(mapper, value) {
  if (typeof mapper !== "function") return {};
  try {
    const fields = mapper(value);
    return fields && typeof fields === "object" && !Array.isArray(fields) ? fields : {};
  } catch (_error) {
    return {};
  }
}

function observeOperation(options, operation) {
  const logger = options.logger || { info() {}, error() {} };
  const name = options.name;
  const fields = options.fields || {};
  return withOptionalSpan(name, fields, options.resultFields, function () {
    const startedAt = performance.now();
    logger.info({ event: `${name}.started`, ...fields });

    function completed(value) {
      logger.info({
        event: `${name}.completed`,
        ...fields,
        ...safeResultFields(options.resultFields, value),
        duration_ms: Number((performance.now() - startedAt).toFixed(3)),
      });
      return value;
    }

    function failed(error) {
      logger.error({
        event: `${name}.failed`,
        ...fields,
        duration_ms: Number((performance.now() - startedAt).toFixed(3)),
        error_code: error && error.code ? error.code : "INTERNAL_ERROR",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    try {
      const result = operation();
      return result && typeof result.then === "function" ? result.then(completed, failed) : completed(result);
    } catch (error) {
      return failed(error);
    }
  });
}

module.exports = { observeOperation };
