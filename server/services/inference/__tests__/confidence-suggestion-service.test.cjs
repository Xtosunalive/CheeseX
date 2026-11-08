const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createConfidenceSuggestionService, scoreToBand } = require("../confidence-suggestion-service.cjs");
const { confidenceBandValues } = require("../../../shared/confidence-bands.cjs"); // WP-142 批⓪：测试同样不手抄阈值，代表值从单源取

const ONTOLOGY = {
  relation_types: {
    DEPENDS_ON: { confidence_prior: 0.8, confidence_floor: 0.4 },
    REFERENCES: { confidence_prior: 0.7, confidence_floor: 0.35 },
    MENTIONS: { confidence_prior: 0.6, confidence_floor: 0.3 },
    DOCUMENTS: {}, // 未声明 prior/floor —— 不参与
  },
  confidence_suggestion: { cooccurrence_cap: 10 },
};

function coverage(map) { return () => new Map(Object.entries(map)); }
function edge(over = {}) {
  return Object.assign({ source: "tech:a", target: "tech:b", type: "DEPENDS_ON", confidence: undefined, properties: {} }, over);
}

test("C2 公式：证据升向先验且单调", () => {
  const svc = createConfidenceSuggestionService({
    ontologyData: ONTOLOGY,
    articleCoverage: coverage({ p1: new Set(["tech:a", "tech:b"]), p2: new Set(["tech:a", "tech:b"]), p3: new Set(["tech:a", "tech:b"]) }),
  });
  const e2 = svc.annotateEdge(edge());
  const e3 = svc.annotateEdge(edge());
  assert.equal(e2.suggestedConfidence, e3.suggestedConfidence); // 2、3 篇同测一个对象——单测单调性走 suggest
  const s2 = svc.suggest("DEPENDS_ON", ["p1", "p2"]);
  const s3 = svc.suggest("DEPENDS_ON", ["p1", "p2", "p3"]);
  assert.ok(s3 > s2, "证据多建议高");
  assert.ok(s2 > 0.4 && s2 < 0.8, "介于 floor 与 prior 之间");
});

test("C2 饱和：共现超上限不再抬升、永不超越先验", () => {
  const svc = createConfidenceSuggestionService({ ontologyData: ONTOLOGY, articleCoverage: coverage({}) });
  const refs10 = Array.from({ length: 10 }, (_, i) => `p${i}`);
  const refs50 = Array.from({ length: 50 }, (_, i) => `q${i}`);
  const s10 = svc.suggest("DEPENDS_ON", refs10);
  const s50 = svc.suggest("DEPENDS_ON", refs50);
  assert.equal(s10, 0.8, "恰达上限＝先验");
  assert.equal(s50, 0.8, "超上限饱和——不越先验（2026-10-24 终审补的 min(1,·) 项）");
});

test("C2 证据 <2 篇不生效不显示", () => {
  const svc = createConfidenceSuggestionService({
    ontologyData: ONTOLOGY,
    articleCoverage: coverage({ only: new Set(["tech:a", "tech:b"]) }),
  });
  const row = svc.annotateEdge(edge());
  assert.equal(row.suggestedConfidence, undefined);
  assert.equal(row.suggestedConfidenceEvidence, undefined);
  assert.equal(row.confidenceSource, "none");
});

test("C1/C2 未声明类型不参与建议", () => {
  const svc = createConfidenceSuggestionService({
    ontologyData: ONTOLOGY,
    articleCoverage: coverage({ p1: new Set(["tech:a", "tech:b"]), p2: new Set(["tech:a", "tech:b"]) }),
  });
  const row = svc.annotateEdge(edge({ type: "DOCUMENTS" }));
  assert.equal(row.suggestedConfidence, undefined);
  assert.equal(row.confidenceSource, "none");
});

