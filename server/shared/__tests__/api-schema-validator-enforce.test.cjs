// Component: Api-Schema-Validator-Enforce-Behavior (seq196)
// gate: check-api-response-schema-contract（quality-gates.json，precommit 链）
// @responsible: enforce 翻转行为证据——真实契约推导探针 × 红灯期实测响应样本（fixture，source=git）闭环
// @inputs: server/shared/api-schema-validator.cjs（被测执法位）、docs/plans/business-slices/red-evidence/seq196/observed-responses.json（红灯样本）
// @outputs: 违约样本全 block / 合规样本全 pass / 关闭开关 / shadow 名单 / 渐进语义行为证明
// @context: 规则 28 行为级红灯证据由提交进仓库的测试承载（L2 行为层，ADR048）——preflight 重放属 L3 静态层，两层不得互越权。
const { test, describe } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const VALIDATOR_PATH = path.join(ROOT, "server", "shared", "api-schema-validator.cjs");
const FIXTURE_PATH = path.join(ROOT, "docs", "plans", "business-slices", "red-evidence", "seq196", "observed-responses.json");

// 红灯期定性（#1591/#1592）：修实现向契约对齐 = severity/generatedAt/precleaned（fixture 旧样本对【修后实现+修后契约】
// 在探针语义下仍违例——fixture 是旧实现产物，不会随实现变化，其违例由本测试固化证明执法位可检出）；
// 修契约向实现现实对齐 = health/inference-conflicts（fixture 样本对【修后契约】转为合规——正是契约修正的行为证明）。
const IMPLEMENT_FIXED_URLS = new Set(["/api/entity/check", "/api/documents/search", "/api/articles/precleaned"]);
const CONTRACT_FIXED_URLS = new Set(["/api/health", "/api/kg/inference-conflicts"]);

function loadValidator() {
  delete process.env.API_RESPONSE_SCHEMA_SHADOW;
  return require(VALIDATOR_PATH);
}

// 红灯样本夹具住 docs/plans 内部证据面（真实探针响应，含真实业务数据），不入公开仓：
// 缺席时依赖夹具的用例明示跳过（vault=skip 同惯例）；ENF-1/ENF-6 不依赖夹具，常驻。
const FIXTURE_PRESENT = require("node:fs").existsSync(FIXTURE_PATH);

test("ENF-1: 契约路由表规模稳定（防推导倒退）", () => {
  const validator = loadValidator();
  assert.ok(validator.contractRouteCount >= 50, `契约推导路由数=${validator.contractRouteCount}，防倒退下限 50`);
});

describe("seq196 enforce 翻转行为证据（真实探针 × 红灯 fixture）", {
  skip: FIXTURE_PRESENT ? false : "内部红灯证据夹具（docs/plans）不在公开仓——证据用例缺席跳过",
}, () => {
  const validator = loadValidator();
  const fixture = JSON.parse(require("node:fs").readFileSync(FIXTURE_PATH, "utf8"));
  const probe = validator.createContractResponseProbe({ logger: { error() {}, warn() {} } });

  test("ENF-2: 实现修复面样本（severity/generatedAt/precleaned）——真实探针检出违例并阻断", () => {
    let checked = 0;
    for (const sample of fixture.samples) {
      if (!IMPLEMENT_FIXED_URLS.has(sample.url)) continue;
      const verdict = probe(sample.url, sample.method, sample.status, sample.body);
      assert.strictEqual(verdict.action, "block", `${sample.url} 红灯违例样本必须被执法位检出（block）`);
      assert.ok(verdict.violations.length > 0);
      checked++;
    }
    assert.strictEqual(checked, 3, "实现修复面样本必须恰好 3 条（与 #1592 定性一致）");
  });

  test("ENF-3: 契约修正面样本（health/inference-conflicts）——修后契约实证合规（pass）", () => {
    let checked = 0;
    for (const sample of fixture.samples) {
      if (!CONTRACT_FIXED_URLS.has(sample.url)) continue;
      const verdict = probe(sample.url, sample.method, sample.status, sample.body);
      assert.strictEqual(verdict.action, "pass", `${sample.url} 在修正后契约下必须合规（契约向实现现实对齐的行为证明）`);
      checked++;
    }
    assert.strictEqual(checked, 2, "契约修正面样本必须恰好 2 条");
  });

  test("ENF-4: 合规对照样本——真实探针全部放行", () => {
    for (const sample of fixture.samples) {
      if (IMPLEMENT_FIXED_URLS.has(sample.url) || CONTRACT_FIXED_URLS.has(sample.url)) continue;
      const verdict = probe(sample.url, sample.method, sample.status, sample.body);
      assert.strictEqual(verdict.action, "pass", `${sample.url} 对照样本必须 pass`);
    }
  });

  test("ENF-5: shadow 名单端点违例照发（ADR060 §5 可单独回退）", () => {
    process.env.API_RESPONSE_SCHEMA_SHADOW = "/api/entity/check,/api/documents";
    try {
      const shadowProbe = validator.createContractResponseProbe({ logger: { error() {}, warn() {} } });
      const sample = fixture.samples.find((s) => s.url === "/api/entity/check");
      const verdict = shadowProbe(sample.url, sample.method, sample.status, sample.body);
      assert.strictEqual(verdict.action, "pass", "名单内端点违例必须照发（仅记录）");
      // 名单前缀匹配：/api/documents 覆盖 /api/documents/search
      const sample2 = fixture.samples.find((s) => s.url === "/api/documents/search");
      assert.strictEqual(shadowProbe(sample2.url, sample2.method, sample2.status, sample2.body).action, "pass", "前缀匹配生效");
    } finally {
      delete process.env.API_RESPONSE_SCHEMA_SHADOW;
    }
  });
});

test("ENF-6: API_RESPONSE_SCHEMA_CHECK=0 时 envelope 零探针（违约也照发——显式关闭语义）", async () => {
  // PR-085 第 1 步：探针由 http-app onSend 钩子承载——经真实传输层验证「=0 完全关闭」
  const envelope = require(path.join(ROOT, "server", "shared", "api-envelope.cjs"));
  const { createHttpApp } = require(path.join(ROOT, "server", "shared", "http-app.cjs"));
  process.env.API_RESPONSE_SCHEMA_CHECK = "0";
  envelope.setResponseSchemaProbe(function () { return { action: "block", violations: [] }; });
  const http = createHttpApp({ cors: false });
  http.registerRoute("GET", "/api/kg/pending-review", (_req, res) => envelope.sendJSON(res, 200, { anything: "goes" }));
  try {
    const res = await http.app.inject({ method: "GET", url: "/api/kg/pending-review" });
    assert.strictEqual(res.statusCode, 200, "=0 必须完全关闭执法（探针即使返回 block 也不生效）");
    assert.strictEqual(res.json().data.anything, "goes");
  } finally {
    delete process.env.API_RESPONSE_SCHEMA_CHECK;
    envelope.setResponseSchemaProbe(null);
    await http.close();
  }
});
