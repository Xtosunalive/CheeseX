// Component: 索引原型同名键回归（entity-compliance + property-governance）
// @responsible: 锁死索引键取 Object.prototype 同名值（constructor/toString 等）时不得崩溃、假重复、假已解析、假挂载、假通过。
// @inputs: buildEntityIndexes / buildAliasIndex / resolveTarget / aliasOf / checkMount / 声明式引擎诊断
// @outputs: 断言结果
// @context: Vault
// 2026-10-29 Master「12都修」：与 schema-validators 三处同型（systemOwners/seen/layers.layout）同批收口。
// 同日「要修的类还是要求」：补别名索引写侧、B04 关系类型、F04 字段别名归一三处同型。
const assert = require("node:assert/strict");
const test = require("node:test");

const { buildEntityIndexes, checkEntityCompliance } = require("../entity-compliance-service.cjs");
const { runAllDiagnostics, runBodyDiagnostics, runFrontmatterDiagnostics } = require("../entity-compliance-declarative-engine.cjs");
const { resolveTarget, aliasOf } = require("../entity-compliance-body-rules.cjs");
const { buildAliasIndex } = require("../entity-alias-index.cjs");
const pg = require("../property-governance-service.cjs");

function entity(name, fm, body) {
  return { fileName: name + ".md", frontmatter: fm, body: body || "", sourcePath: "知识库/wiki/entities/" + name + ".md" };
}

const VALID_FM = {
  arch_component: true, arch_layer: "service", arch_category: "服务", module: "Fixture模块",
  date: "2025-01-01", updated: "2025-01-01", status: "有效", tags: ["entity"],
};

// ── 别名（原 TypeError：aliasOwners[alias] 命中 Object.prototype.constructor）──

test("别名取 constructor：不崩溃，按普通别名归一见效（原 HTTP 500）", () => {
  const entities = [entity("a", Object.assign({ title: "A 服务", "architecture-node-id": "a", aliases: ["constructor"] }, VALID_FM), "依赖::[[constructor]]")];
  const indexes = buildEntityIndexes(entities);
  assert.equal(indexes.duplicateAliases.has("constructor"), false, "单实体别名不撞车");
  assert.equal(resolveTarget("constructor", indexes), true, "别名连线可解析");
  assert.equal(aliasOf("constructor", indexes), "A 服务");
  const result = checkEntityCompliance(entities[0], {}, indexes);
  const f17 = result.groups.flatMap((g) => g.checks).filter((f) => f.ruleId === "F17");
  assert.ok(f17.every((f) => f.passed !== false), "无撞车不得产 F17 违规");
});

test("别名互相撞 constructor：仍按真撞车拦（正反例）", () => {
  const entities = [
    entity("a", Object.assign({ title: "A 服务", "architecture-node-id": "a", aliases: ["constructor"] }, VALID_FM)),
    entity("b", Object.assign({ title: "B 服务", "architecture-node-id": "b", aliases: ["constructor"] }, VALID_FM)),
  ];
  const indexes = buildEntityIndexes(entities);
  assert.ok(indexes.duplicateAliases.has("constructor"), "同别名撞车被捕");
  assert.deepEqual(indexes.aliasOwners["constructor"], ["A 服务", "B 服务"], "持有者列表按序累积");
  for (const e of entities) {
    const f17 = checkEntityCompliance(e, {}, indexes).groups.flatMap((g) => g.checks).find((f) => f.ruleId === "F17");
    assert.ok(f17 && f17.passed === false, "双方均产 F17 违规");
  }
});

for (const key of ["constructor", "toString", "__proto__", "hasOwnProperty", "普通名称"]) {
  test(`别名撞他人正名 ${key}：不依赖扫描顺序，自身正名别名不算冲突`, () => {
    const aliasEntity = entity("alias", { ...VALID_FM, title: "别名持有者", "architecture-node-id": "alias", aliases: [key] });
    const titleEntity = entity("title", { ...VALID_FM, title: key, "architecture-node-id": "title" });
    for (const entities of [[aliasEntity, titleEntity], [titleEntity, aliasEntity]]) {
      const indexes = buildEntityIndexes(entities);
      assert.ok(indexes.duplicateAliases.has(key));
      const f17 = checkEntityCompliance(aliasEntity, {}, indexes).groups.flatMap((g) => g.checks).find((f) => f.ruleId === "F17");
      assert.equal(f17.passed, false);
    }
    const self = entity("self", { ...VALID_FM, title: key, "architecture-node-id": "self", aliases: [key] });
    assert.equal(buildEntityIndexes([self]).duplicateAliases.has(key), false);
  });
}

