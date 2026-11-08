// Component: Derived-Projections-Regenerator
// @responsible: 写路径联动重生成 TheSchema 派生物（SPEC-020 波 2）——fields/enums/versions 任一写入
//               成功后同步重生成 resolved-domains.json（配方解析物）。失败记 warn 不回滚本体
//               （派生物可重生成——fields-write-service 投影联动先例同款；漂移兜底＝第 32 号门禁）。
// @inputs: vaultPath（三源自读）
// @outputs: 重写 TheSchema 解析物 resolved-domains.json（经 theschema-root 解析——SPEC-023 迁仓后=data/theschema/）
// @context: 复用 project-resolved-domains.mjs 导出的 buildResolvedArtifacts（防两份生成逻辑）；
//           CJS 侧动态 import mjs——fields-write-service 已验证的合法通道。
const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");
const { replaceTheSchemaFile } = require("./theschema-write.cjs"); // WP-079 唯一门：TheSchema 写通道由咽喉按落点选，服务侧禁自判
// （旧直连 repo-schema-io 已退役——派生物落点同样经咽喉分流：仓内主源＝git 即账，vault 侧＝vault-io）

const { resolveTheSchemaDir } = require("./theschema-root.cjs");

async function regenerateResolvedDomains(vaultPath, logger) {
  const log = logger || console;
  const dir = resolveTheSchemaDir(vaultPath);
  if (!fs.existsSync(path.join(dir, "fields.yaml"))) return false; // 无字段字典的 vault（测试夹具）——无配方可解析，静默跳过
  const readYaml = (name) => {
    const p = path.join(dir, name);
    return fs.existsSync(p) ? YAML.parse(fs.readFileSync(p, "utf8")) || {} : {};
  };
  const { buildResolvedArtifacts } = await import("../../scripts/quality/project-resolved-domains.mjs");
  const output = buildResolvedArtifacts({ fields: readYaml("fields.yaml"), enums: readYaml("enums.yaml"), versions: readYaml("versions.yaml") });
  replaceTheSchemaFile(path.join(dir, "resolved-domains.json"), output, { summary: "resolved-domains 联动重生成" });
  return true;
}

/** best-effort 包装：失败记 warn 不抛（本体已落盘，派生物由门禁兜底）。 */
async function regenerateResolvedDomainsBestEffort(vaultPath, logger, sourceEvent) {
  const log = logger || console;
  try {
    await regenerateResolvedDomains(vaultPath, logger);
    return true;
  } catch (e) {
    log.warn({ event: "resolved-domains-sync-failed", source: sourceEvent || "unknown", error: e.message, reason: "解析物重生成失败——本体已落盘，跑 npm run project:resolved-domains 补齐" });
    return false;
  }
}

module.exports = { regenerateResolvedDomains, regenerateResolvedDomainsBestEffort };
