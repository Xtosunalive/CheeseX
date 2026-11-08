const articleLifecycle = require("./article-lifecycle-paths.cjs");

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/").trim();
}

function vaultPathFromCoordinate(value) {
  const coordinate = normalizePath(value);
  if (!coordinate.startsWith("vault:")) return "";
  return coordinate.slice("vault:".length).split("#", 1)[0].trim();
}

function relationSourceEvidence(connection) {
  const properties = connection?.properties || {};
  const legacy = properties.inference_sources || connection?.inference_sources || [];
  const evidence = Array.isArray(legacy) ? legacy.map((item) => ({
    file: normalizePath(item?.file || item?.path),
    method: String(item?.method || item?.source || ""),
    confidence: item?.confidence,
    coordinate: "",
  })).filter((item) => item.file) : [];

  const coordinates = properties.inputCoordinates || properties.input_coordinates || [];
  for (const coordinate of Array.isArray(coordinates) ? coordinates : []) {
    const file = vaultPathFromCoordinate(coordinate);
    if (!file || evidence.some((item) => item.file === file)) continue;
    evidence.push({
      file,
      method: String(properties.ruleId || properties.rule_id || properties.source || "lineage"),
      confidence: properties.confidence,
      coordinate: String(coordinate),
    });
  }
  return evidence;
}

function sourceKind(sourcePath) {
  const value = normalizePath(sourcePath);
  if (articleLifecycle.hasFormalSegment(value)) return "standard_article";
  if (value.includes("wiki/entities/") || value.includes("wiki/concepts/")) return "wiki_entity";
  if (value.includes("raw/precleaned/")) return "raw_precleaned";
  if (value.includes("/raw/")) return "raw_candidate";
  return "raw_other";
}

module.exports = { relationSourceEvidence, sourceKind, vaultPathFromCoordinate };
