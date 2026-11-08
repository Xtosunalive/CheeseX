// @contract ReviewStatus: "approved" | "pending" | "rejected"
// @see contracts/http-api.openapi.json#/components/schemas/ReviewStatus
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const YAML = require("yaml");
const { createVersionRegistryService } = require("../../pipeline/version-registry-service.cjs");
const { createChangeDispositionService } = require("../../governance/change-disposition-service.cjs");
const { detectRuleConflicts } = require("../../inference/inference-rule-conflicts.cjs");
const { createInferenceDecisionConsumer } = require("../../inference/inference-decision-consumer.cjs");
const { readEnums, writeArchitectureProjectionIdentity } = require("../enums-write-service.cjs");

function fixture() {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "version-registry-")); process.env.THESCHEMA_DIR = path.join(vaultPath, "知识库", "TheSchema"); // SPEC-023 波 3 钉扎
  const schemaPath = path.join(vaultPath, "知识库", "TheSchema");
  fs.mkdirSync(schemaPath, { recursive: true });
  fs.writeFileSync(path.join(schemaPath, "enums.yaml"), YAML.stringify({ architecture_projection: { product: "AnyShare", version: "master", product_aliases: { AS: "AnyShare" } } }));
  return vaultPath;
}

function draftRegistry() {
  return {
    schema_version: 1,
    products: {
      AnyShare: {
        versions: [
          { id: "7.0.10", label: "AnyShare 7.0.10", status: "draft", release_date: null, aliases: [], snapshot: null },
          { id: "v07.0.2", label: "AnyShare 7.0.2", status: "draft", release_date: null, aliases: ["AS-702"], snapshot: null },
        ],
      },
    },
  };
}

function serviceFor(vaultPath, overrides = {}) {
  return createVersionRegistryService({
    vaultPath,
    now: () => new Date("2026-07-18T08:00:00.000Z"),
    projectVersion: () => ({
      _format_version: "1.0",
      _generated_for_version: "7.0.2",
      product: "AnyShare",
      components: [{ id: "gateway", layer: "gateway", category: "服务" }],
      dependencies: [],
    }),
    readEnums,
    writeArchitectureProjectionIdentity,
    ...overrides,
  });
}

test("returns an empty valid registry when versions.yaml does not exist", async function (t) {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  const result = serviceFor(vaultPath).getRegistry();
  assert.equal(result.schema_version, 1);
  assert.equal(Object.keys(result.products).length, 0); // WP-050：装载产物 null 原型——按键集断言
  assert.equal(result.summary.totalVersions, 0);
  assert.match(result.revision, /^sha256:/);
});

test("writes normalized sorted versions and rejects stale revisions", async function (t) {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  const service = serviceFor(vaultPath);
  const current = service.getRegistry();
  const written = service.writeRegistry(current.revision, draftRegistry());
  assert.deepEqual(written.products.AnyShare.versions.map((item) => item.id), ["7.0.2", "7.0.10"]);
  assert.throws(() => service.writeRegistry(current.revision, draftRegistry()), { code: "VERSIONS_REVISION_CONFLICT" });
  // PR-201 码面分离红例：缺基线 400（原与过期混报 409）
  assert.throws(() => service.writeRegistry(undefined, draftRegistry()), (e) => e.code === "SCHEMA_REVISION_REQUIRED" && e.status === 400, "writeRegistry 缺基线应 400 而非 409 混报");
  assert.throws(() => service.writeRegistry("", draftRegistry()), (e) => e.code === "SCHEMA_REVISION_REQUIRED", "空串同缺基线");
  // PR-201 红队洞 3 补：freezeVersion 缺基线同样 400（原零红例）
  await assert.rejects(() => service.freezeVersion(undefined, "测试产品", "1.0"), (e) => e.code === "SCHEMA_REVISION_REQUIRED" && e.status === 400, "freezeVersion 缺基线应 400");
  await assert.rejects(() => service.freezeVersion("", "测试产品", "1.0"), (e) => e.code === "SCHEMA_REVISION_REQUIRED", "freezeVersion 空串同缺基线");
});

