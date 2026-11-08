// Component: anomaly-issue-collector 直读源派生测试（F2，#1418）
// @responsible: 验证 missing_entity 议题从权威源（precleaned frontmatter × wiki/entities）直读派生，
//               不再依赖 master_graph 批量快照的存在性/新鲜度——冷启动可派生、源变更即时生效。
// @inputs: 临时 Vault（enums.yaml + 正式文章快照 wiki/articles + 可选实体页 + 可选陈旧图）
// @outputs: 单元测试断言
// @context: Vault
// 背景实录（2026-09-05/06 人工验证）：干净起点无 master_graph → 派生源为空 → 缺实体引导链死锁；
// 建实体后须重跑管道才销账（陈旧耦合）。本切片把「规则的输入」归还权威源（D7/D2）。

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createAnomalyIssueCollector } = require("../governance/anomaly-issue-collector.cjs");

const ENUMS_YAML = [
  "version: 1",
  "modules:",
  "  Fixture模块:",
  "    subdomain: architecture",
  "    system: fixture",
  "    since: 1.0.0.0",
  "    until: ''",
].join("\n");

const ARTICLE_FM = [
  "---",
  "article_id: fixture-a",
  "title: Article A",
  "status: 有效",
  "date: 2026-09-06",
  "updated: 2026-09-06",
  "tags: [entity]",
  "product: AnyShare",
  "version: 7.0.6.7",
  "module: Fixture模块",
  "---",
  "",
  "# Article A",
  "",
  "正文。",
].join("\n");

function buildVault({ withArticle = true, entity = "none", withStaleGraph = false, articleBody = ARTICLE_FM } = {}) {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "collector-src-"));
  fs.mkdirSync(path.join(vault, "知识库", "TheSchema"), { recursive: true });
  const articleDir = path.join(vault, "知识库", "wiki", "articles", "ops", "article-fixture-a"); // SPEC-030 派②两层
  fs.mkdirSync(articleDir, { recursive: true });
  fs.writeFileSync(path.join(vault, "知识库", "TheSchema", "enums.yaml"), ENUMS_YAML, "utf8");
  if (withArticle) fs.writeFileSync(path.join(articleDir, "snapshot.md"), articleBody, "utf8");
  if (entity !== "none") {
    fs.mkdirSync(path.join(vault, "知识库", "wiki", "entities"), { recursive: true });
    const lines = ["---", "title: Fixture模块", "architecture-node-id: fixture-module", `arch_component: ${entity === "governed"}`, "module: [Fixture模块]", "status: 有效", "date: 2026-09-06", "updated: 2026-09-06", "tags: [entity]", "---", "", "# Fixture模块", ""];
    fs.writeFileSync(path.join(vault, "知识库", "wiki", "entities", "Fixture模块.md"), lines.join("\n"), "utf8");
  }
  if (withStaleGraph) {
    // 陈旧图：声称实体不存在（图里没有 Module 节点）——真实源里实体文件存在
    //（SPEC-012 wave-2 图族：诱饵种 derived-index.db——图不被本测试读取，仅证「图快照陈旧不主导」）
    const { getDerivedIndexStore } = require("../../shared/persistence/derived-index-store.cjs");
    getDerivedIndexStore(vault).artifacts.put("master_graph", JSON.stringify({
      _format_version: "1.0",
      ontology: { node_types: [], relation_types: [] },
      nodes: [{ id: "doc-article-fixture-a", label: "Article A", labels: ["Document"], properties: { title: "Article A", module: "Fixture模块", file_path: "知识库/wiki/articles/ops/article-fixture-a/snapshot.md" } }],
      connections: [], pendingReview: [], unresolvedWikilinks: [],
    }));
  }
  return vault;
}

