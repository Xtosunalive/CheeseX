// Component: Category-Matrix-Growth Tests
// @responsible: ADR-006 修订A（Master 2026-10-29「按A」）——实体类别生长回归：
//   ① growCategoryMatrix 真写入（矩阵行创建/追加、幂等、修订推进）；
//   ② 修复链生长门：新类别＋子域 → 生长后校验通过并落盘；派生表（archCategories）随矩阵同步；
//   ③ 未选子域 → fail-closed（growth-needs-subdomain）；
//   ④ 契约形状（2026-10-29 回归修复）：矩阵行必含 domain_id（SchemaSubdomainPolicy required——
//     WP-043 首发只写 allowed_categories，/api/schema/enums 被 enforce 拦截 500）；注册表子域回填真域、
//     野生子域写空串；存量坏行随重复生长自愈（原 added 空早退永不修复）。
// @inputs: test/fixtures/minimal-vault 枚举模板 + 临时实体
// @outputs: 单元/集成断言
// @context: schema-manager × entity-compliance

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const YAML = require("yaml");

const { createSchemaWriteService } = require("../schema-write-service.cjs");
const { createEntityRepairService, revision } = require("../../entity-compliance/entity-repair-service.cjs");
const { loadRuleSetForVault } = require("../../../routes/entity-compliance-routes.cjs");

function git(cwd, args) { execFileSync("git", args, { cwd, encoding: "utf8" }); }

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cat-growth-"));
  process.env.THESCHEMA_DIR = path.join(root, "vault", "知识库", "TheSchema"); // SPEC-023 波 3 钉扎
  const repo = path.join(root, "vault");
  fs.mkdirSync(repo);
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "fixture@example.invalid"]);
  git(repo, ["config", "user.name", "Fixture"]);
  const schemaDir = path.join(repo, "知识库", "TheSchema");
  fs.mkdirSync(schemaDir, { recursive: true });
  const fixtureSchema = path.resolve(__dirname, "../../../../test/fixtures/minimal-vault/知识库/TheSchema");
  for (const name of ["ontology.yaml", "enums.yaml", "versions.yaml"]) fs.copyFileSync(path.join(fixtureSchema, name), path.join(schemaDir, name));
  const entitiesDir = path.join(repo, "知识库", "wiki", "entities");
  fs.mkdirSync(entitiesDir, { recursive: true });
  fs.writeFileSync(path.join(entitiesDir, "growth-entity.md"),
    "---\ntitle: Growth\narchitecture-node-id: growth\narch_subdomain: overview\ndate: 2025-01-01\nupdated: 2025-01-01\nstatus: 有效\ntags: [entity]\n---\n\n# Growth\n\n正文。\n", "utf8");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "fixture"]);
  return { root, repo };
}

function makeWritable(target) {
  if (!fs.existsSync(target)) return;
  if (fs.lstatSync(target).isDirectory()) {
    fs.chmodSync(target, 0o755);
    for (const entry of fs.readdirSync(target)) makeWritable(path.join(target, entry));
  } else fs.chmodSync(target, 0o644);
}

function readEnums(repo) {
  return YAML.parse(fs.readFileSync(path.join(repo, "知识库", "TheSchema", "enums.yaml"), "utf8"));
}

test("growCategoryMatrix：新行创建＋幂等＋修订推进＋派生表同步", (t) => {
  const env = fixture();
  t.after(() => { makeWritable(env.root); fs.rmSync(env.root, { recursive: true, force: true }); });
  const svc = createSchemaWriteService({ vaultPath: env.repo });

  const first = svc.growCategoryMatrix({ subdomain: "overview", categories: ["平台设施", "新域类别"] });
  assert.deepEqual(first.added.sort(), ["平台设施", "新域类别"]);
  const matrix1 = readEnums(env.repo).subdomain_constraints || {};
  assert.deepEqual((matrix1.overview || {}).allowed_categories.slice().sort(), ["平台设施", "新域类别"], "矩阵行已建");

  const second = svc.growCategoryMatrix({ subdomain: "overview", categories: ["平台设施"] });
  assert.deepEqual(second.added, [], "幂等：已有类别零追加");

  const ruleSet = loadRuleSetForVault(env.repo);
  assert.ok((ruleSet.archCategories || []).includes("新域类别"), "派生表随矩阵同步（配置页所见即此）");
});