test("canonicalizes configured product aliases before exposing versions to architecture projection", async function (t) {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  const service = serviceFor(vaultPath);
  const payload = draftRegistry();
  payload.products.As = payload.products.AnyShare;
  delete payload.products.AnyShare;
  const written = service.writeRegistry(service.getRegistry().revision, payload);
  assert.deepEqual(Object.keys(written.products), ["AnyShare"]);
  assert.equal(written.products.AnyShare.versions.length, 2);
  const persisted = YAML.parse(fs.readFileSync(path.join(vaultPath, "知识库", "TheSchema", "versions.yaml"), "utf8"));
  assert.deepEqual(Object.keys(persisted.products), ["AnyShare"]);
});

test("reads and updates aliases for the authoritative architecture product", async function (t) {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  const service = serviceFor(vaultPath);
  const current = service.getProductIdentity();
  assert.equal(current.canonicalProduct, "AnyShare");
  assert.deepEqual(current.aliases, ["AS"]);
  const written = service.writeProductIdentity(current.revision, ["as", "AnyShare Enterprise"]);
  assert.deepEqual(written.aliases, ["AnyShare Enterprise", "as"]);
  const enums = YAML.parse(fs.readFileSync(path.join(vaultPath, "知识库", "TheSchema", "enums.yaml"), "utf8"));
  assert.deepEqual(enums.architecture_projection.product_aliases, { "AnyShare Enterprise": "AnyShare", as: "AnyShare" });
  assert.throws(() => service.writeProductIdentity(written.revision, ["AnyShare"]), { code: "INVALID_PRODUCT_ALIAS" });
});

test("first-set of canonical product from empty state writes the anchor (IDENTITY_ANCHOR_IMMUTABLE 批 2026-10-27)", async function (t) {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  // 归档清空态：product 置空串（空态死锁的现场形态——此前读出什么写回什么，无入口可设定）
  const enumsFile = path.join(vaultPath, "知识库", "TheSchema", "enums.yaml");
  fs.writeFileSync(enumsFile, YAML.stringify({ architecture_projection: { product: "", version: "master", product_aliases: {} } }));
  const service = serviceFor(vaultPath);
  const current = service.getProductIdentity();
  assert.equal(current.canonicalProduct, null);
  const written = service.writeProductIdentity(current.revision, ["As"], "AnyShare");
  assert.equal(written.canonicalProduct, "AnyShare");
  assert.deepEqual(written.aliases, ["As"]);
  const enums = YAML.parse(fs.readFileSync(enumsFile, "utf8"));
  assert.equal(enums.architecture_projection.product, "AnyShare");
  assert.deepEqual(enums.architecture_projection.product_aliases, { As: "AnyShare" });
});

test("renaming a set canonical anchor is rejected with 409 IDENTITY_ANCHOR_IMMUTABLE", async function (t) {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  const service = serviceFor(vaultPath);
  const current = service.getProductIdentity();
  assert.equal(current.canonicalProduct, "AnyShare");
  assert.throws(() => service.writeProductIdentity(current.revision, ["AS"], "OtherProduct"), (error) => {
    assert.equal(error.code, "IDENTITY_ANCHOR_IMMUTABLE");
    assert.equal(error.status, 409);
    return true;
  });
});

test("configured branch returns contract-required fields (响应探针热修回归钉)", async function (t) {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  const service = serviceFor(vaultPath);
  const identity = service.getProductIdentity();
  assert.equal(identity.canonicalProduct, "AnyShare");
  assert.equal(identity.configured, true);
  assert.equal(typeof identity.note, "string");
});

test("rejects released entries without immutable snapshots", async function (t) {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  const service = serviceFor(vaultPath);
  const payload = draftRegistry();
  payload.products.AnyShare.versions[0].status = "released";
  const result = service.validateRegistryPayload(payload);
  assert.equal(result.summary.errors, 1);
  assert(result.diagnostics.some((item) => item.code === "RELEASED_SNAPSHOT_REQUIRED"));
});

