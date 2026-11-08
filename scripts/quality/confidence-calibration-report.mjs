#!/usr/bin/env node
// confidence-calibration-report.mjs — SPEC-027 §八 校准报告（第 3 步）
// @responsible: review_actions＋relations.yaml 档位＋本体现值三方对账 → 修订建议报告。
//   只读统计、零写路径；实际修订走 relations-write-service 同款写网关＋schema 修订审批（本脚本不写）。
// 用法：node scripts/quality/confidence-calibration-report.mjs [--out <path>]
//   缺省输出 stdout（可丢弃派生物——不落盘不加 --out）；样本不足类型输出「维持现值」不硬调。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIN_SAMPLE = 10; // 每类型最小样本——不足不硬调（防小样本噪声，SPEC §八）

const { confidenceBandValues } = require("../../server/shared/confidence-bands.cjs"); // WP-049 L4：档位单源＋读经端口
let BAND_VALUES = null; // 装载后从 ontology 声明派生（单源），消费点沿用本名

function readOntology(vaultPath) {
  const { loadVocabBundle } = require("../../server/shared/vocab-load-port.cjs");
  const bundle = loadVocabBundle(vaultPath, { files: ["ontology"] });
  const file = bundle.files.ontology;
  if (!file || file.state !== "present") throw new Error("ontology 缺件（信封装载）: " + bundle.dir);
  const { data } = { data: file.data };
  return data;
}

function reviewActions(dataDir) {
  const dbPath = path.join(dataDir, "runtime-state.db");
  if (!fs.existsSync(dbPath)) return [];
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare("SELECT action_json FROM review_actions").all().map((r) => JSON.parse(r.action_json));
  } finally { db.close(); }
}

function relationBands(vaultPath) {
  const { readRelationsFile } = require("../../server/services/schema-manager/relations-write-service.cjs");
  try {
    return (readRelationsFile(vaultPath).data.relations || []).filter((r) => r.endpoint_domain === "graph" && r.confidence_band);
  } catch { return []; }
}

const vaultPath = process.env.VAULT_PATH || (fs.existsSync(path.join(ROOT, ".env")) ? (fs.readFileSync(path.join(ROOT, ".env"), "utf8").match(/^VAULT_PATH=(.+)$/m) || [])[1]?.trim() : null);
if (!vaultPath) { console.error("VAULT_PATH 未解析（环境变量或 .env）——校准报告无法读本体/实例账"); process.exit(1); }
const dataDir = path.join(ROOT, "data");

const ontology = readOntology(vaultPath);
BAND_VALUES = confidenceBandValues(ontology); // WP-049 L4：从本体声明派生（单源，无手抄）
const actions = reviewActions(dataDir);
const bands = relationBands(vaultPath);
const cap = ontology.confidence_suggestion?.cooccurrence_cap ?? null;

const byType = {};
for (const a of actions) {
  const t = a.relationType || "UNKNOWN";
  byType[t] = byType[t] || { approved: 0, rejected: 0 };
  if (a.action === "approved") byType[t].approved += 1;
  else if (a.action === "rejected") byType[t].rejected += 1;
}
const bandsByType = {};
for (const b of bands) {
  bandsByType[b.type] = bandsByType[b.type] || [];
  bandsByType[b.type].push(BAND_VALUES[b.confidence_band]); // BAND_VALUES 在 main 装载后由 confidenceBandValues 派生
}

const report = {
  generated_at: new Date().toISOString(),
  sources: { review_actions: actions.length, graph_bands: bands.length, cooccurrence_cap: cap },
  principle: "校准只认最终裁决（含 rejected，防幸存者偏差）；样本不足不硬调；修订走写网关＋schema 审批，本报告零写路径",
  per_type: [],
};

for (const [type, rel] of Object.entries(ontology.relation_types || {})) {
  const stats = byType[type] || { approved: 0, rejected: 0 };
  const bandValues = bandsByType[type] || [];
  const n = stats.approved + stats.rejected;
  const current = {
    prior: rel.confidence_prior ?? null,
    floor: rel.confidence_floor ?? null,
    weight_default: rel.weight_default ?? null,
  };
  let recommendation = "维持现值";
  let rationale = null;
  if (n < MIN_SAMPLE && bandValues.length < MIN_SAMPLE) {
    rationale = `样本不足（裁决 ${n}＋档位 ${bandValues.length} < ${MIN_SAMPLE}）`;
  } else {
    const rejectRate = n > 0 ? stats.rejected / n : 0;
    const bandAvg = bandValues.length ? bandValues.reduce((s, v) => s + v, 0) / bandValues.length : null;
    if (rejectRate >= 0.3) { recommendation = `建议下调 confidence_prior（拒绝率 ${(rejectRate * 100).toFixed(0)}%）`; rationale = "高拒绝率＝先验过乐观"; }
    else if (bandAvg !== null && current.prior !== null && Math.abs(bandAvg - current.prior) > 0.15) { recommendation = `建议重估 confidence_prior（档位均值 ${bandAvg.toFixed(2)} vs 先验 ${current.prior}）`; rationale = "人判档位与先验漂移超阈"; }
    else rationale = `样本充分（裁决 ${n}＋档位 ${bandValues.length}）且无越阈信号`;
  }
  report.per_type.push({ type, current, decisions: stats, band_count: bandValues.length, band_avg: bandValues.length ? Number((bandValues.reduce((s, v) => s + v, 0) / bandValues.length).toFixed(3)) : null, recommendation, rationale });
}

const out = JSON.stringify(report, null, 2);
const outIdx = process.argv.indexOf("--out");
if (outIdx > -1 && process.argv[outIdx + 1]) {
  fs.writeFileSync(process.argv[outIdx + 1], out);
  console.error(`报告已写: ${process.argv[outIdx + 1]}`);
} else {
  console.log(out);
}
