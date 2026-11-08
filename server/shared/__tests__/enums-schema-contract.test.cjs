// Component: Enums-Schema-Read-Write-Contract Tests（PR-052）
// @responsible: 验证 enums.yaml 形态单一事实源（contracts/enums.schema.json + Ajv）在读侧/写侧的行为契约：
//   破坏实验① PR-049 原始脏值（tag_aliases 标量）→ 读侧无损转化 + 留痕，不瘫
//   破坏实验② 真类型错误（数字）→ 局部降级 + warn，不抛 500
//   破坏实验③ 脏 policy（allowed_categories 标量）→ 局部降级，脏值不入并集（A 口径：不补全）
//   破坏实验④ 写侧非规范序列化 → 落盘前被拒（400，文件未变）
//   破坏实验⑤ 绕过写侧闸门的非规范落盘 → 落盘后自校验告警（enums-write-noncanonical）
//   既有行为：validateStringMap 由 schema 派生且签名/行为不变；真实库与测试 fixture 严格校验零错
// @inputs: contracts/enums.schema.json、server/shared/enums-loader.cjs、enums-write-service.cjs
// @outputs: 单元/集成测试断言结果
// @context: Schema-Manager

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const YAML = require("yaml");

const { buildRuleSet, normalizeEnums, validateEnumsStrict } = require("../enums-loader.cjs");
const { readEnums, writeEnums } = require("../../services/schema-manager/enums-write-service.cjs");
const { validateStringMap } = require("../../services/schema-manager/schema-validators.cjs");

// 本文件位于 server/shared/__tests__/ → 仓根需上溯三级
const FIXTURE_ENUMS = path.resolve(__dirname, "..", "..", "..", "test", "fixtures", "minimal-vault", "知识库", "TheSchema", "enums.yaml");

function baseEnums() {
  return {
    domains: { ops: "运维操作", ref: "参考资料" },
    subdomains: { ops: ["deploy", "monitor"], ref: ["architecture"] },
    tags: { 运维: ["运维", "监控"] },
    lifecycle: { status: ["灰度", "在线"], default_status: "灰度" },
    arch_categories: ["服务", "存储"],
  };
}

