const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const YAML = require("yaml");
const routes = require("../enums-routes.cjs");
const { createSchemaWriteService } = require("../../services/schema-manager/schema-write-service.cjs");
const { createRouteHarness, mergeW1aActionTypes, setupActionRuntime, teardownActionRuntime } = require("./helpers/route-harness.cjs");
const { createAuthStack } = require("../../shared/auth/auth-stack.cjs");
const { createPrincipal } = require("../../shared/auth/principal.cjs");
const { createRoleRegistry } = require("../../shared/auth/role-registry.cjs");
const { getDecisionsLogPath } = require("../../vault-paths.cjs");

function makeHarness() {
  const stack = createAuthStack({
    mode: "oidc",
    methods: [{
      name: "test-header",
      authenticate(request) {
        const operatorId = request.headers["x-test-operator"];
        if (!operatorId) return { status: "not-applicable" };
        return { status: "authenticated", principal: createPrincipal({ operatorId, roles: [], assurance: "verified", channel: "web" }) };
      },
    }],
  });
  return createRouteHarness({
    cors: false,
    auth: {
      mode: "oidc",
      stack,
      cors: false,
      roleRegistry: createRoleRegistry({
        defaults: { authenticated: ["submit"] },
        entries: [
          { operatorId: "module-admin", roles: ["admin"] },
          { operatorId: "module-reviewer", roles: ["review"] },
        ],
      }),
    },
  });
}

function call(harness, target, body, operatorId = "module-admin") {
  const [method, template] = target.split(/\s+/);
  return harness.request({ method, url: template }, {
    params: { moduleId: body?.moduleId || "结算" },
    body,
    headers: { "x-test-operator": operatorId },
  });
}