test("C9 结构边（auto-discovered）不进建议与置信度", () => {
  const svc = createConfidenceSuggestionService({
    ontologyData: ONTOLOGY,
    articleCoverage: coverage({ p1: new Set(["ref:x", "ref"]), p2: new Set(["ref:x", "ref"]), p3: new Set(["ref:x", "ref"]) }),
  });
  const row = svc.annotateEdge(edge({ source: "ref:x", target: "ref", properties: { source: "auto-discovered" } }));
  assert.equal(row.suggestedConfidence, undefined);
  assert.equal(row.confidenceSource, "none");
});

test("C5 confidenceSource 四槽：band > native > suggestion > none", () => {
  const cov = coverage({ p1: new Set(["tech:a", "tech:b"]), p2: new Set(["tech:a", "tech:b"]) });
  const band = [{ endpoint_domain: "graph", type: "DEPENDS_ON", source: "tech:a", target: "tech:b", confidence_band: "high" }];
  const withBand = createConfidenceSuggestionService({ ontologyData: ONTOLOGY, articleCoverage: cov, listRelationBands: () => band });
  assert.equal(withBand.annotateEdge(edge()).confidenceSource, "band");
  assert.equal(withBand.annotateEdge(edge()).effectiveConfidence, 0.85);

  const native = createConfidenceSuggestionService({ ontologyData: ONTOLOGY, articleCoverage: cov });
  assert.equal(native.annotateEdge(edge({ confidence: 1 })).confidenceSource, "native");

  const sug = createConfidenceSuggestionService({ ontologyData: ONTOLOGY, articleCoverage: cov });
  assert.equal(sug.annotateEdge(edge()).confidenceSource, "suggestion");

  const none = createConfidenceSuggestionService({ ontologyData: ONTOLOGY, articleCoverage: coverage({}) });
  assert.equal(none.annotateEdge(edge()).confidenceSource, "none");
});

test("C3 确定性：同输入（含固定 now）两跑输出一致", () => {
  const cov = coverage({ p2: new Set(["tech:a", "tech:b"]), p1: new Set(["tech:a", "tech:b"]) });
  const mk = () => createConfidenceSuggestionService({ ontologyData: ONTOLOGY, articleCoverage: cov, now: () => "2026-10-24T00:00:00Z", sourceRevision: "abc123" });
  const a = mk().annotateEdges([edge()]);
  const b = mk().annotateEdges([edge()]);
  assert.deepEqual(a, b);
  assert.deepEqual(a[0].suggestedConfidenceEvidence.articleRefs, ["p1", "p2"], "证据引用排序稳定");
});

test("C4 证据记录随行：refs＋计数＋observedAt＋revision", () => {
  const svc = createConfidenceSuggestionService({
    ontologyData: ONTOLOGY,
    articleCoverage: coverage({ p1: new Set(["tech:a", "tech:b"]), p2: new Set(["tech:a", "tech:b"]) }),
    now: () => "2026-10-24T00:00:00Z",
    sourceRevision: "rev9",
  });
  const ev = svc.annotateEdge(edge()).suggestedConfidenceEvidence;
  assert.deepEqual(ev.articleRefs, ["p1", "p2"]);
  assert.equal(ev.cooccurrenceCount, 2);
  assert.equal(ev.observedAt, "2026-10-24T00:00:00Z");
  assert.equal(ev.sourceRevision, "rev9");
});

// ── WP-142 批⓪（SPEC-091 §一 R9-3）：suggestedConfidenceBand 预填换算 ──
test("WP-142 scoreToBand 换算：0.87→high／0.6→medium／0.2→low（阈值取自单源缺省）", () => {
  const bandValues = confidenceBandValues(ONTOLOGY); // 本体未声明 band_* → 规范缺省（单源）
  assert.equal(scoreToBand(0.87, bandValues), "high", "≥ high 代表值归 high");
  assert.equal(scoreToBand(0.6, bandValues), "medium", "≥ medium 代表值归 medium");
  assert.equal(scoreToBand(0.2, bandValues), "low", "有建议分即至少 low 档");
  assert.equal(scoreToBand(null, bandValues), null, "score 非法/null＝无档位可预填");
  assert.equal(scoreToBand(Number.NaN, bandValues), null, "非有限数＝非法");
});

