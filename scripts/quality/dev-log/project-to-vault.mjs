#!/usr/bin/env node
/**
 * project-to-vault.mjs — dev-log 专家团进度 → Markdown 投影。
 *
 * 零逻辑改动搬运自源库（架构图系统-rebuild）同名文件。唯一改编：
 *   默认投影目标由用户 Obsidian Vault 改为本仓 docs/dev-log/dashboard/
 *   （仓内投影，git 版本化；如需投影到 Obsidian，设 KB_VAULT/VAULT_PATH 环境变量即可恢复原行为）。
 *   Vault 侧永远是派生只读投影——事实源唯一 = 仓内 docs/dev-log/entries/
 *   （append-only + git 版本化 + check-dev-log 门禁）。本脚本只读台账与
 *   progress.json，渲染 Markdown，绝不回写台账；产物可随时删除重建
 *   （与 progress.json 同级投影，无信息增量）。
 * 挂载建议：fold:progress 之后手动运行（npm run project:dashboard）；失败静默不阻塞。
 * 形态：生成区标记 + frontmatter 供 Dataview 聚合。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// 辖区注册单唯一源 = 门禁同款：投影永不自持副本，注册单变动投影自动跟随。
import { OWNER_ZONE_PREFIXES } from "../shared/dev-log-ledger.mjs";
// 角色身份 + 辖区功能总结唯一源 = dev-log-roles.mjs（与 ledger 互补：本文件管人读身份，ledger 管机器合规）。
// 统一责任矩阵 renderer（数据仍由 dev-log-roles.mjs 导出，本文件只渲染）。
import { OWNER_META } from "../shared/dev-log-roles.mjs";
import { renderResponsibilityMatrix } from "../shared/dev-log-responsibility-matrix.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");
// 默认投影到仓内 docs/dev-log/dashboard/；设 KB_VAULT / VAULT_PATH 则投影到该 Vault。
// ⚠️ 目录名必须与本份数区分：Obsidian 的「04-项目/专家团管控项目进度」是源库（架构图系统-rebuild）
// 的投影落脚点——两仓若写同一路径会互相覆盖（同名文件互踩）。故 Vault 模式下目录追加本仓名（仓目录 basename）。
const vaultOverride = process.env.KB_VAULT || process.env.VAULT_PATH;
const TARGET_DIR = vaultOverride
  ? path.join(vaultOverride, "04-项目", `专家团管控项目进度-${path.basename(REPO_ROOT)}`)
  : path.join(REPO_ROOT, "docs", "dev-log", "dashboard");
// Vault 模式下目标必须在本仓之外：KB_VAULT/VAULT_PATH 一旦解析到仓根（或仓内任意子目录），
// Obsidian 落脚目录「04-项目/…」就会整个写进代码仓并随合并入库（7a52c9c1 实发），与 dashboard/ 形成双源。
if (vaultOverride) {
  const rel = path.relative(REPO_ROOT, path.resolve(TARGET_DIR));
  const insideRepo = rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  if (insideRepo) {
    console.error(`project_to_vault: refused — target ${TARGET_DIR} is inside the repo (KB_VAULT/VAULT_PATH=${vaultOverride}); Obsidian projection must not be written into the code repo`);
    process.exit(2);
  }
}

// 人读映射：把 W 码 / 英文枚举翻译成人读含义——总览等级表 + 角色页共用。
// 维度定义唯一源 = contracts/dev-log.schema.json（cls/source/auth），本映射只做「展示翻译」，不另立枚举。
const CLS_META = {
  W1: "纯表面（文案/样式/展示层，无逻辑语义变化）",
  W2: "运维（构建/依赖/脚本/配置/环境）",
  W3: "调研（只读勘察，产出结论不改产品代码）",
  W4: "标准开发（常规功能/修复，单域内可控改动）",
  W5: "重型任务（跨层重构/契约变更/数据迁移/架构调整）",
};
const AUTH_META = {
  none: "免确认（可直接执行，事后留痕）",
  confirm: "动作前确认（执行前须向用户报备并获准）",
  accept: "人工收货（执行后须由用户验收/签收才闭环）",
};
const SOURCE_META = {
  dev: "开发动作（改码/跑脚本）",
  gate: "门禁结果（quality gate / acceptance 结论）",
};
const CLS_SHORT = (c) => CLS_META[c]?.split("（")[0] ?? c;
const AUTH_SHORT = (a) => AUTH_META[a]?.split("（")[0] ?? a;
const SOURCE_SHORT = (s) => SOURCE_META[s]?.split("（")[0] ?? s;

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

function fmtTs(ts) {
  return ts ? ts.replace("T", " ").replace(/\.\d+Z$/, "").replace(/Z$/, "") : "—";
}

function esc(s) {
  return String(s ?? "").replaceAll("|", "\\|");
}

/** 读台账全部事件，按 owner 分组 */
function loadLedgers() {
  const entriesDir = path.join(REPO_ROOT, "docs", "dev-log", "entries");
  const byOwner = new Map();
  if (!fs.existsSync(entriesDir)) return byOwner;
  for (const file of fs.readdirSync(entriesDir)) {
    if (!file.endsWith(".jsonl")) continue;
    const owner = file.replace(/\.jsonl$/, "");
    const events = fs.readFileSync(path.join(entriesDir, file), "utf8")
      .split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
    byOwner.set(owner, events);
  }
  return byOwner;
}

