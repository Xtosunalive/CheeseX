// Component: Entity-Repair-Service Tests
// @responsible: 验证 preview/apply 的路径、字段、正文、并发、备份和原子写回安全。
// @inputs: 临时 Vault entity Markdown
// @outputs: 单元测试断言
// @context: Vault

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createEntityRepairService, revision } = require("../entity-repair-service.cjs");
const { parseTypedRelationLine } = require("../entity-relation-patch-service.cjs");

// SPEC-012 WP-A：写前备份迁 data/backups（backup-store，KB_DATA_DIR 可注入）。
// backupRel 形如 data/backups/<family>/<name>.<ts>.bak；实际落点＝注入 data 目录下去掉 data 前缀的路径。
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "entity-repair-data-")); process.env.THESCHEMA_DIR = path.join(DATA_DIR, "知识库", "TheSchema"); // SPEC-023 波 1 钉扎
process.env.KB_DATA_DIR = DATA_DIR;
function backupAbsPath(backupRel) {
  return path.join(DATA_DIR, ...String(backupRel).split(path.sep).slice(1));
}

const rules = {
  archLayers: ["service"], archCategories: ["服务"], statuses: ["有效", "灰度"], moduleNames: ["Fixture模块"],
  articleTypes: ["最佳实践"], docTypes: ["用户手册"], categoryPaths: ["ops.maintain"], products: ["AnyShare"],
  versionsByProduct: { AnyShare: ["7.0.0.0", "7.0.6.7"] }, layerAliases: {}, categoryAliases: {}, wikilinkTypeLabels: { "关联": "relates_to", "依赖": "depends_on" },
  versionableRelations: new Set(["depends_on"]), wikilinkRelations: new Set(["depends_on", "relates_to"]),
  allRegisteredVersions: ["7.0.0.0", "7.0.6.7", "8.0.0.0"],
};

function setup(raw, options) {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "entity-repair-")); process.env.THESCHEMA_DIR = path.join(vault, "知识库", "TheSchema"); // SPEC-023 波 1 钉扎
  const dir = path.join(vault, "知识库", "wiki", "entities"); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "target.md"); fs.writeFileSync(file, raw, "utf8");
  const service = createEntityRepairService({ vaultPath: vault, ruleSetProvider: () => rules, ttlMs: options && options.ttlMs });
  const sourceKey = "知识库/wiki/entities/target.md";
  const sourceRevision = revision(fs.readFileSync(file, "utf8"), fs.statSync(file));
  return { vault, file, service, sourceKey, sourceRevision };
}

const RAW = "---\ntitle: Target\narchitecture-node-id: target\narch_component: true\ndate: 2025-01-01\nupdated: 2025-01-01\nstatus: 有效\ntags: [entity]\n---\n\n# Target\n\n正文不可改变。\n";

