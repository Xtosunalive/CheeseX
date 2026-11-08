// Component: Dev-Log-Ledger-Pure-Logic
// @responsible: check-dev-log.mjs 的纯校验逻辑（无 CLI、无报告、无退出码）。
//   零逻辑改动搬运自源库（架构图系统-rebuild）同名文件；校验语义、报错 kind、
//   空态三值一律保持原样。唯一改编点：OWNER_ZONE_PREFIXES 的**值域**按本仓真实
//   目录结构重定（键集与源库 schema owner 枚举一致，本仓 contracts/dev-log.schema.json
//   与源库同源，键不变）；改编已逐项核对 src/、server/、scripts/ 实际目录。
// @context: Sync
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import Ajv from "ajv";
import { fileOwnedBy } from "./governance-utils.mjs";

const require = createRequire(import.meta.url);

// ── 常量与可配置映射 ──

export const ENTRIES_RELPATH = "docs/dev-log/entries";
export const SCHEMA_RELPATH = "contracts/dev-log.schema.json";
// 枚举字段：值域唯一事实源在 schema，本脚本只按名取用，不复制枚举字面量。
export const ENUM_FIELDS = ["cls", "auth"];

// 台账体积提示线（只告警，不改退出码，绝不删除/截断/轮转）。
// 单条事件体积按源库实测校准约 300 B，故 10 MiB ≈ 3.5 万条事件：
//   足够提前预警、正常节奏不误报、git diff/blame 无肉眼可见退化。
export const LEDGER_SIZE_HINT_BYTES = 10 * 1024 * 1024;
export const BYTES_PER_EVENT_APPROX = 300;