test("freezes a draft projection before marking the registry entry released", async function (t) {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  const service = serviceFor(vaultPath);
  const saved = service.writeRegistry(service.getRegistry().revision, draftRegistry());
  const frozen = await service.freezeVersion(saved.revision, "AnyShare", "7.0.2"); // PR-056
  const entry = frozen.products.AnyShare.versions.find((item) => item.id === "7.0.2");
  assert.equal(entry.status, "released");
  assert.equal(entry.release_date, "2026-07-18");
  assert.match(entry.snapshot.sha256, /^sha256:[0-9a-f]{64}$/);
  const absolute = path.join(vaultPath, ...entry.snapshot.path.split("/"));
  const raw = fs.readFileSync(absolute, "utf8");
  assert.equal("sha256:" + crypto.createHash("sha256").update(raw).digest("hex"), entry.snapshot.sha256);
  const snapshot = JSON.parse(raw);
  assert.equal(snapshot.product, "AnyShare");
  assert.equal(snapshot.version, "7.0.2");
  assert.equal(snapshot.components[0].id, "gateway");
  // PR-152：冻结时刻成对补写投影身份——Release 消费端要求 architecture_projection
  // product/version 两者都要有或都无（ADR-009）；注册口只写 product，冻结口在此补 version。
  const enumsAfter = YAML.parse(fs.readFileSync(path.join(vaultPath, "知识库", "TheSchema", "enums.yaml"), "utf8"));
  assert.equal(enumsAfter.architecture_projection.product, "AnyShare");
  assert.equal(enumsAfter.architecture_projection.version, "7.0.2");
  await assert.rejects(() => service.freezeVersion(frozen.revision, "AnyShare", "7.0.2"), { code: "VERSION_ALREADY_RELEASED" }); // PR-056
});

test("does not change the registry or leave a snapshot when projection validation fails", async function (t) {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  const service = serviceFor(vaultPath, { projectVersion: () => ({ product: "AnyShare", components: null, dependencies: [] }) });
  const saved = service.writeRegistry(service.getRegistry().revision, draftRegistry());
  const registryPath = path.join(vaultPath, "知识库", "TheSchema", "versions.yaml");
  const before = fs.readFileSync(registryPath, "utf8");
  await assert.rejects(() => service.freezeVersion(saved.revision, "AnyShare", "7.0.2"), { code: "INVALID_VERSION_PROJECTION" }); // PR-056：freezeVersion 异步化
  assert.equal(fs.readFileSync(registryPath, "utf8"), before);
  assert.equal(fs.existsSync(path.join(vaultPath, "知识库", "architecture", "AnyShare", "7.0.2", "architecture-version.snapshot.json")), false);
});

test("blocks version freeze before snapshot write when reasoning requires review", async function (t) {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  const service = serviceFor(vaultPath, {
    projectVersion: () => ({
      _format_version: "1.0",
      _generated_for_version: "7.0.2",
      product: "AnyShare",
      components: [{ id: "gateway", layer: "gateway", category: "服务" }],
      dependencies: [{ source: "gateway", target: "auth", reviewStatus: "pending" }],
    }),
    changeDispositionService: createChangeDispositionService({ conflictDetector: detectRuleConflicts, decisionConsumer: createInferenceDecisionConsumer() }),
  });
  const saved = service.writeRegistry(service.getRegistry().revision, draftRegistry());
  await assert.rejects(() => service.freezeVersion(saved.revision, "AnyShare", "7.0.2"), (error) => error.code === "REASONING_CONFLICT_UNRESOLVED" && error.status === 409); // PR-056
  assert.equal(fs.existsSync(path.join(vaultPath, "知识库", "architecture", "AnyShare", "7.0.2", "architecture-version.snapshot.json")), false);
  assert.equal(service.getRegistry().products.AnyShare.versions.find((item) => item.id === "7.0.2").status, "draft");
});

test("prevents mutation of an already released registry entry", async function (t) {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  const service = serviceFor(vaultPath);
  const saved = service.writeRegistry(service.getRegistry().revision, draftRegistry());
  const frozen = await service.freezeVersion(saved.revision, "AnyShare", "7.0.2"); // PR-056
  const changed = { schema_version: frozen.schema_version, products: structuredClone(frozen.products) };
  changed.products.AnyShare.versions.find((item) => item.id === "7.0.2").label = "changed";
  assert.throws(() => service.writeRegistry(frozen.revision, changed), { code: "RELEASED_VERSION_IMMUTABLE" });
});

