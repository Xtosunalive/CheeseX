#!/usr/bin/env node
// 复用机制领域模型图生成器——事实源：contracts/reuse-domains.json ＋ contracts/data-domains.json
// 用法：node scripts/quality/project-reuse-model-map.mjs [--out <dir>]
// 输出：reuse-model-map.svg（PNG 由使用方用 Chrome 无头 --screenshot 栅格化——qlmanage 会裁边不可用）
// 派生物，不手改；注册表更新后重跑即新图。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outDirIdx = process.argv.indexOf("--out");
const OUT_DIR = outDirIdx > -1 ? resolve(process.argv[outDirIdx + 1]) : join(REPO, "docs/design");

const reuse = JSON.parse(readFileSync(join(REPO, "contracts/reuse-domains.json"), "utf8"));
const data = JSON.parse(readFileSync(join(REPO, "contracts/data-domains.json"), "utf8"));

const STAGES = ["candidate", "surveying", "contracting", "migrating", "gating", "closing", "completed"];
const STAGE_CN = {
  candidate: "候选", surveying: "勘察", contracting: "立契", migrating: "迁移",
  gating: "门禁", closing: "收官", completed: "完成", paused: "暂停",
};
const SHORT_NAME = {
  "http-boundary": "HTTP 边界", "api-contract": "API 类型消费",
  "schema-rules-data": "Schema 规则数据", "derived-index-data": "派生读模型",
  "runtime-state-data": "运行时状态", "telemetry-data": "观测痕迹",
  "audit-ledger-data": "审计账", "dictionary-data": "对象字典与元模型",
  "vault-content-data": "vault 内容", "article-lifecycle": "文章生命周期",
};

const W = 1680, H = 1080;
const TRACK_X0 = 60, TRACK_X1 = 1340;
const SLOT = (TRACK_X1 - TRACK_X0) / STAGES.length;
const COL_TOP = 330, COL_BOTTOM = 880;
const PANEL_X0 = 1380, PANEL_X1 = 1620;
const FONT = `'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif`;

const REUSE_FILL = "#dbeafe", REUSE_EDGE = "#2563eb";
const DATA_FILL = "#fef3c7", DATA_EDGE = "#b45309";
const SLATE = "#0f172a";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const chipName = (d) => SHORT_NAME[d.id] ?? d.name;
const center = (i) => TRACK_X0 + SLOT * (i + 0.5);

// 按阶段分列；同列内复用域在前、数据域在后
const byStage = Object.fromEntries(STAGES.map((s) => [s, []]));
const paused = [];
for (const d of reuse.domains) (d.status === "paused" ? paused : byStage[d.status] ??= []).push({ ...d, kind: "reuse" });
for (const d of data.domains) (d.status === "paused" ? paused : byStage[d.status] ??= []).push({ ...d, kind: "data" });

const parts = [];
parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);

// —— 标题区 ——
parts.push(`<text x="${W / 2}" y="52" text-anchor="middle" font-family="${FONT}" font-size="27" font-weight="700" fill="${SLATE}">复用机制领域模型 —— 22 个域的生命周期与同构构成</text>`);
parts.push(`<text x="${W / 2}" y="84" text-anchor="middle" font-family="${FONT}" font-size="14" fill="#475569">复用域 15 ＋ 数据域 7 ＝ 22 ｜ 状态推进须证据指针（门禁通过／PR 关账）｜ 唯一事实源＝领域注册表</text>`);
parts.push(`<line x1="60" y1="102" x2="1620" y2="102" stroke="#e2e8f0" stroke-width="1"/>`);

