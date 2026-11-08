// Component: Edge-Identity
// @responsible: Stable identity for reviewable graph edges across API/UI/writeback.
// @inputs: 图谱边、证据来源与审核请求身份字段
// @outputs: 稳定 edgeId、规范身份字段与匹配结果
// @context: Canvas
const crypto = require("crypto");

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function firstSource(edge) {
  var props = edge && edge.properties ? edge.properties : {};
  var sources = Array.isArray(props.sources) ? props.sources : [];
  return sources.length > 0 && sources[0] && typeof sources[0] === "object" ? sources[0] : {};
}

function relationType(edge) {
  return asString(edge && (edge.relationType || edge.type));
}

function sourceFile(edge) {
  var src = firstSource(edge);
  return asString(edge && (edge.sourceFile || edge.source_file))
    || asString(src.file)
    || asString(edge && edge.properties && (edge.properties.sourceFile || edge.properties.source_file));
}

function lineNumber(edge) {
  var src = firstSource(edge);
  var value = edge && (edge.lineNumber || edge.line_number);
  if (value === undefined && edge && edge.properties) value = edge.properties.lineNumber || edge.properties.line_number;
  if (value === undefined) value = src.line_number || src.lineNumber;
  var n = Number(value);
  return Number.isFinite(n) && n > 0 ? String(Math.trunc(n)) : "";
}

function evidenceText(edge) {
  var src = firstSource(edge);
  return asString(edge && (edge.evidenceText || edge.evidence_text))
    || asString(edge && edge.properties && (edge.properties.evidenceText || edge.properties.evidence_text))
    || asString(src.evidence_text)
    || asString(src.evidenceText);
}

function evidenceHash(edge) {
  var explicit = asString(edge && (edge.evidenceHash || edge.evidence_hash))
    || asString(edge && edge.properties && (edge.properties.evidenceHash || edge.properties.evidence_hash));
  if (explicit) return explicit;
  var evidence = evidenceText(edge);
  if (!evidence) return "";
  return crypto.createHash("sha1").update(evidence).digest("hex").slice(0, 16);
}

function edgeIdentityParts(edge) {
  return {
    source: asString(edge && (edge.from || edge.source)),
    target: asString(edge && (edge.to || edge.target)),
    relationType: relationType(edge),
    sourceFile: sourceFile(edge),
    lineNumber: lineNumber(edge),
    evidenceHash: evidenceHash(edge),
  };
}

function stableEdgeId(edge) {
  // WP-053 V-B（红队发现 C 清偿）：边持久身份经身份入口（长度前缀编码）——与 Python
  // _edge_stable_id 字节同构（identity_port.make_id）。过渡期存量图混形态：本函数在 JS 读路径
  // 按段重算（不读存量 edgeId 值），legacy 兼容面见 edgeMatchesIdentity。
  var p = edgeIdentityParts(edge);
  var { makeId } = require("./identity-port.cjs");
  return makeId("edge-id", [p.source, p.target, p.relationType, p.sourceFile, p.lineNumber, p.evidenceHash]);
}

/** legacy 管道格式（过渡期存量：master_graph 旧边／评审账本旧载荷）——按 6 段重建旧串。 */
function legacyStableEdgeId(edge) {
  var p = edgeIdentityParts(edge);
  return [p.source, p.target, p.relationType, p.sourceFile, p.lineNumber, p.evidenceHash].join("|");
}

function identityFromPayload(payload) {
  return {
    edgeId: asString(payload && (payload.edgeId || payload.edge_id || payload.id)),
    source: asString(payload && (payload.source || payload.from)),
    target: asString(payload && (payload.target || payload.to)),
    relationType: asString(payload && (payload.relationType || payload.type)),
    sourceFile: asString(payload && (payload.sourceFile || payload.source_file)),
    lineNumber: asString(payload && (payload.lineNumber || payload.line_number)),
    evidenceHash: asString(payload && (payload.evidenceHash || payload.evidence_hash)),
  };
}

function edgeMatchesIdentity(edge, identity) {
  var edgeId = stableEdgeId(edge);
  if (identity.edgeId) {
    // WP-053 V-B legacy 兼容面：评审账本/存量图旧载荷持管道格式 edgeId——双格式等值比对
    // （新编码或 legacy 任一命中即匹配）；退役注记：master_graph --force 全量重建＋账本自然
    // 翻新后此面可摘（摘除须附破坏实验——SPEC-048 R2）。
    if (edgeId === identity.edgeId) return true;
    return legacyStableEdgeId(edge) === identity.edgeId;
  }

  var p = edgeIdentityParts(edge);
  if (!identity.source || !identity.target) return false;
  if (p.source !== identity.source || p.target !== identity.target) return false;
  if (identity.relationType && p.relationType !== identity.relationType) return false;
  if (identity.sourceFile && p.sourceFile !== identity.sourceFile) return false;
  if (identity.lineNumber && p.lineNumber !== identity.lineNumber) return false;
  if (identity.evidenceHash && p.evidenceHash !== identity.evidenceHash) return false;
  return true;
}

function decorateEdge(edge) {
  var p = edgeIdentityParts(edge);
  return {
    edgeId: stableEdgeId(edge),
    sourceFile: p.sourceFile,
    lineNumber: p.lineNumber ? Number(p.lineNumber) : undefined,
    evidenceHash: p.evidenceHash,
  };
}

module.exports = {
  decorateEdge,
  edgeIdentityParts,
  edgeMatchesIdentity,
  evidenceHash,
  identityFromPayload,
  stableEdgeId,
};