// owner → 允许写入的路径前缀。
// 键取自 contracts/dev-log.schema.json 的 owner 枚举（唯一事实源，勿在此增删键）；
// 值为允许前缀数组：以 "/" 结尾表示目录前缀（前缀匹配），否则为精确文件（全等匹配）。
// 值域按本仓真实目录重定（与源库差异：本仓无 shared/ 顶层目录、无 src/styles 独立治理、
// docs/ 尚未建全）。team-lead 的前缀与其它角色天然重叠（合流者覆盖全仓）——这是设计不是漏配。
// 2026-09-28 归属修订（问题处理流程固化 P1c）：删 server-api 的 src/lib/ 兜底（与 domain 前缀双重归属）；
// src/lib/ 根层 15 个数据流枢纽文件逐文件登记归 domain-core（「谁拥有数据与规则谁拥有代码」，
// 决策卡第 6 项裁 A）；台账存量核查零历史写入，收窄零存量风险；shared/ 维持 server-api、
// docs/adr/ 维持 domain-core（第 8 项裁 A，执法表为有意安排）。
export const OWNER_ZONE_PREFIXES = {
  "domain-core-engineer": [
    "contracts/",
    "data/theschema/", // SPEC-023 波 1 过渡：TheSchema 仓内副本辖区（波 2 注册表终态化）
    "data/governance/", // 裁定镜像批：治理数据镜像归 domain-core（与 theschema 同族）
    "src/lib/domain/",
    "src/lib/ontology.ts",
    // 路由跳转契约单源（domain-registry#navigation：NAV_ROUTES 唯一清单）——
    // 与 ontology.ts 同性质。2026-10-06 e7f0a2d 改动此文件时无归属，钩子兜底
    // 甩给 team-lead 判越界（dev_log_file_out_of_zone 存量红）；归 domain-core 辖区（2026-10-08 修）。
    "src/lib/navigation.ts",
    "src/lib/request-status.ts",
    "src/lib/schema-shape.ts", // 复用域 schema-shape 单源（SCHEMA-IA-001 批1 开域，PR-110）——语义投影机制归 domain-core（「谁拥有数据与规则谁拥有代码」同款）
    "src/lib/schema-edit.ts", // SCHEMA-IA edit 半场接线单点（WP-138 R4 落地）——与 schema-shape.ts 同族归 domain-core（2026-11-07 注册，分派前辖区先注册纪律）
    "src/lib/object-dictionary.ts", // 字典契约前端投影装载器（SCHEMA-IA-001 批4）——schema-shape 域供给面，随批登记
    "src/lib/topology-store.ts",
    "src/lib/topology-types.ts",
    "src/lib/graph-data.ts",
    "src/lib/graph-data-types.ts",
    "src/lib/gap-types.ts",
    "src/lib/review-data-store.ts",
    "src/lib/property-data-store.ts",
    "src/lib/pipeline-store.ts",
    "src/lib/dashboard-ui-store.ts",
    "src/lib/dashboard-containers.ts",
    "src/lib/entity-registry-selectors.ts",
    "src/lib/obsidian.ts",
    "src/lib/pipeline-api.ts",
    "src/lib/utils.ts",
    "src/types/",
    "docs/adr/",
  ],
  "feature-module-engineer": ["src/features/", "src/App.tsx", "src/main.tsx", "src/vite-env.d.ts", "index.html"],
  "ui-component-engineer": ["src/components/", "src/constants/", "src/hooks/", "src/styles/", "public/", "src/lib/format.ts", "src/lib/table-url.ts"], // format.ts/table-url.ts＝P3/P2 表格收敛交付件逐文件登记（收官台账修复批）
  // PR-016 方案甲落位 + PR-017 补登记：运行时脚本事实源目录归 server-api
  //（服务端经 server/shared/vault-runtime-resolver.cjs 消费，"谁拥有数据与规则谁拥有代码"）。
  "server-api-engineer": ["server/", "scripts/vault-runtime/", "contracts/http-api.openapi.json", "src/lib/api.ts", "src/lib/edge-api.ts", "src/lib/edge-relations-hook.ts", "src/lib/generated/", "shared/"],
  "quality-gate-engineer": ["scripts/quality/", "scripts/e2e/", "test/", "src/test/", "coverage/", ".githooks/", ".github/"],
  "guard-captain": ["contracts/quality-gates.json", "docs/dev-log/gate-health.md"],
  "progress-synthesizer": ["docs/dev-log/", "PROGRESS.md", ".ledger/state-journal.jsonl", ".ledger/"], // 目录级归属 2026-10-23 PR-067 关账：仓内旧位遗存目录（SPEC-012 ③ 迁 runtime-state.db 后唯一遗存文件 state-journal.jsonl，仓内零读者——代码引用的 .ledger 均为 vault 侧），目录随文件同归谱系继承者墓碑辖区
  "team-lead": [
    "CONTRIBUTING.md", // WP-143 波5（2026-11-08）：CONTRIBUTING 五步落根目录——root 文件缺辖区映射落兜底即越界（dev-log-ledger L94 已知陷阱热修先例 9c7c3495）
    ".nvmrc", // 同批：node 版本锁定文件归 team-lead（工程基建）

    "docs/",
    "scripts/",
    "discipline-kit/",
    "discipline-kit/reference/",
    "AGENTS.md",
    "CLAUDE.md",
    "CONTEXT.md",
    "DESIGN.md",
    "GIT-CONTEXT.md",
    "REQUIREMENTS.md",
    "BLOCKED.md",
    "README.md",
    "package.json",
    "package-lock.json",
    // 根目录下的项目级配置/点文件：既不属于任何专属辖区，又会被实际改动，
    // 无归属时会落 team-lead 兜底却判越界（2026-09-21 实测：改动 .env.example/.gitignore
    // 导致 check:dev-log 报 dev_log_file_out_of_zone）。归入主理人辖区（统筹·总账文件）。
    ".env.example",
    ".gitignore",
    ".npmrc",
    // W4 收官门禁实测新增的根级工程配置（构建/静态扫描/代码风格）——同属主理人辖区
    "eslint.config.js",
    "knip.json",
    "components.json",
    "src/index.css",
    // 2026-09-27 backfill 回填实测新增：根级构建/TS 配置（vite/tsconfig/postcss）——同属主理人辖区
    "vite.config.ts",
    "tsconfig.json",
    "tsconfig.app.json",
    "tsconfig.node.json",
    "postcss.config.js",
    // 2026-10-22 PR-093 实测：受版本管理的 AI 指令目录（.gitignore 白名单 !.claude/instructions/），
    // 与 AGENTS.md/CLAUDE.md 同类，ia-metadata 等 skill 入库落此——归主理人辖区（统筹·AI 协作指令）。
    ".claude/instructions/",
    // 2026-10-23 PR-067 关账：专家团管控项目文档（顶层项目文档，与 docs/ 兜底同理——活跃使用，末笔 7a52c9c1）。
    "04-项目/",
  ],
};

