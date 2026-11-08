const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createHttpLogger, createJsonLogger, createRotatingFileStream } = require("../json-logger.cjs");
const { runWithRequestContext } = require("../request-context.cjs");

function parseLines(lines) {
  return lines.map((line) => JSON.parse(line));
}

test("JSON logger preserves its API, adds request context, and redacts sensitive fields", () => {
  const lines = [];
  const logger = createJsonLogger({ sink: (line) => lines.push(line) });

  runWithRequestContext({ traceId: "tr_logger-12345678" }, () => {
    logger.info({
      subsystem: "test",
      event: "safe-event",
      token: "secret-token",
      authorization: "Bearer secret",
      requestBody: { article: "private content" },
      vaultPath: "/Users/example/private-vault",
      failure: new Error(`failed at ${process.cwd()}/private-file`),
      proposalId: "proposal-123456789abc",
    });
  });

  const [record] = parseLines(lines);
  assert.equal(record.level, "info");
  assert.equal(record.subsystem, "test");
  assert.equal(record.event, "safe-event");
  assert.equal(record.trace_id, "tr_logger-12345678");
  assert.equal(record.proposalId, "proposal-123456789abc");
  assert.equal(record.token, "[Redacted]");
  assert.equal(record.authorization, "[Redacted]");
  assert.equal(record.requestBody, "[Redacted]");
  assert.equal(record.vaultPath, "[Redacted]");
  assert.equal(record.failure.message.includes(process.cwd()), false);
});

test("logger sink failures never escape into business code", () => {
  const logger = createJsonLogger({ sink() { throw new Error("disk unavailable"); } });
  assert.doesNotThrow(() => logger.error({ event: "write-failed" }));
});

test("pino-http emits bounded request lifecycle records", async () => {
  const lines = [];
  const logger = createJsonLogger({ sink: (line) => lines.push(line) });
  const httpLogger = createHttpLogger({ logger });
  const req = new EventEmitter();
  Object.assign(req, {
    method: "POST",
    url: "/api/proposals?private=yes",
    headers: { authorization: "Bearer secret", cookie: "session=secret" },
    socket: { remoteAddress: "127.0.0.1", remotePort: 1234 },
  });
  const res = new EventEmitter();
  Object.assign(res, {
    statusCode: 202,
    getHeaders() { return { "x-trace-id": req.id }; },
  });

  runWithRequestContext({ traceId: "tr_http-12345678" }, () => {
    httpLogger(req, res);
    res.emit("finish");
  });
  await new Promise((resolve) => setImmediate(resolve));

  const records = parseLines(lines);
  assert.deepEqual(records.map((entry) => entry.event), ["request.started", "request.completed"]);
  assert.ok(records.every((entry) => entry.trace_id === "tr_http-12345678"));
  assert.equal(records[0].http.method, "POST");
  assert.equal(records[0].http.path, "/api/proposals");
  assert.equal(records[1].http.status_code, 202);
  assert.equal(typeof records[1].duration_ms, "number");
  assert.equal(JSON.stringify(records).includes("Bearer secret"), false);
  assert.equal(JSON.stringify(records).includes("session=secret"), false);
});

test("pino-http records failed responses and their error code", async () => {
  const lines = [];
  const logger = createJsonLogger({ sink: (line) => lines.push(line) });
  const httpLogger = createHttpLogger({ logger });
  const req = new EventEmitter();
  Object.assign(req, { method: "GET", url: "/api/failure", headers: {}, socket: {} });
  const res = new EventEmitter();
  Object.assign(res, {
    statusCode: 500,
    errorCode: "INTERNAL_ERROR",
    err: new Error(`failed at ${process.cwd()}/private-file`),
    getHeaders() { return {}; },
  });

  runWithRequestContext({ traceId: "tr_failure-12345678" }, () => {
    httpLogger(req, res);
    res.emit("finish");
  });
  await new Promise((resolve) => setImmediate(resolve));

  const records = parseLines(lines);
  assert.equal(records.at(-1).event, "request.failed");
  assert.equal(records.at(-1).http.error_code, "INTERNAL_ERROR");
  assert.equal(records.at(-1).level, "error");
  assert.equal(JSON.stringify(records).includes(process.cwd()), false);
});

test("rotating JSONL stream writes to an isolated directory", async () => {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-logs-"));
  const stream = createRotatingFileStream(logDir);
  const logger = createJsonLogger({ stream });
  logger.info({ event: "file-smoke", token: "secret" });
  stream.end();
  await new Promise((resolve, reject) => {
    stream.once("finish", resolve);
    stream.once("error", reject);
  });

  const output = fs.readFileSync(path.join(logDir, "runtime.jsonl"), "utf8");
  assert.match(output, /"event":"file-smoke"/);
  assert.equal(output.includes("secret"), false);
  fs.rmSync(logDir, { recursive: true, force: true });
});

test("T6: sink failure emits rate-limited stderr degradation signal instead of silent swallow", async () => {
  const { createJsonLogger } = require("../json-logger.cjs");
  const stderrLines = [];
  const originalWrite = process.stderr.write;
  process.stderr.write = (chunk) => { stderrLines.push(String(chunk)); return true; };
  try {
    const logger = createJsonLogger({ sink: () => { throw new Error("sink boom"); } });
    for (let i = 0; i < 8; i++) logger.info({ subsystem: "t6", event: "degraded" });
    // pino 是异步批量写，等待 flush
    await new Promise((resolve) => setTimeout(resolve, 200));
    logger.flush();
    await new Promise((resolve) => setTimeout(resolve, 100));
  } finally {
    process.stderr.write = originalWrite;
  }
  const joined = stderrLines.join("");
  assert.match(joined, /json-logger\] sink write failed/, "sink 失败应有 stderr 降级信号");
  assert.match(joined, /sink failure log suppressed/, "超过限流应抑制洪泛");
  const first5 = stderrLines.filter((line) => line.includes("sink write failed"));
  assert.ok(first5.length <= 5, `限流后前 5 条内的实际信号数 ${first5.length} 不应超过 5`);
});
