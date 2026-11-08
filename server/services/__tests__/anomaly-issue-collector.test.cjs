const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  createAnomalyIssueCollector,
  candidateIssue,
  articleCandidateIssue,
  inferenceCandidateIssue,
} = require("../governance/anomaly-issue-collector.cjs");

const SOURCE_REVISION = `sha256:${"1".repeat(64)}`;
const RULE_SET = { wikilinkTypeLabels: { "依赖": "DEPENDS_ON" } };

test("typed wikilink occurrences keep every coordinate, raw unknown type and evidence item", () => {
  const issue = candidateIssue({
    issueId: "typed-1",
    title: "typed candidate",
    sourceNodeId: "api",
    targetNodeId: "database",
    sourcePath: "知识库/wiki/entities/api.md",
    sourceRevision: SOURCE_REVISION,
    ruleRevision: "B04",
    ruleSet: RULE_SET,
    links: [
      { type: "依赖", target: "database", coordinate: "line:4", snippet: "依赖::[[database]]" },
      { type: "依赖", target: "database", coordinate: "line:9", snippet: "依赖::[[database|DB]]" },
      { type: "自定义关系", target: "database", coordinate: "line:12", snippet: "自定义关系::[[database]]" },
    ],
  });

  assert.equal(issue.relationCandidate.triples.length, 2);
  assert.deepEqual(issue.relationCandidate.triples.flatMap((item) => item.evidence).map((item) => item.coordinate), ["line:4", "line:9", "line:12"]);
  assert.equal(issue.relationCandidate.triples[1].relationType, "自定义关系");
  assert.equal(issue.relationCandidate.triples[1].relationTypeStatus, "unknown");
  assert.equal(issue.relationCandidate.candidateStatus, "review_required");
  assert.equal(issue.relationCandidate.triples.some((item) => item.relationType === "RELATED"), false);
});

test("resolved targets stay known when only the raw relation type is unknown", () => {
  const issue = candidateIssue({ issueId: "typed-known-target", title: "candidate", sourceNodeId: "api", targetNodeId: "database", sourcePath: "api.md", sourceRevision: SOURCE_REVISION, ruleRevision: "B04", ruleSet: RULE_SET, knownNodeIds: new Set(["api", "database"]), links: [{ type: "自定义关系", target: "database", coordinate: "line:6", snippet: "自定义关系::[[database]]" }] });
  assert.equal(issue.relationCandidate.triples[0].relationTypeStatus, "unknown");
  assert.equal(issue.relationCandidate.triples[0].targetEndpointStatus, "known");
});

test("article applicability and inference conflicts use the same candidate contract without implying approval", () => {
  const article = articleCandidateIssue({
    articleId: "ART-1",
    title: "Article",
    sourcePath: "知识库/raw/precleaned/article.md",
    sourceHash: SOURCE_REVISION,
  }, { revision: "association-revision", componentOptions: [], versionOptions: [] });
  assert.equal(article.relationCandidate.triples[0].relationType, "DOCUMENTS");
  assert.equal(article.relationCandidate.triples[0].targetEndpointStatus, "unknown");
  assert.equal(article.relationCandidate.candidateStatus, "review_required");

  const inference = inferenceCandidateIssue({
    conflictId: "conflict-1",
    subjectNodeId: "api",
    conclusionKey: "requires-change",
    sourceRevision: SOURCE_REVISION,
    conclusions: [
      { ruleId: "rule-a", conclusionKey: "requires-change", effect: "ASSERT", evidence: ["edge:api->db"] },
      { ruleId: "rule-b", conclusionKey: "requires-change", effect: "BLOCK", evidence: [] },
    ],
  });
  assert.equal(inference.relationCandidate.triples.length, 2);
  assert.equal(new Set(inference.relationCandidate.triples.map((item) => item.targetNodeId)).size, 1);
  assert.deepEqual(inference.relationCandidate.triples.map((item) => item.relationType), ["requires-change:ASSERT", "requires-change:BLOCK"]);
  assert.equal(inference.relationCandidate.triples[1].evidence[0].snippet, "rule:rule-b; effect:BLOCK");
});