test("WP-142 预填档位与本体声明同源：band_* 声明覆盖时按声明值换算", () => {
  // 缺省 medium=0.5：0.52 归 medium；本体声明 band_medium=0.55 后同分归 low——判定随声明走，零手抄
  const defaults = confidenceBandValues(ONTOLOGY);
  assert.equal(scoreToBand(0.52, defaults), "medium");
  const declared = confidenceBandValues({ ...ONTOLOGY, confidence_suggestion: { ...ONTOLOGY.confidence_suggestion, band_medium: 0.55 } });
  assert.equal(scoreToBand(0.52, declared), "low", "声明覆盖阈值后按声明值换算");
});

test("WP-142 annotateEdge：有建议分即随行下发预填档位；无建议分字段缺省", () => {
  const cov = coverage({ p1: new Set(["tech:a", "tech:b"]), p2: new Set(["tech:a", "tech:b"]) });
  const svc = createConfidenceSuggestionService({ ontologyData: ONTOLOGY, articleCoverage: cov });
  const row = svc.annotateEdge(edge()); // 2 篇共现 → 建议值 ≈0.52（>medium 代表值 0.5）
  assert.notEqual(row.suggestedConfidence, undefined, "建议分在场");
  assert.equal(row.suggestedConfidenceBand, "medium", "预填档位随建议同行下发且与代表值同源判定");
  const none = createConfidenceSuggestionService({ ontologyData: ONTOLOGY, articleCoverage: coverage({}) });
  const empty = none.annotateEdge(edge()); // 证据 <2 篇不生效不显示
  assert.equal(empty.suggestedConfidence, undefined);
  assert.equal(empty.suggestedConfidenceBand, undefined, "无建议时预填档位字段缺省（前端回落「不评分位」）");
});

// ── C9 四槽回退链（引擎 resolver 注入面）──
test("C9 回退链：resolver 档位置顶覆盖原生 1.0；resolver 异常 fail-safe 保持既有值", () => {
  const { createInferenceEngine } = require("../inference-engine.cjs");
  const ontology = {
    relations: new Map([["DEPENDS_ON", { registeredForInference: true, weight: 1, impactPropagation: "forward" }]]),
    rules: [],
  };
  const graph = {
    nodes: [{ id: "a" }, { id: "b" }],
    connections: [{ from: "a", to: "b", relationType: "DEPENDS_ON", confidence: 1, properties: { reviewStatus: "pending" } }],
  };
  const bandEngine = createInferenceEngine({ ontology, resolveEdgeConfidence: () => ({ confidence: 0.5, confidenceSource: "band" }) });
  const r1 = bandEngine.infer({ graph, seedNodeIds: ["a"] });
  assert.equal(r1.affected[0].confidence, 0.5, "band 档位置顶覆盖原生 1.0（覆盖优先）");

  const failEngine = createInferenceEngine({ ontology, resolveEdgeConfidence: () => { throw new Error("resolver boom"); } });
  const r2 = failEngine.infer({ graph, seedNodeIds: ["a"] });
  assert.equal(r2.affected[0].confidence, 1, "resolver 异常 fail-safe＝原生值不变");

  const noResolver = createInferenceEngine({ ontology });
  const r3 = noResolver.infer({ graph, seedNodeIds: ["a"] });
  assert.equal(r3.affected[0].confidence, 1, "无 resolver＝既有行为不变");
});

