// Component: Api-Schema-Contract-Foundation (EG-1a)
// gate: check-api-response-schema-contract.mjs（quality-gates.json api-response-schema-contract 的行为证据文件，precommit 链）
// @responsible: 契约可执行化地基——openapi.json components schema 单源 + Ajv 出站校验器（shadow 灰度）
// @inputs: contracts/http-api.openapi.json（唯一契约事实源，规则 9）、server/shared/api-schema-validator.cjs（新执法位）
// @outputs: validateComponentPayload / __getResponseSchemaProbe（shadow 灰度语义）
// @context: 规则 9 契约防腐链补「响应↔契约」执法层；错误明细语义对齐 RFC 9457 §3.2 errors[]/pointer（field=表单字段简化坐标系）。
//          ADR022 L3 确定性门禁 + ADR048 L2 行为测试。
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const OPENAPI_PATH = path.join(ROOT, "contracts", "http-api.openapi.json");
const VALIDATOR_PATH = path.join(ROOT, "server", "shared", "api-schema-validator.cjs");

function loadOpenapiComponents() {
  const doc = JSON.parse(fs.readFileSync(OPENAPI_PATH, "utf8"));
  return (doc && doc.components && doc.components.schemas) || null;
}

describe("EG-1a 契约可执行化地基（RED→GREEN）", () => {
  test("EG1A-1: components.schemas 含 BlockerDetail 且形状合规（RFC 9457 errors 语义）", () => {
    const schemas = loadOpenapiComponents();
    assert.ok(schemas, "openapi.json 缺 components.schemas");
    const blocker = schemas.BlockerDetail;
    assert.ok(blocker, "缺 BlockerDetail schema——写门阻断明细未在唯一契约事实源定型");
    assert.deepStrictEqual(
      [...(blocker.required || [])].sort(),
      ["field", "message", "ruleId"],
      "BlockerDetail.required 必须为 ruleId/field/message"
    );
    assert.strictEqual(blocker.additionalProperties, false, "BlockerDetail 必须 additionalProperties:false（漂移执法前提）");
    assert.ok(
      /RFC 9457|JSON Pointer/.test(blocker.properties.field.description || ""),
      "BlockerDetail.field.description 须标注 RFC 9457/JSON Pointer 定位语义"
    );
  });

  test("EG1A-2: components.schemas 含 WriteGateBlockersExtension（blockers 数组）", () => {
    const schemas = loadOpenapiComponents();
    const ext = schemas && schemas.WriteGateBlockersExtension;
    assert.ok(ext, "缺 WriteGateBlockersExtension schema");
    assert.strictEqual(ext.type, "object");
    assert.deepStrictEqual(ext.required, ["blockers"]);
    assert.strictEqual(ext.properties.blockers.type, "array", "blockers 必须为数组");
    assert.strictEqual(
      ext.properties.blockers.items && ext.properties.blockers.items.$ref,
      "#/components/schemas/BlockerDetail",
      "blockers.items 必须 $ref BlockerDetail（形状单源，禁止内联复制——规则 8）"
    );
  });

  test("EG1A-3: EntityRepairPostCheck 补登记 blockers（存量漂移修正：seq178 实证后端返回、契约漏登记）", () => {
    const schemas = loadOpenapiComponents();
    const postCheck = schemas && schemas.EntityRepairPostCheck;
    assert.ok(postCheck, "EntityRepairPostCheck schema 缺失");
    assert.ok(
      postCheck.properties && postCheck.properties.blockers,
      "EntityRepairPostCheck 缺 blockers 属性（entity-repair-service.cjs 实际返回，契约静默滞留——审计实证）"
    );
    assert.strictEqual(
      postCheck.properties.blockers.items && postCheck.properties.blockers.items.$ref,
      "#/components/schemas/BlockerDetail",
      "blockers.items 必须 $ref BlockerDetail"
    );
    assert.strictEqual(postCheck.additionalProperties, false, "EntityRepairPostCheck 必须 additionalProperties:false");
  });

  test("SEQ196-4: 契约推导校验器——路由表编译、模板匹配、状态码族选择", () => {
    assert.ok(fs.existsSync(VALIDATOR_PATH), "server/shared/api-schema-validator.cjs 不存在——响应出站校验执法位未建");
    const validator = require(VALIDATOR_PATH);
    assert.ok(validator.contractRouteCount >= 50, `契约推导路由数异常: ${validator.contractRouteCount}`);
    // 精确路由命中
    assert.ok(validator.matchRoute("get", "/api/anomalies"), "GET /api/anomalies 必须命中契约路由");
    // 模板参数通配（{issueId} ↔ 实际 id）
    assert.ok(validator.matchRoute("get", "/api/anomalies/some-id"), "参数化路由必须模板匹配");
    // method 不匹配不命中
    assert.strictEqual(validator.matchRoute("post", "/api/anomalies"), null, "method 维度必须参与匹配");
    // 契约外路由 → null（渐进语义：跳过不校验）
    assert.strictEqual(validator.matchRoute("get", "/api/nonexistent-route"), null, "契约外路由必须返回 null");
    // 状态码精确匹配：精确码命中；无精确码跳过（渐进语义——e2e 活阻断实证后修正）
    const route = validator.matchRoute("get", "/api/anomalies");
    assert.ok(validator.pickValidator(route, 200), "精确 200 schema 必须命中");
    assert.strictEqual(validator.pickValidator(route, 404), null, "未声明状态码必须跳过（族兜底会误拦合法 fail-closed 响应）");
  });

  test("SEQ196-5: enforce 探针语义——合规 pass / 违规 block / 契约外与渐进面 pass", () => {
    const validator = require(VALIDATOR_PATH);
    delete process.env.API_RESPONSE_SCHEMA_SHADOW;
    const probe = validator.createContractResponseProbe({ logger: { error() {}, warn() {} } });
    // 合规 envelope（真实形状，观测轮 PASS 样本同构）
    const okVerdict = probe("/api/kg/pending-review", "GET", 200, {
      success: true,
      data: { total: 0, pending: 0, approved: 0, edges: [], workingRevision: "sha256:" + "a".repeat(64) },
      trace_id: "tr_test",
    });
    assert.strictEqual(okVerdict.action, "pass", "合规载荷必须 pass");
    // 违规 payload → block + violations 非空
    const badVerdict = probe("/api/kg/pending-review", "GET", 200, { success: true, data: { wrong: true }, trace_id: "tr_test" });
    assert.strictEqual(badVerdict.action, "block", "违约载荷必须 block（enforce 语义）");
    assert.ok(badVerdict.violations.length > 0, "违规明细非空（RFC 9457 语义 errors）");
    // 契约外路由 → pass（渐进语义）
    assert.strictEqual(probe("/api/nonexistent-route", "GET", 200, {}).action, "pass");
  });

  test("SEQ196-6: 默认 enforce（未设 env=探针在位）+ 显式关闭（API_RESPONSE_SCHEMA_CHECK=0）", () => {
    const envelope = require(path.join(ROOT, "server", "shared", "api-envelope.cjs"));
    assert.strictEqual(typeof envelope.__getResponseSchemaProbe, "function", "api-envelope 需暴露 probe 访问器");
    delete process.env.API_RESPONSE_SCHEMA_CHECK;
    envelope.setResponseSchemaProbe(function () { return { action: "pass", violations: [] }; });
    try {
      const on = envelope.__getResponseSchemaProbe();
      assert.strictEqual(typeof on, "function", "seq196 语义：未设 env 时默认 enforce（探针在位）");
      process.env.API_RESPONSE_SCHEMA_CHECK = "0";
      assert.strictEqual(envelope.__getResponseSchemaProbe(), null, "=0 必须显式关闭");
    } finally {
      delete process.env.API_RESPONSE_SCHEMA_CHECK;
      envelope.setResponseSchemaProbe(null);
    }
  });

  test("SEQ196-6b: envelope enforce 端到端——违约 500 替换、合规照发、探针异常不波及、shadow 名单照发", async () => {
    // PR-085 第 1 步：探针由 http-app onSend 钩子承载——经真实传输层（inject）验证四种语义
    const envelope = require(path.join(ROOT, "server", "shared", "api-envelope.cjs"));
    const { createHttpApp } = require(path.join(ROOT, "server", "shared", "http-app.cjs"));
    const verdict = (action) => () => ({ action, violations: action === "block" ? [{ location: "x", message: "m", keyword: "required" }] : [] });
    let current = null;
    const http = createHttpApp({ cors: false });
    http.registerRoute("GET", "/api/kg/pending-review", (_req, res) => envelope.sendJSON(res, 200, current));
    const hit = () => http.app.inject({ method: "GET", url: "/api/kg/pending-review" });
    try {
      // 违约 → 500 INTERNAL_ERROR 替换（不外泄违约载荷）
      envelope.setResponseSchemaProbe(verdict("block"));
      current = { leak: true };
      const blocked = await hit();
      assert.strictEqual(blocked.statusCode, 500, "违约响应必须替换为 500");
      const body = blocked.json();
      assert.strictEqual(body.success, false, "阻断响应必须是失败 envelope");
      assert.strictEqual(body.error_code, "INTERNAL_ERROR", "阻断响应错误码必须 INTERNAL_ERROR（裁定①）");
      assert.strictEqual(body.data, undefined, "违约载荷不得外泄");
      // 合规 → 照发
      envelope.setResponseSchemaProbe(verdict("pass"));
      current = { marker: "original" };
      const passed = await hit();
      assert.strictEqual(passed.statusCode, 200, "合规响应必须照发");
      assert.strictEqual(passed.json().data.marker, "original", "合规载荷原样外发");
      // 探针异常 → 响应链路不受影响
      envelope.setResponseSchemaProbe(() => { throw new Error("probe crash"); });
      current = { ok: true };
      const crashed = await hit();
      assert.strictEqual(crashed.statusCode, 200, "探针异常不波及响应链路");
      // shadow 名单（探针内判定——名单命中返回 pass）
      process.env.API_RESPONSE_SCHEMA_SHADOW = "/api/kg/pending-review";
      const validator = require(VALIDATOR_PATH);
      const shadowProbe = validator.createContractResponseProbe({ logger: { error() {}, warn() {} } });
      const shadowVerdict = shadowProbe("/api/kg/pending-review", "GET", 200, { success: true, data: { wrong: true }, trace_id: "tr_x" });
      assert.strictEqual(shadowVerdict.action, "pass", "shadow 名单端点违例必须照发（ADR060 §5 可单独回退）");
    } finally {
      delete process.env.API_RESPONSE_SCHEMA_CHECK;
      delete process.env.API_RESPONSE_SCHEMA_SHADOW;
      envelope.setResponseSchemaProbe(null);
      await http.close();
    }
  });
});
