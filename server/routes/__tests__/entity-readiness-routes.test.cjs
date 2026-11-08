// Component: Entity-Readiness-Routes Tests
// @responsible: 验证 entity check/readiness 共享扫描与入图 blocker 汇总。
// @inputs: 临时 minimal Vault entity Markdown 与 enums.yaml
// @outputs: 路由响应断言
// @context: Pipeline

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const routes = require("../entity-compliance-routes.cjs");
const { scanDraftSources } = require("../../services/article-workflow/draft-source-scanner.cjs");
const { createRouteHarness } = require("./helpers/route-harness.cjs");

function writeEntity(root, name, frontmatter, body) {
  const dir = path.join(root, "知识库", "wiki", "entities");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name + ".md"), "---\n" + frontmatter + "\n---\n\n" + (body || ""), "utf8");
}

function writeArticle(root, name, frontmatter, body) {
  const dir = path.join(root, "知识库", "raw", "precleaned");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name + ".md"), "---\n" + frontmatter + "\n---\n\n" + (body || ""), "utf8");
}

function writeDraft(root, relativePath, frontmatter, body) {
  const file = path.join(root, "知识库", "raw", "drafts", ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "---\n" + frontmatter + "\n---\n\n" + (body || ""), "utf8");
}

function makeVault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "entity-readiness-"));
  const schemaDir = path.join(root, "知识库", "TheSchema");
  fs.mkdirSync(schemaDir, { recursive: true });
  fs.writeFileSync(path.join(schemaDir, "enums.yaml"), [
    "arch_categories: [服务]",
    "lifecycle:",
    "  status: [有效]",
    "modules:",
    "  Fixture模块: {}",
    "domains:",
    "  ops: 运维操作",
    "subdomains:",
    "  ops: [maintain]",
    "article_types: [场景规范]",
    "doc_types: [运维手册]",
    "architecture_projection:",
    "  product: AnyShare",
    "  product_aliases:",
    "    AS: AnyShare",
    "  projected_relation_types: [depends_on, relates_to]",
    "  wikilink_type_labels:",
    "    依赖: depends_on",
    "    关联: relates_to",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(schemaDir, "versions.yaml"), [
    "schema_version: 1",
    "products:",
    "  As:",
    "    versions:",
    "      - id: 7.0.0.0",
    "        label: AnyShare 7.0.0.0",
    "        status: draft",
    "        release_date: null",
    "        aliases: []",
    "        snapshot: null",
  ].join("\n"), "utf8");
  return root;
}

function writeMissingEntityGraph(root) {
  const dir = path.join(root, ".ledger");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "master_graph.json"), JSON.stringify({ nodes: [{ id: "doc-mysql", label: "MySQL 文档", labels: ["Document"], properties: { title: "MySQL 文档", file_path: "知识库/raw/mysql.md", module: "MySQL" } }] }), "utf8");
}

function register(vaultPath) {
  const handlers = createRouteHarness();
  routes.register(handlers.registerRoute, {
    vaultPath,
    readMasterGraph: function () {
      const graphPath = path.join(vaultPath, ".ledger", "master_graph.json");
      if (!fs.existsSync(graphPath)) return null;
      try { return JSON.parse(fs.readFileSync(graphPath, "utf8")); } catch (_e) { return null; }
    },
    scanDraftSources,
  });
  return handlers;
}