test("the unified collector emits all three candidate sources without writing formal files", () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "relation-candidate-collector-"));
  const formalGraph = path.join(vaultPath, "master_graph.json");
  fs.writeFileSync(formalGraph, "formal-before\n");
  // ADR063 #1746：catalog 文章的活源文件须真实在位（源投影对账会跳过已删源的检出）
  fs.mkdirSync(path.join(vaultPath, "知识库", "raw", "precleaned"), { recursive: true });
  fs.writeFileSync(path.join(vaultPath, "知识库", "raw", "precleaned", "article.md"), "# Article\n");
  try {
    const collect = createAnomalyIssueCollector({
      vaultPath,
      logger: { warn() {} },
      relationRuleSet: RULE_SET,
      relationRegistry: { relations: new Map([["DOCUMENTS", { assertionPolicies: [{ sourceKind: "article_association", producer: "article-association-service.approved_association" }] }]]) },
      scanAndCheck: () => ({ results: [{
        sourceKey: "知识库/wiki/entities/api.md",
        entityId: "api",
        sourceRevision: SOURCE_REVISION,
        groups: [{ label: "body", checks: [{
          ruleId: "B04",
          message: "typed candidate",
          unknownRelations: [{ type: "自定义关系", target: "database", coordinate: "line:6", snippet: "自定义关系::[[database]]" }],
        }] }],
      }] }),
      scanDraftSources: () => [],
      isWorkbenchIssueFinding: () => true,
      findUnmanagedEntityCandidates: () => [],
      listRelationTargetOptions: () => [],
      articleAssociationService: { list: () => ({
        revision: "association-revision",
        decisions: [],
        articles: [{ articleId: "ART-1", title: "Article", sourcePath: "知识库/raw/precleaned/article.md", sourceHash: SOURCE_REVISION, componentIds: [] }],
        componentOptions: [],
        versionOptions: [],
      }) },
      conflictStore: { list: () => [{
        conflictId: "conflict-1",
        status: "unresolved",
        subjectNodeId: "api",
        conclusionKey: "requires-change",
        sourceRevision: SOURCE_REVISION,
        conclusions: [
          { ruleId: "rule-a", effect: "ASSERT", evidence: ["edge:a"] },
          { ruleId: "rule-b", effect: "BLOCK", evidence: ["policy:b"] },
        ],
      }] },
      readMasterGraph: () => ({ nodes: [] }),
      articleGraphBatchService: { previewRepair: () => ({ formalContentHash: SOURCE_REVISION, unapprovedNodes: [] }) },
      graphProvenanceService: { collectMissingRelationLineage: () => [] },
      collectBatchBlockerIssues: () => [],
    });

    const collection = collect();
    const candidates = collection.issues.filter((item) => item.relationCandidate);
    assert.deepEqual(collection.workingRevisions, { masterGraph: null });
    assert.equal(candidates.length, 3);
    assert.deepEqual(new Set(candidates.map((item) => item.issueKind)), new Set(["relation_conflict", "article_association"]));
    assert.equal(candidates.every((item) => item.relationCandidate.candidateStatus !== "rejected"), true);
    const articleCandidate = candidates.find((item) => item.issueKind === "article_association");
    assert.equal(articleCandidate.relationCandidate.triples[0].assertionPolicyStatus, "unregistered");
    assert.equal(articleCandidate.relationCandidate.candidateStatus, "review_required");
    assert.equal(fs.readFileSync(formalGraph, "utf8"), "formal-before\n");
    assert.equal(fs.existsSync(path.join(vaultPath, ".ledger", "current")), false);
  } finally {
    fs.rmSync(vaultPath, { recursive: true, force: true });
  }
});