test("C9 回退链：无值边经 resolver 吃建议值（confidenceExplicit 判据）", () => {
  const { createInferenceEngine } = require("../inference-engine.cjs");
  const ontology = { relations: new Map([["DEPENDS_ON", { registeredForInference: true, weight: 1, impactPropagation: "forward" }]]), rules: [] };
  const graph = {
    nodes: [{ id: "a" }, { id: "b" }],
    connections: [{ from: "a", to: "b", relationType: "DEPENDS_ON", properties: {} }], // 无 confidence
  };
  const engine = createInferenceEngine({ ontology, resolveEdgeConfidence: (edge) => (edge.confidenceExplicit ? null : { confidence: 0.6, confidenceSource: "suggestion" }) });
  const r = engine.infer({ graph, seedNodeIds: ["a"] });
  assert.equal(r.affected[0].confidence, 0.6, "无值边（缺省 0.5）被建议值 0.6 顶替");
  assert.equal(r.affected[0].traces[0].hops[0].edgeConfidence, 0.6);
});

// ── 红队复核修复回归（R2/R3/R4/R6/R10/R12/R13）──
test("R4 值域与序校验：prior≤floor／越界＝该类型不参与（fail-safe 非炸）", () => {
  const ont = { relation_types: {
    INVERTED: { confidence_prior: 0.3, confidence_floor: 0.8 },   // 倒置
    OVERFLOW: { confidence_prior: 7.5, confidence_floor: 2 },     // 越界
    OK: { confidence_prior: 0.8, confidence_floor: 0.4 },
  }, confidence_suggestion: { cooccurrence_cap: 10 } };
  const svc = createConfidenceSuggestionService({ ontologyData: ont, articleCoverage: coverage({ p1: new Set(["a", "b"]), p2: new Set(["a", "b"]) }) });
  assert.equal(svc.typeConfig("INVERTED"), null);
  assert.equal(svc.typeConfig("OVERFLOW"), null);
  assert.notEqual(svc.typeConfig("OK"), null);
  assert.equal(svc.annotateEdge(edge({ source: "a", target: "b", type: "INVERTED" })).suggestedConfidence, undefined);
});

test("R12 cap 护栏：cap<2 回落 10（渐进语义不退化）", () => {
  const svc = createConfidenceSuggestionService({ ontologyData: { relation_types: { DEPENDS_ON: { confidence_prior: 0.8, confidence_floor: 0.4 } }, confidence_suggestion: { cooccurrence_cap: 1 } }, articleCoverage: coverage({}) });
  const s = svc.suggest("DEPENDS_ON", ["p1", "p2"]);
  assert.ok(s > 0.4 && s < 0.8, "cap=1 被护栏回落 10——2 篇不直达先验");
});

test("R6 结构边连 band 槽也排除（不参与建议「与置信度」）", () => {
  const band = [{ endpoint_domain: "graph", type: "BELONGS_TO", source: "ref:x", target: "ref", confidence_band: "high" }];
  const svc = createConfidenceSuggestionService({ ontologyData: ONTOLOGY, articleCoverage: coverage({}), listRelationBands: () => band });
  assert.equal(svc.annotateEdge(edge({ source: "ref:x", target: "ref", type: "BELONGS_TO", properties: { source: "auto-discovered" } })).confidenceSource, "none");
});

test("R10 读侧防腐：非法档位枚举＝无 band", () => {
  const band = [{ endpoint_domain: "graph", type: "DEPENDS_ON", source: "tech:a", target: "tech:b", confidence_band: "ultra" }];
  const svc = createConfidenceSuggestionService({ ontologyData: ONTOLOGY, articleCoverage: coverage({}), listRelationBands: () => band });
  assert.equal(svc.annotateEdge(edge()).confidenceSource, "none");
});

test("R13 建议字段独立于槽位：band/native 在位时仍呈现机器对照面", () => {
  const cov = coverage({ p1: new Set(["tech:a", "tech:b"]), p2: new Set(["tech:a", "tech:b"]) });
  const band = [{ endpoint_domain: "graph", type: "DEPENDS_ON", source: "tech:a", target: "tech:b", confidence_band: "high" }];
  const withBand = createConfidenceSuggestionService({ ontologyData: ONTOLOGY, articleCoverage: cov, listRelationBands: () => band });
  const row = withBand.annotateEdge(edge());
  assert.equal(row.confidenceSource, "band");
  assert.notEqual(row.suggestedConfidence, undefined, "建议对照面不因 band 覆盖消失");
  const nat = createConfidenceSuggestionService({ ontologyData: ONTOLOGY, articleCoverage: cov });
  assert.notEqual(nat.annotateEdge(edge({ confidence: 1 })).suggestedConfidence, undefined, "native 边同样保留建议对照");
});