(function run() {
  let env = setup(RAW);
  try {
    const before = fs.readFileSync(env.file, "utf8"); const beforeStat = fs.statSync(env.file);
    assert.throws(() => env.service.preview({ sourceKey: env.sourceKey, sourceRevision: env.sourceRevision, changes: { "category-path": "wrong" } }), (e) => e.code === "VALIDATION_ERROR");
    assert.throws(() => env.service.preview({ sourceKey: "../outside.md", sourceRevision: env.sourceRevision, changes: { arch_layer: "service" } }), (e) => e.code === "SOURCE_NOT_FOUND" || e.code === "VALIDATION_ERROR");
    assert.throws(() => env.service.preview({ sourceKey: env.sourceKey, sourceRevision: env.sourceRevision, changes: { arch_layer: "bad" } }), (e) => e.code === "VALIDATION_ERROR");
    const preview = env.service.preview({ sourceKey: env.sourceKey, sourceRevision: env.sourceRevision, changes: { title: "Renamed", arch_layer: "service", arch_category: "服务", module: ["Fixture模块"], tags: ["entity", "component"] } });
    assert(preview.previewId); assert.deepStrictEqual(preview.changedFields, ["title", "arch_layer", "arch_category", "module", "tags"]);
    assert.strictEqual(fs.readFileSync(env.file, "utf8"), before, "preview must not write");
    assert.strictEqual(fs.statSync(env.file).mtimeMs, beforeStat.mtimeMs, "preview preserves mtime");
    assert(preview.afterFrontmatter.includes("arch_layer: service"));
    const applied = env.service.apply({ previewId: preview.previewId, confirmed: true });
    const after = fs.readFileSync(env.file, "utf8");
    assert(after.endsWith("# Target\n\n正文不可改变。\n"), "body bytes preserved");
    assert(fs.existsSync(backupAbsPath(applied.backupPath)), "backup exists（data 目录 backups 下——SPEC-012 WP-A）");
    assert.deepStrictEqual(applied.writtenFields, preview.changedFields);
    assert.throws(() => env.service.apply({ previewId: preview.previewId, confirmed: true }), (e) => e.code === "PREVIEW_EXPIRED");
    assert(!fs.existsSync(path.join(env.vault, ".ledger", "master_graph.json")), "repair does not write derived JSON");
    assert(!fs.existsSync(path.join(env.vault, ".ledger", "master_graph.db")), "repair does not write derived DB");
  } finally { fs.rmSync(env.vault, { recursive: true, force: true }); }

  env = setup(RAW);
  try {
    fs.unlinkSync(env.file);
    // WP-113 M2：人不填身份——changes 不带 architecture-node-id，落盘号由系统铸造（主干与标题同源＋尾段）。
    const preview = env.service.preview({
      sourceKey: env.sourceKey,
      createIfMissing: true,
      initialTitle: "Target",
      changes: { title: "Target", arch_component: true, date: "2026-07-20", updated: "2026-07-20", status: "有效", tags: ["entity"] },
    });
    assert(preview.entityId && !String(preview.entityId).includes("Target"), `身份号是不透明串、不得携带业务语义（标题/类别等），实得 ${JSON.stringify(preview.entityId)}`);
    assert.strictEqual(fs.existsSync(env.file), false, "create preview must not write");
    const applied = env.service.apply({ previewId: preview.previewId, confirmed: true });
    assert.strictEqual(applied.backupPath, "", "new entity has no previous file to back up");
    assert(fs.readFileSync(env.file, "utf8").includes(`architecture-node-id: ${preview.entityId}`), "落盘身份＝preview 回显的铸造号");
    assert.throws(() => env.service.preview({ sourceKey: env.sourceKey, createIfMissing: true, changes: { title: "Again" } }), (e) => e.code === "SOURCE_CHANGED");
  } finally { fs.rmSync(env.vault, { recursive: true, force: true }); }

  // 缺项允许创建，预览继续返回 F16 待处理明细。
  env = setup(RAW);
  try {
    fs.unlinkSync(env.file);
    const incomplete = env.service.preview({
      sourceKey: env.sourceKey,
      createIfMissing: true,
      initialTitle: "Target",
      changes: { title: "Target", arch_component: true, date: "2026-07-20", updated: "2026-07-20", status: "有效" },
    });
    assert((incomplete.postCheck.blockers || []).some((b) => b.ruleId === "F16"));
    env.service.apply({ previewId: incomplete.previewId, confirmed: true });
    assert(fs.existsSync(env.file));
  } finally { fs.rmSync(env.vault, { recursive: true, force: true }); }

  env = setup(RAW + "\n- 关联::[[强制入主]]\n- 关联::[[强制入主]]\n正文提到 [[强制入主]]，不得删除。\n");
  try {
    const before = fs.readFileSync(env.file, "utf8");
    const preview = env.service.preview({ sourceKey: env.sourceKey, sourceRevision: env.sourceRevision, relationPatch: { operation: "remove-target", originalTarget: "强制入主" } });
    assert.deepStrictEqual(preview.bodyPatch, { before: ["- 关联::[[强制入主]]", "- 关联::[[强制入主]]"], after: [] });
    assert.strictEqual(fs.readFileSync(env.file, "utf8"), before, "relation preview must not write");
    const applied = env.service.apply({ previewId: preview.previewId, confirmed: true });
    const after = fs.readFileSync(env.file, "utf8");
    assert(!after.includes("关联::[[强制入主]]"), "all duplicate typed relation lines are removed");
    assert(after.includes("正文提到 [[强制入主]]，不得删除。"), "non-relation source content is preserved");
    assert(fs.existsSync(backupAbsPath(applied.backupPath)), "relation write creates a source backup");
    assert.strictEqual(fs.readFileSync(backupAbsPath(applied.backupPath), "utf8"), before, "backup preserves exact original source");
    assert.throws(() => env.service.apply({ previewId: preview.previewId, confirmed: true }), (error) => error.code === "PREVIEW_EXPIRED");
  } finally { fs.rmSync(env.vault, { recursive: true, force: true }); }

  env = setup(RAW + "\n关联::[[强制入主]]\n");
  try {
    const preview = env.service.preview({ sourceKey: env.sourceKey, sourceRevision: env.sourceRevision, relationPatch: { operation: "remove-target", originalTarget: "强制入主" } });
    fs.appendFileSync(env.file, "来源已变化。\n", "utf8");
    assert.throws(() => env.service.apply({ previewId: preview.previewId, confirmed: true }), (error) => error.code === "SOURCE_CHANGED");
  } finally { fs.rmSync(env.vault, { recursive: true, force: true }); }

  env = setup(RAW);
  try {
    const preview = env.service.preview({ sourceKey: env.sourceKey, sourceRevision: env.sourceRevision, changes: { arch_layer: "service" } });
    fs.appendFileSync(env.file, "external edit\n");
    assert.throws(() => env.service.apply({ previewId: preview.previewId, confirmed: true }), (e) => e.code === "SOURCE_CHANGED");
  } finally { fs.rmSync(env.vault, { recursive: true, force: true }); }

  // PR-083：并发写者内容保全——apply 被写前拒绝后，先到者的磁盘内容不被静默覆盖（lost update 防护的行为证据）
  env = setup(RAW);
  try {
    const preview = env.service.preview({ sourceKey: env.sourceKey, sourceRevision: env.sourceRevision, changes: { title: "Renamed", arch_layer: "service", arch_category: "服务", module: ["Fixture模块"], tags: ["entity", "component"] } });
    const winner = RAW.replace("title: Target", "title: Winner");
    fs.writeFileSync(env.file, winner, "utf8");
    assert.throws(
      () => env.service.apply({ previewId: preview.previewId, confirmed: true }),
      (e) => e.code === "SOURCE_CHANGED" && e.status === 409,
    );
    assert(fs.readFileSync(env.file, "utf8").includes("title: Winner"), "并发写者的内容不被 apply 静默覆盖");
  } finally { fs.rmSync(env.vault, { recursive: true, force: true }); }

  env = setup(RAW.replace("arch_component: true", "arch_component: true\narch_subdomain: test1"));
  try {
    // B9（裁决 #9 选 B）：空值统一「保留键、值为空串」，不再删键。
    const preview = env.service.preview({ sourceKey: env.sourceKey, sourceRevision: env.sourceRevision, changes: { arch_subdomain: "" } });
    assert(preview.afterFrontmatter.includes("arch_subdomain: \"\""), "clearing subdomain keeps the key with empty value");
    env.service.apply({ previewId: preview.previewId, confirmed: true });
    assert(fs.readFileSync(env.file, "utf8").includes("arch_subdomain:"), "applied source still contains the subdomain key (empty value)");
  } finally { fs.rmSync(env.vault, { recursive: true, force: true }); }

  env = setup(RAW.replace("status: 有效", "status: 有效 # keep"));
  try {
    // 2026-10-08 字段托管双防线：①用户 status 被剥离忽略；②系统注入碰注释行（手改痕迹）仍 UNSAFE 拒——
    // 托管不是绕过安全守卫的通道，反而让「手改 status」必经此门（哨兵语义）
    assert.throws(() => env.service.preview({ sourceKey: env.sourceKey, sourceRevision: env.sourceRevision, changes: { status: "在线" } }), (e) => e.code === "UNSAFE_FRONTMATTER");
  } finally { fs.rmSync(env.vault, { recursive: true, force: true }); }

  env = setup(RAW);
  try {
    const other = path.join(env.vault, "知识库", "wiki", "entities", "other.md");
    fs.writeFileSync(other, "---\ntitle: Other\naliases: [Shared]\ndate: 2025-01-01\nstatus: 有效\ntags: [entity]\n---\n", "utf8");
    assert.throws(() => env.service.preview({ sourceKey: env.sourceKey, sourceRevision: env.sourceRevision, changes: { aliases: ["Shared"] } }), (e) => e.code === "ALIAS_AMBIGUOUS");
    const aliasPreview = env.service.preview({ sourceKey: env.sourceKey, sourceRevision: env.sourceRevision, changes: { aliases: ["Unique"] } });
    assert(aliasPreview.afterFrontmatter.includes("Unique"));
  } finally { fs.rmSync(env.vault, { recursive: true, force: true }); }

  env = setup(RAW);
  try {
    const articleDir = path.join(env.vault, "知识库", "raw", "precleaned"); fs.mkdirSync(articleDir, { recursive: true });
    const articleFile = path.join(articleDir, "强制入主.md");
    const articleRaw = "---\ntitle: MySQL 强制入主操作流程\nproduct: AnyShare\nversion: 7.0.0.0\nmodule: Fixture模块\narticle_type: 最佳实践\ndoc-type: 用户手册\ncategory-path: ops.maintain\ntags: [mysql]\n---\n\n正文保持不变。\n";
    fs.writeFileSync(articleFile, articleRaw, "utf8");
    const sourceKey = "知识库/raw/precleaned/强制入主.md";
    const sourceRevision = revision(articleRaw, fs.statSync(articleFile));
    assert.throws(() => env.service.preview({ sourceKey, sourceRevision, changes: { product: "Unknown" } }), (e) => e.code === "VALIDATION_ERROR" && e.details.allowedValues.includes("AnyShare"));
    assert.throws(() => env.service.preview({ sourceKey, sourceRevision, changes: { version: "9.0.0.0" } }), (e) => e.code === "VALIDATION_ERROR" && e.details.product === "AnyShare");
    assert.throws(() => env.service.preview({ sourceKey, sourceRevision, changes: { "category-path": "ops.unknown" } }), (e) => e.code === "VALIDATION_ERROR" && e.details.rule === "structured-two-part");
    const preview = env.service.preview({ sourceKey, sourceRevision, changes: { article_id: "mysql-force-primary" } });
    assert(preview.afterFrontmatter.includes("article_id: mysql-force-primary"));
    assert.strictEqual(fs.readFileSync(articleFile, "utf8"), articleRaw, "article preview must not write");
    const applied = env.service.apply({ previewId: preview.previewId, confirmed: true });
    assert.strictEqual(applied.entityId, "mysql-force-primary");
    assert(fs.readFileSync(articleFile, "utf8").endsWith("正文保持不变。\n"), "article body bytes preserved");
    assert(applied.backupPath.includes("backups/articles/"), "article backup uses its own directory");
    assert.throws(() => env.service.preview({ sourceKey, sourceRevision: applied.sourceRevision, changes: { article_id: "renamed-id" } }), (e) => e.code === "VALIDATION_ERROR");

    // PR-151②：字典必填两字段在文章修复通道可修（ARCH 两键入 ARTICLE_EDITABLE_FIELDS；枚举经契约
    // article.enumFields→archLayers/archCategories 自动执法）＋ 修复写随写重算校验章（③）
    const articleAfterFirst = fs.readFileSync(articleFile, "utf8");
    const revisionAfterFirst = revision(articleAfterFirst, fs.statSync(articleFile));
    assert.throws(() => env.service.preview({ sourceKey, sourceRevision: revisionAfterFirst, changes: { arch_layer: "bogus" } }), (e) => e.code === "VALIDATION_ERROR" && e.details.field === "arch_layer", "闭包外 arch_layer 拒绝");
    const archPreview = env.service.preview({ sourceKey, sourceRevision: revisionAfterFirst, changes: { arch_layer: "service", arch_category: "服务" } });
    assert(archPreview.afterFrontmatter.includes("arch_layer: service"), "arch 字段进修复预览");
    const archApplied = env.service.apply({ previewId: archPreview.previewId, confirmed: true });
    const articleFinal = fs.readFileSync(articleFile, "utf8");
    assert(articleFinal.includes("arch_layer: service") && articleFinal.includes("arch_category: 服务"), "arch 字段落盘");
    assert(/^validation_status: \S+/m.test(articleFinal), "PR-151③：修复写随写重算校验章");
    assert(articleFinal.endsWith("正文保持不变。\n"), "article body bytes preserved after arch repair");
    void archApplied;
  } finally { fs.rmSync(env.vault, { recursive: true, force: true }); }

  // ── Slice 2: Preview + confirm with registry revision & reload ──
  {
    let se = setup(RAW);
    try {
      // Test 1: Preview with versioned relation returns registryRevision and semanticFingerprint
      const entityB = path.join(se.vault, "知识库", "wiki", "entities", "b.md");
      fs.writeFileSync(entityB, "---\ntitle: B\narchitecture-node-id: b\narch_component: true\n---\n\n# B\n", "utf8");
      const preview = se.service.preview({ sourceKey: se.sourceKey, sourceRevision: se.sourceRevision, relationPatch: { operation: "add", relationType: "依赖", direction: "outgoing", targetId: "b", versionRange: { since: "7.0.0.0", until: "8.0.0.0" } } });
      assert(typeof preview.previewId === "string", "preview ID exists");
      assert(typeof preview.registryRevision === "string" && preview.registryRevision.startsWith("sha256:"), "registryRevision is sha256 string");
      assert(typeof preview.semanticFingerprint === "string" && preview.semanticFingerprint.startsWith("sha256:"), "semanticFingerprint is sha256 string");
      assert.deepStrictEqual(preview.parsedRange, { since: "7.0.0.0", until: "8.0.0.0" }, "parsedRange matches input");
      assert(preview.nextRaw.includes("@effective(since=7.0.0.0, until=8.0.0.0)"), "nextRaw includes version suffix");
      assert(preview.bodyPatch, "bodyPatch exists");
      assert(typeof preview.bodyPatch.before === "string", "bodyPatch.before is string");
      assert(typeof preview.bodyPatch.after === "string", "bodyPatch.after is string");
      assert(preview.sourceCoordinate, "sourceCoordinate exists");
      assert(typeof preview.sourceCoordinate.fileRevision === "string", "fileRevision exists");
    } finally { fs.rmSync(se.vault, { recursive: true, force: true }); }
  }

  // Test 2: Preview → apply with matching registry succeeds
  {
    let se = setup(RAW);
    try {
      const entityB = path.join(se.vault, "知识库", "wiki", "entities", "b.md");
      fs.writeFileSync(entityB, "---\ntitle: B\narchitecture-node-id: b\narch_component: true\n---\n\n# B\n", "utf8");
      const rawBefore = fs.readFileSync(se.file, "utf8");
      const targetId = "b";
      const preview = se.service.preview({ sourceKey: se.sourceKey, sourceRevision: se.sourceRevision, relationPatch: { operation: "add", relationType: "依赖", direction: "outgoing", targetId, versionRange: { since: "7.0.0.0", until: "8.0.0.0" } } });
      assert(preview.registryRevision, "registry revision present");
      const applied = se.service.apply({ previewId: preview.previewId, confirmed: true });
      const after = fs.readFileSync(se.file, "utf8");
      assert(after.includes("依赖::[[b]] @effective(since=7.0.0.0, until=8.0.0.0)"), "versioned relation written to file");
      assert(applied.backupPath, "backup created");
      assert(fs.existsSync(backupAbsPath(applied.backupPath)), "backup file exists（data 目录 backups 下——SPEC-012 WP-A）");
    } finally { fs.rmSync(se.vault, { recursive: true, force: true }); }
  }

  // Test 3: Preview → tamper with ontology.yaml → apply rejects with REGISTRY_CHANGED
  {
    let se = setup(RAW);
    try {
      const entityB = path.join(se.vault, "知识库", "wiki", "entities", "b.md");
      fs.writeFileSync(entityB, "---\ntitle: B\narchitecture-node-id: b\narch_component: true\n---\n\n# B\n", "utf8");
      const schemaDir = path.join(se.vault, "知识库", "TheSchema");
      fs.mkdirSync(schemaDir, { recursive: true });
      const ontologyPath = path.join(schemaDir, "ontology.yaml");
      fs.writeFileSync(ontologyPath, "relation_types:\n  DEPENDS_ON:\n    fact_encoding: typed_wikilink\n    versionable: true\n", "utf8");
      const versionsPath = path.join(schemaDir, "versions.yaml");
      fs.writeFileSync(versionsPath, "products: {}\n", "utf8");
      const preview = se.service.preview({ sourceKey: se.sourceKey, sourceRevision: se.sourceRevision, relationPatch: { operation: "add", relationType: "依赖", direction: "outgoing", targetId: "b", versionRange: { since: "7.0.0.0", until: "8.0.0.0" } } });
      // Tamper with ontology after preview
      fs.writeFileSync(ontologyPath, "relation_types:\n  DEPENDS_ON:\n    fact_encoding: typed_wikilink\n    versionable: false\n", "utf8");
      assert.throws(() => se.service.apply({ previewId: preview.previewId, confirmed: true }), (error) => error.code === "REGISTRY_CHANGED");
    } finally { fs.rmSync(se.vault, { recursive: true, force: true }); }
  }

  // Test 4: Reload test — write then re-parse to verify identical relation and range
  {
    let se = setup(RAW);
    try {
      const entityB = path.join(se.vault, "知识库", "wiki", "entities", "b.md");
      fs.writeFileSync(entityB, "---\ntitle: B\narchitecture-node-id: b\narch_component: true\n---\n\n# B\n", "utf8");
      const preview = se.service.preview({ sourceKey: se.sourceKey, sourceRevision: se.sourceRevision, relationPatch: { operation: "add", relationType: "依赖", direction: "outgoing", targetId: "b", versionRange: { since: "7.0.0.0", until: "8.0.0.0" } } });
      se.service.apply({ previewId: preview.previewId, confirmed: true });
      // Re-read the file and parse back
      const writtenRaw = fs.readFileSync(se.file, "utf8");
      const relationLine = writtenRaw.split(/\r?\n/).find((line) => line.startsWith("依赖::"));
      const reloaded = parseTypedRelationLine(relationLine, rules);
      assert.deepStrictEqual(reloaded, { relationType: "depends_on", label: "依赖", targetId: "b", versionRange: { since: "7.0.0.0", until: "8.0.0.0" } }, "production parser reloads identical relation identity and range");
    } finally { fs.rmSync(se.vault, { recursive: true, force: true }); }
  }

  // Test 5: Empty version range preview → no @effective suffix
  {
    let se = setup(RAW);
    try {
      const entityB = path.join(se.vault, "知识库", "wiki", "entities", "b.md");
      fs.writeFileSync(entityB, "---\ntitle: B\narchitecture-node-id: b\narch_component: true\n---\n\n# B\n", "utf8");
      const preview = se.service.preview({ sourceKey: se.sourceKey, sourceRevision: se.sourceRevision, relationPatch: { operation: "add", relationType: "依赖", direction: "outgoing", targetId: "b", versionRange: { since: "", until: "" } } });
      assert.deepStrictEqual(preview.parsedRange, { since: "", until: "" }, "empty range → empty parsedRange");
      assert(!preview.nextRaw.includes("@effective"), "no @effective when range is empty");
      assert(preview.bodyPatch.after === "依赖::[[b]]" || !preview.bodyPatch.after.includes("@effective"), "bodyPatch.after has no suffix");
    } finally { fs.rmSync(se.vault, { recursive: true, force: true }); }
  }

  // Test 6: Non-versionable relation rejects versionRange from preview
  {
    let se = setup(RAW);
    try {
      const entityB = path.join(se.vault, "知识库", "wiki", "entities", "b.md");
      fs.writeFileSync(entityB, "---\ntitle: B\narchitecture-node-id: b\narch_component: true\n---\n\n# B\n", "utf8");
      assert.throws(() => se.service.preview({ sourceKey: se.sourceKey, sourceRevision: se.sourceRevision, relationPatch: { operation: "add", relationType: "关联", direction: "outgoing", targetId: "b", versionRange: { since: "7.0.0.0" } } }), (e) => e.code === "VERSION_NOT_ALLOWED");
      // Confirm relates_to works without versionRange
      const previewNoRange = se.service.preview({ sourceKey: se.sourceKey, sourceRevision: se.sourceRevision, relationPatch: { operation: "add", relationType: "关联", direction: "outgoing", targetId: "b" } });
      assert(previewNoRange.previewId, "relates_to without version range passes");
    } finally { fs.rmSync(se.vault, { recursive: true, force: true }); }
  }

  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  delete process.env.KB_DATA_DIR;
  console.log("Entity repair service tests passed");
})();