function renderOverview(progress, byOwner) {
  const total = progress?.total_events ?? [...byOwner.values()].reduce((n, ev) => n + ev.length, 0);
  const lines = [];
  lines.push("---");
  lines.push("tags: [dashboard, dev-log, 专家团]");
  lines.push(`total_events: ${total}`);
  lines.push(`owners_active: ${[...byOwner.values()].filter((e) => e.length > 0).length}`);
  lines.push(`last_event_ts: ${progress?.last_event_ts ?? ""}`);
  lines.push("---");
  lines.push("");
  lines.push("# 专家团管控项目进度（dev-log 投影）");
  lines.push("");
  lines.push("> 本目录为**可视化检查数据层**：由 `scripts/quality/dev-log/project-to-vault.mjs` 从仓内台账派生，禁止手改；");
  lines.push("> 事实源唯一 = 仓 `docs/dev-log/entries/`（append-only + 门禁校验）。产物可随时删除重建。");
  lines.push(`> 总事件数 **${total}** · 最后事件 ${fmtTs(progress?.last_event_ts)} · 运行 \`npm run project:dashboard\` 刷新。`);
  lines.push("");
  lines.push("## 成员账本总览");
  lines.push("");
  lines.push("| 成员（花名） | 负责的功能（辖区） | 管辖代码区（注册单） | 台账 | 事件数 | 最近活动 | 最近在做什么（最新事件） |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const [owner, events] of [...byOwner.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const meta = OWNER_META[owner] ?? { name: owner, duty: "—" };
    const zones = (OWNER_ZONE_PREFIXES[owner] ?? []).join(" · ");
    const last = events[events.length - 1];
    lines.push(`| ${meta.name} | ${meta.duty} | ${esc(zones || "—")} | [[${owner}]] | ${events.length} | ${fmtTs(last?.ts)} | ${esc(last ? `${last.event} · ${last.req ?? "无需求号"}` : "空账本（辖区未动）")} |`);
  }
  lines.push("");

  // 成员职责与分工：从角色注册单（dev-log-roles.mjs）派生——单一事实源，非硬编码常量。
  // 与上方「成员账本总览」（实时指标表）互补：那张看"谁有多少活动"，这张看"每个角色负责什么功能"。
  lines.push("## 成员职责与分工（各领域负责什么 · 注册单实时值）");
  lines.push("");
  lines.push("> 数据来自角色注册单 `scripts/quality/shared/dev-log-roles.mjs`（与门禁越界判定同源 owner 枚举）；改职责 / 辖区功能总结只改注册单，勿手改本页。与上方「成员账本总览」互补：那张是实时指标，这张是职责定义。");
  lines.push("");
  for (const [owner, meta] of Object.entries(OWNER_META)) {
    const zones = (OWNER_ZONE_PREFIXES[owner] ?? []).join(" · ") || "—";
    lines.push(`### ${meta.name}（${owner}）— ${meta.duty}`);
    lines.push("");
    lines.push(`- 管辖代码区：${esc(zones)}`);
    lines.push(`- 负责什么：${esc(meta.zone_summary || "（待补写至角色注册单）")}`);
    lines.push("");
  }
  lines.push("");

  // 统一责任矩阵：从角色注册单派生三视图 + SoD 体检（单一事实源，非硬编码常量）。
  lines.push(...renderResponsibilityMatrix());

  // 分类与授权等级表：cls/source/auth 三维度人读 + 实况计数 + 组合分布（数据自台账实时聚合，不依赖 progress.json 的子集）。
  const clsCounts = {};
  const authCounts = {};
  const sourceCounts = {};
  const comboCounts = {};
  for (const [, events] of byOwner) {
    for (const e of events) {
      clsCounts[e.cls] = (clsCounts[e.cls] ?? 0) + 1;
      authCounts[e.auth] = (authCounts[e.auth] ?? 0) + 1;
      sourceCounts[e.source] = (sourceCounts[e.source] ?? 0) + 1;
      comboCounts[`${e.cls}/${e.auth}`] = (comboCounts[`${e.cls}/${e.auth}`] ?? 0) + 1;
    }
  }
  const totalEv = [...byOwner.values()].reduce((n, ev) => n + ev.length, 0);
  lines.push("## 分类与授权等级表（人读参考 + 实况计数）");
  lines.push("");
  lines.push("> 本表把 W 码 / 英文枚举翻译成人读含义并附实况计数。维度定义唯一源 = `contracts/dev-log.schema.json`（cls / source / auth），本表只做展示翻译。计数来自仓内台账实时聚合。");
  lines.push("");
  lines.push("### 条目来源（source · 分类来源 = 这条记录从哪来）");
  lines.push("");
  lines.push("| 来源 | 含义 | 事件数 | 占比 |");
  lines.push("|---|---|---:|---:|");
  for (const code of ["dev", "gate"]) {
    const n = sourceCounts[code] ?? 0;
    lines.push(`| ${code} ${SOURCE_SHORT(code)} | ${esc(SOURCE_META[code])} | ${n} | ${totalEv ? Math.round((n / totalEv) * 100) : 0}% |`);
  }
  lines.push("");
  lines.push("### 授权明细（auth · 这一步要不要你点头）");
  lines.push("");
  lines.push("| 级别 | 含义 | 事件数 | 占比 |");
  lines.push("|---|---|---:|---:|");
  for (const code of ["none", "confirm", "accept"]) {
    const n = authCounts[code] ?? 0;
    lines.push(`| ${code} ${AUTH_SHORT(code)} | ${esc(AUTH_META[code])} | ${n} | ${totalEv ? Math.round((n / totalEv) * 100) : 0}% |`);
  }
  lines.push("");
  lines.push("### 工作分级（cls · 改动的轻重）");
  lines.push("");
  lines.push("| 等级 | 含义 | 事件数 | 占比 |");
  lines.push("|---|---|---:|---:|");
  for (const code of ["W1", "W2", "W3", "W4", "W5"]) {
    const n = clsCounts[code] ?? 0;
    lines.push(`| ${code} ${CLS_SHORT(code)} | ${esc(CLS_META[code])} | ${n} | ${totalEv ? Math.round((n / totalEv) * 100) : 0}% |`);
  }
  lines.push("");
  lines.push("### 组合分布（cls × auth · 什么级别的改动需要什么授权）");
  lines.push("");
  lines.push("| 组合 | 事件数 |");
  lines.push("|---|---:|");
  for (const [k, v] of Object.entries(comboCounts).sort((a, b) => b[1] - a[1])) {
    const [c, a] = k.split("/");
    lines.push(`| ${CLS_SHORT(c)} / ${AUTH_SHORT(a)} | ${v} |`);
  }
  lines.push("");
  // 假解决警报数据（regressed 复现待派发 / reopened 返工已立案）——先于总结表收集
  const regressions = [];
  const reopens = new Map();
  for (const [, events] of byOwner) {
    for (const e of events) {
      if (e.event === "dev.task.regressed") regressions.push(e);
      if (e.event === "dev.task.reopened") {
        const key = e.reopened_of ?? "?";
        if (!reopens.has(key)) reopens.set(key, []);
        reopens.get(key).push(e);
      }
    }
  }

  // 任务语义层：req → 总结事件聚合（已完成/待总结两栏）
  const summaryByReq = new Map();
  for (const [, events] of byOwner) {
    for (const e of events) {
      if (e.event === "dev.task.summarized" && e.req) {
        if (!summaryByReq.has(e.req)) summaryByReq.set(e.req, []);
        summaryByReq.get(e.req).push(e);
      }
    }
  }
  const pendingByReq = new Map();
  for (const [req, v] of Object.entries(progress?.by_req ?? {})) {
    if ((v.events ?? 0) > 0 && !summaryByReq.has(req)) pendingByReq.set(req, v);
  }
  lines.push("## 任务语义层（每个任务完成了什么 · 模块发生了什么变化）");
  lines.push("");
  lines.push("### ✅ 已有总结（角色收口时亲笔）");
  lines.push("");
  if (summaryByReq.size === 0) {
    lines.push("（暂无——首个任务总结落账后此处自动呈现。）");
  } else {
    lines.push("| 需求 | 总结人 | 影响模块 | 总结（完成了什么/变化） |");
    lines.push("|---|---|---|---|");
    for (const [req, ss] of [...summaryByReq.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))) {
      for (const s of ss) {
        const who = (OWNER_META[s.owner] ?? { name: s.owner }).name;
        const reworkMark = reopens.has(req) ? ` ⚠️返工×${reopens.get(req).length}（→ ${(reopens.get(req) ?? []).map((r) => r.req).join(", ")}）` : "";
        lines.push(`| ${esc(req)}${reworkMark} | ${who} | ${(s.modules ?? []).map(esc).join("、") || "—"} | ${esc((s.summary ?? "").slice(0, 160))}${(s.summary ?? "").length > 160 ? "…" : ""} |`);
      }
    }
  }
  lines.push("");
  const openReg = regressions.filter((g) => !reopens.has(g.req));
  lines.push("### 🚨 假解决警报（已总结任务复现——待总监派发返工）");
  lines.push("");
  if (openReg.length === 0) {
    lines.push("✅ 无未派发复现——已总结任务均无回退。");
  } else {
    lines.push("| 原任务 | 复现记录时间 | 复现现象 |");
    lines.push("|---|---|---|");
    for (const g of openReg) lines.push(`| ${esc(g.req)} | ${fmtTs(g.ts)} | ${esc((g.rework_note ?? "").slice(0, 120))} |`);
  }
  lines.push("");
  lines.push("### 🔁 返工链（已立案返工——原任务 → 返工任务）");
  lines.push("");
  if (reopens.size === 0) {
    lines.push("（暂无返工记录。）");
  } else {
    lines.push("| 原任务 | 返工任务 | 责任角色 | 返工说明 |");
    lines.push("|---|---|---|---|");
    for (const [ofKey, rs] of reopens) {
      for (const r of rs) lines.push(`| ${esc(ofKey)} | ${esc(r.req)} | ${(OWNER_META[r.owner] ?? { name: r.owner }).name} | ${esc((r.rework_note ?? "").slice(0, 100))} |`);
    }
  }
  lines.push("");
  lines.push("### 🔴 待总结（活跃任务缺语义收口——对应角色应补写）");
  lines.push("");
  if (pendingByReq.size === 0) {
    lines.push("✅ 无待总结——全部活跃任务已有语义收口。");
  } else {
    lines.push("| 需求 | 提交数 | 待总结角色 | 最后活动 |");
    lines.push("|---|---|---|---|");
    for (const [req, v] of [...pendingByReq.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))) {
      lines.push(`| ${esc(req)} | ${v.events} | ${(v.owners ?? []).map((o) => (OWNER_META[o] ?? { name: o }).name).join("、")} | ${fmtTs(v.last_ts)} |`);
    }
  }
  lines.push("");

  // 角色页小结空缺：有活动事件但零 dev.task.summarized 的角色（与待总结同机理，按角色维度）。
  const hasSummary = new Map();
  for (const [owner, events] of byOwner) {
    hasSummary.set(owner, events.some((e) => e.event === "dev.task.summarized"));
  }
  const gapOwners = [...byOwner.entries()].filter(([owner, events]) => events.length > 0 && !hasSummary.get(owner));
  lines.push("## 角色页小结空缺（有活动但无任务级总结——倒逼补写）");
  lines.push("");
  if (gapOwners.length === 0) {
    lines.push("✅ 无空缺——每个有活动的角色都已亲笔至少一条任务级总结。");
  } else {
    lines.push("| 角色 | 事件数 | 辖区功能总结页 |");
    lines.push("|---|---|---|");
    for (const [owner, events] of gapOwners.sort((a, b) => b[1].length - a[1].length)) {
      const meta = OWNER_META[owner] ?? { name: owner };
      lines.push(`| ${meta.name} | ${events.length} | [[${owner}]] |`);
    }
    lines.push("");
    lines.push("> 与待总结同机理；任务收口时由该角色本人发 `dev.task.summarized` 事件（summary + modules）补写。");
  }
  lines.push("");

  const byReq = progress?.by_req;
  if (byReq) {
    lines.push("## 需求维度（by_req，最近 10 个）");
    lines.push("");
    lines.push("| 需求 | 事件数 | 状态 | 涉及角色 |");
    lines.push("|---|---|---|---|");
    const reqs = Object.entries(byReq)
      .sort((a, b) => (b[1].last_ts ?? "").localeCompare(a[1].last_ts ?? ""))
      .slice(0, 10);
    for (const [req, v] of reqs) {
      lines.push(`| ${esc(req)} | ${v.events} | ${v.status ?? "—"} | ${(v.owners ?? []).map((o) => (OWNER_META[o] ?? { name: o }).name).join("、")} |`);
    }
    lines.push("");
  }
  return lines.join("\n") + "\n";
}

