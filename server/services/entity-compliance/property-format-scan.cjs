// @responsible: property-gov 格式扫描（Rule 10 字面量残留检查）——seq203 自 property-governance-service.cjs
// 拆出（规则 2：触及超限文件必须先拆再改）。本模块即 FIELDS_TO_SCAN 词表唯一事实源：
// 前端 FormatArtifactCard.PROPOSAL_FIELDS 为其投影（− "label"），由
// server/services/__tests__/property-gov-wordlist-projection.test.cjs 锁死，改词表必须双端同步。
var FIELDS_TO_SCAN = ["module", "label", "arch_layer", "arch_category", "arch_status", "arch_subdomain"];

// 原则6 单源：格式扫描哨兵值的唯一具名常量。语义 = 字段值是复杂对象字面量，
// 自动归一化不可靠，须人工确认后才可写回。前端不得再内联此字面量（改判 requiresManualConfirm 布尔）。
var COMPLEX_OBJECT_PLACEHOLDER = "(复杂对象，需人工处理)";

/**
 * Scan component string fields for Python/JS literal artifacts (Rule 10).
 */
function checkFormat(component) {
  var artifacts = [];

  for (var i = 0; i < FIELDS_TO_SCAN.length; i++) {
    var field = FIELDS_TO_SCAN[i];
    var raw = component[field];

    if (typeof raw === "string") {
      var trimmed = raw.trim();
      // Detect Python list literal: ['...'] or ['...', '...']
      if (trimmed.indexOf("[") === 0 && trimmed.indexOf("]") > 1) {
        var cleaned = trimmed.replace(/^\[?'?|'?\]?$/g, "").replace(/^\[|\]$/g, "").replace(/'/g, "").trim();
        artifacts.push({ field: field, rawValue: trimmed, normalizedValue: cleaned });
      }
      // Detect Python dict/JS object literal: {...}
      else if (trimmed.indexOf("{") === 0 && trimmed.indexOf("}") > 1) {
        artifacts.push({ field: field, rawValue: trimmed, normalizedValue: COMPLEX_OBJECT_PLACEHOLDER, requiresManualConfirm: true });
      }
    }

    if (field === "module" && Array.isArray(raw)) {
      var firstItem = raw.length > 0 ? String(raw[0]).trim() : "";
      artifacts.push({ field: "module", rawValue: "[" + raw.map(String).join(", ") + "]", normalizedValue: firstItem });
    }
  }

  return {
    format_artifact: { passed: artifacts.length === 0, artifacts: artifacts },
  };
}

module.exports = { FIELDS_TO_SCAN: FIELDS_TO_SCAN, COMPLEX_OBJECT_PLACEHOLDER: COMPLEX_OBJECT_PLACEHOLDER, checkFormat: checkFormat };