function makeDeps(vault) {
  return {
    vaultPath: vault,
    logger: { warn() {}, info() {}, error() {} },
    readMasterGraphSnapshot: () => ({ exists: false, data: null, revision: null }),
    scanAndCheck: () => { throw new Error("skip"); },
    articleAssociationService: { list: () => { throw new Error("skip"); } },
    conflictStore: null,
    graphProvenanceService: { collectMissingRelationLineage: () => [] },
    articleGraphBatchService: { previewRepair: () => ({ formalContentHash: "sha256:" + "0".repeat(64), unapprovedNodes: [] }) },
    collectBatchBlockerIssues: () => { throw new Error("skip"); },
  };
}

function missingEntityIssues(vault) {
  const collect = createAnomalyIssueCollector(makeDeps(vault));
  const result = collect();
  return (result.issues || result).filter((issue) => issue.issueKind === "missing_entity");
}

test("T1 冷启动（无 master_graph）：正式文章快照声明模块但实体库空 → 照常派生 missing_entity（不再依赖图存在）", () => {
  const vault = buildVault({ withArticle: true, entity: "none" });
  try {
    const issues = missingEntityIssues(vault);
    assert.equal(issues.length, 1, "冷启动必须派生缺实体议题");
    assert.ok(issues[0].title.includes("缺少知识实体"), issues[0].title);
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test("T2 守卫：实体页存在且 arch_component=true → 冷启动下不派生", () => {
  const vault = buildVault({ withArticle: true, entity: "governed" });
  try {
    assert.equal(missingEntityIssues(vault).length, 0);
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test("T3 实体页存在但 arch_component=false（非受管实体）→ 仍派生 missing_entity", () => {
  const vault = buildVault({ withArticle: true, entity: "ungoverned" });
  try {
    assert.equal(missingEntityIssues(vault).length, 1, "非受管实体不满足入图资格，应派生");
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test("T4 陈旧图不主导：图声称缺实体但实体文件已存在 → 以源为准不派生（新鲜度解耦）", () => {
  const vault = buildVault({ withArticle: true, entity: "governed", withStaleGraph: true });
  try {
    assert.equal(missingEntityIssues(vault).length, 0, "源里实体存在 → 不派生，即使图快照陈旧");
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test("T5 守卫：文章未声明 module → 不适用，不派生（判定函数 admission 语义保持）", () => {
  const vault = buildVault({ withArticle: true, entity: "none", articleBody: ARTICLE_FM.replace("module: Fixture模块\n", "") });
  try {
    assert.equal(missingEntityIssues(vault).length, 0);
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test("T6b 整改6·粒度=文章×类型：同 article_id 多版本快照只派生一条（取最新内容）", () => {
  const vault = buildVault({ withArticle: true, entity: "none" });
  try {
    // 同文章第二份快照（文件名=内容 hash，字典序更大=更新内容）
    const articleDir = path.join(vault, "知识库", "wiki", "articles", "ops", "article-fixture-a"); // SPEC-030 派②两层
    fs.writeFileSync(path.join(articleDir, "zz-newer-snapshot.md"), ARTICLE_FM.replace("title: Fixture 文章 A", "title: Fixture 文章 A（v2）"), "utf8");
    const issues = missingEntityIssues(vault);
    assert.equal(issues.length, 1, "同文章多快照聚合为一行（文章×类型粒度）");
    assert.equal(issues[0].issueId, "missing-entity-doc-article-fixture-a");
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test("T6 议题形状与账本键连续：issueId/evidence/proposedAction 与图派生时代一致", () => {
  const vault = buildVault({ withArticle: true, entity: "none" });
  try {
    const issue = missingEntityIssues(vault)[0];
    assert.equal(issue.issueId, "missing-entity-doc-article-fixture-a", "issueId 保持 doc-article-<articleId> 形态（账本连续）");
    assert.equal(issue.proposedAction.type, "entity-repair");
    assert.equal(issue.proposedAction.sourceKey, "知识库/wiki/entities/Fixture模块.md");
    assert.equal(issue.evidence[0].path, "知识库/wiki/articles/ops/article-fixture-a/snapshot.md");
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});
