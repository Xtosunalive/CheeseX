// Component: Entity-Repair-Routes Tests
// @responsible: 验证 preview/apply HTTP 编排、包络与错误状态映射。
// @inputs: 注入式 repair service；经 route-harness（Fastify inject）走完整传输层（契约推导校验→handler→封套→onSend 探针）
// @outputs: 路由响应断言
// @context: Pipeline

const assert = require("assert");
const routes = require("../entity-compliance-routes.cjs");
const { createRouteHarness, setupActionRuntime } = require("./helpers/route-harness.cjs"); // WP-048 W1-B：repair/apply 已动作化
const fs0 = require("node:fs"); const os0 = require("node:os"); const path0 = require("node:path");
setupActionRuntime({ vaultPath: fs0.mkdtempSync(path0.join(os0.tmpdir(), "entity-repair-actions-")) });

function harnessFor(service) {
  const h = createRouteHarness();
  routes.register(h.registerRoute, { vaultPath: "/unused", repairService: service });
  return h;
}

(async function run() {
  const h = harnessFor({
    preview(payload) { return { previewId: "p1", sourceKey: payload.sourceKey, changedFields: ["module"], postCheck: { blockerCount: 0, warningCount: 0 }, expiresAt: new Date().toISOString(), beforeFrontmatter: "", afterFrontmatter: "" }; },
    apply(input) { return { entityId: "x", writtenFields: ["module"], sourceRevision: { contentHash: "sha256:x", size: 10, mtimeMs: 1 } }; },
  });
  let res = await h.call("POST /api/entity/repair/preview", undefined, { sourceKey: "x" });
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body)); assert.strictEqual(res.body.success, true); assert.strictEqual(res.body.data.previewId, "p1");
  res = await h.call("POST /api/entity/repair/apply", undefined, { previewId: "p1", confirmed: true });
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body)); assert.strictEqual(res.body.success, true);
  assert.deepStrictEqual(res.body.data.writtenFields, ["module"]);

  // 业务错误 status/code 透传（契约合法载荷使请求抵达 service；service 抛出 → 错误处理器承载）
  for (const sample of [
    [400, "VALIDATION_ERROR"], [404, "SOURCE_NOT_FOUND"], [409, "SOURCE_CHANGED"], [422, "POST_CHECK_REGRESSION"], [500, "WRITE_FAILED"],
  ]) {
    const failing = harnessFor({ preview() { const e = new Error(sample[1]); e.code = sample[1]; e.status = sample[0]; throw e; }, apply() { throw new Error("unused"); } });
    res = await failing.call("POST /api/entity/repair/preview", undefined, { sourceKey: "x" });
    assert.strictEqual(res.statusCode, sample[0], sample[1] + " → " + JSON.stringify(res.body)); assert.strictEqual(res.body.error_code, sample[1]);
  }
  // 非法 JSON 由传输层拒绝（FST_ERR_CTP_INVALID_JSON_BODY → 400 VALIDATION_ERROR）
  res = await h.request("POST /api/entity/repair/preview", { rawBody: "{bad" });
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.error_code, "VALIDATION_ERROR");
  await h.close();
  console.log("Entity repair route tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });

// seq181：字段级校验错误必须携带 details.field 归因（validateChanges 14 处字段级抛点）——
// preview 被拒通道的错误响应从「笼统 message」升级为「机器可归因」，前端 extractFieldBlocker
// 据此行内回显。用真实 repairService + 临时 Vault 走 preview，断言三个代表点的 details 形状。
const { createEntityRepairService: _ce } = require("../../services/entity-compliance/entity-repair-service.cjs");
const _rules = {
  archLayers: ["service"], archCategories: ["服务"], statuses: ["有效"], moduleNames: ["Fixture模块"],
  articleTypes: ["最佳实践"], docTypes: ["用户手册"], categoryPaths: ["ops.maintain"], products: ["AnyShare"],
  versionsByProduct: { AnyShare: ["7.0.0.0"] }, layerAliases: {}, categoryAliases: {}, wikilinkTypeLabels: {},
  versionableRelations: new Set(), wikilinkRelations: new Set(), allRegisteredVersions: ["7.0.0.0"],
};
(async () => {
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "seq181-"));
  setupActionRuntime({ vaultPath: vault }); // WP-048 W1-B：真服务块——通道随本库（防缺省库错位）
  fs.mkdirSync(path.join(vault, "知识库", "wiki", "entities"), { recursive: true });
  const service = _ce({ vaultPath: vault, ruleSetProvider: () => _rules });
  const cases = [
    [{ sourceKey: "知识库/wiki/entities/demo.md", createIfMissing: true, initialTitle: "t", changes: { arch_until: "not-a-version" } }, { field: "arch_until", rule: "semver" }],
    [{ sourceKey: "知识库/wiki/entities/demo.md", createIfMissing: true, initialTitle: "t", changes: { arch_layer: "not-a-layer" } }, { field: "arch_layer", rule: "enum" }],
    [{ sourceKey: "知识库/wiki/entities/demo.md", createIfMissing: true, initialTitle: "t", changes: { arch_component: "yes" } }, { field: "arch_component", rule: "boolean" }],
  ];
  for (const [payload, expected] of cases) {
    try {
      await service.preview(payload);
      assert.fail("should throw: " + JSON.stringify(expected));
    } catch (e) {
      assert.equal(e.code, "VALIDATION_ERROR", e.message);
      assert.equal(e.status, 400);
      assert.deepEqual({ field: e.details && e.details.field, rule: e.details && e.details.rule }, expected);
    }
  }
  fs.rmSync(vault, { recursive: true, force: true });
  console.log("seq181 field-attribution: 3 representative points OK");
})();