test("the collector consumes one graph snapshot and reports its exact working revision", () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "anomaly-collector-snapshot-"));
  let graphReads = 0;
  let complianceGraph;
  let lineageGraph;
  const graph = { nodes: [{ id: "api", labels: [] }], connections: [] };
  const graphRevision = `sha256:${"a".repeat(64)}`;
  try {
    const collect = createAnomalyIssueCollector({
      vaultPath,
      logger: { warn() {} },
      readMasterGraphSnapshot() {
        graphReads += 1;
        return { data: graph, revision: graphRevision, exists: true };
      },
      readMasterGraph() { throw new Error("legacy graph reader must not be called"); },
      scanAndCheck(_vaultPath, value) { complianceGraph = value; return { results: [] }; },
      scanDraftSources: () => [],
      relationRuleSet: RULE_SET,
      isWorkbenchIssueFinding: () => false,
      findUnmanagedEntityCandidates: () => [],
      listRelationTargetOptions: () => [],
      articleAssociationService: { list: () => ({ decisions: [], articles: [] }) },
      conflictStore: { list: () => [] },
      graphProvenanceService: { collectMissingRelationLineage(value) { lineageGraph = value; return []; } },
    });

    const result = collect();
    assert.equal(graphReads, 1);
    assert.equal(complianceGraph, graph);
    assert.equal(lineageGraph, graph);
    assert.deepEqual(result.workingRevisions, { masterGraph: graphRevision });
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

// ── WP-116 批1（八址键直取收敛）：越界键 → 显式分支非静默 ──
const RESERVED_KEYS = ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"];

test("WP-116 连线前缀键：保留名 link.type → unknown＋canonical 回落原文（普通对象/null 原型表同正确）", () => {
  const plainTable = { wikilinkTypeLabels: { "依赖": "DEPENDS_ON" } }; // 测试夹具原形态（普通对象）
  const nullProtoTable = { wikilinkTypeLabels: Object.assign(Object.create(null), { "依赖": "DEPENDS_ON" }) }; // WP-050 现役形态
  for (const ruleSet of [plainTable, nullProtoTable]) {
    for (const type of RESERVED_KEYS.concat([null, "", "未在册"])) {
      const issue = candidateIssue({
        issueId: "wp113-hostile", title: "t", sourceNodeId: "n", targetNodeId: "x",
        sourcePath: "a.md", sourceRevision: SOURCE_REVISION, ruleRevision: "B04", ruleSet,
        links: [{ type, target: "X", coordinate: "c", snippet: "s" }],
      });
      const triple = issue.relationCandidate.triples[0];
      assert.equal(triple.relationTypeStatus, "unknown", `${String(type)} → unknown（显式 own 分支，不命中原型面）`);
      assert.equal(triple.relationType, type || "UNKNOWN_RELATION", `${String(type)} canonical 回落原文/UNKNOWN_RELATION`);
      assert.ok(!JSON.stringify(issue).includes("function "), "不塞 JS 函数原文");
    }
  }
  // 对照：在册前缀语义逐字保持（canonical=规范类型、known）
  const known = candidateIssue({
    issueId: "wp113-known", title: "t", sourceNodeId: "n", targetNodeId: "x",
    sourcePath: "a.md", sourceRevision: SOURCE_REVISION, ruleRevision: "B04",
    ruleSet: plainTable, links: [{ type: "依赖", target: "X", coordinate: "c", snippet: "s" }],
  });
  assert.equal(known.relationCandidate.triples[0].relationType, "DEPENDS_ON");
  assert.equal(known.relationCandidate.triples[0].relationTypeStatus, "known");
});

// 旧手写 `---` 正则解析（已退役）逐字内联——对账基准（WP-116 行为保持钉）。
function legacyParseTags(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const fmText = m[1];
  let tags = null;
  const inline = fmText.match(/^tags:\s*\[([^\]]*)\]/m);
  if (inline) tags = inline[1].split(",");
  else {
    const blockMatch = fmText.match(/^tags:\s*\n((?:[ \t]*-[ \t]*.+\n?)+)/m);
    if (blockMatch) tags = blockMatch[1].split("\n").map((line) => line.replace(/^[ \t]*-[ \t]*/, "").trim()).filter(Boolean);
    else {
      const inlineScalar = fmText.match(/^tags:[ \t]+([^\[\n].*?)[ \t]*$/m);
      if (inlineScalar) tags = inlineScalar[1].split(",");
    }
  }
  return tags;
}
// 旧 collectTagList 入参归一（值→计数桶），与新 proposedAction.value/count 同视角对账
function legacyTagBuckets(raw) {
  const tags = legacyParseTags(raw);
  const buckets = {};
  if (!tags) return buckets;
  for (const item of tags) {
    const value = String(item || "").trim().replace(/^['"]|['"]$/g, "");
    if (!value) continue;
    buckets[value] = (buckets[value] || 0) + 1;
  }
  return buckets;
}

function wildTagBuckets(vaultPath) {
  const collect = createAnomalyIssueCollector({
    vaultPath,
    logger: { warn() {} },
    scanAndCheck: () => ({ results: [] }),
    scanDraftSources: () => [],
    isWorkbenchIssueFinding: () => false,
    findUnmanagedEntityCandidates: () => [],
    listRelationTargetOptions: () => [],
    articleAssociationService: { list: () => ({ decisions: [], articles: [] }) },
    conflictStore: { list: () => [] },
    graphProvenanceService: { collectMissingRelationLineage: () => [] },
  });
  const buckets = {};
  for (const item of collect().issues.filter((issue) => issue.issueKind === "wild_tag")) {
    buckets[item.proposedAction.value] = item.proposedAction.count;
  }
  return buckets;
}

function wildTagBucketsForRaw(raw, name) {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "wp113-wild-"));
  fs.mkdirSync(path.join(vaultPath, "知识库", "raw", "drafts"), { recursive: true });
  fs.writeFileSync(path.join(vaultPath, "知识库", "raw", "drafts", `${name}.md`), raw, "utf8");
  try {
    return { buckets: wildTagBuckets(vaultPath), vaultPath };
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
}

test("WP-116 wild-tag 采集：loadDocument 与退役正则的解析产出逐字对账（15 例矩阵）", () => {
  const cases = [
    ["no-frontmatter", "# 正文\n没有frontmatter\n"],
    ["frontmatter-no-tags", "---\ntitle: t\nmodule: m\n---\n正文\n"],
    ["tags-null", "---\ntags:\n---\n正文\n"],
    ["tags-empty-inline", "---\ntags: []\n---\n正文\n"],
    ["tags-inline", "---\ntags: [mysql,  索引 ]\n---\n正文\n"],
    ["tags-inline-quoted", "---\ntags: ['x y', \"z\"]\n---\n正文\n"],
    ["tags-inline-dup", "---\ntags: [mysql, mysql]\n---\n正文\n"],
    ["tags-block", "---\ntags:\n  - alpha\n  - beta\n---\n正文\n"],
    ["tags-block-quoted", "---\ntags:\n  - 'a b'\n  - c\n---\n正文\n"],
    ["tags-scalar", "---\ntags: mysql,索引\n---\n正文\n"],
    ["tags-scalar-quoted", '---\ntags: "a, b"\n---\n正文\n'],
    ["tags-nested-only", "---\nmeta:\n  tags: [nested]\n---\n正文\n"],
    ["tags-after-other-keys", "---\ntitle: t\ntags: [late]\n---\n正文\n"],
    ["mid-file-separator-only", "正文\n---\ntags: [x]\n---\n尾\n"],
    ["unclosed-bracket", "---\ntags: [a, b\n---\n正文\n"],
  ];
  for (const [name, raw] of cases) {
    const { buckets } = wildTagBucketsForRaw(raw, name);
    assert.deepEqual(buckets, legacyTagBuckets(raw), `${name}：新旧采集桶逐字一致`);
  }
  // 对账基准非空洞守卫：正例确有产出（防夹具退化成两边都空的假绿）
  assert.deepEqual(legacyTagBuckets("---\ntags: [mysql,  索引 ]\n---\n"), { mysql: 1, "索引": 1 });
  assert.deepEqual(legacyTagBuckets("---\ntags: [mysql, mysql]\n---\n"), { mysql: 2 });
  // 溯源面：sourcePath 指向 drafts 原文（野生标签处理入口需要文件坐标）
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "wp113-wild-files-"));
  fs.mkdirSync(path.join(vaultPath, "知识库", "raw", "drafts"), { recursive: true });
  fs.writeFileSync(path.join(vaultPath, "知识库", "raw", "drafts", "src.md"), "---\ntags: [孤例]\n---\n正文\n", "utf8");
  try {
    const collect = createAnomalyIssueCollector({
      vaultPath,
      logger: { warn() {} },
      scanAndCheck: () => ({ results: [] }),
      scanDraftSources: () => [],
      isWorkbenchIssueFinding: () => false,
      findUnmanagedEntityCandidates: () => [],
      listRelationTargetOptions: () => [],
      articleAssociationService: { list: () => ({ decisions: [], articles: [] }) },
      conflictStore: { list: () => [] },
      graphProvenanceService: { collectMissingRelationLineage: () => [] },
    });
    const issue = collect().issues.find((item) => item.issueKind === "wild_tag");
    assert.ok(issue, "野生标签确有检出");
    assert.deepEqual(issue.proposedAction.files, ["知识库/raw/drafts/src.md"]);
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("WP-116 wild-tag 采集：坏 YAML 整块弃用＋null 标量跳过——与退役正则的已声明分歧（保守不造假 wild-tag）", () => {
  // 旧正则从容错块逐行捞值（坏 YAML 里 tags: [x] 仍捞 "x"、tags: ~ 捞 "~"、重复键取首个）；
  // 装载端口语义：坏 YAML → 空 frontmatter（key-absent）、~ → null-value、重复键 → 解析错空面。
  // 两角均为垃圾输入，弃用不产出＝保守方向（不产生假野生标签）；此处钉住新语义防无感知回退。
  const divergent = [
    ["yaml-error-with-tags-line", "---\nfoo: [unclosed\ntags: [x]\n---\n正文\n", { x: 1 }],
    ["tags-tilde", "---\ntags: ~\n---\n正文\n", { "~": 1 }],
    ["tags-duplicate-keys", "---\ntags: [a]\ntags: [b]\n---\n正文\n", { a: 1 }],
  ];
  for (const [name, raw, legacyExpectation] of divergent) {
    const { buckets } = wildTagBucketsForRaw(raw, name);
    assert.deepEqual(buckets, {}, `${name}：新路径不产出（旧正则会捞 ${JSON.stringify(legacyExpectation)}）`);
    assert.deepEqual(legacyTagBuckets(raw), legacyExpectation, `${name}：对账基准确为旧产出（分歧真实存在，非静默）`);
  }
});