// ── 正名/ID（原假重复 + 索引查不到）──

test("正名与 ID 取 constructor：不误判重复、索引自身键可查（原假重复+查不到）", () => {
  const single = [entity("c", Object.assign({ title: "constructor", "architecture-node-id": "constructor" }, VALID_FM))];
  const indexes = buildEntityIndexes(single);
  assert.equal(indexes.duplicateTitles.has("constructor"), false, "单实体正名不误判重复");
  assert.equal(indexes.duplicateIds.has("constructor"), false, "单实体 ID 不误判重复");
  assert.equal(indexes.titleLookup["constructor"].id, "constructor", "正名索引记录自身键");
  assert.equal(resolveTarget("constructor", indexes), true, "正名可解析（原被原型属性短路且未登记）");
  const result = checkEntityCompliance(single[0], {}, indexes);
  const checks = result.groups.flatMap((g) => g.checks);
  assert.ok(checks.filter((f) => f.ruleId === "F02c").every((f) => f.passed !== false), "无 F02c 假违规");
  assert.ok(checks.filter((f) => f.ruleId === "F02b").every((f) => f.passed !== false), "无 F02b 假违规");
});

test("两个 constructor 正名/ID 并存：仍按真重复拦（正反例）", () => {
  const dup = [
    entity("c1", Object.assign({ title: "constructor", "architecture-node-id": "constructor" }, VALID_FM)),
    entity("c2", Object.assign({ title: "constructor", "architecture-node-id": "constructor" }, VALID_FM)),
  ];
  const indexes = buildEntityIndexes(dup);
  assert.ok(indexes.duplicateTitles.has("constructor"), "同名被捕");
  assert.ok(indexes.duplicateIds.has("constructor"), "同 ID 被捕");
});

// ── 读侧：外部注入普通对象索引不得被原型链冒名解析 ──

test("外部注入普通对象索引：空索引不得解析 constructor/toString", () => {
  const plain = { ids: {}, titleLookup: {}, filenameLookup: {}, aliasLookup: {} };
  assert.equal(resolveTarget("constructor", plain), false, "ids 空表不得冒名命中");
  assert.equal(resolveTarget("toString", plain), false, "toString 同型");
  assert.equal(resolveTarget("hasOwnProperty", plain), false, "hasOwnProperty 同型");
  assert.equal(aliasOf("constructor", plain), null, "空别名表不得返回正名");
});

test("外部注入普通 aliasOwners：F17 消息不因原型同名值崩溃", () => {
  const indexes = {
    ids: Object.create(null), titleLookup: Object.create(null), filenameLookup: Object.create(null),
    aliasLookup: Object.create(null), aliasOwners: {}, duplicateAliases: new Set(["constructor"]),
  };
  const e = entity("a", Object.assign({ title: "A 服务", "architecture-node-id": "a", aliases: ["constructor"] }, VALID_FM));
  const f17 = runAllDiagnostics(e, { wikilinkTypeLabels: {} }, indexes).find((d) => d.ruleId === "F17");
  assert.ok(f17 && f17.passed === false, "撞车仍产 F17");
  assert.ok(f17.message.includes("constructor"), "消息含撞车值（不因缺持有者表崩溃）");
});

// ── 挂载判定（原假绿：nodeById[compId] 命中 Object.prototype.constructor）──

test("checkMount：组件 id 取原型同名值不得判已挂载（原假绿）", () => {
  const graph = [{ id: "real", properties: { file_path: "知识库/wiki/entities/real.md" } }];
  const miss = pg.checkMount({ id: "constructor", sourcePath: "" }, graph);
  assert.equal(miss.mount_mismatch.passed, false, "未入图不得判已挂载");
  assert.equal(miss.mount_mismatch.matchedEntityId, null);
  const missToString = pg.checkMount({ id: "toString", sourcePath: "" }, graph);
  assert.equal(missToString.mount_mismatch.passed, false, "toString 同型");
});

