// Component: ErrorFactoryContract — EG-1b 错误工厂收敛（33→1）+ dispatch 错误钩子升级的目标态断言
// @responsible: 断言共享错误工厂契约、dispatch 层 status/details 感知、本地工厂清零、死码清除（TDD 先行：落地前 RED，落地后全绿）
// @inputs: server/shared/error-factory.cjs、server/shared/http-app.cjs（PR-085：route-dispatch 退役，错误钩子由框架错误处理器承载）、server/ 源码树、contracts/http-api.openapi.json
// @outputs: node --test 结果（8 用例）
// @context: Pipeline
//
// 设计依据（ADR060:22 框架错误钩子强制统一 + 规则 32 shadow-then-enforce）：
//   - 刀1（本切片）：33 个本地工厂收敛到共享工厂（定义唯一），dispatchRoute.fail 升级为 status/code/details 感知——
//     9 处纯转发 catch 由钩子接管后删除；零语义变化（无 status 错误仍 fallback 500）。
//   - 刀2（后续小片）：typedError 两参版伤害点的 status 补齐（语义变化，独立验收）。
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, readdirSync, statSync, existsSync } = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(path.dirname(__filename), "../../..");
const FACTORY = path.join(ROOT, "server", "shared", "error-factory.cjs");
const HTTP_APP = path.join(ROOT, "server", "shared", "http-app.cjs");
const OPENAPI = path.join(ROOT, "contracts", "http-api.openapi.json");

function* walk(dir, exts) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "__tests__") continue;
      yield* walk(full, exts);
    } else if (exts.some((e) => name.endsWith(e))) {
      yield full;
    }
  }
}

// 本地错误工厂定义口径（与 ADR060 审计同口径）：顶层 function XyzError(...) / const xyzError = (...) 声明
const LOCAL_FACTORY_RE = /^(?:function\s+\w*[eE]rror\w*\s*\(|const\s+\w*[eE]rror\w*\s*=\s*(?:\([^)]*\)\s*=>|function))/;

// 豁免清单（刀1 零语义原则——收敛会改变行为的特化工厂/响应侧出口/信封单源，刀2/EG-2 候选）
const EXEMPT_FILES = ["shared/api-envelope.cjs"];
const EXEMPT_RELKEYS = new Set([
  "shared/decision-lineage.cjs:lineageError",
  "shared/yaml-frontmatter.cjs:unsafeFrontmatterError",
  "shared/working-artifact-snapshot.cjs:artifactError",
  "services/inference/inference-conflict-store.cjs:typedError",
  "services/inference/inference-decision-consumer.cjs:consumerError",
  "services/governance/relation-candidate-contract.cjs:contractError",
  "services/projection/source-freshness-service.cjs:freshnessError",
  "routes/anomaly-workbench-routes.cjs:errorResponse",
  "routes/approval-state-machine-routes.cjs:sendError",
  "routes/architecture-version-routes.cjs:routeError",
  "routes/article-association-routes.cjs:sendError",
  "routes/article-workflow-routes.cjs:sendWorkflowError",
  "routes/dependencies-routes.cjs:sendRouteError",
  "routes/kg-routes.cjs:inventoryError",
  "routes/version-registry-routes.cjs:routeError",
  "services/entity-compliance/entity-compliance-declarative-engine.cjs:mapSchemaErrors",
]);

function countLocalFactories() {
  const hits = [];
  for (const ext of [".cjs"]) {
    for (const file of walk(path.join(ROOT, "server"), [ext])) {
      const rel = path.relative(ROOT, file).replace(/\\/g, "/");
      if (rel.includes("error-factory.cjs")) continue;
      if (EXEMPT_FILES.some((x) => rel === "server/" + x || rel.endsWith(x))) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!LOCAL_FACTORY_RE.test(line.trim())) return;
        const fnName = (line.match(/(?:function|const)\s+(\w*[eE]rror\w*)/) || [])[1] || "?";
        const relKey = `${rel.replace(/^server\//, "")}:${fnName}`;
        if (EXEMPT_RELKEYS.has(relKey)) return;
        hits.push(`${rel}:${i + 1}`);
      });
    }
  }
  return hits;
}

// 纯转发 catch 口径：响应体只有 code/status/message、无 details 的错误出口（与实测 9 处清单同口径）
const FORWARD_CATCH_RE = /sendJSON\(\s*res,\s*(?:e|err|error)\.status\s*\|\|\s*500,\s*\{\s*error_code:\s*(?:e|err|error)\.code\s*\|\|\s*"[A-Z_]+",\s*message:\s*(?:e|err|error)\.message\s*\}\s*\)/;