function withTempVault(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pr052-enums-"));
  const vaultPath = path.join(root, "vault");
  const schemaDir = path.join(vaultPath, "知识库", "TheSchema");
  fs.mkdirSync(schemaDir, { recursive: true });
  fs.copyFileSync(FIXTURE_ENUMS, path.join(schemaDir, "enums.yaml"));
  process.env.THESCHEMA_DIR = schemaDir; // SPEC-023 波 3 钉扎（写通道领地）
  try {
    return fn(vaultPath);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// ── 破坏实验①：PR-049 原始脏值（tag_aliases 标量）→ 无损转化 + 留痕 ──
test("实验① tag_aliases 标量被无损转成数组并留 normalizationTrail（PR-049 防线）", () => {
  const dirty = { ...baseEnums(), tag_aliases: { test: "运维" } };
  const ruleSet = buildRuleSet(dirty);

  assert.deepEqual(ruleSet.tagAliases, { test: ["运维"] }, "标量别名必须转成单元素数组");
  assert.deepEqual(ruleSet.degradedNodes, [], "标量是合法偏差，不应走降级路径");
  assert.equal(ruleSet.normalizationTrail.length, 1, "必须有且只有一条转化痕迹");
  assert.deepEqual(
    { path: ruleSet.normalizationTrail[0].path, from: ruleSet.normalizationTrail[0].from, to: ruleSet.normalizationTrail[0].to },
    { path: "tag_aliases.test", from: "string", to: "array" },
    "痕迹须记录字段位置与原形态",
  );
  assert.ok(ruleSet.subdomainIds.includes("deploy"), "其余派生不受影响（页面正常，非全瘫）");
});

test("实验①b 传入对象不被就地改写（纯读侧不污染调用方数据）", () => {
  const dirty = { ...baseEnums(), tag_aliases: { test: "运维" } };
  buildRuleSet(dirty);
  assert.deepEqual(dirty.tag_aliases, { test: "运维" }, "buildRuleSet 不得就地 coerce 调用方的对象");
});

// ── 破坏实验②：真类型错误 → 局部降级 + warn，不抛 ──
test("实验② tag_aliases 为数字（真类型错误）→ 局部降级 + warn，不抛错", () => {
  const warns = [];
  const broken = { ...baseEnums(), tag_aliases: 42 };
  const ruleSet = buildRuleSet(broken, { warn: (payload) => warns.push(payload) });

  assert.deepEqual(ruleSet.tagAliases, {}, "真类型错误该字段降级为空");
  assert.deepEqual(ruleSet.degradedNodes, ["tag_aliases"], "降级落点须精确到字段级");
  assert.equal(warns.length, 1, "必须留 warn 痕迹（宽容不静默）");
  assert.equal(warns[0].event, "enums-degraded-nodes");
  assert.deepEqual(warns[0].nodes, ["tag_aliases"]);
  assert.equal(ruleSet.statuses.length, 2, "其余字段正常消费，接口可正常返回（非全瘫）");
});

test("实验②b 嵌套对象真类型错误（tag_aliases.x 为对象）→ 该键降级，不牵连同键其他别名", () => {
  const broken = { ...baseEnums(), tag_aliases: { good: ["运维"], bad: { nested: true } } };
  const ruleSet = buildRuleSet(broken);

  assert.deepEqual(ruleSet.tagAliases, { good: ["运维"] }, "仅坏键降级，好键保留");
  assert.deepEqual(ruleSet.degradedNodes, ["tag_aliases.bad"]);
});

test("实验②c 数字不被 coerce 静默改值（PR-052 口径：只有字符串可无损转化）", () => {
  const broken = { ...baseEnums(), tag_aliases: { x: 42 } };
  const ruleSet = buildRuleSet(broken);

  assert.deepEqual(ruleSet.tagAliases, {}, "数字不得被转成 [\"42\"] 洗白成合法别名");
  assert.deepEqual(ruleSet.degradedNodes, ["tag_aliases.x"]);
});

test("实验②d 一处脏值不致整份丢弃（PR-049 类事故：局部降级而非全瘫）", () => {
  const broken = { ...baseEnums(), article_types: "不是数组", tag_aliases: { ok: ["运维"] } };
  const ruleSet = buildRuleSet(broken);

  assert.deepEqual(ruleSet.articleTypes, [], "坏节降级为空");
  assert.deepEqual(ruleSet.tagAliases, { ok: ["运维"] }, "好节完好");
  assert.deepEqual(ruleSet.archLayers, [], "不抛错即为通过");
  assert.ok(ruleSet.domainIds === undefined || Array.isArray(ruleSet.domainIds));
  assert.ok(ruleSet.archCategories.length === 2, "arch_categories 保底语义不受脏节影响");
});

// ── 破坏实验③：脏 policy → 局部降级，脏值不入并集（A 口径：不补全）──
test("实验③ 脏 policy（allowed_categories 标量）→ 整节点降级，脏值不入类别并集", () => {
  const broken = {
    ...baseEnums(),
    subdomain_constraints: {
      a: { allowed_categories: [" 服务 ", "", "终端"] },
      b: { allowed_categories: ["服务", "存储"] },
      c: { allowed_categories: "not-an-array" },
    },
  };
  const ruleSet = buildRuleSet(broken);

  assert.deepEqual(ruleSet.archCategories, ["服务", "终端", "存储"], "并集须 trim/跳空/去重，且不含脏值 not-an-array");
  assert.deepEqual(ruleSet.degradedNodes, ["subdomain_constraints.c"], "降级落点为脏 policy 节点");
  assert.equal(ruleSet.normalizationTrail.length, 0, "A 口径：allowed_categories 不参与标量补全（无转化痕迹）");
});

// ── 写侧：破坏实验④ 落盘前严格校验 ──
test("实验④ 写侧非规范序列化 → 落盘前被拒（400），文件保持原样", () => {
  withTempVault((vaultPath) => {
    const before = readEnums(vaultPath);
    assert.throws(
      () => writeEnums({
        vaultPath,
        expectedRevision: before.revision,
        // PR-049 原始笔误形态：别名值写成标量
        mutate: (doc) => { doc.set("tag_aliases", doc.createNode({ test: "运维" })); },
      }),
      (error) => error.code === "ENUMS_SHAPE_INVALID" && error.status === 400,
      "非规范序列化必须在落盘前被拒（400）",
    );
    const after = readEnums(vaultPath);
    assert.equal(after.revision, before.revision, "被拒后文件一个字节都不能变");
  });
});

test("实验④b 写侧合法数组值正常落盘（严格校验不误伤正常写入）", () => {
  withTempVault((vaultPath) => {
    const before = readEnums(vaultPath);
    const written = writeEnums({
      vaultPath,
      expectedRevision: before.revision,
      mutate: (doc) => { doc.set("tag_aliases", doc.createNode({ test: ["运维"] })); },
    });
    assert.deepEqual(written.data.tag_aliases, { test: ["运维"] });
    assert.equal(written.revision !== before.revision, true, "合法写入应产生新 revision");
  });
});

// ── 破坏实验⑤：绕过写侧闸门 → 落盘后自校验告警 ──
test("实验⑤ 绕过写侧闸门的非规范落盘 → 读回自校验告警 enums-write-noncanonical", () => {
  // 本文件自带运行器（不经 node:test）→ 无 NODE_TEST_CONTEXT；telemetry 需显式装配内存库（SPEC-012 WP-B）
  const { openPersistenceDb } = require("../persistence/sqlite-adapter.cjs");
  const { initTelemetryStore } = require("../persistence/telemetry-store.cjs");
  initTelemetryStore(openPersistenceDb());
  withTempVault((vaultPath) => {
    const warns = [];
    const logger = { warn: (payload) => warns.push(payload) };
    const enumsPath = path.join(vaultPath, "知识库", "TheSchema", "enums.yaml");
    const current = readEnums(vaultPath);
    const polluted = { ...current.data, tag_aliases: { test: "运维" } };
    // 直接落盘模拟「绕过 writeEnums 闸门的写源」——不经 writeEnums 的严格校验
    fs.writeFileSync(enumsPath, YAML.stringify(polluted), "utf8");

    // 读回路径上自校验：写后自校验函数对同一份数据应报非规范
    const { assertCanonicalWrite } = require("../../services/schema-manager/enums-write-service.cjs");
    assertCanonicalWrite(vaultPath, readEnums(vaultPath), logger);

    const noncanonical = warns.find((w) => w.event === "enums-write-noncanonical");
    assert.ok(noncanonical, "必须报 enums-write-noncanonical（序列化笔误当场暴露）");
    assert.deepEqual(noncanonical.fields, ["tag_aliases.test"]);

    // SPEC-012 WP-B：痕迹落 telemetry 库可复核（vault 不再有 health 文件）
    const { getTelemetryStore, TRACE_KINDS } = require("../persistence/telemetry-store.cjs");
    const trace = getTelemetryStore(vaultPath).latestTrace(TRACE_KINDS.ENUMS_NORMALIZATION);
    assert.ok(trace, "必须记 enums-normalization 痕迹");
    assert.equal(trace.payload.file, "知识库/TheSchema/enums.yaml");
    assert.equal(trace.payload.normalizationTrail.length, 1);
    assert.equal(fs.existsSync(path.join(vaultPath, ".ledger", "health")), false, "vault 内不得出现 health 目录");
    assert.ok(trace.payload.timestamp, "痕迹须带时间戳");
  });
});

// ── schema 派生的 validateStringMap：签名与行为不变 ──
test("validateStringMap 已由 contracts/enums.schema.json 派生（签名与行为不变）", () => {
  assert.deepEqual(validateStringMap({ a: ["x"] }, "tag_aliases"), [], "合法值零错");
  assert.equal(validateStringMap(null, "tag_aliases").length, 1, "非对象仍报 1 错（既有行为）");
  assert.equal(validateStringMap({ a: "x" }, "tag_aliases").length > 0, true, "标量被 schema 判为形态错");
  assert.equal(validateStringMap({ a: ["x", "x"] }, "tags").length > 0, true, "重复值仍报（语义项保留）");
});

test("validateStringMap 的形态报错实例路径指向该键（与 schema 同源）", () => {
  const errors = validateStringMap({ good: ["x"], bad: 42 }, "tag_aliases");
  assert.equal(errors.length, 1, "只有坏键报错，好键不牵连");
  assert.ok(errors[0].includes("/tag_aliases/bad"), `报错须指向坏键实例路径，实得 ${errors[0]}`);
});

// ── 真实数据与既有行为回归 ──
test("真实测试 fixture 严格校验零错（写侧闸门不误伤既有数据）", () => {
  const data = YAML.parse(fs.readFileSync(FIXTURE_ENUMS, "utf8"));
  assert.deepEqual(validateEnumsStrict(data), [], "fixture 必须严格零错");
});

test("真实 vault enums.yaml 严格校验零错（形态源与真实数据一致）", () => {
  const realPath = process.env.PR052_REAL_ENUMS || path.resolve(__dirname, "..", "..", "..", "data", "theschema", "enums.yaml"); // SPEC-023 后真实库＝仓内主源
  if (!fs.existsSync(realPath)) return; // 非本机环境跳过（不因缺真实库而红）
  const data = YAML.parse(fs.readFileSync(realPath, "utf8"));
  assert.deepEqual(validateEnumsStrict(data), [], "真实库必须严格零错");
  const ruleSet = buildRuleSet(data);
  assert.equal(ruleSet.normalizationTrail.length, 0, "真实库无待转化项");
  assert.equal(ruleSet.degradedNodes.length, 0, "真实库无降级节点");
});

test("normalizeEnums 对非对象输入返回空收口结果（入参守卫）", () => {
  for (const input of [null, undefined, "字符串", 42, []]) {
    const result = normalizeEnums(input);
    assert.deepEqual(result.data, {}, `输入 ${JSON.stringify(input)} 应收口为空`);
    assert.deepEqual(result.normalizationTrail, []);
    assert.deepEqual(result.degradedNodes, []);
  }
});

test("buildRuleSet 签名向后兼容：单参数调用正常（既有消费方零改动）", () => {
  const ruleSet = buildRuleSet(baseEnums());
  assert.deepEqual(ruleSet.archLayers, [], "缺 layers 不炸");
  assert.deepEqual(ruleSet.statuses, ["灰度", "在线"]);
  assert.equal(ruleSet.defaultStatus, "灰度");
  assert.ok(Array.isArray(ruleSet.normalizationTrail));
  assert.ok(Array.isArray(ruleSet.degradedNodes));
});

// ── 跑 ──
let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log("  ok  " + name);
  } catch (error) {
    failed++;
    console.error("FAIL  " + name);
    console.error("      " + (error && error.message));
  }
}
console.log(`Enums schema contract tests: ${tests.length - failed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);