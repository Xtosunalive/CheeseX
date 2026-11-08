const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { test } = require("node:test");
const { createEntityRepairService, revision } = require("../entity-repair-service.cjs");

// 裁决 2A2（2026-09-27）：空枚举表（配置故障）与非法枚举值（输入错）分离为两个 rule。
// 守护：fail-closed 行为不变（空表仍拒写），但错误语义精确——
// rule=enum-table-empty（修法=补 enums.yaml）/ rule=enum（修法=改值）。
// 同步修复诊断报告定位的「preview 400 死锁表述」：用户不再被告知「值非法」而是「表未配置」。

const FULL_RULES = {
  archLayers: ["service"], archCategories: ["服务"], statuses: ["有效"], moduleNames: ["Fixture模块"],
  articleTypes: ["最佳实践"], docTypes: ["用户手册"], categoryPaths: ["ops.maintain"], products: ["AnyShare"],
  versionsByProduct: { AnyShare: ["7.0.0.0"] }, layerAliases: {}, categoryAliases: {}, wikilinkTypeLabels: {},
  versionableRelations: new Set(), wikilinkRelations: new Set(), allRegisteredVersions: ["7.0.0.0"],
};

const RAW = "---\ntitle: Target\narchitecture-node-id: target\narch_component: true\ndate: 2025-01-01\nupdated: 2025-01-01\nstatus: 有效\ntags: [entity]\n---\n\n# Target\n";

function setupWithRules(rules) {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "repair-enum-"));
  const dir = path.join(vault, "知识库", "wiki", "entities");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "target.md");
  fs.writeFileSync(file, RAW, "utf8");
  const service = createEntityRepairService({ vaultPath: vault, ruleSetProvider: () => rules, ttlMs: 60_000 });
  const sourceRevision = revision(fs.readFileSync(file, "utf8"), fs.statSync(file));
  return { vault, file, service, sourceKey: "知识库/wiki/entities/target.md", sourceRevision };
}

test("实体侧：空枚举表 → rule=enum-table-empty 且指明 enumKey（不再误报值非法）", () => {
  const emptyRules = { ...FULL_RULES, archLayers: [] };
  const se = setupWithRules(emptyRules);
  try {
    assert.throws(
      () => se.service.preview({ sourceKey: se.sourceKey, sourceRevision: se.sourceRevision, changes: { arch_layer: "service" } }),
      (e) => e.code === "VALIDATION_ERROR" && e.details && e.details.rule === "enum-table-empty" && e.details.enumKey === "archLayers",
      "空表必须报 enum-table-empty + enumKey，而非「包含非法枚举值」"
    );
  } finally { fs.rmSync(se.vault, { recursive: true, force: true }); }
});

test("实体侧：表非空但值不在表内 → rule=enum（输入错语义保留）", () => {
  const se = setupWithRules(FULL_RULES);
  try {
    assert.throws(
      () => se.service.preview({ sourceKey: se.sourceKey, sourceRevision: se.sourceRevision, changes: { arch_layer: "not-in-table" } }),
      (e) => e.code === "VALIDATION_ERROR" && e.details && e.details.rule === "enum",
      "非法值仍报 rule=enum"
    );
  } finally { fs.rmSync(se.vault, { recursive: true, force: true }); }
});

test("实体侧：fail-closed 不变——空表时合法值同样被拒（不因语义细化而放行）", () => {
  // 2026-10-08 字段托管适配：status 已系统托管（用户提交被剥离，不走用户枚举校验）——
  // fail-closed 语义改用 arch_layer 验证（同为枚举白名单字段，B1 语义不变）
  const emptyRules = { ...FULL_RULES, archLayers: [] };
  const se = setupWithRules(emptyRules);
  try {
    assert.throws(
      () => se.service.preview({ sourceKey: se.sourceKey, sourceRevision: se.sourceRevision, changes: { arch_layer: "service" } }),
      (e) => e.details.rule === "enum-table-empty",
      "空表时即使是将来合法的值也必须拒（B1 fail-closed 语义不回退）"
    );
  } finally { fs.rmSync(se.vault, { recursive: true, force: true }); }
});