test("checkMount：真登记的 constructor 节点/映射仍命中（正例）", () => {
  const hit = pg.checkMount({ id: "constructor", sourcePath: "" }, [{ id: "constructor" }]);
  assert.equal(hit.mount_mismatch.passed, true);
  assert.equal(hit.mount_mismatch.matchedEntityId, "constructor");
  const viaArchId = pg.checkMount({ id: "toString", sourcePath: "" }, [{ id: "n1", properties: { "architecture-node-id": "toString" } }]);
  assert.equal(viaArchId.mount_mismatch.passed, true);
  assert.equal(viaArchId.mount_mismatch.matchedEntityId, "n1");
});

// ── 别名索引（entity-repair 写侧）：原 owners[key].includes 命中原型属性 → TypeError 500 ──

test("buildAliasIndex：别名取 constructor 不崩溃，冲突按普通键判定", () => {
  const single = buildAliasIndex([{ sourcePath: "a.md", frontmatter: { title: "A 服务", aliases: ["constructor"] } }]);
  assert.deepEqual(single.owners.constructor, ["a.md"], "自身键登记持有者");
  assert.deepEqual(Object.keys(single.conflicts), [], "单持有者不算撞车");

  const pair = buildAliasIndex([
    { sourcePath: "a.md", frontmatter: { title: "A 服务", aliases: ["constructor"] } },
    { sourcePath: "b.md", frontmatter: { title: "B 服务", aliases: ["constructor"] } },
  ]);
  assert.deepEqual(pair.conflicts.constructor, ["a.md", "b.md"], "真撞车仍被捕");
});

// ── 正文关系类型（B04）：known[t.type] 命中原型属性 → 未注册类型假绿 ──

test("B04：正文 constructor::[[x]] 未注册，不得因原型属性判通过（原假绿）", () => {
  const ruleSet = { wikilinkTypeLabels: { 依赖: "depends_on" } };
  const indexes = { ids: Object.create(null), titleLookup: Object.create(null), filenameLookup: Object.create(null), aliasLookup: Object.create(null) };
  const diags = runBodyDiagnostics("constructor::[[x]]", ruleSet, indexes);
  const b04 = diags.find((d) => d.ruleId === "B04");
  assert.ok(b04 && b04.passed === false, "未注册类型必须判失败");
  assert.ok(String(b04.currentValue || "").includes("constructor"), "诊断点名该类型");
});

test("B04：已注册关系照常通过（正例不被误伤）", () => {
  const ruleSet = { wikilinkTypeLabels: { 依赖: "depends_on" } };
  const indexes = Object.create(null);
  indexes.ids = Object.create(null); indexes.titleLookup = Object.create(null);
  indexes.filenameLookup = Object.create(null); indexes.aliasLookup = Object.create(null);
  assert.equal(runBodyDiagnostics("依赖::[[x]]", ruleSet, indexes).find((d) => d.ruleId === "B04"), undefined, "注册类型不产 B04 诊断");
});

// ── 字段别名归一（F04）：aliasMaps[field][v] 命中原型属性 → 值是函数，诊断文案被污染 ──

test("F04：arch_layer 取 constructor 不得被别名表改写成函数（原文案污染）", () => {
  const ruleSet = { archLayers: ["service"], layerAliases: { svc: "service" } };
  const indexes = Object.create(null);
  indexes.ids = Object.create(null); indexes.titleLookup = Object.create(null);
  indexes.filenameLookup = Object.create(null); indexes.aliasLookup = Object.create(null);
  const diags = runFrontmatterDiagnostics(Object.assign({}, VALID_FM, { arch_layer: "constructor" }), ruleSet, indexes);
  const f04 = diags.find((d) => d.ruleId === "F04");
  assert.ok(f04, "未注册分层产 F04");
  assert.equal(f04.currentValue, "constructor", "现值保持原文，不得变成函数");
  assert.ok(String(f04.message || "").includes("constructor"), "消息点名原值，不得出现 native code");
});
