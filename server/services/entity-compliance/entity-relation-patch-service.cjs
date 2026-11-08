// Component: Entity-Relation-Patch-Service
// @responsible: 校验结构化 relationPatch、解析稳定目标 ID并生成坐标化正文补丁。
// @inputs: Vault entity、relationPatch、Schema 关系类型
// @outputs: nextRaw/sourceCoordinate/resolvedTarget/expectedEdge
// @context: Vault

const crypto = require("crypto");
const fs = require("fs");
const { scanEntities } = require("./entity-source-scanner.cjs");
const { isSemverLike, compareSemver } = require("./entity-compliance-helpers.cjs");

const { createError: relationError } = require("../../shared/error-factory.cjs");
function hash(value) { return "sha256:" + crypto.createHash("sha256").update(value).digest("hex"); }
function buildEffectiveSuffix(since, until) {
  const s = (since === undefined || since === null || since === "") ? "" : String(since);
  const u = (until === undefined || until === null || until === "") ? "" : String(until);
  if (s === "" && u === "") return "";
  return " @effective(since=" + s + ", until=" + u + ")";
}
function validateVersionRange(versionRange, options) {
  if (!versionRange || typeof versionRange !== "object") return { since: "", until: "" };
  const since = typeof versionRange.since === "string" ? versionRange.since.trim() : "";
  const until = typeof versionRange.until === "string" ? versionRange.until.trim() : "";
  if (since === "" && until === "") return { since: "", until: "" };
  const versionableRelations = options.versionableRelations || new Set();
  const allRegisteredVersions = options.allRegisteredVersions || [];
  if (!versionableRelations.has(options.relationType)) throw relationError("VERSION_NOT_ALLOWED", "关系类型 " + options.relationType + " 不支持版本范围", 422);
  if (since !== "" && !isSemverLike(since)) throw relationError("VERSION_RANGE_INVALID", "since 不是合法版本格式: " + since, 422);
  if (until !== "" && !isSemverLike(until)) throw relationError("VERSION_RANGE_INVALID", "until 不是合法版本格式: " + until, 422);
  if (allRegisteredVersions.length === 0) throw relationError("VERSION_REGISTRY_UNAVAILABLE", "产品版本注册表为空，不能确认关系生效范围", 422);
  if (since !== "" && !allRegisteredVersions.includes(since)) throw relationError("VERSION_NOT_REGISTERED", "版本 " + since + " 未在产品版本注册表中登记", 422);
  if (until !== "" && !allRegisteredVersions.includes(until)) throw relationError("VERSION_NOT_REGISTERED", "版本 " + until + " 未在产品版本注册表中登记", 422);
  if (since !== "" && until !== "" && compareSemver(since, until) >= 0) throw relationError("VERSION_RANGE_INVERTED", "版本区间倒置: since=" + since + " >= until=" + until, 422);
  return { since: since, until: until };
}
function escapePattern(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function sameFile(left, right) {
  try { return fs.realpathSync(left) === fs.realpathSync(right); } catch (_error) { return left === right; }
}
function selectedEntity(entities, sourcePath) { return entities.find((item) => sameFile(item.file, sourcePath)); }
function uniqueById(entities, id) {
  const matches = entities.filter((item) => item.id === id);
  if (matches.length !== 1) throw relationError("RELATION_TARGET_AMBIGUOUS", "关系目标必须解析到唯一 architecture-node-id", 409, { targetId: id, matches: matches.map((item) => item.file) });
  return matches[0];
}
function listRelationTargetOptions(vaultPath, excludedId) {
  return scanEntities(vaultPath)
    .filter((item) => item.id && item.id !== excludedId)
    .map((item) => ({ id: item.id, label: item.title || item.id }));
}
function labelFor(ruleSet, relationType) {
  const labels = ruleSet.wikilinkTypeLabels || {};
  // 关系类型来自请求体：普通取值会把 constructor/toString 当已注册标签放行（写侧穿透）。
  if (Object.prototype.hasOwnProperty.call(labels, relationType)) return { label: relationType, normalized: labels[relationType] };
  const hit = Object.entries(labels).find(([, normalized]) => normalized === relationType);
  if (!hit) throw relationError("UNSUPPORTED_RELATION_TYPE", "关系类型未在 Schema 注册", 422);
  return { label: hit[0], normalized: hit[1] };
}
function parseTypedRelationLine(line, ruleSet) {
  if (typeof line !== "string") return null;
  const labels = ruleSet.wikilinkTypeLabels || {};
  for (const [label, normalized] of Object.entries(labels)) {
    const pattern = new RegExp("^[\\t ]*(?:-[\\t ]*)?" + escapePattern(label) + "[\\t ]*::[\\t ]*\\[\\[([^|\\]]+)(?:\\|[^\\]]*)?\\]\\](?: @effective\\(since=([^,]*), until=([^)]*)\\))?[ \\t]*$");
    const match = line.match(pattern);
    if (match) {
      return {
        relationType: normalized,
        label,
        targetId: match[1].trim(),
        versionRange: { since: (match[2] || "").trim(), until: (match[3] || "").trim() },
      };
    }
  }
  return null;
}
function removableRelationLines(raw, ruleSet, originalTarget) {
  const labels = Object.keys(ruleSet.wikilinkTypeLabels || {});
  if (!labels.length) throw relationError("UNSUPPORTED_RELATION_TYPE", "Schema 未登记可处理的关系类型", 422);
  const labelPattern = labels.map(escapePattern).join("|");
  const targetPattern = escapePattern(originalTarget);
  const linePattern = new RegExp("^[\\t ]*(?:-[\\t ]*)?(?:" + labelPattern + ")[\\t ]*::[\\t ]*\\[\\[" + targetPattern + "(?:\\|[^\\]]*)?\\]\\](?: @effective\\([^)]*\\))?[ \\t]*$");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const lines = raw.split(/\r?\n/);
  const indexes = [];
  for (let index = 0; index < lines.length; index++) if (linePattern.test(lines[index])) indexes.push(index);
  return { eol, lines, indexes };
}
function buildRelationPatch(options) {
  const { vaultPath, sourcePath, relationPatch, ruleSet } = options;
  if (!relationPatch || !["add", "replace", "remove", "retarget", "remove-target", "remove-targets"].includes(relationPatch.operation)) throw relationError("VALIDATION_ERROR", "operation 不受支持", 400);
  if (relationPatch.operation === "remove-targets") {
    const entities = scanEntities(vaultPath); const selected = selectedEntity(entities, sourcePath);
    if (!selected || !selected.id) throw relationError("VALIDATION_ERROR", "当前 entity 缺少稳定 architecture-node-id", 422);
    const originalTargets = Array.isArray(relationPatch.originalTargets) ? [...new Set(relationPatch.originalTargets.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean))] : [];
    if (!originalTargets.length) throw relationError("VALIDATION_ERROR", "必须选择至少一个无法解析的原目标", 400);
    const matches = originalTargets.map((originalTarget) => {
      const pattern = new RegExp("\\[\\[" + escapePattern(originalTarget) + "(?:\\|[^\\]]*)?\\]\\]", "g");
      const hits = Array.from(selected.raw.matchAll(pattern));
      if (hits.length !== 1) throw relationError("UNSAFE_BODY_PATCH", "每个无法解析的原目标必须在正文中唯一出现", 422, { originalTarget, matches: hits.length });
      return { originalTarget, pattern, hit: hits[0] };
    });
    let nextRaw = selected.raw;
    matches.forEach((item) => { nextRaw = nextRaw.replace(item.pattern, ""); });
    const startByte = Math.min(...matches.map((item) => Buffer.byteLength(selected.raw.slice(0, item.hit.index))));
    const endByte = Math.max(...matches.map((item) => Buffer.byteLength(selected.raw.slice(0, item.hit.index)) + Buffer.byteLength(item.hit[0])));
    return {
      sourcePath: selected.file, nextRaw,
      sourceCoordinate: { startByte, endByte, blockHash: hash(matches.map((item) => item.hit[0]).join("\n")), fileRevision: hash(selected.raw) },
      resolvedTarget: null, expectedEdge: null,
      bodyPatch: { before: originalTargets.map((target) => `[[${target}]]`), after: [] },
    };
  }
  if (relationPatch.operation === "remove-target") {
    const entities = scanEntities(vaultPath); const selected = selectedEntity(entities, sourcePath);
    if (!selected || !selected.id) throw relationError("VALIDATION_ERROR", "当前 entity 缺少稳定 architecture-node-id", 422);
    if (typeof relationPatch.originalTarget !== "string" || !relationPatch.originalTarget.trim()) throw relationError("VALIDATION_ERROR", "必须选择无法解析的原目标", 400);
    const originalTarget = relationPatch.originalTarget.trim();
    const match = removableRelationLines(selected.raw, ruleSet, originalTarget);
    if (!match.indexes.length) throw relationError("UNSAFE_BODY_PATCH", "未找到可安全删除的完整关系行", 422, { originalTarget, matches: 0 });
    const removedLines = match.indexes.map((index) => match.lines[index]);
    const firstIndex = match.indexes[0]; const lastIndex = match.indexes[match.indexes.length - 1];
    const startByte = Buffer.byteLength(match.lines.slice(0, firstIndex).join(match.eol) + (firstIndex ? match.eol : ""));
    const endByte = Buffer.byteLength(match.lines.slice(0, lastIndex + 1).join(match.eol));
    const indexes = new Set(match.indexes);
    const nextRaw = match.lines.filter((_line, index) => !indexes.has(index)).join(match.eol);
    return {
      sourcePath: selected.file, nextRaw,
      sourceCoordinate: { startByte, endByte, blockHash: hash(removedLines.join(match.eol)), fileRevision: hash(selected.raw) },
      resolvedTarget: null, expectedEdge: null,
      bodyPatch: { before: removedLines, after: [] },
    };
  }
  if (relationPatch.operation === "retarget") {
    const entities = scanEntities(vaultPath); const selected = selectedEntity(entities, sourcePath);
    if (!selected || !selected.id) throw relationError("VALIDATION_ERROR", "当前 entity 缺少稳定 architecture-node-id", 422);
    const target = uniqueById(entities, relationPatch.targetId);
    if (target && target.id === selected.id) throw relationError("SELF_RELATION_NOT_ALLOWED", "不能把无法解析的链接替换为当前组件自身", 422);
    if (typeof relationPatch.originalTarget !== "string" || !relationPatch.originalTarget.trim()) throw relationError("VALIDATION_ERROR", "必须选择无法解析的原目标", 400);
    const originalTarget = relationPatch.originalTarget.trim();
    const linkPattern = new RegExp("\\[\\[" + escapePattern(originalTarget) + "(?:\\|[^\\]]*)?\\]\\]", "g");
    const matches = Array.from(selected.raw.matchAll(linkPattern));
    if (matches.length !== 1) throw relationError("UNSAFE_BODY_PATCH", "无法解析的原目标必须在正文中唯一出现", 422, { originalTarget, matches: matches.length });
    const startByte = Buffer.byteLength(selected.raw.slice(0, matches[0].index));
    const nextRaw = selected.raw.replace(linkPattern, `[[${target.id}]]`);
    return {
      sourcePath: selected.file,
      nextRaw,
      sourceCoordinate: { startByte, endByte: startByte + Buffer.byteLength(matches[0][0]), blockHash: hash(matches[0][0]), fileRevision: hash(selected.raw) },
      resolvedTarget: { id: target.id, title: target.title, sourcePath: target.file },
      expectedEdge: null,
      bodyPatch: { before: `[[${originalTarget}]]`, after: `[[${target.id}]]` },
    };
  }
  if (!relationPatch.direction || !["outgoing", "incoming"].includes(relationPatch.direction)) throw relationError("RELATION_DIRECTION_REQUIRED", "必须确认关系方向", 422);
  const entities = scanEntities(vaultPath); const selected = selectedEntity(entities, sourcePath);
  if (!selected || !selected.id) throw relationError("VALIDATION_ERROR", "当前 entity 缺少稳定 architecture-node-id", 422);
  const target = uniqueById(entities, relationPatch.targetId); const relation = labelFor(ruleSet, relationPatch.relationType);
  if (relationPatch.operation !== "remove" && target.id === selected.id) throw relationError("SELF_RELATION_NOT_ALLOWED", "不能新增或替换指向当前组件自身的关系", 422);
  const writeEntity = relationPatch.direction === "outgoing" ? selected : target;
  const linkId = relationPatch.direction === "outgoing" ? target.id : selected.id;
  const edgeSource = relationPatch.direction === "outgoing" ? selected.id : target.id;
  const edgeTarget = relationPatch.direction === "outgoing" ? target.id : selected.id;
  const eol = writeEntity.raw.includes("\r\n") ? "\r\n" : "\n";
  const lines = writeEntity.raw.split(/\r?\n/);
  const matches = [];
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseTypedRelationLine(lines[i], ruleSet);
    if (parsed && parsed.relationType === relation.normalized && (relationPatch.operation === "replace" || parsed.targetId === linkId)) matches.push(i);
  }
  // Validate and normalize version range against relation capability registry
  const effective = validateVersionRange(relationPatch.versionRange, {
    relationType: relation.normalized,
    versionableRelations: ruleSet.versionableRelations || new Set(),
    allRegisteredVersions: ruleSet.allRegisteredVersions || [],
  });
  const effectiveSuffix = buildEffectiveSuffix(effective.since, effective.until);
  if (relationPatch.operation === "add") {
    if (!matches.length) { if (lines[lines.length - 1] !== "") lines.push(""); lines.push(relation.label + "::[[" + linkId + "]]" + effectiveSuffix); }
  } else {
    if (matches.length !== 1) throw relationError("UNSAFE_BODY_PATCH", "关系行无法唯一定位", 422, { matches: matches.length });
    if (relationPatch.operation === "remove") lines.splice(matches[0], 1); else lines[matches[0]] = relation.label + "::[[" + linkId + "]]" + effectiveSuffix;
  }
  const nextRaw = lines.join(eol);
  const beforeLine = matches.length === 1 ? writeEntity.raw.split(/\r?\n/)[matches[0]] : "";
  const byteOffset = matches.length === 1 ? Buffer.byteLength(writeEntity.raw.split(/\r?\n/).slice(0, matches[0]).join(eol) + (matches[0] ? eol : "")) : Buffer.byteLength(writeEntity.raw);
  return {
    sourcePath: writeEntity.file, nextRaw,
    sourceCoordinate: { startByte: byteOffset, endByte: byteOffset + Buffer.byteLength(beforeLine), blockHash: hash(beforeLine), fileRevision: hash(writeEntity.raw) },
    resolvedTarget: { id: target.id, title: target.title, sourcePath: target.file },
    expectedEdge: { source: edgeSource, target: edgeTarget, relationType: relation.normalized, direction: "outgoing", operation: relationPatch.operation, versionRange: effective },
    bodyPatch: { before: beforeLine, after: relationPatch.operation === "remove" ? "" : relation.label + "::[[" + linkId + "]]" + effectiveSuffix },
  };
}
module.exports = { buildRelationPatch, listRelationTargetOptions, buildEffectiveSuffix, validateVersionRange, parseTypedRelationLine };