(async function run() {
  const vault = makeVault();
  try {
    writeEntity(vault, "ordinary", [
      "title: Ordinary", "date: 2025-01-01", "updated: 2025-01-01",
      "status: 有效", "tags: [entity]",
    ].join("\n"));
    writeEntity(vault, "healthy", [
      "title: Healthy", "architecture-node-id: healthy", "arch_component: true",
      "arch_layer: service", "arch_category: 服务", "module: Fixture模块",
      "date: 2025-01-01", "updated: 2025-01-01", "status: 有效", "tags: [entity]",
    ].join("\n"), "依赖::[[healthy]]\n关联::[[healthy]]");
    writeEntity(vault, "blocked", [
      "title: Blocked", "architecture-node-id: blocked", "arch_component: true",
      "date: 2025-01-01", "updated: 2025-01-01", "status: 有效", "tags: [entity]",
    ].join("\n"));
    writeArticle(vault, "强制入主", [
      "title: MySQL 强制入主操作流程", "module: Fixture模块", "product: AnyShare",
      "article_type: 场景规范", "doc-type: 运维手册", "version: 7.0.0.0",
      "category-path: ops:maintain:mysql-ops", "tags: [MySQL]",
    ].join("\n"), "操作正文");
    writeDraft(vault, "普通投稿.md", "title: 普通投稿", "正文");

    const handlers = register(vault);
    assert(handlers.routes.has("GET /api/entity/check"), "check route registered");
    assert(handlers.routes.has("GET /api/entity/readiness"), "readiness route registered");

    const checkRes = await handlers.call("GET /api/entity/check", "/api/entity/check?limit=50");
    assert.strictEqual(checkRes.statusCode, 200);
    assert.match(checkRes.body.data.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.strictEqual(checkRes.body.data.total, 5);
    assert.strictEqual(checkRes.body.data.readiness.ready, true); // #940: blocked entity only has warnings (arch_layer/arch_category are warn, not error)
    assert(!checkRes.body.data.readiness.blockingSourceKeys.includes("知识库/wiki/entities/blocked.md")); // #940: no longer blocking
    assert(checkRes.body.data.items.some((item) => item.architectureIntent === "ordinary"));
    const blocked = checkRes.body.data.items.find((item) => item.entityId === "blocked");
    assert.strictEqual(blocked.sourceKey, "知识库/wiki/entities/blocked.md");
    assert.strictEqual(typeof blocked.sourceRevision.mtimeMs, "number");
    assert.strictEqual(typeof blocked.sourceRevision.size, "number");
    assert.match(blocked.sourceRevision.contentHash, /^sha256:/);
    const article = checkRes.body.data.items.find((item) => item.sourceKey === "知识库/raw/precleaned/强制入主.md");
    assert(article, "standard article is included in source checks");
    assert.strictEqual(article.sourceType, "standard-article");
    assert(article.groups.some((group) => group.id === "article_identity"));
    assert(article.groups.flatMap((group) => group.checks).some((finding) => finding.ruleId === "A02" && finding.passed === false), "missing article_id is reported");
    const articleFindings = Object.fromEntries(article.groups.flatMap((group) => group.checks).map((finding) => [finding.field, finding]));
    assert.deepStrictEqual(articleFindings.product.allowedValues, ["AnyShare"]);
    assert.deepStrictEqual(articleFindings.version.allowedValues, ["7.0.0.0"]);
    assert.deepStrictEqual(articleFindings.version.allowedValuesByProduct, { AnyShare: ["7.0.0.0"] });
    assert.deepStrictEqual(articleFindings["category-path"].allowedValues, ["ops:maintain"]);
    assert(checkRes.body.data.items.some((item) => item.sourceKey === "知识库/raw/drafts/普通投稿.md"));

    const readinessRes = await handlers.call("GET /api/entity/readiness", "/api/entity/readiness");
    assert.strictEqual(readinessRes.statusCode, 200);
    assert.strictEqual(readinessRes.body.data.ready, true); // #940: arch_layer/arch_category missing = warn, not error
    assert.strictEqual(readinessRes.body.data.totalArchComponents, 2);
    assert.strictEqual(readinessRes.body.data.blockerEntities, 0); // #940: no blockers
    assert(!readinessRes.body.data.blockingSourceKeys.includes("知识库/wiki/entities/blocked.md")); // #940: only warnings
    assert(!readinessRes.body.data.blockingSourceKeys.includes("知识库/wiki/entities/ordinary.md"));
    assert(!readinessRes.body.data.blockingSourceKeys.includes("知识库/raw/precleaned/强制入主.md"));
    assert(readinessRes.body.data.warnings.length > 0, "#940: warnings array non-empty (arch_layer/arch_category)");
  } finally {
    fs.rmSync(vault, { recursive: true, force: true });
  }

  const warningOnlyVault = makeVault();
  try {
    writeEntity(warningOnlyVault, "healthy", [
      "title: Healthy", "architecture-node-id: healthy", "arch_component: true",
      "arch_layer: service", "arch_category: 服务", "module: Fixture模块",
      "date: 2025-01-01", "updated: 2025-01-01", "status: 有效", "tags: [entity]",
    ].join("\n"));
    const warningHandlers = register(warningOnlyVault);
    const res = await warningHandlers.call("GET /api/entity/readiness", "/api/entity/readiness");
    assert.strictEqual(res.body.data.ready, true);
    assert(res.body.data.warningCount > 0);
    assert.strictEqual(res.body.data.warningDetails.length, res.body.data.warningCount);
    assert(res.body.data.warningDetails.every((item) => item.ruleId && item.sourceKey));
  } finally {
    fs.rmSync(warningOnlyVault, { recursive: true, force: true });
  }

  // 回归：raw/drafts 草稿 frontmatter 引用型字段（product/module）使用 wikilink 时，
  // scanDraftSources 输出层必须剥离 [[X]] → X（与标准化链路 article-admission-policy.referenceText
  // 一致），否则待处理问题会把缺实体误报为"模块无值"（REQUIREMENTS #827）。
  const wikilinkVault = makeVault();
  try {
    writeDraft(wikilinkVault, "wikilink-draft.md",
      "article_id: wikilink-test\ntitle: Wikilink Draft\ndate: 2026-08-19\nproduct: '[[通用]]'\nmodule: '[[主模块]]'\narticle_type: 方案设计\ndoc-type: 技术文档\ncategory-path: concept.method\ntags: [test]",
      "# Wikilink Draft\n");
    const scanned = scanDraftSources(wikilinkVault);
    const fm = scanned[0].frontmatter;
    assert.strictEqual(fm.product, "通用", "draft product wikilink 应剥离为 通用");
    assert.strictEqual(fm.module, "主模块", "draft module wikilink 应剥离为 主模块");
  } finally {
    fs.rmSync(wikilinkVault, { recursive: true, force: true });
  }

  const noArchVault = makeVault();
  try {
    writeEntity(noArchVault, "ordinary", "title: Ordinary\ndate: 2025-01-01\nupdated: 2025-01-01\nstatus: 有效\ntags: [entity]");
    const noArchHandlers = register(noArchVault);
    const res = await noArchHandlers.call("GET /api/entity/readiness", "/api/entity/readiness");
    assert.strictEqual(res.body.data.ready, true);
    assert.strictEqual(res.body.data.reason, "NO_ARCH_COMPONENTS");
    assert.strictEqual(res.body.data.totalArchComponents, 0);
  } finally {
    fs.rmSync(noArchVault, { recursive: true, force: true });
  }

  const missingEntityVault = makeVault();
  try {
    writeEntity(missingEntityVault, "ordinary", "title: Ordinary\ndate: 2025-01-01\nupdated: 2025-01-01\nstatus: 有效\ntags: [entity]");
    writeMissingEntityGraph(missingEntityVault);
    const handlers = register(missingEntityVault);
    const checkRes = await handlers.call("GET /api/entity/check", "/api/entity/check");
    const mysql = checkRes.body.data.items.find((item) => item.sourceKey === "知识库/wiki/entities/MySQL.md");
    assert(mysql, "missing MySQL entity is listed");
    assert.strictEqual(mysql.sourceExists, false);
    assert(mysql.blockerCount > 0);
    const readinessRes = await handlers.call("GET /api/entity/readiness", "/api/entity/readiness");
    assert.strictEqual(readinessRes.body.data.ready, false);
    assert(readinessRes.body.data.blockingSourceKeys.includes("知识库/wiki/entities/MySQL.md"));
  } finally {
    fs.rmSync(missingEntityVault, { recursive: true, force: true });
  }

  // seq205 展示即事实：GET /api/entity/check-one 单实体现读现算（契约 06 编辑前重读）。
  // 核心行为：两次调用之间改源文件 → check-one 返回的值/revision 必须反映最新文件内容（打开即事实）。
  const liveVault = makeVault();
  try {
    writeEntity(liveVault, "live", [
      "title: Live", "architecture-node-id: live", "arch_component: true",
      "date: 2025-01-01", "updated: 2025-01-01", "status: 有效", "tags: [entity]",
    ].join("\n"));
    const liveHandlers = register(liveVault);
    assert(liveHandlers.routes.has("GET /api/entity/check-one"), "check-one route registered");

    const res1 = await liveHandlers.call("GET /api/entity/check-one", "/api/entity/check-one?sourceKey=" + encodeURIComponent("知识库/wiki/entities/live.md"));
    assert.strictEqual(res1.statusCode, 200);
    assert.strictEqual(res1.body.data.result.sourceKey, "知识库/wiki/entities/live.md");
    assert.match(res1.body.data.result.sourceRevision.contentHash, /^sha256:/);
    // seq207 诊断不拥有值：sourceValues 必须携带文件现值（title: Live）
    assert.strictEqual(res1.body.data.result.sourceValues.title, "Live");
    assert.strictEqual(res1.body.data.result.sourceValues.arch_layer, null, "文件里没有的字段= null（空框=真没有）");
    const hashBefore = res1.body.data.result.sourceRevision.contentHash;
    const scoreBefore = res1.body.data.result.score;

    // 模拟用户在检查之后修改源文件（补齐 arch_layer/arch_category）
    const target = path.join(liveVault, "知识库", "wiki", "entities", "live.md");
    fs.writeFileSync(target, [
      "---", "title: Live", "architecture-node-id: live", "arch_component: true",
      "arch_layer: service", "arch_category: 服务", "module: Fixture模块",
      "date: 2025-01-01", "updated: 2025-01-01", "status: 有效", "tags: [entity]", "---", "", "正文",
    ].join("\n"), "utf8");

    const res2 = await liveHandlers.call("GET /api/entity/check-one", "/api/entity/check-one?sourceKey=" + encodeURIComponent("知识库/wiki/entities/live.md"));
    assert.strictEqual(res2.statusCode, 200);
    assert.notStrictEqual(res2.body.data.result.sourceRevision.contentHash, hashBefore, "check-one must re-read file: revision changes after edit");
    assert(res2.body.data.result.score > scoreBefore, "check-one must reflect fixed file (score improves)");

    // 失败路径：非法 sourceKey / 不存在的实体
    const badRes = await liveHandlers.call("GET /api/entity/check-one", "/api/entity/check-one?sourceKey=" + encodeURIComponent("../escape.md"));
    assert.strictEqual(badRes.statusCode, 400);
    assert.strictEqual(badRes.body.error_code, "VALIDATION_ERROR");
    const missingRes = await liveHandlers.call("GET /api/entity/check-one", "/api/entity/check-one?sourceKey=" + encodeURIComponent("知识库/wiki/entities/none.md"));
    assert.strictEqual(missingRes.statusCode, 404);
    assert.strictEqual(missingRes.body.error_code, "SOURCE_MISSING");
  } finally {
    fs.rmSync(liveVault, { recursive: true, force: true });
  }

  console.log("Entity readiness route tests passed");
})().catch((error) => { console.error(error); process.exit(1); });