// ── PR-012：preview/apply 409 三码族（SOURCE_CHANGED / PREVIEW_EXPIRED / REGISTRY_CHANGED）契约登记后的出站行为证明 ──
// 背景：三码此前未登记在两端点 409 anyOf，被 seq196 出站 enforce 探针整包改写 500 INTERNAL_ERROR（#1592 链路）。
// 本块按 main.cjs 同参接线真实契约探针（setResponseSchemaProbe(createContractResponseProbe(...))）——PR-085 第 1 步起探针
// 由 http-app onSend 钩子承载，经 route-harness 走到的即生产同一执法位；用真实 repairService + 临时 Vault 走 HTTP 层，
// 断言 409 原样直达客户端（status 不被翻转、error_code 保留）。
(async () => {
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const { setResponseSchemaProbe } = require("../../shared/api-envelope.cjs");
  const { createContractResponseProbe } = require("../../shared/api-schema-validator.cjs");

  // 契约探针接线（与 server/main.cjs 同参；测试文件独立进程，模块级单例无串扰）
  setResponseSchemaProbe(createContractResponseProbe({ logger: { error() {}, warn() {} } }));
  try {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), "pr012-"));
    setupActionRuntime({ vaultPath: vault }); // WP-048 W1-B：真服务块——通道随本库
    fs.mkdirSync(path.join(vault, "知识库", "wiki", "entities"), { recursive: true });
    const sourceKey = "知识库/wiki/entities/pr012.md";
    fs.writeFileSync(path.join(vault, sourceKey), "---\n---\n\n# PR012\n");
    const service = _ce({ vaultPath: vault, ruleSetProvider: () => _rules });
    const h = harnessFor(service);

    // ① preview：已存在实体 + 不带 sourceRevision → 409 SOURCE_CHANGED 直达（非 500 enforce 改写）
    let res = await h.call("POST /api/entity/repair/preview", undefined, { sourceKey });
    assert.strictEqual(res.statusCode, 409, "preview 409 必须直达客户端，不得被出站 enforce 翻转为 500：" + JSON.stringify(res.body));
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.error_code, "SOURCE_CHANGED");
    assert.ok(typeof res.body.message === "string" && res.body.message.length > 0);
    assert.ok(typeof res.body.trace_id === "string");

    // ② apply：不存在/过期的 previewId → 409 PREVIEW_EXPIRED 直达
    res = await h.call("POST /api/entity/repair/apply", undefined, { previewId: "pr012-nonexistent", confirmed: true });
    assert.strictEqual(res.statusCode, 409, "apply 409 必须直达客户端，不得被出站 enforce 翻转为 500：" + JSON.stringify(res.body));
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.error_code, "PREVIEW_EXPIRED");
    assert.ok(typeof res.body.message === "string" && res.body.message.length > 0);

    // ③ REGISTRY_CHANGED 无轻量 HTTP 触发路径（需 relationPatch preview + 改 ontology.yaml），
    //    以探针直查替代：envelope 形状（allOf ApiError + error_code 枚举）必须在两端点 409 契约下放行。
    const registryBody = { success: false, error: "本体或版本注册表已变化，请重新预览", error_code: "REGISTRY_CHANGED", message: "本体或版本注册表已变化，请重新预览", trace_id: "pr012-t" };
    for (const url of ["/api/entity/repair/apply"]) {
      const verdict = createContractResponseProbe({ logger: { error() {}, warn() {} } })(url, "POST", 409, registryBody);
      assert.strictEqual(verdict.action, "pass", url + " 409 REGISTRY_CHANGED envelope 必须被契约放行（action=pass）");
    }
    // 对照：契约外错误码仍须被执法位拦截（证明探针活着，①②不是「探针没接上」的假绿）
    const rogue = { success: false, error: "x", error_code: "PR012_ROGUE_CODE", message: "x", trace_id: "t" };
    const rogueVerdict = createContractResponseProbe({ logger: { error() {}, warn() {} } })("/api/entity/repair/apply", "POST", 409, rogue);
    assert.strictEqual(rogueVerdict.action, "block", "未登记错误码必须被 enforce 拦截（探针有效性对照）");

    await h.close();
    fs.rmSync(vault, { recursive: true, force: true });
    console.log("PR-012 409 three-code family: preview SOURCE_CHANGED / apply PREVIEW_EXPIRED / probe REGISTRY_CHANGED OK");
  } finally {
    // 还原模块级探针单例，避免影响同进程后续块
    setResponseSchemaProbe(null);
  }
})();