// —— 生命周期轨道（站间橙菱形＝证据关卡）——
const BOX_W = 148, BOX_H = 46, TRACK_Y = 132;
STAGES.forEach((s, i) => {
  const cx = center(i);
  const done = s === "completed";
  parts.push(`<rect x="${cx - BOX_W / 2}" y="${TRACK_Y}" width="${BOX_W}" height="${BOX_H}" rx="8" fill="${done ? "#14532d" : SLATE}"/>`);
  parts.push(`<text x="${cx}" y="${TRACK_Y + 21}" text-anchor="middle" font-family="${FONT}" font-size="15" font-weight="600" fill="#ffffff">${STAGE_CN[s]}　${s}</text>`);
  parts.push(`<text x="${cx}" y="${TRACK_Y + 38}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="#cbd5e1">${byStage[s].length} 域</text>`);
  if (i < STAGES.length - 1) {
    const ax = cx + BOX_W / 2, bx = center(i + 1) - BOX_W / 2;
    const mid = (ax + bx) / 2;
    parts.push(`<line x1="${ax + 3}" y1="${TRACK_Y + BOX_H / 2}" x2="${bx - 20}" y2="${TRACK_Y + BOX_H / 2}" stroke="#64748b" stroke-width="2"/>`);
    parts.push(`<polygon points="${bx - 4},${TRACK_Y + BOX_H / 2} ${bx - 13},${TRACK_Y + BOX_H / 2 - 5} ${bx - 13},${TRACK_Y + BOX_H / 2 + 5}" fill="#64748b"/>`);
    parts.push(`<polygon points="${mid},${TRACK_Y + BOX_H / 2 - 11} ${mid + 11},${TRACK_Y + BOX_H / 2} ${mid},${TRACK_Y + BOX_H / 2 + 11} ${mid - 11},${TRACK_Y + BOX_H / 2}" fill="#f59e0b" stroke="#ffffff" stroke-width="2"/>`);
    parts.push(`<text x="${mid}" y="${TRACK_Y + BOX_H + 16}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="#b45309">证据</text>`);
  }
});

// —— 暂停旁路条 ——
parts.push(`<rect x="${TRACK_X0}" y="236" width="${TRACK_X1 - TRACK_X0}" height="46" rx="8" fill="#f8fafc" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="6 4"/>`);
parts.push(`<text x="${TRACK_X0 + 16}" y="264" font-family="${FONT}" font-size="13" font-weight="600" fill="#64748b">paused 暂停（旁路，不再推进）</text>`);
paused.forEach((d, i) => {
  const x = TRACK_X0 + 300 + i * 200;
  parts.push(`<rect x="${x}" y="244" width="186" height="30" rx="6" fill="#f1f5f9" stroke="#94a3b8" stroke-width="1"/>`);
  parts.push(`<text x="${x + 93}" y="264" text-anchor="middle" font-family="${FONT}" font-size="13" fill="#475569">${esc(chipName(d))}（已撤销，防重提保留）</text>`);
});

// —— 分阶段计数行：4→0→0→1→9→0→7＝22 ——
STAGES.forEach((s, i) => {
  if (i > 0) {
    const prev = center(i - 1), cur = center(i);
    parts.push(`<text x="${(prev + cur) / 2}" y="${COL_TOP - 16}" text-anchor="middle" font-family="${FONT}" font-size="12" fill="#94a3b8">→</text>`);
  }
  parts.push(`<text x="${center(i)}" y="${COL_TOP - 16}" text-anchor="middle" font-family="${FONT}" font-size="13" font-weight="600" fill="#475569">${byStage[s].length}</text>`);
});
parts.push(`<text x="${TRACK_X0}" y="${COL_TOP - 16}" font-family="${FONT}" font-size="12" fill="#94a3b8">分阶段计数：</text>`);
parts.push(`<text x="${TRACK_X1}" y="${COL_TOP - 16}" text-anchor="end" font-family="${FONT}" font-size="12" fill="#94a3b8">合计 ${reuse.domains.length + data.domains.length}（空列＝当前无域在此阶段）</text>`);