test("U3 模块 HTTP 动作：角色、OCC、幂等追加、审计与拒绝不落盘", async () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "wp233-module-http-"));
  const schemaDir = path.join(vaultPath, "知识库", "TheSchema");
  fs.mkdirSync(schemaDir, { recursive: true });
  const previousTheschemaDir = process.env.THESCHEMA_DIR;
  process.env.THESCHEMA_DIR = schemaDir;
  const enumsPath = path.join(schemaDir, "enums.yaml");
  fs.writeFileSync(enumsPath, YAML.stringify({
    domains: { finance: "财务" },
    subdomains: { finance: [{ id: "settlement", label: "结算" }] },
    layers: [],
    arch_categories: [],
    article_types: [],
    doc_types: [],
    modules: {},
  }));
  mergeW1aActionTypes(path.join(schemaDir, "ontology.yaml"));
  setupActionRuntime({ vaultPath });
  const harness = makeHarness();
  const ledger = [];
  const graphWrites = [];
  const service = createSchemaWriteService({
    vaultPath,
    logger: null,
    gitLedger: { scheduleLedger: (...args) => ledger.push(args) },
    onGraphInputWrite: (event) => graphWrites.push(event),
  });
  routes.register(harness.registerRoute, { vaultPath, schemaWriteService: service });
  try {
    const read = () => YAML.parse(fs.readFileSync(enumsPath, "utf8"));
    const revision = () => "sha256:" + require("node:crypto").createHash("sha256").update(fs.readFileSync(enumsPath)).digest("hex");
    const initial = revision();
    const definition = { system: "settlement-service", subdomain: "settlement", parent_id: "", since: "7.0.0", until: "", products: [], description: "U3 样板" };

    const denied = await call(harness, "PUT /api/schema/modules/:moduleId", { revision: initial, definition }, "module-reviewer");
    assert.equal(denied.status, 403, JSON.stringify(denied.body));
    assert.equal(denied.body.error_code, "ROLE_DENIED");
    assert.deepEqual(read().modules, {});
    assert.equal(revision(), initial);

    const created = await call(harness, "PUT /api/schema/modules/:moduleId", { revision: initial, definition });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    assert.equal(created.body.data.moduleId, "结算");
    assert.equal(read().modules["结算"].description, "U3 样板");
    assert.equal(ledger.length, 1);
    assert.match(ledger[0][1], /模块保存 结算/);
    assert.deepEqual(ledger[0][2], [enumsPath], "账车只收实际 enums 文件，不带已退役快照目录");

    const afterCreate = revision();
    const beforeConflict = fs.readFileSync(enumsPath);
    const conflict = await call(harness, "PUT /api/schema/modules/:moduleId", { revision: initial, definition: { ...definition, description: "陈旧修改" } });
    assert.equal(conflict.status, 409, JSON.stringify(conflict.body));
    assert.equal(conflict.body.error_code, "ENUMS_REVISION_CONFLICT");
    assert.deepEqual(fs.readFileSync(enumsPath), beforeConflict);

    const appended = await harness.call("POST /api/schema/enums/append", "/api/schema/enums/append", {
      revision: afterCreate,
      moduleId: "结算",
      value: "产品A",
    }, { "x-test-operator": "module-admin" });
    assert.equal(appended.status, 200, JSON.stringify(appended.body));
    assert.equal(appended.body.data.appended, true);
    assert.deepEqual(read().modules["结算"].products, ["产品A"]);

    const afterAppend = revision();
    const repeated = await harness.call("POST /api/schema/enums/append", "/api/schema/enums/append", {
      revision: afterAppend,
      moduleId: "结算",
      value: "产品A",
    }, { "x-test-operator": "module-admin" });
    assert.equal(repeated.status, 200, JSON.stringify(repeated.body));
    assert.equal(repeated.body.data.appended, false);
    assert.equal(revision(), afterAppend);
    assert.deepEqual(read().modules["结算"].products, ["产品A"]);

    const beforeMissing = fs.readFileSync(enumsPath);
    const missing = await harness.call("POST /api/schema/enums/append", "/api/schema/enums/append", {
      revision: afterAppend,
      moduleId: "不存在",
      value: "产品B",
    }, { "x-test-operator": "module-admin" });
    assert.equal(missing.status, 400, JSON.stringify(missing.body));
    assert.equal(missing.body.error_code, "VALIDATION_ERROR");
    assert.deepEqual(fs.readFileSync(enumsPath), beforeMissing);

    const beforePrototype = fs.readFileSync(enumsPath);
    const prototypeUpsert = await call(harness, "PUT /api/schema/modules/:moduleId", {
      revision: afterAppend,
      moduleId: "__proto__",
      definition,
    });
    assert.equal(prototypeUpsert.status, 400, JSON.stringify(prototypeUpsert.body));
    assert.equal(prototypeUpsert.body.error_code, "VALIDATION_ERROR");
    const prototypeAppend = await harness.call("POST /api/schema/enums/append", "/api/schema/enums/append", {
      revision: afterAppend,
      moduleId: "__proto__",
      value: "产品B",
    }, { "x-test-operator": "module-admin" });
    assert.equal(prototypeAppend.status, 400, JSON.stringify(prototypeAppend.body));
    assert.equal(prototypeAppend.body.error_code, "VALIDATION_ERROR");
    assert.deepEqual(fs.readFileSync(enumsPath), beforePrototype);

    const legacyData = read();
    legacyData.modules["旧模块"] = { system: "旧系统", subdomain: "maintain", products: "legacy-product" };
    fs.writeFileSync(enumsPath, YAML.stringify(legacyData));
    const beforeLegacy = fs.readFileSync(enumsPath);
    const legacyAppend = await harness.call("POST /api/schema/enums/append", "/api/schema/enums/append", {
      revision: revision(),
      moduleId: "旧模块",
      value: "2.0.0",
    }, { "x-test-operator": "module-admin" });
    assert.equal(legacyAppend.status, 400, JSON.stringify(legacyAppend.body));
    assert.equal(legacyAppend.body.error_code, "VALIDATION_ERROR");
    assert.match(legacyAppend.body.message, /products/);
    assert.deepEqual(fs.readFileSync(enumsPath), beforeLegacy);

    const auditPath = getDecisionsLogPath(vaultPath);
    const events = fs.readFileSync(auditPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    const successes = events.filter((event) => event.kind === "ontology_action" && event.outcome === "success");
    assert.deepEqual(successes.map((event) => event.action_id), ["schema.modules.upsert", "schema.enums.append", "schema.enums.append"]);
    assert.ok(successes.every((event) => event.operator_id === "module-admin"));
    assert.ok(successes.every((event) => event.input_revision && event.output_revision));
    assert.deepEqual(graphWrites.map((event) => [event.category, event.source]), [
      ["enums", "modules-upsert"],
      ["enums", "enum-append"],
      ["enums", "enum-append"],
    ]);
    assert.ok(events.some((event) => event.action_id === "schema.modules.upsert" && event.outcome === "failed" && event.error_code === "ENUMS_REVISION_CONFLICT"));
    assert.equal(events.some((event) => event.module_id === "__proto__" && event.outcome === "success"), false);
  } finally {
    await harness.close();
    teardownActionRuntime();
    if (previousTheschemaDir === undefined) delete process.env.THESCHEMA_DIR;
    else process.env.THESCHEMA_DIR = previousTheschemaDir;
    fs.rmSync(vaultPath, { recursive: true, force: true });
  }
});