function countForwardCatches() {
  const hits = [];
  for (const file of walk(path.join(ROOT, "server", "routes"), [".cjs"])) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (FORWARD_CATCH_RE.test(line) && !/details/.test(line)) hits.push(`${path.relative(ROOT, file)}:${i + 1}`);
    });
  }
  return hits;
}

describe("EG-1b 错误工厂收敛目标态", () => {
  test("T1 共享工厂存在且基础构造：Error 实例 + code + message", () => {
    assert.equal(existsSync(FACTORY), true, "server/shared/error-factory.cjs 不存在——共享工厂未建");
    const { createError } = require(FACTORY);
    const e = createError("SOME_CODE", "出错了");
    assert.ok(e instanceof Error);
    assert.equal(e.code, "SOME_CODE");
    assert.equal(e.message, "出错了");
  });

  test("T2 共享工厂附加字段：status 与 details 挂载", () => {
    const { createError } = require(FACTORY);
    const e = createError("CONFLICT_CODE", "冲突", { status: 409, details: { why: "x" } });
    assert.equal(e.status, 409);
    assert.deepEqual(e.details, { why: "x" });
  });

  test("T3 零语义：无 status 时不设 status 字段（响应侧 fallback 500 与现状一致）", () => {
    const { createError } = require(FACTORY);
    const e = createError("NO_STATUS", "无状态码");
    assert.equal("status" in e, false, "无 status 入参时不得默认设置 status（0 语义收敛原则）");
  });

  // PR-085 第 1 步：dispatchRoute.fail 的 status/code/details 感知由 http-app setErrorHandler 承载——经 inject 走真实传输层断言
  async function throwThrough(error) {
    const { createHttpApp } = require(HTTP_APP);
    const http = createHttpApp({ cors: false });
    http.registerRoute("GET", "/api/x", function handler() { throw error; });
    const res = await http.app.inject({ method: "GET", url: "/api/x" });
    await http.close();
    return { statusCode: res.statusCode, body: res.json() };
  }

  test("T4 dispatch 钩子 status 感知：handler 抛 status=409 → 响应 409（现状恒 500 = RED 点）", async () => {
    const { createError } = require(FACTORY);
    const { statusCode, body } = await throwThrough(createError("DUPLICATE", "已存在", { status: 409, details: { key: "k1" } }));
    assert.equal(statusCode, 409, `期望 409，实际 ${statusCode}——错误处理器未感知 error.status`);
    assert.equal(body.error_code, "DUPLICATE");
  });

  test("T5 dispatch 钩子 details 透传：error.details 必达响应体（现状丢弃 = RED 点）", async () => {
    const { createError } = require(FACTORY);
    const { body } = await throwThrough(createError("VALIDATION_CODE", "字段非法", { status: 400, details: [{ field: "a", message: "必填" }] }));
    assert.deepEqual(body.details, [{ field: "a", message: "必填" }], "details 被丢弃——钩子未透传");
  });

  test("T6 dispatch 兜底保持：无 status 错误 → 500 + INTERNAL_ERROR（零语义基线）", async () => {
    const { statusCode, body } = await throwThrough(new Error("普通错误"));
    assert.equal(statusCode, 500);
    assert.equal(body.error_code, "INTERNAL_ERROR");
  });

  test("T7 工厂定义唯一：server/ 内（除共享工厂与测试）本地错误工厂定义计数=0（现状 33 = RED）", () => {
    const hits = countLocalFactories();
    assert.equal(hits.length, 0, `仍有 ${hits.length} 处本地错误工厂定义：\n${hits.slice(0, 10).join("\n")}`);
  });

  test("T8 纯转发 catch 清零 + 死码 ENTITY_NOT_READY 清除（RED：9 处转发 + 契约仍声明）", () => {
    const forwards = countForwardCatches();
    assert.equal(forwards.length, 0, `仍有 ${forwards.length} 处丢 details 的纯转发 catch：\n${forwards.join("\n")}`);
    const openapi = readFileSync(OPENAPI, "utf8");
    assert.ok(!openapi.includes('"ENTITY_NOT_READY"'), "契约仍声明死码 ENTITY_NOT_READY（后端零抛点）");
  });
});