function renderOwnerPage(owner, events) {
  const last = events[events.length - 1];
  const meta = OWNER_META[owner] ?? { name: owner, duty: "—", zone_summary: "" };
  const lines = [];
  lines.push("---");
  lines.push(`owner: ${owner}`);
  lines.push(`name: ${meta.name}`);
  lines.push(`duty: ${meta.duty}`);
  lines.push("zones:");
  for (const z of OWNER_ZONE_PREFIXES[owner] ?? []) lines.push(`  - ${z}`);
  lines.push(`events: ${events.length}`);
  lines.push(`seq_max: ${last?.seq ?? 0}`);
  lines.push(`last_ts: ${last?.ts ?? ""}`);
  lines.push("tags: [dev-log, 专家团台账]");
  lines.push("---");
  lines.push("");
  lines.push(`# ${meta.name} — ${meta.duty}（${owner}）`);
  lines.push("");
  lines.push("> 派生投影：事实源 = 仓 `docs/dev-log/entries/${owner}.jsonl`，本页随投影刷新，禁止手改。**事件流水是机器口径的溯源底稿，人读请看下方「辖区功能总结」与「本角色工作小结」**。");
  lines.push("");

  // 辖区功能总结：这个角色负责什么（人读，事实源 = dev-log-roles.mjs 的 zone_summary）。
  lines.push("## 辖区功能总结（这个角色负责什么）");
  lines.push("");
  lines.push(meta.zone_summary || "（暂无辖区功能总结——由主理人/该角色补写至角色注册单 `scripts/quality/shared/dev-log-roles.mjs`。）");
  lines.push("");
  lines.push("> 管辖代码区见**属性区** `zones`（注册单实时值，随投影自动跟随）；辖区对账与变动待办见 [[辖区管理]]。");
  lines.push("");

  // 本角色工作小结：该角色亲笔的任务级总结（dev.task.summarized by owner）。
  const mySummaries = events
    .filter((e) => e.event === "dev.task.summarized" && e.req)
    .sort((a, b) => (a.req < b.req ? 1 : -1));
  lines.push("## 本角色工作小结（任务收口时亲笔）");
  lines.push("");
  if (mySummaries.length === 0) {
    lines.push("（该角色尚无任务级总结——任务收口时由本人亲笔 `dev.task.summarized`（summary + modules）。下方「原始事件流水」是机器记录，不是人读总结。）");
  } else {
    lines.push("| 需求 | 影响模块 | 总结（完成了什么 / 变化） |");
    lines.push("|---|---|---|");
    for (const s of mySummaries) {
      lines.push(`| ${esc(s.req)} | ${(s.modules ?? []).map(esc).join("、") || "—"} | ${esc((s.summary ?? "").slice(0, 240))}${(s.summary ?? "").length > 240 ? "…" : ""} |`);
    }
  }
  lines.push("");

  // 原始事件流水（机器口径·供溯源）降级为最末节。
  const recent = events.slice(-15).reverse();
  if (recent.length) {
    lines.push("## 原始事件流水（机器口径 · 供溯源，非人读）");
    lines.push("");
    lines.push("| ts | seq | 类型 | 分类/授权 | 需求 | 具体动作 |");
    lines.push("|---|---|---|---|---|---|");
    for (const e of recent) {
      const kind = e.source === "gate" ? "门禁结果" : "开发动作";
      const clsName = CLS_SHORT(e.cls);
      const authName = AUTH_SHORT(e.auth);
      const action = e.cmd ?? e.event;
      lines.push(`| ${fmtTs(e.ts)} | ${e.seq} | ${kind} | ${esc(clsName)}·${esc(authName)} | ${esc(e.req ?? "—")} | ${esc(action)} |`);
    }
  } else {
    lines.push("## 原始事件流水（机器口径 · 供溯源）");
    lines.push("");
    lines.push("（空账本——该辖区尚未发生记录事件。）");
  }
  lines.push("");
  return lines.join("\n") + "\n";
}


