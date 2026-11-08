const assert = require("assert");
const test = require("node:test");
const path = require("path");
// PR-019：这里只取纯函数 isConfigured（对入参求值，与模块实例状态无关）。
// 不要在此处取 configure —— 顶层绑定是**文件加载时**捕获的实例，进程若已注入真实
// LANGFUSE_*（.env），该实例加载即 enabled=true，会污染「缺键应保持 disabled」类断言。
// 凡依赖模块状态的用例一律走 resetEnv() + loadFresh()（见下）。
const { isConfigured } = require("../langfuse-tracer.cjs");

const MODULE_PATH = path.join(__dirname, "..", "langfuse-tracer.cjs");

// 删除模块缓存并清空 Langfuse 相关环境变量，使下一次 require 重新评估配置。
function resetEnv(extra) {
  for (const key of ["LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "LANGFUSE_BASE_URL", "LANGFUSE_DISABLED"]) {
    delete process.env[key];
  }
  if (extra) Object.assign(process.env, extra);
  delete require.cache[MODULE_PATH];
}

function loadFresh() {
  return require(MODULE_PATH);
}

test("isConfigured returns false when all LANGFUSE_* keys are absent", function () {
  assert.strictEqual(isConfigured({}), false);
  assert.strictEqual(isConfigured({ LANGFUSE_PUBLIC_KEY: "pk-x" }), false);
  assert.strictEqual(isConfigured({ LANGFUSE_PUBLIC_KEY: "pk-x", LANGFUSE_SECRET_KEY: "sk-x" }), false);
});

test("isConfigured returns false when LANGFUSE_DISABLED=1 even with full keys", function () {
  const full = { LANGFUSE_PUBLIC_KEY: "pk-x", LANGFUSE_SECRET_KEY: "sk-x", LANGFUSE_BASE_URL: "https://cloud.langfuse.com" };
  assert.strictEqual(isConfigured(full), true);
  assert.strictEqual(isConfigured(Object.assign({}, full, { LANGFUSE_DISABLED: "1" })), false);
});

test("module loads without LANGFUSE_* as a deterministic no-op (enabled=false)", function () {
  resetEnv();
  const tracer = loadFresh();
  assert.strictEqual(tracer.enabled, false);
  assert.strictEqual(tracer.state.enabled, false);
});

test("module enables only when all three LANGFUSE_* keys are present", function () {
  resetEnv({
    LANGFUSE_PUBLIC_KEY: "pk-lf-test",
    LANGFUSE_SECRET_KEY: "sk-lf-test",
    LANGFUSE_BASE_URL: "https://cloud.langfuse.com",
  });
  const tracer = loadFresh();
  assert.strictEqual(tracer.state.enabled, true);
  // 避免真实网络：立即 shutdown 释放 SDK 资源
  return tracer.shutdown();
});

test("invalid Langfuse configuration fails open without blocking module load", function () {
  resetEnv({
    LANGFUSE_PUBLIC_KEY: "pk-lf-test",
    LANGFUSE_SECRET_KEY: "sk-lf-test",
    LANGFUSE_BASE_URL: "://invalid-url",
  });
  const tracer = loadFresh();
  assert.strictEqual(tracer.enabled, false);
  assert.strictEqual(tracer.state.sdk, null);
  assert.deepStrictEqual(tracer.span("fallback", {}, function () { return { ok: true }; }), { ok: true });
});

test("configure() with missing keys keeps tracing disabled and is re-runnable", function () {
  resetEnv();
  // PR-019：本断言的前提是「模块初始 disabled」，故必须取 resetEnv() 之后的新实例。
  // 原先用的是文件加载时捕获的顶层 configure —— 进程若已注入真实 LANGFUSE_*（.env），
  // 那个实例加载即 enabled=true，断言 `false` 必然失败（与产品行为无关，纯夹具问题）。
  const tracer = loadFresh();
  const first = tracer.configure({});
  assert.strictEqual(first.enabled, false);
  const second = tracer.configure({ LANGFUSE_PUBLIC_KEY: "pk-x" });
  assert.strictEqual(second.enabled, false);
  assert.strictEqual(tracer.state.enabled, false);
});

test("span() passes through the callback when disabled and propagates errors", function (t) {
  resetEnv();
  const tracer = loadFresh();
  assert.strictEqual(tracer.state.enabled, false);

  const syncValue = tracer.span("op", {}, function () { return { ok: true }; });
  assert.deepStrictEqual(syncValue, { ok: true });

  return tracer.span("async-op", {}, async function () { return 42; })
    .then(function (value) { assert.strictEqual(value, 42); })
    .then(function () {
      assert.throws(function () {
        tracer.span("throwing", {}, function () { throw new Error("boom"); });
      }, /boom/);
    })
    .then(function () {
      // 异步错误同样向上传播
      return assert.rejects(
        function () { return tracer.span("async-throw", {}, async function () { throw new Error("async-boom"); }); },
        /async-boom/,
      );
    });
});

test("requestSpan() passes through and returns the handler result when disabled", function (t) {
  resetEnv();
  const tracer = loadFresh();
  const req = { method: "POST", url: "/api/articles/graph-batches/1/publish", headers: {} };
  const res = { statusCode: 200 };
  const result = tracer.requestSpan(req, res, function () { return { published: true }; });
  assert.deepStrictEqual(result, { published: true });
});

test("shutdown() is a safe no-op when tracing is disabled", function (t) {
  resetEnv();
  const tracer = loadFresh();
  assert.strictEqual(tracer.state.enabled, false);
  return tracer.shutdown().then(function () { assert.ok(true, "shutdown resolves without throwing"); });
});
