#!/usr/bin/env node
// Component: gate-health（门禁健康度派生件——保安队长职责交付物，WP-124 落地）
// @responsible: AGENTS.md「门禁准入与留任复核」条款的机器半边：健康度读数从单一事实源派生，
//   禁手改。数据源＝contracts/quality-gates.json（注册/退役/执行面/注记）＋test-results/ci-gates.json
//   （最近一轮 CI 实跑时长与结论，本地或 CI 产生）＋contracts/known-gate-failures.json（豁免账）。
//   读数只陈述事实（空转/常绿/无留任句/最近红史），裁决（退役/降档/留任）归人——波 4 全台对照为模板。
// @inputs: 上述三文件
// @outputs: docs/dev-log/gate-health.md（覆盖写）；stdout gate_health=ok|FAIL
// @context: 手动运行 node scripts/quality/dev-log/gate-health.mjs（CI 不强制；批次收官时必跑一次入账）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const OUT = path.join(ROOT, "docs", "dev-log", "gate-health.md");

const reg = JSON.parse(fs.readFileSync(path.join(ROOT, "contracts/quality-gates.json"), "utf8"));
const gates = reg.gates || [];
let ci = null;
try { ci = JSON.parse(fs.readFileSync(path.join(ROOT, "test-results/ci-gates.json"), "utf8")); } catch { /* 无最近实跑 */ }
let known = {};
try { known = JSON.parse(fs.readFileSync(path.join(ROOT, "contracts/known-gate-failures.json"), "utf8")).known || {}; } catch { /* 无豁免账 */ }

const live = gates.filter((g) => g.status !== "retired");
const retired = gates.filter((g) => g.status === "retired");
const byExec = (exec) => live.filter((g) => g.execution === exec);
const durById = new Map((ci?.results || []).map((r) => [r.gateId, r]));

// 终态分层（WP-126 收官批定版；2026-11-06 门禁收敛批）。分层依据＝兄弟仓对照判据：
//   通用基础＝所有成熟项目都有；边界·产品不变量＝对外/产品不变量，扫描是唯一手段；
//   治理基建＝守治理工件本体（本仓特有：治理工件即产品）；域对账守望＝一致性/纪律执法，
//   逐台带留任理由与机会窗口（详见注册表 note 与 docs/plans/ 工具化评估）。
const LAYERS = {
  "通用基础": ["typecheck", "lint", "frontend-tests", "node-tests", "conflict-markers", "contract-hygiene", "check-py-tests", "knip"],
  "边界·产品不变量": ["vault-write-destinations", "vault-observation-exit", "frozen-artifacts", "ontology-consumer-anchors", "schema-writers", "ui-kit", "table-usage", "recipe-usage", "theme-contract", "term-copy", "vocab-load-port", "error-codes", "runtime-scope", "check-pipeline-rules"],
  "治理基建": ["dev-log", "problem-register", "domain-registry", "work-packages", "test-placement", "merge-reconcile", "data-roles", "taxonomy-growth"],
  "域对账守望": ["navigation", "action-coverage", "empty-state-semantics", "defect-shapes", "state-liveness", "interaction-state", "response-count-parity", "ui-stat-provenance", "fields-registry", "fields-dictionary", "object-dictionary", "schema-shape", "article-lifecycle", "rules-lifecycle", "derivation-sync", "contract-route-parity"],
  "夜间 E2E": ["e2e-suite", "e2e-baseline"],
};
const layerOf = (id) => Object.entries(LAYERS).find(([, ids]) => ids.includes(id))?.[0] || "⚠未分层";
const unlayered = live.filter((g) => layerOf(g.id) === "⚠未分层").map((g) => g.id);

// 健康信号（只陈述，不裁决）
const signals = [];
for (const g of live) {
  const note = String(g.note || "").trim();
  if (!note) signals.push(`| ${g.id} | note 为空——留任理由缺失（违反「每台一句为什么」） |`);
  if (g.execution === "ci" && /观察期|observe/.test(note) && !g.surfaces?.length) signals.push(`| ${g.id} | CI 档＋注记自述观察期——疑似常绿空转，复核是否降档 |`);
}
const slowest = (ci?.results || []).slice().sort((a, b) => (b.durationMs || 0) - (a.durationMs || 0)).slice(0, 5);
const reds = (ci?.results || []).filter((r) => r.conclusion !== "success");

const line = (g) => {
  const r = durById.get(g.id);
  const dur = r ? `${(r.durationMs / 1000).toFixed(1)}s/${r.conclusion}` : "-";
  return `| ${g.id} | ${layerOf(g.id)} | ${g.execution || "-"} | ${(g.surfaces || []).join(",") || "-"} | ${dur} |`;
};

const md = `# 门禁健康度（派生投影，禁手改）

> 生成于 ${new Date().toISOString()}，命令 \`node scripts/quality/dev-log/gate-health.mjs\`；事实源＝contracts/quality-gates.json ＋ test-results/ci-gates.json${ci ? `（最近实跑 ${ci.generatedAt}）` : "（无最近实跑记录）"}。裁决（退役/降档/留任）按 AGENTS.md「门禁准入与留任复核」条款归人与批次复核，本页只供读数。

## 总量与分层

| 口径 | 值 |
|---|---|
| 注册总条目 | ${gates.length} |
| 活台 / 退役 | ${live.length} / ${retired.length} |
| CI 面（每次推送全跑） | ${byExec("ci").length} |
| 夜间 | ${byExec("nightly").length}（${byExec("nightly").map((g) => g.id).join("、") || "-"}） |
| 手动 | ${byExec("manual").length}（${byExec("manual").map((g) => g.id).join("、") || "-"}） |
| commit 面 | ${live.filter((g) => (g.surfaces || []).includes("commit")).length} |
| 已知豁免账 | ${Object.keys(known).length} 条 |

## 终态分层（收敛批 2026-11-06 定版）

| 层 | 台数 | 内容 |
|---|---|---|
${Object.entries(LAYERS).map(([k, ids]) => `| ${k} | ${live.filter((g) => LAYERS[k].includes(g.id)).length} | ${ids.join("、")} |`).join("\n")}

${unlayered.length ? `> ⚠ 未分层：${unlayered.join("、")}——新台注册时须同步归层。\n` : ""}
## 活台清单

| id | 分层 | execution | surfaces | 最近实跑 |
|---|---|---|---|---|
${live.map(line).join("\n")}

## 健康信号（复核入口，非结论）

${signals.length ? signals.join("\n") : "无（全部活台有注记，无注记自述观察期的 CI 档）"}

## 最近一轮 CI 最慢 5 台

${slowest.length ? slowest.map((r) => `- ${r.gateId}：${(r.durationMs / 1000).toFixed(1)}s（${r.conclusion}）`).join("\n") : "无实跑记录"}

${reds.length ? `## 最近一轮红台\n\n${reds.map((r) => `- ${r.gateId}（${r.conclusion}）`).join("\n")}` : "## 最近一轮红台\n\n无"}

## 退役台（${retired.length}）

${retired.map((g) => `- ${g.id}`).join("\n")}
`;

fs.writeFileSync(OUT, md);
console.log(`gate_health=ok live=${live.length} retired=${retired.length} ci_faces=${byExec("ci").length} signals=${signals.length} -> ${path.relative(ROOT, OUT)}`);
