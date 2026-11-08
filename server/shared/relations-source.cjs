// Component: Relations-Source（治理关系并源装载器）
// @responsible: EDGE-RELATION-GOV-001 对象本体批——为 edge 投影装载人工/治理关系源：
//   relations.yaml（实例账，①类 TheSchema）＋对象字典卡（端点对象 → 图节点侧供给）。
//   读取宽容（坏行跳过带 warn——投影 fail-open；严格校验在写通道 relations-write-service）。
// @inputs: vaultPath（TheSchema 解析链）、repo contracts/object-dictionary.json
// @outputs: loadGovernanceRelations({ vaultPath, logger }) → { objects, relations }
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");
const ROOT = path.resolve(__dirname, "..", "..");

function loadGovernanceRelations({ vaultPath, logger } = {}) {
  const warn = (event, extra) => {
    if (logger && typeof logger.warn === "function") logger.warn({ event, ...extra });
  };
  const out = { objects: [], relations: [] };

  // 端点对象侧：字典卡 → 图节点供给（node_id=object_id、label=canonical_name、category=object_kind）
  try {
    const dict = JSON.parse(fs.readFileSync(path.join(ROOT, "contracts", "object-dictionary.json"), "utf8"));
    out.objects = (dict.core_objects || []).map((c) => ({
      objectId: c.object_id,
      canonicalName: c.canonical_name,
      objectKind: c.object_kind || "business_object",
      subtype: c.subtype || null,
    }));
  } catch (error) {
    warn("relations-source-dictionary-load-failed", { error: error.message });
  }

  // 实例侧：relations.yaml（经 TheSchema 咽喉归一；文件缺省＝空账）
  try {
    const { resolveTheSchemaDir } = require("./theschema-root.cjs");
    const { normalizeDocument } = require("./theschema-loader.cjs");
    const filePath = path.join(resolveTheSchemaDir(vaultPath), "relations.yaml");
    if (fs.existsSync(filePath)) {
      const parsed = YAML.parse(fs.readFileSync(filePath, "utf8")) || {};
      const { data } = normalizeDocument("relations", parsed);
      const nameToObj = new Map(out.objects.map((o) => [o.canonicalName, o]));
      out.relations = (data.relations || [])
        .filter((row) => {
          // R14（SPEC-027 C11）：图域覆盖行端点＝图谱节点 id，本就不在字典——非悬空，静默跳过（治理投影面不消费图域行）
          if (row.endpoint_domain === "graph") return false;
          if (!nameToObj.has(row.source) || !nameToObj.has(row.target)) {
            warn("relations-source-endpoint-dangling-skipped", { source: row.source, target: row.target, type: row.type });
            return false;
          }
          return true;
        })
        .map((row) => ({
          source: row.source,
          target: row.target,
          type: row.type,
          note: row.note || "",
          assertedBy: row.asserted_by,
          assertedAt: row.asserted_at,
        }));
    }
  } catch (error) {
    warn("relations-source-load-failed", { error: error.message });
  }
  return out;
}

module.exports = { loadGovernanceRelations };