// —— 各阶段泳道列 ——
const CHIP_W = 166, CHIP_H = 34, CHIP_GAP = 10;
STAGES.forEach((s, i) => {
  const cx = center(i);
  const chips = byStage[s];
  parts.push(`<line x1="${cx}" y1="${COL_TOP - 6}" x2="${cx}" y2="${COL_TOP}" stroke="#cbd5e1" stroke-width="1.5"/>`);
  if (chips.length === 0) {
    parts.push(`<text x="${cx}" y="${COL_TOP + 24}" text-anchor="middle" font-family="${FONT}" font-size="12" fill="#94a3b8">（空）</text>`);
  }
  chips.forEach((d, j) => {
    const y = COL_TOP + j * (CHIP_H + CHIP_GAP);
    const fill = d.kind === "reuse" ? REUSE_FILL : DATA_FILL;
    const edge = d.kind === "reuse" ? REUSE_EDGE : DATA_EDGE;
    parts.push(`<rect x="${cx - CHIP_W / 2}" y="${y}" width="${CHIP_W}" height="${CHIP_H}" rx="7" fill="${fill}" stroke="${edge}" stroke-width="1.5"/>`);
    parts.push(`<text x="${cx}" y="${y + 22}" text-anchor="middle" font-family="${FONT}" font-size="13" fill="#1e293b">${esc(chipName(d))}</text>`);
  });
});

// —— 右侧：同构构成面板 ——
parts.push(`<rect x="${PANEL_X0}" y="132" width="${PANEL_X1 - PANEL_X0}" height="748" rx="10" fill="#f8fafc" stroke="#e2e8f0" stroke-width="1.5"/>`);
parts.push(`<text x="${(PANEL_X0 + PANEL_X1) / 2}" y="162" text-anchor="middle" font-family="${FONT}" font-size="15" font-weight="700" fill="${SLATE}">每个域都有同样的八件构成</text>`);
const ANATOMY = [
  ["authority", "权威源（唯一实现位）"],
  ["contract", "契约"],
  ["gate", "门禁（机器执法）"],
  ["tests", "守护测试"],
  ["writers", "写者登记"],
  ["register_entry", "登记簿 PR 条目"],
  ["verification_evidence", "证据指针"],
  ["metrics", "度量（完成必填）"],
];
ANATOMY.forEach(([en, cn], i) => {
  const y = 196 + i * 30;
  parts.push(`<rect x="${PANEL_X0 + 18}" y="${y - 11}" width="9" height="9" fill="${REUSE_EDGE}"/>`);
  parts.push(`<text x="${PANEL_X0 + 36}" y="${y}" font-family="${FONT}" font-size="13" fill="#334155">${cn}</text>`);
  parts.push(`<text x="${PANEL_X1 - 18}" y="${y}" text-anchor="end" font-family="monospace" font-size="11" fill="#94a3b8">${en}</text>`);
});
parts.push(`<line x1="${PANEL_X0 + 18}" y1="448" x2="${PANEL_X1 - 18}" y2="448" stroke="#e2e8f0" stroke-width="1.5"/>`);
parts.push(`<text x="${(PANEL_X0 + PANEL_X1) / 2}" y="476" text-anchor="middle" font-family="${FONT}" font-size="15" font-weight="700" fill="${SLATE}">生命周期 8 态（status_values）</text>`);
[...STAGES, "paused"].forEach((s, i) => {
  const col = i % 2, row = Math.floor(i / 2);
  const x = PANEL_X0 + 18 + col * 116, y = 506 + row * 28;
  parts.push(`<text x="${x}" y="${y}" font-family="${FONT}" font-size="12.5" fill="#334155">${STAGE_CN[s]}　${s}</text>`);
});
parts.push(`<line x1="${PANEL_X0 + 18}" y1="636" x2="${PANEL_X1 - 18}" y2="636" stroke="#e2e8f0" stroke-width="1.5"/>`);
parts.push(`<text x="${(PANEL_X0 + PANEL_X1) / 2}" y="664" text-anchor="middle" font-family="${FONT}" font-size="15" font-weight="700" fill="${SLATE}">图例</text>`);
parts.push(`<rect x="${PANEL_X0 + 18}" y="684" width="26" height="16" rx="4" fill="${REUSE_FILL}" stroke="${REUSE_EDGE}" stroke-width="1.5"/>`);
parts.push(`<text x="${PANEL_X0 + 54}" y="697" font-family="${FONT}" font-size="13" fill="#334155">复用域 ×${reuse.domains.length}（代码复用）</text>`);
parts.push(`<rect x="${PANEL_X0 + 18}" y="716" width="26" height="16" rx="4" fill="${DATA_FILL}" stroke="${DATA_EDGE}" stroke-width="1.5"/>`);
parts.push(`<text x="${PANEL_X0 + 54}" y="729" font-family="${FONT}" font-size="13" fill="#334155">数据域 ×${data.domains.length}（数据治理）</text>`);
parts.push(`<polygon points="${PANEL_X0 + 31},756 ${PANEL_X0 + 39},764 ${PANEL_X0 + 31},772 ${PANEL_X0 + 23},764" fill="#f59e0b"/>`);
parts.push(`<text x="${PANEL_X0 + 54}" y="769" font-family="${FONT}" font-size="13" fill="#334155">证据关卡（推进必过）</text>`);
parts.push(`<text x="${(PANEL_X0 + PANEL_X1) / 2}" y="812" text-anchor="middle" font-family="${FONT}" font-size="12" fill="#64748b">开域＝表加行＋登记簿立 PR</text>`);
parts.push(`<text x="${(PANEL_X0 + PANEL_X1) / 2}" y="832" text-anchor="middle" font-family="${FONT}" font-size="12" fill="#64748b">（两处同时，缺一不算开启）</text>`);
parts.push(`<text x="${(PANEL_X0 + PANEL_X1) / 2}" y="856" text-anchor="middle" font-family="${FONT}" font-size="12" fill="#64748b">两表规则逐字节同源</text>`);

