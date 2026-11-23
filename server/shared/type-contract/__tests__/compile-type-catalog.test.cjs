// WP-228：合流编译器单元＋真仓 smoke——确定性（同输入两次 JSON 串逐字节一致）、缺类级中文名
// 即抛错点名、三标签降 labels 不进 entries、属主映射口径（FaqCard 直查／KnowledgeArticle→article
// ／实体族→entity）、动作面（类绑定＋generic 六件）、词典卡系统投影种类、individualWriteAllowed
// 矩阵。真仓断言基于仓库三源（data/theschema＋object-dictionary）——改源不改测试即红。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");
const { compileTypeCatalog, GOVERNANCE_LABELS } = require("../compile-type-catalog.cjs");
const { individualWriteAllowed } = require("../index.cjs");

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const realInputs = () => ({
  ontology: YAML.parse(fs.readFileSync(path.join(ROOT, "data/theschema/ontology.yaml"), "utf8")),
  fields: YAML.parse(fs.readFileSync(path.join(ROOT, "data/theschema/fields.yaml"), "utf8")),
  dictionary: JSON.parse(fs.readFileSync(path.join(ROOT, "contracts/object-dictionary.json"), "utf8")),
  enums: YAML.parse(fs.readFileSync(path.join(ROOT, "data/theschema/enums.yaml"), "utf8")),
});

const FIXTURE = {
  ontology: {
    node_types: {
      FaqCard: { display_name: "问题卡", allows_relations: [], data_properties: { question: { required: true } } },
      KnowledgeArticle: { display_name: "知识文章", subClassOf: "Document" },
      Document: { display_name: "文档" },
      business_object: { display_name: "业务对象" },
    },
    action_types: {
      "articles.retire": { class_id: "KnowledgeArticle", http_route: "POST /api/articles/retire", executor: "x" },
    },
  },
  fields: {
    keys: { FaqCard: { primary: "individual_id", display: "question" }, article: { primary: "article_id", display: "title" }, entity: { primary: "architecture-node-id", display: "title" } },
    classes: {
      FaqCard: { properties: [{ name: "question", display: "问题" }] },
      article: { properties: [{ name: "title", display: "标题" }] },
      entity: { properties: [{ name: "title", display: "实体名称" }] },
    },
  },
  dictionary: { core_objects: [] },
  enums: {},
};

test("确定性：同输入编译两次，JSON 串逐字节一致；条目按 type_id 排序", () => {
  const a = JSON.stringify(compileTypeCatalog(FIXTURE));
  const b = JSON.stringify(compileTypeCatalog(FIXTURE));
  assert.equal(a, b);
  const cat = compileTypeCatalog(FIXTURE);
  const ids = cat.entries.map((e) => e.type_id);
  assert.deepEqual([...ids].sort(), ids);
});

test("缺类级中文显示名即红：抛错点名缺名类，不出半成品目录", () => {
  const broken = { ...FIXTURE, ontology: { ...FIXTURE.ontology, node_types: { ...FIXTURE.ontology.node_types, Plate: { description: "x" } } } };
  assert.throws(() => compileTypeCatalog(broken), /缺类级中文显示名.*Plate/);
});

test("三标签降级：不进 entries，进 labels；词典卡系统投影种类在册且不可经个体通道", () => {
  const cat = compileTypeCatalog(FIXTURE);
  for (const label of GOVERNANCE_LABELS) {
    assert.ok(!cat.entries.some((e) => e.type_id === label), `${label} 不应是种类`);
    assert.ok(cat.labels[label], `${label} 应在 labels`);
  }
  const card = cat.entries.find((e) => e.type_id === "object_dictionary_card");
  assert.ok(card && card.system_projection === true);
  assert.equal(individualWriteAllowed(cat, "object_dictionary_card").reason, "TYPE_SYSTEM_PROJECTION");
});

test("属主映射口径：类同名直查→KnowledgeArticle→article→实体族→entity；动作面含类绑定＋generic", () => {
  const cat = compileTypeCatalog(FIXTURE);
  const faq = cat.entries.find((e) => e.type_id === "FaqCard");
  assert.equal(faq.keys.owner, "FaqCard");
  assert.deepEqual(faq.properties, [{ name: "question", display: "问题" }]);
  const art = cat.entries.find((e) => e.type_id === "KnowledgeArticle");
  assert.equal(art.keys.owner, "article");
  assert.equal(art.parent_type_id, "Document");
  assert.ok(art.actions.includes("articles.retire"), "类绑定动作保留");
  for (const g of ["individuals.create", "individuals.retire", "individuals.config"]) {
    assert.ok(!art.actions.includes(g), `非 markdown-individual 类不携带 generic 动作（${g}）——ADR-021 §4.1/§3.2`);
  }
  const faqEntry = cat.entries.find((e) => e.type_id === "FaqCard");
  for (const g of ["individuals.create", "individuals.retire", "individuals.config"]) assert.ok(faqEntry.actions.includes(g), "markdown-individual 类携带 generic 全套");

});

test("真仓 smoke：27 条、pending 归零、13 节点种类全有中文名、写口径矩阵成立", () => {
  const cat = compileTypeCatalog(realInputs());
  assert.equal(cat.entries.length, 27);
  assert.deepEqual(cat.meta.pending_dictionary_entries, []);
  const objectEntries = cat.entries.filter((e) => e.sources.ontology);
  assert.equal(objectEntries.length, 13);
  for (const e of objectEntries) assert.match(e.display_name, /[\u4e00-\u9fff]/, `${e.type_id} 需中文显示名`);
  const plate = cat.entries.find((e) => e.type_id === "Plate");
  assert.ok(plate && !plate.actions.includes("individuals.create"), "Plate 无新建动作（ADR-021 §4.1——红队记档2）");
  const sys = cat.entries.find((e) => e.type_id === "System");
  assert.ok(sys && sys.actions.length === 0, "System 只读类零 generic 动作");
  assert.equal(individualWriteAllowed(cat, "FaqCard").allowed, true);
  for (const c of ["KnowledgeArticle", "Plate", "System", "Module", "Team"]) {
    assert.equal(individualWriteAllowed(cat, c).allowed, false, `${c} 应拒`);
  }
  for (const label of GOVERNANCE_LABELS) assert.equal(individualWriteAllowed(cat, label).reason, "TYPE_NOT_IN_CATALOG");
  assert.equal(individualWriteAllowed(null, "FaqCard").reason, "TYPE_CATALOG_UNAVAILABLE");
  assert.equal(individualWriteAllowed(cat, "NoSuch").reason, "TYPE_NOT_IN_CATALOG");
});
