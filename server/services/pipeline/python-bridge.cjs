// Component: Python-Bridge — structured Python subprocess communication via stdout JSON lines.
// @responsible: 启动 Python 子进程并解析结构化进度、日志和退出状态。
// @inputs: Python 命令、参数、环境变量与 stdout/stderr
// @outputs: 子进程句柄、结构化消息与完成结果
// @context: Pipeline
//
// Contract: Python scripts emit structured JSON lines when run with --json-progress.
// Structured message types: { type: "progress"|"stage"|"log", ... }
// Fallback: non-JSON lines are treated as plain log text.
const { spawn } = require("child_process");
const { resolvePythonPath } = require("../../shared/python-path.cjs");

/**
 * @param {Object} options
 * @param {string} [options.pythonPath]  缺省走 resolvePythonPath()（PYTHON_PATH || python3）
 * @param {string} [options.cwd]
 * @param {Object} [options.env]
 * @param {number} [options.timeoutMs=300000]
 * @param {Object} [options.logger]   { info, warn, error } methods
 * @param {Function} [options.spawnProcess]  测试注入口（缺省 child_process.spawn）
 * @returns {{ spawn: Function, parseLine: Function }}
 */
function createPythonBridge(options) {
  // ADR-002：解释器解析单点 = shared/python-path.cjs（PYTHON_PATH 优先，回退 python3）
  const pythonPath = options.pythonPath || resolvePythonPath();
  const cwd = options.cwd || process.cwd();
  const env = Object.assign({}, process.env, options.env || {});
  const timeoutMs = options.timeoutMs || 5 * 60 * 1000;
  const logger = options.logger || { info: function () {}, warn: function () {}, error: function () {} };
  const spawnProcess = options.spawnProcess || spawn;

  /**
   * Parse one stdout line. Returns null if empty, or { structured: true, data }
   * for JSON progress lines, or { structured: false, text } for plain log lines.
   */
  function parseLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("{")) {
      try {
        const obj = JSON.parse(trimmed);
        if (obj && typeof obj.type === "string") {
          return { structured: true, data: obj };
        }
      } catch (_) { /* not valid JSON, treat as plain text */ }
    }
    return { structured: false, text: trimmed };
  }

  /**
   * Spawn a Python script and capture structured + plain output.
   * @param {string} scriptPath   Absolute path to the Python script
   * @param {string[]} args       CLI args
   * @param {Object} callbacks
   * @param {Function} [callbacks.onProgress]  ({ stage, pct, message }) => void
   * @param {Function} [callbacks.onStage]     ({ stage, name }) => void
   * @param {Function} [callbacks.onLog]       ({ source, level?, message }) => void
   * @param {AbortSignal} [callbacks.signal]   AbortSignal for cancellation
   * @returns {Promise<{ exitCode: number|null, logs: Array<{source:string,message:string}> }>}
   */
  function spawnScript(scriptPath, args, callbacks) {
    const onProgress = callbacks.onProgress || function () {};
    const onStage = callbacks.onStage || function () {};
    const onLog = callbacks.onLog || function () {};
    const signal = callbacks.signal;

    return new Promise(function (resolve, reject) {
      const child = spawnProcess(pythonPath, [scriptPath].concat(args), {
        cwd: cwd,
        env: env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const logs = [];
      let killedBySignal = false;
      let timedOut = false;

      // Timeout
      const timeout = setTimeout(function () {
        timedOut = true;
        child.kill("SIGTERM");
      }, timeoutMs);

      // AbortSignal
      if (signal) {
        if (signal.aborted) {
          child.kill("SIGTERM");
          killedBySignal = true;
        } else {
          signal.addEventListener("abort", function () {
            child.kill("SIGTERM");
            killedBySignal = true;
          }, { once: true });
        }
      }

      // stdout line parser
      let stdoutBuffer = "";
      child.stdout.on("data", function (chunk) {
        stdoutBuffer += chunk.toString();
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() || "";
        for (var i = 0; i < lines.length; i++) {
          const parsed = parseLine(lines[i]);
          if (!parsed) continue;
          if (parsed.structured) {
            dispatchStructured(parsed.data, onProgress, onStage, onLog, logs);
          } else {
            onLog({ source: "stdout", level: "info", message: parsed.text });
            logs.push({ source: "stdout", message: parsed.text });
          }
        }
      });

      // stderr（W2-WP3：同时走 onLog 回调，消费方可做失败语义解析——此前只落内部 logs）
      let stderrBuffer = "";
      child.stderr.on("data", function (chunk) {
        stderrBuffer += chunk.toString();
        const lines = stderrBuffer.split(/\r?\n/);
        stderrBuffer = lines.pop() || "";
        for (var i = 0; i < lines.length; i++) {
          const trimmed = lines[i].trim();
          if (trimmed) {
            onLog({ source: "stderr", level: "warn", message: trimmed });
            logger.warn({ event: "python-stderr", message: trimmed });
            logs.push({ source: "stderr", message: trimmed });
          }
        }
      });

      child.once("error", function (err) {
        clearTimeout(timeout);
        logs.push({ source: "system", message: "Spawn error: " + err.message });
        reject(err);
      });

      child.once("close", function (code) {
        clearTimeout(timeout);
        // Flush residual buffers
        if (stdoutBuffer.trim()) {
          logs.push({ source: "stdout", message: stdoutBuffer.trim() });
        }
        if (stderrBuffer.trim()) {
          logs.push({ source: "stderr", message: stderrBuffer.trim() });
        }
        if (timedOut) {
          logs.push({ source: "system", message: "Process timed out after " + timeoutMs + "ms" });
        }
        if (killedBySignal) {
          logs.push({ source: "system", message: "Process cancelled via AbortSignal" });
        }
        resolve({ exitCode: code, logs: logs });
      });
    });
  }

  return { spawn: spawnScript, parseLine: parseLine };
}

function dispatchStructured(msg, onProgress, onStage, onLog, logs) {
  switch (msg.type) {
    case "progress":
      onProgress({ stage: msg.stage, pct: msg.pct, message: msg.message || "" });
      logs.push({ source: "stdout", message: "[progress] " + (msg.message || msg.stage) });
      break;
    case "stage":
      onStage({ stage: msg.stage, name: msg.name || msg.stage });
      logs.push({ source: "stdout", message: "[stage] " + msg.name });
      break;
    case "log":
      onLog({ source: "stdout", level: msg.level || "info", message: msg.message || "" });
      logs.push({ source: "stdout", message: (msg.level ? "[" + msg.level + "] " : "") + (msg.message || "") });
      break;
    default:
      logs.push({ source: "stdout", message: JSON.stringify(msg) });
  }
}

module.exports = { createPythonBridge };
