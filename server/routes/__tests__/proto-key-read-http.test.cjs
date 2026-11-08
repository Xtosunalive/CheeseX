// Component: 索引原型同名键路由回归
// @responsible: 进程内请求注入验证原型同名键、真实别名冲突与类别发现。
// @inputs: 临时 Vault（entities + enums）+ 派生库 SA/图测试数据
// @outputs: GET /api/entity/check、GET /api/schema/discovery、GET /api/property/check、POST /api/entity/repair/preview 响应断言
// @context: Pipeline
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const complianceRoutes = require("../entity-compliance-routes.cjs");
const discoveryRoutes = require("../schema-discovery-routes.cjs");
const propertyRoutes = require("../property-routes.cjs");
const { createRouteHarness } = require("./helpers/route-harness.cjs");
const { getDerivedIndexStore } = require("../../shared/persistence/derived-index-store.cjs");
const { revision } = require("../../services/entity-compliance/entity-repair-service.cjs");
const sas = require("../../services/projection/semantic-architecture-service.cjs");
const { scanDraftSources } = require("../../services/article-workflow/draft-source-scanner.cjs");

function writeEntity(root, name, fmLines, body) {
  const dir = path.join(root, "知识库", "wiki", "entities");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name + ".md"), "---\n" + fmLines.join("\n") + "\n---\n\n" + (body || ""), "utf8");
}

const BASE_FM = [
  "arch_component: true", "arch_layer: service", "arch_category: 服务", "module: Fixture模块",
  "date: 2025-01-01", "updated: 2025-01-01", "status: 有效", "tags: [entity]",
];