// ── 参数与工具 ──

// 复用 governance-utils 的 fileOwnedBy（唯一定义）：目录前缀转成 `<dir>/**`，
// 精确文件原样保留，避免本脚本再造一份前缀匹配实现。
function isWithinZone(prefixes, file) {
  const allowedFiles = prefixes.map((prefix) => (prefix.endsWith("/") ? `${prefix}**` : prefix));
  return fileOwnedBy({ allowedFiles }, file);
}

function normalizeRelPath(raw) {
  if (typeof raw !== "string" || raw.length === 0) return null; // 空路径不可判定 → 越界
  if (raw.includes("\\") || path.isAbsolute(raw)) return null; // 绝对路径/反斜杠 → 不可判定
  const cleaned = raw.replace(/^\.\//, "");
  const segments = cleaned.split("/");
  if (segments.some((s) => s === "" || s === ".." || s === ".")) return null;
  return cleaned;
}

function summarize(list, limit = 10) {
  const shown = list.slice(0, limit).join(", ");
  return list.length > limit ? `${shown}, …(共 ${list.length} 项)` : shown;
}

function loc(event) {
  return `${event.file}:${event.line}`;
}

// ── schema 读取 ──

// 解析 $ref（仅本 schema 内的 `#/...` 指针），使枚举来源支持 properties 直接声明或 $defs/definitions 引用。
function resolveSubschema(schema, node, seen = new Set()) {
  if (!node || typeof node !== "object") return null;
  if (typeof node.$ref === "string" && node.$ref.startsWith("#")) {
    const pointer = node.$ref.slice(1);
    if (seen.has(pointer)) return null;
    seen.add(pointer);
    const target = pointer
      .split("/")
      .filter(Boolean)
      .reduce((acc, raw) => {
        if (acc == null) return null;
        const seg = decodeURIComponent(raw).replace(/~1/g, "/").replace(/~0/g, "~");
        return acc[seg];
      }, schema);
    return resolveSubschema(schema, target, seen);
  }
  return node;
}

export function readEnum(schema, field) {
  const properties = schema && typeof schema === "object" ? schema.properties : null;
  if (!properties) return null;
  const node = resolveSubschema(schema, properties[field]);
  const value = node && node.enum;
  return Array.isArray(value) && value.length > 0 ? value : null;
}

// 读取 schema 中某字段的 pattern（模式唯一事实源在 schema，与 readEnum 同一哲学）。
// 返回 RegExp；未声明、空串或非法正则时返回 null，由调用方 fail-closed。
// 与 server/shared/dev-log.cjs 落盘器 `new RegExp(SCHEMA.properties.req.pattern)` 同源同法。
export function readPattern(schema, field) {
  const properties = schema && typeof schema === "object" ? schema.properties : null;
  if (!properties) return null;
  const node = resolveSubschema(schema, properties[field]);
  const value = node && node.pattern;
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    return new RegExp(value);
  } catch {
    return null;
  }
}