// —— 注册表单一事实源横条 ——
const BAR_Y = 922;
STAGES.forEach((s, i) => {
  parts.push(`<line x1="${center(i)}" y1="${COL_BOTTOM}" x2="${center(i)}" y2="${BAR_Y}" stroke="#cbd5e1" stroke-width="2"/>`);
});
parts.push(`<rect x="60" y="${BAR_Y}" width="1560" height="66" rx="10" fill="${SLATE}"/>`);
parts.push(`<text x="840" y="${BAR_Y + 28}" text-anchor="middle" font-family="${FONT}" font-size="15" font-weight="700" fill="#ffffff">领域注册表＝唯一事实源：contracts/reuse-domains.json（复用域 ${reuse.domains.length}）＋ contracts/data-domains.json（数据域 ${data.domains.length}）</text>`);
parts.push(`<text x="840" y="${BAR_Y + 50}" text-anchor="middle" font-family="${FONT}" font-size="12" fill="#cbd5e1">回看＝读本表＋各域 guide ｜ 派生视图一律从本表生成 ｜ check:domain-registry 机器执法（开域两处同开／推进须证据／两表同源）</text>`);

parts.push(`<text x="840" y="1040" text-anchor="middle" font-family="${FONT}" font-size="11" fill="#94a3b8">本图由 scripts/quality/project-reuse-model-map.mjs 从注册表派生——派生物，不手改</text>`);
parts.push(`</svg>`);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "reuse-model-map.svg"), parts.join("\n"), "utf8");

for (const s of STAGES) {
  const chips = byStage[s];
  console.log(`${s}(${STAGE_CN[s]}): ${chips.length}${chips.length ? " ← " + chips.map((d) => chipName(d) + (d.kind === "data" ? "*" : "")).join("、") : ""}`);
}
console.log(`paused(暂停): ${paused.map((d) => chipName(d)).join("、") || "无"}`);
console.log(`合计：复用域 ${reuse.domains.length} ＋ 数据域 ${data.domains.length} ＝ ${reuse.domains.length + data.domains.length}`);
console.log(`已写入：${join(OUT_DIR, "reuse-model-map.svg")}`);
