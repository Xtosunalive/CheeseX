// Component: Langfuse-Tracer — optional Langfuse tracing for the API server.
// @responsible: 在 LANGFUSE_* 环境变量配置齐全时初始化 Langfuse OTel 追踪；
//               否则提供确定性 no-op，保证未配置时应用行为零变化。
// @inputs: LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY / LANGFUSE_BASE_URL / LANGFUSE_DISABLED
// @outputs: requestSpan / span 追踪包装函数，shutdown 刷新并释放资源
// @context: Canvas
//
// 设计要点（Langfuse skill instrumentation best-practices）：
// - 未配置 LANGFUSE_* 时不加载 OTel SDK，不产生任何网络请求；span/requestSpan 直接透传。
// - 配置时使用 @langfuse/tracing v5 的 startActiveObservation（基于 OTel 异步上下文），
//   请求/服务内部创建的嵌套观测自动成为其子节点，无需手动传递 parent id。
// - 只记录请求方法、路径、状态码与业务 id，不记录请求体、文件内容或图数据（敏感数据掩码）。
// - 短生命周期进程在退出前必须 flush/shutdown，避免丢失缓冲中的 traces。

const { logger } = require("./json-logger.cjs");
const { getTraceId } = require("./request-context.cjs");

const state = { enabled: false, sdk: null, shuttingDown: false, shutdownRegistered: false };

function isConfigured(env) {
  if (!env) return false;
  if (String(env.LANGFUSE_DISABLED) === "1") return false;
  return Boolean(
    env.LANGFUSE_PUBLIC_KEY &&
    env.LANGFUSE_SECRET_KEY &&
    env.LANGFUSE_BASE_URL
  );
}

function configure(env) {
  if (isConfigured(env)) {
    if (state.sdk) return state;
    let sdk = null;
    try {
      // 延迟加载 OTel 包：仅在真正启用时引入，避免未配置路径的启动开销。
      const { NodeSDK } = require("@opentelemetry/sdk-node");
      const { LangfuseSpanProcessor } = require("@langfuse/otel");
      sdk = new NodeSDK({
        spanProcessors: [
          new LangfuseSpanProcessor({
            publicKey: env.LANGFUSE_PUBLIC_KEY,
            secretKey: env.LANGFUSE_SECRET_KEY,
            baseUrl: env.LANGFUSE_BASE_URL,
          }),
        ],
      });
      sdk.start();
      state.sdk = sdk;
      state.enabled = true;
      registerShutdown(sdk);
      logger.info({ event: "langfuse-tracing-enabled", baseUrl: env.LANGFUSE_BASE_URL });
    } catch (error) {
      state.sdk = null;
      state.enabled = false;
      if (sdk && typeof sdk.shutdown === "function") {
        Promise.resolve(sdk.shutdown()).catch(function () {});
      }
      logger.warn({ event: "langfuse-initialization-failed", error: error.message });
    }
  } else {
    logger.info({ event: "langfuse-tracing-disabled", reason: "LANGFUSE_* 未完整配置" });
  }
  return state;
}

function registerShutdown(sdk) {
  if (state.shutdownRegistered) return;
  state.shutdownRegistered = true;
  function flush() {
    if (state.shuttingDown) return Promise.resolve();
    state.shuttingDown = true;
    return Promise.resolve(sdk.shutdown()).catch(function (error) {
      logger.warn({ event: "langfuse-shutdown-failed", error: error.message });
    });
  }
  process.once("SIGINT", function () { flush().finally(function () { process.exit(0); }); });
  process.once("SIGTERM", function () { flush().finally(function () { process.exit(0); }); });
  process.once("beforeExit", function () { flush(); });
}

function shutdown() {
  if (!state.sdk || state.shuttingDown) return Promise.resolve();
  state.shuttingDown = true;
  return Promise.resolve(state.sdk.shutdown()).catch(function (error) {
    logger.warn({ event: "langfuse-shutdown-failed", error: error.message });
  });
}

// 提取请求路径，失败时回退为 "/"，避免 URL 解析异常打断追踪。
function safePathname(req) {
  try {
    return new URL(req.url || "/", "http://127.0.0.1").pathname;
  } catch (_error) {
    return String(req.url || "/");
  }
}

function setRequestOutput(span, res, error) {
  const statusCode = res && Number.isInteger(res.statusCode) ? res.statusCode : error ? 500 : 200;
  const output = { statusCode, ok: statusCode < 400 };
  if (error) output.error = error.message;
  span.update({ output });
}

// 为一个 HTTP 请求创建一条 Langfuse trace，并在其作用域内执行 fn。
// fn 可为同步或异步；enabled 时返回 Promise，disabled 时原样透传 fn 的结果。
function requestSpan(req, res, fn) {
  if (!state.enabled) return fn();
  const pathname = safePathname(req);
  const name = `${req.method || "?"} ${pathname}`;
  const { startActiveObservation } = require("@langfuse/tracing");
  return startActiveObservation(name, function (span) {
    span.update({
      input: {
        method: req.method || null,
        path: pathname,
        traceId: getTraceId(),
      },
    });
    let result;
    try {
      result = fn();
    } catch (error) {
      setRequestOutput(span, res, error);
      throw error;
    }
    if (result && typeof result.then === "function") {
      return result.then(function (value) {
        setRequestOutput(span, res, null);
        return value;
      }).catch(function (error) {
        setRequestOutput(span, res, error);
        throw error;
      });
    }
    setRequestOutput(span, res, null);
    return result;
  });
}

// 为一段业务操作创建一个嵌套 span（自动成为当前活动观测的子节点）。
// opts.input 记录入参；opts.output 可为静态值或 (result) => value 的函数。
function span(name, opts, fn) {
  if (!state.enabled) return fn();
  const options = opts || {};
  const { startActiveObservation } = require("@langfuse/tracing");
  return startActiveObservation(name, function (observation) {
    if (options.input !== undefined) observation.update({ input: options.input });
    let result;
    try {
      result = fn();
    } catch (error) {
      observation.update({ output: { error: error.message } });
      throw error;
    }
    const resolveOutput = function (value) {
      const output = typeof options.output === "function" ? options.output(value) : options.output;
      observation.update({ output: output === undefined ? value : output });
      return value;
    };
    if (result && typeof result.then === "function") {
      return result.then(resolveOutput).catch(function (error) {
        observation.update({ output: { error: error.message } });
        throw error;
      });
    }
    return resolveOutput(result);
  });
}

// 模块加载时即按当前环境决定启用状态（与 main.cjs 读取 API_PORT/VAULT_PATH 同一模式）。
configure(process.env);

const exports_ = { state, isConfigured, configure, requestSpan, span, shutdown };
Object.defineProperty(exports_, "enabled", {
  enumerable: true,
  get: function () { return state.enabled; },
});
module.exports = exports_;