// 收集 schema 里声明的 format 关键字：ajv 未挂 ajv-formats 时会静默跳过这些断言（假绿），须显式暴露。
function collectFormats(node, seen = new Set(), out = new Set()) {
  if (!node || typeof node !== "object" || seen.has(node)) return out;
  seen.add(node);
  if (typeof node.format === "string") out.add(node.format);
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") collectFormats(value, seen, out);
  }
  return out;
}

// ajv-formats 是可选依赖（本仓未显式声明）：解析不到时返回 null，由调用方 fail-closed。
// 抽成独立函数是为了让「format 断言被静默跳过」这条 fail-closed 分支可被单测直接注入。
export function resolveAjvFormats() {
  try {
    const mod = require("ajv-formats");
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

function loadAjv(schema, addFormats) {
  const options = { allErrors: true, strict: false };
  const uses2020 = typeof schema.$schema === "string" && schema.$schema.includes("2020-12");
  const Ctor = uses2020 ? (require("ajv/dist/2020.js").default ?? require("ajv/dist/2020.js")) : Ajv;
  const ajv = new Ctor(options);
  if (addFormats) addFormats(ajv);
  return ajv;
}

// ── 事件读取 ──

// 返回 null 表示目录不存在（合法空态的一种）；返回数组（可为空）表示目录存在。
function collectEntryFiles(entriesDir) {
  if (!fs.existsSync(entriesDir)) return null;
  return fs
    .readdirSync(entriesDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => entry.name)
    .sort();
}

function readEvents(entriesDir, fileNames) {
  const events = [];
  const parseErrors = [];
  const ledgerSizes = []; // 每本台账的字节数（供体积护栏，不参与校验结论）
  for (const name of fileNames) {
    const file = `${ENTRIES_RELPATH}/${name}`;
    const raw = fs.readFileSync(path.join(entriesDir, name), "utf8");
    ledgerSizes.push({ file, bytes: Buffer.byteLength(raw, "utf8") });
    raw.split("\n").forEach((lineText, index) => {
      const line = index + 1;
      const trimmed = lineText.trim();
      if (trimmed.length === 0) return; // 纯空行（含文件末尾换行）不构成事件
      let value;
      try {
        value = JSON.parse(trimmed);
      } catch (error) {
        parseErrors.push({
          kind: "dev_log_invalid_json",
          file,
          line,
          message: `${file}:${line} 不是合法 JSON（${error.message}）`,
        });
        return;
      }
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        parseErrors.push({
          kind: "dev_log_invalid_json",
          file,
          line,
          message: `${file}:${line} 事件必须是 JSON 对象，实际为 ${Array.isArray(value) ? "数组" : typeof value}`,
        });
        return;
      }
      events.push({ file, line, value, invalid: false });
    });
  }
  return { events, parseErrors, ledgerSizes };
}

// ── 台账文件级不变量 ──

// 台账文件名↔owner 校验：entries/ 下每个 *.jsonl 的 basename 必须精确等于契约 owner 枚举里的
// 某个 `<owner>.jsonl`（owner 取自 schema.properties.owner.enum，单源派生，本脚本不抄第二份）。
// 这条把契约「一 owner 一台账、禁分片」的断言变成机器强制：轮转已裁决取消，任何
// `20260915-0209-01-<owner>.jsonl` 形残留分片或游离 .jsonl 都必须清除。
// 与事件条数无关——游离分片即使为空也是违规，故在 checkDevLog 的空事件早返回之前执行。
export function checkLedgerFileNames(fileNames, schema) {
  const owners = readEnum(schema, "owner");
  if (!owners) {
    return [
      {
        kind: "dev_log_ledger_owner_source_missing",
        message:
          "schema 未声明 owner 的 enum——无法判定台账文件名是否合法（须为 <owner>.jsonl），fail-closed",
      },
    ];
  }
  const allowed = new Set(owners.map((owner) => `${owner}.jsonl`));
  const errors = [];
  for (const name of fileNames) {
    if (!allowed.has(name)) {
      errors.push({
        kind: "dev_log_ledger_filename_invalid",
        file: `${ENTRIES_RELPATH}/${name}`,
        message: `${ENTRIES_RELPATH}/${name} 的 basename 不是任一 owner 的 <owner>.jsonl（owner 取自契约 owner.enum：${owners.join("|")}）——一 owner 一台账、禁分片；游离分片/残留文件必须清除`,
      });
    }
  }
  return errors;
}

// ── 跨行不变量 ──

// seq 在各自台账（条目文件）内连续且唯一（ADR051:13：手工取号已实录撞号 4 次）。
// 台账 = 该 owner 的条目文件 docs/dev-log/entries/<owner>.jsonl 这一个文件：不分片、不轮转、
// 不删历史；消费方一律按条目文件分组判定 seq 不变量。同一文件内必须恰为 1..N、不跳号；
// 不同台账各自从 1 开始、互不相关——两个 owner 各有 seq=1 合法且预期，跨文件同号不构成冲突。
export function checkSeqUniqueness(events) {
  const errors = [];
  const byFile = new Map();
  for (const event of events) {
    if (!byFile.has(event.file)) byFile.set(event.file, []);
    byFile.get(event.file).push(event);
  }
  for (const [file, fileEvents] of byFile) {
    const bySeq = new Map();
    for (const event of fileEvents) {
      const seq = event.value.seq;
      if (typeof seq !== "number" || !Number.isInteger(seq)) continue; // 类型问题由 schema 报告
      if (!bySeq.has(seq)) bySeq.set(seq, []);
      bySeq.get(seq).push(event);
    }
    const seqs = [...bySeq.keys()].sort((a, b) => a - b);
    for (const seq of seqs) {
      const holders = bySeq.get(seq);
      if (holders.length > 1) {
        errors.push({
          kind: "dev_log_seq_duplicate",
          seq,
          file,
          message: `${file} 内 seq ${seq} 被 ${holders.length} 条事件重复占用（${summarize(holders.map(loc))}）——同一文件内 seq 必须唯一，手工取号已实录撞号`,
        });
      }
    }
    if (seqs.length > 0) {
      const max = seqs[seqs.length - 1];
      const missing = [];
      for (let expected = 1; expected <= max; expected += 1) {
        if (!bySeq.has(expected)) missing.push(expected);
      }
      if (missing.length > 0) {
        errors.push({
          kind: "dev_log_seq_discontinuous",
          file,
          message: `${file} 的 seq 不连续：期望 1..${max} 全部在场，缺失 ${summarize(missing)}（seq 由机器取 max+1，同一文件内不允许跳号）`,
        });
      }
    }
  }
  return errors;
}

function checkEventFields(events, { schema, ownerZonePrefixes }) {
  const errors = [];
  const enums = {};
  for (const field of ENUM_FIELDS) {
    enums[field] = readEnum(schema, field);
    if (!enums[field]) {
      errors.push({
        kind: "dev_log_enum_source_missing",
        field,
        message: `schema 未声明 ${field} 的 enum——枚举唯一事实源缺失，无法判定越界，fail-closed（不允许把枚举抄进检查脚本）`,
      });
    }
  }

  // 模式同枚举处理：源缺失即 fail-closed，且不做逐条 req 判定（避免同因重复刷屏）。
  const reqPattern = readPattern(schema, "req");
  if (!reqPattern) {
    errors.push({
      kind: "dev_log_pattern_source_missing",
      field: "req",
      message: `schema 未声明 req 的 pattern——模式唯一事实源缺失，无法判定 req 格式，fail-closed（不允许把模式抄进检查脚本）`,
    });
  }

  // #1883 语义层校验：summary/modules 只允许出现在 dev.task.summarized 事件上（错位即脏数据）。
  for (const event of events) {
    const { value } = event;
    const isSummaryEvent = value.event === "dev.task.summarized";
    if (!isSummaryEvent && (value.summary != null || value.modules != null)) {
      errors.push({
        kind: "dev_log_summary_misplaced",
        location: loc(event),
        message: `summary/modules 只允许出现在 dev.task.summarized 事件（实际 event=${value.event}）——语义层错位`,
      });
    }
    if (isSummaryEvent && (typeof value.summary !== "string" || value.summary.trim().length === 0)) {
      errors.push({
        kind: "dev_log_summary_empty",
        location: loc(event),
        message: "dev.task.summarized 事件必须携带非空 summary（任务语义总结不能是空壳）",
      });
    }
  }

  const unknownOwners = new Set();
  for (const event of events) {
    const { value } = event;

    for (const field of ENUM_FIELDS) {
      const allowed = enums[field];
      if (!allowed) continue; // 源缺失已单独 fail，避免同因重复刷屏
      const actual = value[field];
      if (actual === undefined) continue; // 必填性由 schema 报告
      if (!allowed.includes(actual)) {
        errors.push({
          kind: "dev_log_enum_violation",
          field,
          file: event.file,
          line: event.line,
          message: `${loc(event)} ${field}=${JSON.stringify(actual)} 越界，允许值取自 schema：${allowed.join("|")}`,
        });
      }
    }

    const req = value.req;
    if (reqPattern && req !== undefined && req !== null && req !== "") {
      if (typeof req !== "string" || !reqPattern.test(req)) {
        errors.push({
          kind: "dev_log_req_format",
          file: event.file,
          line: event.line,
          message: `${loc(event)} req=${JSON.stringify(req)} 不匹配 ${reqPattern}（模式取自 schema；null/缺省合法，空串非法）`,
        });
      }
    }

    const owner = value.owner;
    const prefixes = typeof owner === "string" ? ownerZonePrefixes[owner] : null;
    if (!prefixes) {
      if (!unknownOwners.has(String(owner))) {
        unknownOwners.add(String(owner));
        errors.push({
          kind: "dev_log_owner_unknown",
          owner: String(owner),
          message: `${loc(event)} owner=${JSON.stringify(owner)} 不在归属映射中，无法判定 files 是否越界，fail-closed`,
        });
      }
      continue;
    }
    if (!Array.isArray(value.files)) continue; // 类型问题由 schema 报告
    for (const rawFile of value.files) {
      const rel = normalizeRelPath(rawFile);
      if (rel === null || !isWithinZone(prefixes, rel)) {
        errors.push({
          kind: "dev_log_file_out_of_zone",
          owner,
          file: event.file,
          line: event.line,
          message: `${loc(event)} files 中的 ${JSON.stringify(rawFile)} 越出 owner=${owner} 的管辖目录（允许前缀：${prefixes.join(", ")}）`,
        });
      }
    }
  }
  return errors;
}

// ── 台账体积护栏（只提示，不改退出码）──

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

// 台账 append-only，且轮转已裁决取消，故体积无界增长是**合法状态**而非非法状态：
// 本函数只产出提示文案，绝不参与 status/退出码计算，也绝不删改任何条目文件。
// 未越线时保持安静（无问题不刷屏是本仓门禁惯例）。
export function ledgerSizeHints(ledgerSizes, threshold = LEDGER_SIZE_HINT_BYTES) {
  return (ledgerSizes || [])
    .filter((entry) => entry.bytes >= threshold)
    .map((entry) => {
      const approxEvents = Math.round(entry.bytes / BYTES_PER_EVENT_APPROX);
      return `dev_log_size_hint: ${entry.file} 已达 ${formatBytes(entry.bytes)}（约 ${approxEvents} 条事件），越过 ${formatBytes(threshold)} 提示线——台账 append-only 不可回收，请规划冷归档（禁止删除/截断/轮转）`;
    });
}

export { collectEntryFiles, readEvents, collectFormats, loadAjv, checkEventFields };
