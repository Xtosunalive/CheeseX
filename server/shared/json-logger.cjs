// Component: JSON-Logger
// @responsible: Emit redacted structured logs to console and a bounded local JSONL file.

const fs = require("node:fs");
const path = require("node:path");
const { Writable } = require("node:stream");
const pino = require("pino");
const pinoHttp = require("pino-http");
const { createStream } = require("rotating-file-stream");
const { getTraceId, resolveTraceId } = require("./request-context.cjs");

const REDACTED = "[Redacted]";
const SENSITIVE_KEYS = new Set([
  "admissionManifestPath", "authorization", "content", "cookie", "credentials",
  "executionVaultPath", "filePath", "password", "requestBody", "responseBody",
  "secret", "token", "vaultPath", "worktreePath",
]);

// T6/#822：sink 失败降级信号 + 计数限流（防洪泛）。模块级状态，多 logger 实例共享。
let sinkFailureCount = 0;
const SINK_FAILURE_LOG_LIMIT = 5;

function safeSink(sink) {
  return new Writable({
    write(chunk, _encoding, callback) {
      try {
        sink(String(chunk));
      } catch (sinkError) {
        // T6：sink 失败不再静默——stderr 降级信号（限流防洪泛）。
        sinkFailureCount += 1;
        if (sinkFailureCount <= SINK_FAILURE_LOG_LIMIT) {
          try {
            process.stderr.write(`[json-logger] sink write failed (${sinkFailureCount}/${SINK_FAILURE_LOG_LIMIT}): ${sinkError && sinkError.message ? sinkError.message : String(sinkError)}\n`);
          } catch { /* best-effort: 清理/降级失败静默可接受 */ }
        } else if (sinkFailureCount === SINK_FAILURE_LOG_LIMIT + 1) {
          try { process.stderr.write("[json-logger] sink failure log suppressed (rate-limited)\n"); } catch { /* best-effort: 清理/降级失败静默可接受 */ }
        }
      }
      callback();
    },
  });
}

function sanitize(value, key = "") {
  if (SENSITIVE_KEYS.has(key)) return REDACTED;
  if (typeof value === "string") {
    const roots = [process.env.VAULT_PATH, process.cwd()].filter((root) => typeof root === "string" && path.isAbsolute(root));
    return roots.reduce((text, root) => text.split(root).join("[Path]"), value);
  }
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry));
  if (value && typeof value === "object") {
    if (value instanceof Error) return { type: value.name, message: sanitize(value.message), code: value.code };
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, sanitize(child, childKey)]));
  }
  return value;
}

function loggerOptions() {
  return {
    base: null,
    formatters: { level: (level) => ({ level }) },
    timestamp: () => `,"ts":"${new Date().toISOString()}"`,
    mixin() {
      const traceId = getTraceId();
      return traceId ? { trace_id: traceId } : {};
    },
  };
}

function createJsonLogger(options = {}) {
  const destination = options.stream || safeSink(options.sink || ((line) => process.stdout.write(line)));
  const raw = pino(loggerOptions(), destination);
  const write = (level, fields = {}) => {
    try {
      raw[level]({ subsystem: fields.subsystem || "app", event: fields.event || "log", ...sanitize(fields) });
    } catch (_error) { /* best-effort: 失败静默可接受 */ }
  };
  return {
    raw,
    debug: (fields) => write("debug", fields),
    info: (fields) => write("info", fields),
    warn: (fields) => write("warn", fields),
    error: (fields) => write("error", fields),
    flush() { try { raw.flush(); } catch (_error) { /* best-effort: 失败静默可接受 */ } },
  };
}

function requestPath(req) {
  try { return new URL(req.url || "/", "http://127.0.0.1").pathname; }
  catch (_error) { return "/"; }
}

function httpFields(req, res) {
  return {
    method: req.method || null,
    path: requestPath(req),
    ...(res && Number.isInteger(res.statusCode) ? { status_code: res.statusCode } : {}),
    ...(res && typeof res.errorCode === "string" ? { error_code: res.errorCode } : {}),
  };
}

function createHttpLogger(options = {}) {
  const target = options.logger || logger;
  return pinoHttp({
    logger: target.raw || target,
    quietReqLogger: true,
    quietResLogger: true,
    serializers: {
      req(req) { return { id: req.id, method: req.method, path: requestPath(req.raw || req) }; },
      res(res) { return { status_code: res.statusCode }; },
      err(error) { return { type: error.name, message: sanitize(error.message), code: error.code }; },
    },
    genReqId(req) { return getTraceId() || resolveTraceId(req.headers && req.headers["x-trace-id"]); },
    customProps(req) { return { trace_id: req.id, subsystem: "http" }; },
    customReceivedMessage() { return "HTTP request started"; },
    customReceivedObject(req) { return { event: "request.started", http: httpFields(req) }; },
    customSuccessMessage() { return "HTTP request completed"; },
    customSuccessObject(req, res, value) {
      return { event: "request.completed", http: httpFields(req, res), duration_ms: value.responseTime };
    },
    customErrorMessage() { return "HTTP request failed"; },
    customErrorObject(req, res, error, value) {
      return {
        event: "request.failed",
        http: httpFields(req, res),
        duration_ms: value.responseTime,
        error: { type: error.name, message: sanitize(error.message), code: error.code },
      };
    },
    customLogLevel(_req, res, error) {
      if (error || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
  });
}

function createRotatingFileStream(logDir) {
  fs.mkdirSync(logDir, { recursive: true });
  const file = createStream("runtime.jsonl", { path: logDir, size: "10M", interval: "1d", maxFiles: 7 });
  // T6/#875：真实文件 sink 故障不再静默——复用 safeSink 的 stderr 降级 + 限流模式。
  file.on("error", (streamError) => {
    sinkFailureCount += 1;
    if (sinkFailureCount <= SINK_FAILURE_LOG_LIMIT) {
      try {
        process.stderr.write(`[json-logger] rotating file sink error (${sinkFailureCount}/${SINK_FAILURE_LOG_LIMIT}): ${streamError && streamError.message ? streamError.message : String(streamError)}\n`);
      } catch { /* best-effort: 清理/降级失败静默可接受 */ }
    } else if (sinkFailureCount === SINK_FAILURE_LOG_LIMIT + 1) {
      try { process.stderr.write("[json-logger] rotating file sink errors suppressed (rate-limited)\n"); } catch { /* best-effort: 清理/降级失败静默可接受 */ }
    }
  });
  return file;
}

function createRuntimeStream() {
  if (process.env.NODE_TEST_CONTEXT) return process.stdout;
  const logDir = path.resolve(__dirname, "..", "..", ".tmp", "logs");
  const file = createRotatingFileStream(logDir);
  return pino.multistream([{ stream: process.stdout }, { stream: file }]);
}

const logger = createJsonLogger({ stream: createRuntimeStream() });
const httpLogger = createHttpLogger({ logger });

module.exports = { REDACTED, createHttpLogger, createJsonLogger, createRotatingFileStream, httpLogger, logger, sanitize };