function makeVault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "proto-key-http-"));
  const schemaDir = path.join(root, "知识库", "TheSchema");
  fs.mkdirSync(schemaDir, { recursive: true });
  fs.writeFileSync(path.join(schemaDir, "enums.yaml"), [
    "arch_categories: [服务, constructor, toString, __proto__, hasOwnProperty]",
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
  fs.writeFileSync(path.join(schemaDir, "versions.yaml"), "schema_version: 1\nproducts:\n  AnyShare:\n    versions: []\n", "utf8");
  return root;
}

async function run() {
  const vault = makeVault();
  const h = createRouteHarness();
  try {
    // 缺陷素材：别名与正名取 Object.prototype 同名值
    writeEntity(vault, "alias-ctor", ["title: 别名构造器", "architecture-node-id: alias-ctor", "aliases: [constructor]"].concat(BASE_FM), "依赖::[[constructor]]");
    writeEntity(vault, "title-ctor", ["title: constructor", "architecture-node-id: title-ctor"].concat(BASE_FM));
    // 模块名取原型同名值（BASE_FM 已带 module，先剔除再写）
    writeEntity(vault, "module-ctor", ["title: 模块构造器", "architecture-node-id: module-ctor", "module: constructor"].concat(BASE_FM.filter((l) => !l.startsWith("module:"))));

    complianceRoutes.register(h.registerRoute, {
      vaultPath: vault,
      readMasterGraph: () => null,
      scanDraftSources,
    });
    discoveryRoutes.register(h.registerRoute, { vaultPath: vault, anomalyListIssues: () => [] });
    propertyRoutes.register(h.registerRoute, { vaultPath: vault, readSemanticArchitecture: sas.readSemanticArchitecture });

    const check = await h.call("GET /api/entity/check", "/api/entity/check?limit=50");
    assert.equal(check.statusCode, 200, "entity/check 不得因别名=constructor 崩溃：" + JSON.stringify(check.body).slice(0, 300));
    const items = check.body.data.items;
    const aliasItem = items.find((i) => i.entityId === "alias-ctor");
    assert.ok(aliasItem, "别名实体在结果中");
    const aliasFindings = aliasItem.groups.flatMap((g) => g.checks);
    assert.ok(aliasFindings.some((f) => f.ruleId === "F17" && f.passed === false), "constructor 别名撞他人正名，读侧必须与写预览一致报冲突");
    const b02 = aliasFindings.filter((f) => f.ruleId === "B02" && f.passed === false);
    assert.equal(b02.length, 0, "[[constructor]] 命中别名，不得报未解析");

    // ② 正名 constructor：原 titleLookup 未登记 + 假重复；修后无 F02c/F02b 违规
    const titleItem = items.find((i) => i.entityId === "title-ctor");
    assert.ok(titleItem, "正名实体在结果中");
    const titleFindings = titleItem.groups.flatMap((g) => g.checks);
    assert.ok(titleFindings.filter((f) => f.ruleId === "F02c").every((f) => f.passed !== false), "单个 title=constructor 不得被判重名");
    assert.ok(titleFindings.filter((f) => f.ruleId === "F02b").every((f) => f.passed !== false), "单个 id 不判重");

    // ③ discovery 同样经 buildEntityIndexes 构索引：原 500，修后 200
    const discovery = await h.call("GET /api/schema/discovery", "/api/schema/discovery");
    assert.equal(discovery.statusCode, 200, "schema/discovery 不得因别名=constructor 崩溃：" + JSON.stringify(discovery.body).slice(0, 300));
    assert.ok(Array.isArray(discovery.body.data.entityMentions), "实体生长信号照常产出");
    for (const [index, key] of ["constructor", "toString", "__proto__", "hasOwnProperty", "未登记类别"].entries()) {
      writeEntity(vault, `category-${index}`, [`title: 类别样本${index}`, `architecture-node-id: category-${index}`, `arch_category: ${key}`].concat(BASE_FM.filter((line) => !line.startsWith("arch_category:"))));
    }
    const categoryDiscovery = await h.call("GET /api/schema/discovery", "/api/schema/discovery");
    assert.equal(categoryDiscovery.statusCode, 200);
    assert.deepEqual(categoryDiscovery.body.data.discovery.categories.map((item) => item.value), ["未登记类别"], "自身已登记的原型同名类别不是野生值");

    // ⑥ 实体 module=constructor：原 groups[groupName] 命中原型属性 → .push 报错 500；修后照常分组
    const catalog = discovery.body.data.entityCatalog;
    assert.ok(Array.isArray(catalog), "实体总目照常产出");
    const ctorGroup = catalog.find((g) => g.group === "constructor");
    assert.ok(ctorGroup, "module=constructor 的实体归入自身分组，不得吞掉或崩溃");
    assert.equal(ctorGroup.count, 1);

    // ⑦ 别名写侧（repair preview 内 buildAliasIndex）：原 owners[key].includes TypeError → 500。
    // 这里 constructor 与 title-ctor 的正名真撞车，修后应得 409 冲突而非崩溃。
    const previewFile = path.join(vault, "知识库", "wiki", "entities", "alias-ctor.md");
    const previewRevision = revision(fs.readFileSync(previewFile, "utf8"), fs.statSync(previewFile));
    const preview = await h.call("POST /api/entity/repair/preview", undefined, {
      sourceKey: "知识库/wiki/entities/alias-ctor.md",
      changes: { aliases: ["constructor"] },
      sourceRevision: previewRevision,
    });
    assert.equal(preview.statusCode, 409, "别名写侧不得因 constructor 崩溃：" + JSON.stringify(preview.body).slice(0, 300));
    assert.equal(preview.body.error_code, "ALIAS_AMBIGUOUS", "真撞车按冲突拦下");

    // ⑦b 无撞车的原型同名别名照常可预览（正例不被误伤）
    const cleanFile = path.join(vault, "知识库", "wiki", "entities", "module-ctor.md");
    const clean = await h.call("POST /api/entity/repair/preview", undefined, {
      sourceKey: "知识库/wiki/entities/module-ctor.md",
      changes: { aliases: ["toString"] },
      sourceRevision: revision(fs.readFileSync(cleanFile, "utf8"), fs.statSync(cleanFile)),
    });
    assert.equal(clean.statusCode, 200, "无撞车的 toString 别名可预览：" + JSON.stringify(clean.body).slice(0, 300));

    // ④ 组件 id=constructor：原 nodeById[compId] 命中 Object.prototype.constructor → 假绿
    const store = getDerivedIndexStore(vault);
    store.artifacts.put("sa", JSON.stringify({ components: [{ id: "constructor", name: "构造器组件", sourcePath: "知识库/wiki/entities/alias-ctor.md" }] }));
    store.artifacts.put("master_graph", JSON.stringify({ nodes: [{ id: "real-node", labels: ["ArchitectureComponent"], properties: { file_path: "知识库/wiki/entities/real.md" } }], connections: [] }));
    sas.setVaultPath(vault);
    const propMiss = await h.call("GET /api/property/check", "/api/property/check?filter=all");
    assert.equal(propMiss.statusCode, 200, JSON.stringify(propMiss.body).slice(0, 300));
    assert.equal(propMiss.body.data.items[0].checks.mount_mismatch.passed, false, "未入图的 constructor 组件不得判已挂载");
    assert.equal(propMiss.body.data.items[0].checks.mount_mismatch.matchedEntityId, null);

    // ⑤ 反证：图里真有 id=constructor 的节点 → 命中（正例不被误伤）
    store.artifacts.put("master_graph", JSON.stringify({ nodes: [{ id: "constructor", labels: ["ArchitectureComponent"], properties: { file_path: "知识库/wiki/entities/alias-ctor.md" } }], connections: [] }));
    const propHit = await h.call("GET /api/property/check", "/api/property/check?filter=all");
    assert.equal(propHit.body.data.items[0].checks.mount_mismatch.passed, true, "真登记的 constructor 节点仍命中");
    assert.equal(propHit.body.data.items[0].checks.mount_mismatch.matchedEntityId, "constructor");
    console.log("proto-key route-injection regression passed");
  } finally {
    await h.close();
    fs.rmSync(vault, { recursive: true, force: true });
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