/**
 * 辖区对账：注册单前缀 ↔ 仓库实际目录（fs 事实源）。
 * - orphan 目录：实际存在但无任何 owner 前缀覆盖（team-lead 兜底不算覆盖）→ 总监待办。
 * - stale 前缀：注册单有但目录已不存在 → 同表另一节。
 */
function renderZoneManagement() {
  // 豁免清单：外部仓库/历史归档/构建产物，非本仓受管代码区
  // data = gitignored 运行时状态目录（SPEC-012 runtime-state-data store 落点 data/runtime-state.db）——
  // 不豁免会造成本地（有 data/）与 CI 克隆（无）投影不一致，freshness 门禁永红（2026-10-15 实证）。
  // .venv/.zcode = gitignored 本机工具目录（Python 虚拟环境 / agent 会话配置），与 .idea/.vscode 同类；
  // 不豁免则本地（有）被标无主目录、CI 克隆（无）标零，投影两侧漂移出假待办（2026-10-26 Master 裁准豁免）。
  const IGNORED = new Set(["node_modules", ".git", "dist", "coverage", "test-results", ".tmp", ".workbuddy", ".idea", ".vscode", ".claude", ".dsh", ".planning", ".qoder", ".gitnexus", ".ledger-backups", ".github", "data", ".venv", ".zcode"]);
  const lines = [];
  const topDirs = fs.readdirSync(REPO_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !IGNORED.has(d.name)).map((d) => d.name + "/");
  const srcSubs = fs.existsSync(path.join(REPO_ROOT, "src"))
    ? fs.readdirSync(path.join(REPO_ROOT, "src"), { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name !== "node_modules").map((d) => "src/" + d.name + "/")
    : [];

  const allOwnerPrefixes = Object.values(OWNER_ZONE_PREFIXES).flat();
  const covered = (dir) => allOwnerPrefixes.some((p) => dir.startsWith(p) || p.startsWith(dir) || (p.includes("/") && dir === p.slice(0, p.lastIndexOf("/") + 1)));

  const orphans = [...topDirs, ...srcSubs].filter((d) => !covered(d));
  // stale：注册单目录前缀已不存在于 fs
  const dirExists = (p) => {
    const clean = p.endsWith("/") ? p.slice(0, -1) : p;
    const parts = clean.split("/");
    let cur = REPO_ROOT;
    for (const part of parts) {
      cur = path.join(cur, part);
      if (!fs.existsSync(cur)) return false;
    }
    return fs.statSync(cur).isDirectory();
  };
  const stale = allOwnerPrefixes.filter((p) => p.endsWith("/") && !dirExists(p));

  lines.push("---");
  lines.push("tags: [dashboard, dev-log, 辖区管理]");
  lines.push(`orphan_dirs: ${orphans.length}`);
  lines.push(`stale_prefixes: ${stale.length}`);
  lines.push(`generated: ${new Date().toISOString()}`);
  lines.push("---");
  lines.push("");
  lines.push("# 辖区管理（注册单 ↔ 目录事实源对账）");
  lines.push("");
  lines.push("> 派生投影：注册单 = `OWNER_ZONE_PREFIXES`（门禁同源）；目录事实源 = 文件系统实况。两边对不齐即出待办；本页随投影刷新，处置记录可手写追加在待办表下方。");
  lines.push("");
  lines.push("## 当前注册单全景");
  lines.push("");
  lines.push("| 成员 | 前缀数 | 管辖代码区 |");
  lines.push("|---|---|---|");
  for (const [owner, prefixes] of Object.entries(OWNER_ZONE_PREFIXES)) {
    const meta = OWNER_META[owner] ?? { name: owner };
    lines.push(`| ${meta.name} | ${prefixes.length} | ${prefixes.map((p) => "\`" + p + "\`").join(" · ")} |`);
  }
  lines.push("");
  lines.push("## 总监待办：无主目录（实际存在但不属任何成员辖区）");
  lines.push("");
  if (orphans.length === 0) {
    lines.push("✅ 当前无无主目录——仓库全部受管目录均已有辖区归属。");
  } else {
    lines.push("| 待办号 | 目录 | 发现时间 | 状态 | 处置（指派/豁免/建区） |");
    lines.push("|---|---|---|---|---|");
    orphans.forEach((d, i) => {
      lines.push(`| TODO-${String(i + 1).padStart(3, "0")} | \`${d}\` | ${new Date().toISOString().slice(0, 10)} | 🔴 待处置 | 待总监（主理人）裁决 |`);
    });
    lines.push("");
    lines.push("> 处置方式三选一：① 指派给既有成员（改注册单加前缀）；② 新建角色辖区；③ 豁免登记（工具/外部仓库目录，加入 IGNORED 说明理由）。裁决后改注册单重投影即消。");
  }
  lines.push("");
  lines.push("## 注册单过期前缀（目录已不存在，需同步）");
  lines.push("");
  if (stale.length === 0) {
    lines.push("✅ 无过期前缀——注册单与目录事实源一致。");
  } else {
    lines.push("| 前缀 | 所属成员 | 建议 |");
    lines.push("|---|---|---|");
    for (const p of stale) {
      const owner = Object.entries(OWNER_ZONE_PREFIXES).find(([, ps]) => ps.includes(p))?.[0] ?? "?";
      lines.push(`| \`${p}\` | ${(OWNER_META[owner] ?? { name: owner }).name} | 确认目录已删→移除前缀；目录改名→改前缀 |`);
    }
  }
  lines.push("");
  return lines.join("\n") + "\n";
}

// ── main ──
try {
  const progress = readJsonSafe(path.join(REPO_ROOT, "docs", "dev-log", "progress.json"));
  const byOwner = loadLedgers();
  fs.mkdirSync(TARGET_DIR, { recursive: true });

  fs.writeFileSync(path.join(TARGET_DIR, "专家团进度总览.md"), renderOverview(progress, byOwner));
  fs.writeFileSync(path.join(TARGET_DIR, "辖区管理.md"), renderZoneManagement());
  for (const [owner, events] of byOwner) {
    fs.writeFileSync(path.join(TARGET_DIR, `${owner}.md`), renderOwnerPage(owner, events));
  }
  console.log(`project_to_vault: written=${1 + byOwner.size} files → ${TARGET_DIR}`);
} catch (error) {
  process.stderr.write(`dev-log-producer: vault projection failed: ${error.message}\n`);
  process.exit(0); // 投影失败静默（观测层不阻塞）
}