test("契约形状：新行必含 domain_id——注册表子域回填真域，野生子域写空串", (t) => {
  const env = fixture();
  t.after(() => { makeWritable(env.root); fs.rmSync(env.root, { recursive: true, force: true }); });
  const svc = createSchemaWriteService({ vaultPath: env.repo });

  // fixture 注册表：subdomains.ops=[maintain]（裸标量形态）；overview 不在注册表（野生）
  svc.growCategoryMatrix({ subdomain: "maintain", categories: ["注册域类别"] });
  svc.growCategoryMatrix({ subdomain: "overview", categories: ["野生域类别"] });
  const matrix = readEnums(env.repo).subdomain_constraints || {};
  assert.equal(matrix.maintain.domain_id, "ops", "注册表子域回填所属域");
  assert.equal(matrix.overview.domain_id, "", "野生子域（注册表查无）写空串——键存在满足契约，不臆造域");
  for (const row of Object.values(matrix)) {
    assert.ok(typeof row.domain_id === "string", "矩阵行 domain_id 键必在（SchemaSubdomainPolicy required）");
    assert.ok(Array.isArray(row.allowed_categories), "矩阵行 allowed_categories 必在");
  }
});

test("契约形状：存量坏行（漏 domain_id）随重复生长自愈", (t) => {
  const env = fixture();
  t.after(() => { makeWritable(env.root); fs.rmSync(env.root, { recursive: true, force: true }); });
  const svc = createSchemaWriteService({ vaultPath: env.repo });

  // 复现 WP-043 首发坏行：只有 allowed_categories、无 domain_id
  const enumsPath = path.join(env.repo, "知识库", "TheSchema", "enums.yaml");
  const doc0 = YAML.parse(fs.readFileSync(enumsPath, "utf8")) || {};
  doc0.subdomain_constraints = { maintain: { allowed_categories: ["存量类别"] } };
  fs.writeFileSync(enumsPath, YAML.stringify(doc0), "utf8");

  // 重复生长已有类别：added 为空，但坏行应被补齐 domain_id（原实现早退不修）
  const healed = svc.growCategoryMatrix({ subdomain: "maintain", categories: ["存量类别"] });
  assert.deepEqual(healed.added, [], "无新类别");
  const row = readEnums(env.repo).subdomain_constraints.maintain;
  assert.equal(row.domain_id, "ops", "坏行 domain_id 已补齐（自愈）");
  assert.deepEqual(row.allowed_categories, ["存量类别"], "类别未被改动");
});

test("修复链生长门：新类别＋子域 → 生长后通过并落盘实体", (t) => {
  const env = fixture();
  t.after(() => { makeWritable(env.root); fs.rmSync(env.root, { recursive: true, force: true }); });
  const writeSvc = createSchemaWriteService({ vaultPath: env.repo });
  const file = path.join(env.repo, "知识库", "wiki", "entities", "growth-entity.md");
  const repair = createEntityRepairService({
    vaultPath: env.repo,
    ruleSetProvider: () => loadRuleSetForVault(env.repo),
    growCategoryMatrix: (input) => writeSvc.growCategoryMatrix(input),
  });
  const sourceKey = "知识库/wiki/entities/growth-entity.md";
  const sourceRevision = revision(fs.readFileSync(file, "utf8"), fs.statSync(file));

  const preview = repair.preview({ sourceKey, sourceRevision, changes: { arch_category: "生长类别A" } });
  assert.ok(preview.previewId, "新类别经生长放行，预览成章");
  const applied = repair.apply({ previewId: preview.previewId, confirmed: true });
  assert.ok(applied, "落盘成功");
  assert.match(fs.readFileSync(file, "utf8"), /arch_category: 生长类别A/, "实体已携带新类别");
  assert.ok((readEnums(env.repo).subdomain_constraints.overview.allowed_categories).includes("生长类别A"), "矩阵已生长");
  assert.ok((loadRuleSetForVault(env.repo).archCategories || []).includes("生长类别A"), "派生表同步");
});

test("修复链生长门：未选子域 → fail-closed 指明", (t) => {
  const env = fixture();
  t.after(() => { makeWritable(env.root); fs.rmSync(env.root, { recursive: true, force: true }); });
  const writeSvc = createSchemaWriteService({ vaultPath: env.repo });
  const file = path.join(env.repo, "知识库", "wiki", "entities", "growth-entity.md");
  const raw = fs.readFileSync(file, "utf8").replace("arch_subdomain: overview\n", ""); // 去子域
  fs.writeFileSync(file, raw, "utf8");
  const repair = createEntityRepairService({
    vaultPath: env.repo,
    ruleSetProvider: () => loadRuleSetForVault(env.repo),
    growCategoryMatrix: (input) => writeSvc.growCategoryMatrix(input),
  });
  const sourceKey = "知识库/wiki/entities/growth-entity.md";
  assert.throws(
    () => repair.preview({ sourceKey, sourceRevision: revision(raw, fs.statSync(file)), changes: { arch_category: "无处安放的类别" } }),
    (e) => e.code === "VALIDATION_ERROR" && e.details && e.details.rule === "growth-needs-subdomain",
  );
});
