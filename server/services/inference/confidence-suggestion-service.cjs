// Component: Confidence-Suggestion-Service（SPEC-027 C2-C5）
// @responsible: 边置信度建议值——查询时现算（零落盘、零写端点、同输入同输出）；证据记录随行；
//               建议永不改变 reviewStatus（「置信度不能替代授权或事实」——TALOS 同款原则）。
// @inputs: ontology 数据（relation_types 的 confidence_prior/floor＋confidence_suggestion.cooccurrence_cap）、
//          articleCoverage()（articleId → 覆盖节点 id 集）、listRelationBands()（relations.yaml 档位覆盖行）
// @outputs: annotateEdges(edgeRows) → 附 suggestedConfidence/suggestedConfidenceEvidence/confidenceSource 的行
// @context: SPEC-027 §四；轴分家后 weight_default 不再作置信度界（C1）；结构边不参与（C9 判据＝properties.source）
const { confidenceBandValues, BAND_VALUE_DEFAULTS } = require("../../shared/confidence-bands.cjs"); // WP-049 L4：档位单源（P6 五份手抄收敛）

function round6(value) { return Math.round(value * 1e6) / 1e6; }

// WP-142 批⓪（SPEC-091 §一 R9-3）：建议分数→预填档位判定（纯函数）。
// 预填档位判定与档位代表值同源（confidence-bands 单源）——bandValues 必须来自
// confidenceBandValues() 产出（本体声明优先），阈值零手抄；前端不换算，只消费本字段。
// 语义：score ≥ 代表值 high → "high"；≥ medium → "medium"；否则 → "low"（有建议分即至少 low 档）；
// score 非法/null 返回 null（无档位可预填，字段缺省）。null/undefined/空串不得经 Number() 隐式归 0
// （Number(null)===0 会把「无分」误判成 low 档），先显式拦截再做有限数校验。
function scoreToBand(score, bandValues) {
  if (score === null || score === undefined || score === "") return null;
  const n = Number(score);
  if (!Number.isFinite(n) || !bandValues || typeof bandValues !== "object") return null;
  if (n >= bandValues.high) return "high";
  if (n >= bandValues.medium) return "medium";
  return "low";
}

function createConfidenceSuggestionService({ ontologyData, articleCoverage, listRelationBands, now = () => new Date().toISOString(), sourceRevision = null } = {}) {
  if (!ontologyData || typeof ontologyData !== "object") throw new Error("confidence-suggestion: ontologyData required");
  const relations = ontologyData.relation_types || {};
  const suggestionConf = ontologyData.confidence_suggestion || {};
  const rawCap = Number(suggestionConf.cooccurrence_cap);
  // R12：cap 护栏——仅 ≥2 有效（<2 时渐进语义退化），非法回落 10
  const cap = Number.isFinite(rawCap) && rawCap >= 2 ? rawCap : 10;
  // R9：band 代表值本体声明优先＋护栏回落——单源住 confidence-bands.cjs（WP-049 L4）
  const bandValues = confidenceBandValues(ontologyData);

  function typeConfig(relationType) {
    const rel = relations[relationType];
    if (!rel || rel.confidence_prior === undefined || rel.confidence_floor === undefined) return null;
    const prior = Number(rel.confidence_prior);
    const floor = Number(rel.confidence_floor);
    // R4（红队）：prior∈(0,1]、floor∈[0,1)、prior>floor——倒置/越界＝声明缺陷，该类型不参与（fail-safe 非炸）
    if (!(prior > 0 && prior <= 1) || !(floor >= 0 && floor < 1) || !(prior > floor)) return null;
    return { prior, floor };
  }

  // 共现证据：同时覆盖两端的 文章集合（每篇文章对一对端点只计一次）
  function cooccurrence(source, target) {
    const coverage = typeof articleCoverage === "function" ? articleCoverage() : new Map();
    const refs = [];
    for (const [articleId, nodes] of coverage) {
      if (nodes.has(source) && nodes.has(target)) refs.push(articleId);
    }
    refs.sort();
    return refs;
  }

  // C2 公式：floor + min(1, log(n)/log(cap)) × (prior − floor)——饱和于 1，永不超越先验
  function suggest(relationType, refs) {
    const cfg = typeConfig(relationType);
    if (!cfg) return null;
    const n = refs.length;
    if (n < 2) return null; // 证据 <2 篇不生效不显示
    const ratio = cap > 1 ? Math.min(1, Math.log(n) / Math.log(cap)) : 1;
    return round6(cfg.floor + ratio * (cfg.prior - cfg.floor));
  }

  function bandFor(source, target, relationType) {
    const rows = typeof listRelationBands === "function" ? listRelationBands() : [];
    const row = rows.find((r) => r.endpoint_domain === "graph" && r.type === relationType && r.source === source && r.target === target);
    // R10：读侧防腐——非法枚举/查无代表值＝无 band（网关护写路径，这里护读路径）
    if (!row || !row.confidence_band || bandValues[row.confidence_band] === undefined) return null;
    return { band: row.confidence_band, value: bandValues[row.confidence_band] };
  }

  function annotateEdge(edge) {
    const props = edge && edge.properties && typeof edge.properties === "object" ? edge.properties : {};
    const row = { ...edge };
    const structural = props.source === "auto-discovered";
    // R6：结构边不参与建议「与置信度」——连 band 槽也排除（摆放事实无可评信心）
    const band = structural ? null : bandFor(edge.source, edge.target, edge.type);
    const nativeValue = edge.confidence !== undefined && edge.confidence !== null && edge.confidence !== "" ? edge.confidence : (props.confidence !== undefined ? props.confidence : undefined);
    // R13：建议字段独立于槽位——非结构边一律计算呈现（band/native 在位时作对照面，不吞建议）
    const refs = structural ? [] : cooccurrence(edge.source, edge.target);
    const suggested = suggest(edge.type, refs);

    let confidenceSource;
    let effectiveConfidence;
    if (band) { confidenceSource = "band"; effectiveConfidence = band.value; }
    else if (nativeValue !== undefined) { confidenceSource = "native"; effectiveConfidence = nativeValue; }
    else if (suggested !== null) { confidenceSource = "suggestion"; effectiveConfidence = suggested; }
    else { confidenceSource = "none"; effectiveConfidence = undefined; }

    row.confidenceSource = confidenceSource;
    if (effectiveConfidence !== undefined) row.effectiveConfidence = effectiveConfidence;
    if (suggested !== null) {
      row.suggestedConfidence = suggested;
      // WP-142 批⓪（SPEC-091 §一 R9-3）：预填档位随建议分数同行下发（阈值在服务端换算，
      // 与档位代表值同源 confidence-bands 单源，前端禁手抄）；评审可改，无建议时字段缺省。
      row.suggestedConfidenceBand = scoreToBand(suggested, bandValues);
      row.suggestedConfidenceEvidence = {
        articleRefs: refs,
        cooccurrenceCount: refs.length,
        observedAt: now(),
        sourceRevision,
      };
    }
    return row;
  }

  return { annotateEdges: (edges) => (Array.isArray(edges) ? edges : []).map(annotateEdge), annotateEdge, suggest, cooccurrence, typeConfig };
}

module.exports = { createConfidenceSuggestionService, scoreToBand, CONFIDENCE_BAND_VALUES: BAND_VALUE_DEFAULTS }; // BAND_VALUE_DEFAULTS 自单源模块再导出（消费面签名不变）
