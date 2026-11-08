// ADR-008 D1 波1 单测：子域词条对象化——归一三态（标量/混合/对象）、派生（subdomainIds/subdomainLabels）、
// validateCategoryPath 兼容、写侧 absorb 对象形态、双形态取 id helper。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const {
  buildRuleSet,
  normalizeEnums,
  normalizeSubdomainEntries,
  subdomainEntryId,
  validateCategoryPath,
} = require("../enums-loader.cjs");

function baseEnums(overrides = {}) {
  return {
    domains: { ops: "运维", tech: "技术" },
    subdomains: { ops: ["deploy", "monitor"], tech: ["api"] },
    subdomain_constraints: {},
    arch_categories: ["服务"],
    article_types: [],
    doc_types: [],
    tags: {},
    tag_aliases: {},
    disabled_tags: [],
    layers: [],
    modules: {},
    lifecycle: { status: ["灰度"], review_cycle: [], default_status: "灰度" },
    architecture_projection: {
      product: "P", version: "v", product_aliases: {}, layer_aliases: {}, category_aliases: {}, subdomain_aliases: {},
      projected_relation_types: [], wikilink_type_labels: {},
    },
    ...overrides,
  };
}

test("归一三态：全标量 → 全对象（痕迹独立通道，不污染 normalizationTrail）", () => {
  const { data, normalizationTrail, entryNormalization } = normalizeEnums(baseEnums());
  assert.deepEqual(data.subdomains, { ops: [{ id: "deploy" }, { id: "monitor" }], tech: [{ id: "api" }] });
  assert.equal(normalizationTrail.length, 0, "PR-052 防线口径不变——归一痕迹不进 normalizationTrail");
  assert.equal(entryNormalization.length, 2);
  assert.deepEqual(entryNormalization[0], { path: "subdomains.ops", from: "scalar-entries", to: "entry-objects", value: 2 });
});

test("归一三态：混合形态 → 全对象（label/description 保留）", () => {
  const mixed = baseEnums({ subdomains: { ops: ["deploy", { id: "monitor", label: "监控", description: "指标与告警" }], tech: null } });
  const { data, entryNormalization } = normalizeEnums(mixed);
  assert.deepEqual(data.subdomains.ops, [{ id: "deploy" }, { id: "monitor", label: "监控", description: "指标与告警" }]);
  assert.equal(data.subdomains.tech, null, "null 预留位语义原样保留");
  assert.equal(entryNormalization.length, 1);
});

test("归一三态：全对象 → 幂等直通（零痕迹）", () => {
  const objectForm = baseEnums({ subdomains: { ops: [{ id: "deploy", label: "部署" }] } });
  const { data, entryNormalization } = normalizeEnums(objectForm);
  assert.deepEqual(data.subdomains, { ops: [{ id: "deploy", label: "部署" }] });
  assert.equal(entryNormalization.length, 0);
});

test("派生：subdomainIds 从词条对象取 id；subdomainLabels 只含有 label 的词条", () => {
  const ruleSet = buildRuleSet(baseEnums({ subdomains: { ops: [{ id: "deploy", label: "部署" }, "monitor"], tech: [{ id: "api" }] } }));
  assert.deepEqual(ruleSet.subdomainIds, ["deploy", "monitor", "api"]);
  assert.deepEqual(ruleSet.subdomainLabels, { deploy: "部署" });
  assert.deepEqual(ruleSet.categoryPaths, ["ops:deploy", "ops:monitor", "tech:api"]);
});

test("validateCategoryPath：归一后 ruleSet 上合法/非法判定语义不变", () => {
  const ruleSet = buildRuleSet(baseEnums());
  assert.equal(validateCategoryPath("ops:deploy", ruleSet), null);
  const error = validateCategoryPath("ops:unknown", ruleSet);
  assert.match(error, /不在 ops 合法子域中/);
  assert.match(error, /deploy、monitor/);
});

test("subdomainEntryId：双形态取 id（消费方公共口）", () => {
  assert.equal(subdomainEntryId(" api "), "api");
  assert.equal(subdomainEntryId({ id: "api" }), "api");
  assert.equal(subdomainEntryId({ label: "x" }), null);
  assert.equal(subdomainEntryId(null), null);
  assert.equal(subdomainEntryId(42), null);
});

test("normalizeSubdomainEntries：非串非对象条目防御性丢弃（脏节点已由 schema 严格层降级）", () => {
  const { normalized } = normalizeSubdomainEntries({ ops: ["deploy", 42, null, { label: "无id" }, { id: " monitor " }] });
  assert.deepEqual(normalized, { ops: [{ id: "deploy" }, { id: "monitor" }] });
});

test("双形态契约：schema 接受 string | {id,label?,description?}（写侧闸门不误伤任一形态）", () => {
  const { validateDocumentStrict } = require("../theschema-loader.cjs");
  assert.equal(validateDocumentStrict("enums", baseEnums()).length, 0);
  const objectForm = baseEnums({ subdomains: { ops: [{ id: "deploy", label: "部署", description: "d" }] } });
  assert.equal(validateDocumentStrict("enums", objectForm).length, 0);
  // label/description 必须是字符串——畸形降级路径由既有 PR-052 测试族覆盖
});

test("真实 vault enums.yaml：读侧归一后 subdomainIds 与标量时代一致（迁移零破坏）", () => {
  const vaultPath = process.env.VAULT_PATH || path.resolve(__dirname, "..", "..", "..");
  const { resolveTheSchemaDir } = require("../theschema-root.cjs");
  const enumsFile = path.join(resolveTheSchemaDir(vaultPath), "enums.yaml");
  if (!fs.existsSync(enumsFile)) return; // 无 vault 且无仓内主源时跳过（CI fixture 覆盖）
  const YAML = require("yaml");
  const enums = YAML.parse(fs.readFileSync(enumsFile, "utf8"));
  const rawScalarIds = new Set(
    Object.values(enums.subdomains || {}).flatMap((list) => (Array.isArray(list) ? list.filter((x) => typeof x === "string").map((x) => String(x).trim()) : [])),
  );
  const ruleSet = buildRuleSet(enums);
  // 标量子域 id 集合全部入派生（对象化前后 subdomainIds 集合不变；跨域重复词条去重）
  const derived = new Set(ruleSet.subdomainIds);
  for (const id of rawScalarIds) assert.ok(derived.has(id), `标量词条 '${id}' 对象化后仍入 subdomainIds`);
  const { data } = normalizeEnums(enums);
  for (const entries of Object.values(data.subdomains)) {
    for (const entry of entries || []) assert.equal(typeof entry, "object", "归一后全为词条对象");
  }
});

test("临时目录往返：写侧对象形态落盘 YAML 后读回归一等价（absorb 通道产出形态）", () => {
  const YAML = require("yaml");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "subentry-"));
  const file = path.join(dir, "enums.yaml");
  const written = baseEnums({ subdomains: { ops: [{ id: "deploy" }, { id: "monitor", label: "监控" }] } });
  fs.writeFileSync(file, YAML.stringify(written), "utf8");
  const reread = YAML.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(normalizeEnums(reread).data.subdomains, written.subdomains);
  fs.rmSync(dir, { recursive: true, force: true });
});