// WP-049 L3 第四拉起点（2026-11-01 实测缺口）：createPythonProjector 真实拉起此前零覆盖
//（既有测试全部注入 projectVersion 桩）——信封未物化致冻结链路自 WP-049 上线起即死。
// 本测经 VAULT_RUNTIME_SCRIPTS_DIR＋PYTHON_PATH 双接缝走真实 spawn：被测对象＝「拉起前信封
// 已物化＋VOCAB_ENVELOPE_PATH 已下发」，投影本体由注入桩层其他测试覆盖。
test("createPythonProjector materializes the vocab envelope and hands VOCAB_ENVELOPE_PATH to the spawn", async function (t) {
  const vaultPath = fixture();
  const scriptsDir = fs.mkdtempSync(path.join(path.dirname(vaultPath), "projector-scripts-"));
  // 解释器经 PYTHON_PATH 指向 node——「generate-sa.py」即 node 脚本：回显拉起 env 关键位
  fs.writeFileSync(path.join(scriptsDir, "generate-sa.py"),
    'process.stdout.write(JSON.stringify({ envelope: process.env.VOCAB_ENVELOPE_PATH || null, product: process.env.ARCH_PRODUCT || null, dataDir: process.env.KB_DATA_DIR || null }));\n');
  const saved = { PYTHON_PATH: process.env.PYTHON_PATH, VAULT_RUNTIME_SCRIPTS_DIR: process.env.VAULT_RUNTIME_SCRIPTS_DIR };
  process.env.PYTHON_PATH = process.execPath;
  process.env.VAULT_RUNTIME_SCRIPTS_DIR = scriptsDir;
  t.after(() => {
    fs.rmSync(vaultPath, { recursive: true, force: true });
    fs.rmSync(scriptsDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });

  const { createPythonProjector } = require("../../pipeline/version-registry-service.cjs");
  const projection = await createPythonProjector({ vaultPath })("AnyShare", "1.0");
  assert.equal(projection.product, "AnyShare", "拉起 env 必须携带 ARCH_PRODUCT（真实 spawn 证据）");
  assert.ok(projection.dataDir, "拉起 env 必须携带 KB_DATA_DIR（SPEC-012 运行时状态库住址——批跑器钉 tmp 槽时携钉扎值，无钉扎时回落仓内 data/）");
  assert.ok(projection.envelope, "VOCAB_ENVELOPE_PATH 必须下发");
  assert.ok(fs.existsSync(projection.envelope), "信封文件必须在拉起前已物化");
  assert.ok(projection.envelope.startsWith(vaultPath), "信封必须落在该库运行时槽内");
  const envelopeBody = JSON.parse(fs.readFileSync(projection.envelope, "utf8"));
  assert.ok(envelopeBody.files && envelopeBody.files.enums, "信封必须携带词表载荷");
});

// PR-170 回归钉（2026-11-01）：双空身份合法空态＋注册表非空 → 读面照常（原实现经
// canonicalizeRegistryProducts→resolveArchitectureProduct 严格取锚点抛错，规则集/版本表空态集体 500）。
// Master 裁决「空态返回空汇总」修复批：别名归一无锚点即原样通过（见 schema-config resolveArchitectureProduct）。
test("returns the registry untouched when projection identity is unmounted", function (t) {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  const enumsPath = path.join(vaultPath, "知识库", "TheSchema", "enums.yaml");
  const enums = YAML.parse(fs.readFileSync(enumsPath, "utf8"));
  enums.architecture_projection.product = "";
  enums.architecture_projection.version = "";
  fs.writeFileSync(enumsPath, YAML.stringify(enums));
  const service = serviceFor(vaultPath);
  const written = service.writeRegistry(service.getRegistry().revision, draftRegistry());
  assert.deepEqual(Object.keys(written.products).sort(), ["AnyShare"], "空态下注册表读面照常（产品名原样保留）");
  assert.equal(written.summary.totalProducts, 1);
});