test("R9 band 代表值本体声明优先", () => {
  const svc = createConfidenceSuggestionService({ ontologyData: { ...ONTOLOGY, confidence_suggestion: { cooccurrence_cap: 10, band_high: 0.9 } }, articleCoverage: coverage({}), listRelationBands: () => [{ endpoint_domain: "graph", type: "DEPENDS_ON", source: "tech:a", target: "tech:b", confidence_band: "high" }] });
  assert.equal(svc.annotateEdge(edge()).effectiveConfidence, 0.9);
});

test("R2/R3 引擎面：显式 0.5 不被建议顶替；resolver 越界值弃用", () => {
  const { createInferenceEngine } = require("../inference-engine.cjs");
  const ontology = { relations: new Map([["DEPENDS_ON", { registeredForInference: true, weight: 1, impactPropagation: "forward" }]]), rules: [] };
  const graph = {
    nodes: [{ id: "a" }, { id: "b" }],
    connections: [{ from: "a", to: "b", relationType: "DEPENDS_ON", confidence: 0.5, properties: {} }], // 显式原生 0.5
  };
  const engine = createInferenceEngine({ ontology, resolveEdgeConfidence: (edge) => (edge.confidenceExplicit ? null : { confidence: 0.6, confidenceSource: "suggestion" }) });
  const r = engine.infer({ graph, seedNodeIds: ["a"] });
  assert.equal(r.affected[0].confidence, 0.5, "显式 0.5＝native，建议不顶替（confidenceExplicit 判据复活）");

  const over = createInferenceEngine({ ontology, resolveEdgeConfidence: () => ({ confidence: 2, confidenceSource: "band" }) });
  const r2 = over.infer({ graph, seedNodeIds: ["a"] });
  assert.equal(r2.affected[0].confidence, 0.5, "resolver 越界（2）＝弃用，回原生值");
});

// ── 红队二轮 NEW-1：结构判据在引擎路径（适配器同款转接）保持排除 ──
test("NEW-1 引擎面：结构边经 main 同款适配器不吃 band/建议（structural 透传）", () => {
  const { createInferenceEngine } = require("../inference-engine.cjs");
  const ontology = { relations: new Map([["REFERENCES", { registeredForInference: true, weight: 1, impactPropagation: "forward" }]]), rules: [] };
  const graph = {
    nodes: [{ id: "a" }, { id: "b" }],
    connections: [{ from: "a", to: "b", relationType: "REFERENCES", properties: { source: "auto-discovered" } }], // 结构边
  };
  const bandRow = [{ endpoint_domain: "graph", type: "REFERENCES", source: "a", target: "b", confidence_band: "high" }];
  const svc = createConfidenceSuggestionService({ ontologyData: ONTOLOGY, articleCoverage: coverage({ p1: new Set(["a", "b"]), p2: new Set(["a", "b"]) }), listRelationBands: () => bandRow });
  // main.cjs 适配器同款：structural → properties.source 转接
  const adapter = (edge) => {
    const a = svc.annotateEdge({ source: edge.source, target: edge.target, type: edge.type, confidence: edge.confidenceExplicit ? edge.confidence : undefined, properties: edge.structural ? { source: "auto-discovered" } : {} });
    return a.effectiveConfidence !== undefined ? { confidence: a.effectiveConfidence, confidenceSource: a.confidenceSource } : null;
  };
  const engine = createInferenceEngine({ ontology, resolveEdgeConfidence: adapter });
  const r = engine.infer({ graph, seedNodeIds: ["a"] });
  assert.equal(r.affected[0].confidence, 0.5, "结构边不吃 band 0.85 也不吃建议——保持 0.5 兜底（C9 引擎面成立）");
});