test("文章侧：空枚举表 → rule=enum-table-empty；产品无注册版本 → 同语义", () => {
  const emptyRules = { ...FULL_RULES, articleTypes: [], versionsByProduct: {} };
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "repair-enum-art-"));
  const dir = path.join(vault, "知识库", "raw", "precleaned");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "article.md");
  fs.writeFileSync(file, "---\ntitle: A\narticle_id: a-1\nproduct: AnyShare\nversion: 7.0.0.0\narticle_type: 最佳实践\ndoc-type: 用户手册\ncategory-path: ops.maintain\n---\n\n# A\n", "utf8");
  const service = createEntityRepairService({ vaultPath: vault, ruleSetProvider: () => emptyRules, ttlMs: 60_000 });
  const sourceRevision = revision(fs.readFileSync(file, "utf8"), fs.statSync(file));
  try {
    assert.throws(
      () => service.preview({ sourceKey: "知识库/raw/precleaned/article.md", sourceRevision, changes: { article_type: "最佳实践" } }),
      (e) => e.code === "VALIDATION_ERROR" && e.details.rule === "enum-table-empty" && e.details.enumKey === "articleTypes"
    );
    assert.throws(
      () => service.preview({ sourceKey: "知识库/raw/precleaned/article.md", sourceRevision, changes: { version: "7.0.0.0" } }),
      (e) => e.code === "VALIDATION_ERROR" && e.details.rule === "enum-table-empty"
    );
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

// ── WP-116 批1（八址键直取收敛）：越界键 → 显式分支非静默 ──
test("WP-116 文章侧版本闸：现值 product 保留名 → 显式 400（不再 TypeError→500）", () => {
  // 夹具普通对象注册表（FULL_RULES 原形态）——裸取 versionsByProduct["constructor"] 撞出函数值
  //（length=1 误过空表检查），下方 .includes(version) 直接 TypeError；宿主 docField hasOwn →
  // 空版本集 → 显式 enum-table-empty 400。
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "repair-enum-hostile-"));
  const dir = path.join(vault, "知识库", "raw", "precleaned");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "article.md");
  fs.writeFileSync(file, "---\ntitle: A\narticle_id: a-1\nproduct: constructor\nversion: 1.0.0\n---\n\n# A\n", "utf8");
  const service = createEntityRepairService({ vaultPath: vault, ruleSetProvider: () => FULL_RULES, ttlMs: 60_000 });
  const sourceRevision = revision(fs.readFileSync(file, "utf8"), fs.statSync(file));
  try {
    assert.throws(
      () => service.preview({ sourceKey: "知识库/raw/precleaned/article.md", sourceRevision, changes: { version: "1.0.0" } }),
      (e) => e.code === "VALIDATION_ERROR" && e.details.rule === "enum-table-empty" && e.details.enumKey === "versionsByProduct.constructor",
      "保留名现值 product → 空版本集显式 400（不再 TypeError）"
    );
    // 对照：changes.product 保留名 → 产品枚举闭集先拦（rule=enum 输入错语义保持，与版本表面分工不混）
    assert.throws(
      () => service.preview({ sourceKey: "知识库/raw/precleaned/article.md", sourceRevision, changes: { product: "toString" } }),
      (e) => e.code === "VALIDATION_ERROR" && e.details.rule === "enum",
      "changes.product 保留名 → 产品枚举闭集拦截（诚实路径不受影响）"
    );
    // 对照：在册产品版本闸语义保持（product 经枚举闭集 → 版本表 own 键取 → 未注册版本报对码）
    assert.throws(
      () => service.preview({ sourceKey: "知识库/raw/precleaned/article.md", sourceRevision, changes: { product: "AnyShare", version: "9.9.9" } }),
      (e) => e.code === "VALIDATION_ERROR" && e.details.rule === "version-by-product" && e.details.product === "AnyShare",
      "在册产品的版本闸照常工作（宿主化不误伤）"
    );
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});
