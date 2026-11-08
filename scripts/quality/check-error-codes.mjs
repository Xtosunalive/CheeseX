#!/usr/bin/env node
// Component: Error-Code-Contract-Guard（错误码事实源双向对账 · P1 模式新实例）
// @responsible: 看守「服务端抛出的错误码 ↔ 契约 error_code enum」的双向完备：
//   ① 抛了未登记（服务端会抛但契约无此码）——enforce 会把这类真实业务错误掩埋成 500
//      （tr_43c615f5 实证：DUPLICATE_DOCUMENT_ID 撞上 409 anyOf 全败，真实错误不可见）
//   ② 登记没人抛（契约 enum 死码）——要么实现丢了要么契约超前，两者都该显式处理
// @context: 2026-10-08 Master 批（00:58「可以」）——P1 名言「单向对账会漏一半」在错误码域重演后的立门禁
// @faces: ①未登记/死枚举双向对账（ci）＋commit 面（PR-206：新码提交瞬间即拦，不再等 CI 兜底）
//         ②内部信号车道（PR-206②）：进程内信号（如 vault-io 写前冲突）不因无 enum 强制入欠账基线——
//           机器面判「外发」的硬信号＝error_code: 直写形态 ∨ 出现在 server/routes/**；
//           工厂同名异物（vault-io 本地 createError vs http-app createError）句式不可判，交四要素到期复审
//         ③freshness＋④出生校验 strict 面（WP-122 error 族合一 2026-11-06：自 error-registry 门禁
//           原样并入，判定逻辑零改动；该门禁就此退役——面①归 derivation-sync（theschema-roles
//           派生行，vault 环境纳保），面②由本件 faces 承接。CI 门禁阶段在 vault 构建步之前，
//           面③是 freshness 唯一无条件执法点）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { EXEMPTION_FIELDS } from "./shared/exemption-fields.mjs"; // PR-215：四要素清单单源（判定强度仍按本件语义＝真值判，不随并源改口径）

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONTRACT = path.join(ROOT, "contracts", "http-api.openapi.json");
const SERVER = path.join(ROOT, "server");
const ROUTES = path.join(ROOT, "server", "routes");
const EXEMPTIONS_PATH = path.join(ROOT, "contracts", "error-code-exemptions.json");

// ── 抛点提取形态（与归账口径同源：外发/内部两车道共用同一收集器，不允许两处各译一遍）──
//   A. 错误工厂调用：typedError/repairError/… 工厂族＋bindErrorFactory 绑定别名（PR-167/168 批补面）
//   B. 对象字面量：error_code: "CODE" | .code = "CODE" | code: "CODE"
//   C. Object.assign(new Error(…), { code: "CODE" })
const THROW_PATTERNS = [
  /(?:typedError|repairError|serviceError|adapterError|sendError|workflowError|reviewError|consumerError|readerError|artifactError|publisherError|snapshotError|stateError|parentError|builderError)\s*\(\s*"([A-Z][A-Z0-9_]{4,})"/g,
  // PR-085 第 2 步补面：EG-1b 共享错误工厂 createError/createErrorWithDetails 及其绑定别名 routeError（http-app/auth 抛点形态）
  /(?:createError|createErrorWithDetails|routeError)\s*\(\s*"([A-Z][A-Z0-9_]{4,})"/g,
  /error_code:\s*"([A-Z][A-Z0-9_]{4,})"/g,
  /\.code\s*=\s*"([A-Z][A-Z0-9_]{4,})"/g,
  /\bcode:\s*"([A-Z][A-Z0-9_]{4,})"/g,
  /Object\.assign\(new Error[^)]*\)\s*,\s*\{\s*code:\s*"([A-Z][A-Z0-9_]{4,})"/g,
];
// 响应序列化形态（PR-206② 的外发硬信号①）：error_code: 直写＝响应体键名，出现即达 HTTP 边界
const SERIALIZED_PATTERN = /error_code:\s*"([A-Z][A-Z0-9_]{4,})"/g;
const EXEMPT_THROWN = new Set([
  // 兜底码：errorResponse 缺省值（无法定位到具体业务面，契约侧已登记 INTERNAL_ERROR）
  "INTERNAL_ERROR",
]);

/** 改名解构别名派生（PR-222）：`const { createError: relationError } = require(...)` 的别名
 *  不在任何固定名单——从文本派生别名集并为每个别名生成工厂模式，防「补一个漏一片」。 */
export function deriveFactoryAliases(serverTexts) {
  const aliases = new Set();
  const destructureRe = /const\s*\{([^}]*)\}\s*=\s*require\(/g;
  for (const [, names] of (serverTexts instanceof Map ? [...serverTexts.values()] : Object.values(serverTexts)).map((t) => [null, t])) {
    destructureRe.lastIndex = 0;
    let m;
    while ((m = destructureRe.exec(names))) {
      for (const pair of m[1].split(",")) {
        const alias = pair.split(":")[1];
        if (alias) {
          const name = alias.trim().replace(/^["']|["']$/g, "");
          if (/^[A-Za-z_][\w$]*$/.test(name) && name !== "createError" && name !== "createErrorWithDetails") aliases.add(name);
        }
      }
    }
  }
  return [...aliases];
}

/** 抛点收集：返回 { thrown: Map<code, files[]>, serialized: Set<code>, routesThrown: Set<code> }。
 *  serverTexts: Map<相对路径, 文件文本>；routesPrefix 划定 HTTP 边界目录。 */
export function collectThrownCodes(serverTexts, routesPrefix = "server/routes/") {
  const thrown = new Map();
  const serialized = new Set();
  const routesThrown = new Set();
  const aliases = deriveFactoryAliases(serverTexts);
  const patterns = aliases.length
    ? THROW_PATTERNS.concat([new RegExp("(?:" + aliases.join("|") + ")\\s*\\(\\s*\"([A-Z][A-Z0-9_]{4,})\"", "g")])
    : THROW_PATTERNS;
  for (const [rel, text] of serverTexts) {
    const isRoute = rel.startsWith(routesPrefix);
    for (const re of patterns) {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) {
        const code = m[1];
        if (EXEMPT_THROWN.has(code)) continue;
        if (!thrown.has(code)) thrown.set(code, []);
        if (!thrown.get(code).includes(rel)) thrown.get(code).push(rel);
        if (isRoute) routesThrown.add(code);
      }
    }
    SERIALIZED_PATTERN.lastIndex = 0;
    for (const m of text.matchAll(SERIALIZED_PATTERN)) if (!EXEMPT_THROWN.has(m[1])) serialized.add(m[1]);
  }
  return { thrown, serialized, routesThrown };
}

/** 契约侧枚举收集（穿透 allOf 目录单元）：Map<code, schema 名>。 */
export function collectContractCodes(contract) {
  const contractCodes = new Map();
  for (const [name, schema] of Object.entries(contract?.components?.schemas || {})) {
    if (!schema || typeof schema !== "object") continue;
    for (const part of (schema.allOf || [schema])) {
      const ec = part?.properties?.error_code;
      if (ec && Array.isArray(ec.enum)) for (const code of ec.enum) contractCodes.set(code, name);
    }
  }
  return contractCodes;
}

/** 对账核心（纯函数，测试件以合成输入直调）。exemptions 形状＝contracts/error-code-exemptions.json。 */
export function auditErrorCodes({ contract, exemptions, serverTexts, today }) {
  const contractCodes = collectContractCodes(contract);
  const { thrown, serialized, routesThrown } = collectThrownCodes(serverTexts);
  const todayStr = today || new Date().toISOString().slice(0, 10);
  const structural = [];
  const EXEMPT_UNREGISTERED = new Set();
  const EXEMPT_DEAD_ENUM = new Set();
  const INTERNAL_SIGNALS = new Set();
  const load = (list, target, lane) => {
    for (const item of list || []) {
      const missing = EXEMPTION_FIELDS.filter((k) => !item[k]);
      if (missing.length) structural.push(`[豁免缺要素] ${item.code}：缺 ${missing.join("/")}`);
      if (item.expiresAt && item.expiresAt < todayStr) structural.push(`[豁免过期] ${item.code}：expiresAt=${item.expiresAt}——立即清理或重裁`);
      target.add(item.code);
    }
    return lane;
  };
  load(exemptions?.unregistered, EXEMPT_UNREGISTERED);
  load(exemptions?.deadEnum, EXEMPT_DEAD_ENUM);
  load(exemptions?.internalSignals, INTERNAL_SIGNALS);

  // ── 内部信号车道机器面（PR-206②）：三条硬判，任一命中＝已达外发面，不得留内部道 ──
  for (const code of INTERNAL_SIGNALS) {
    if (contractCodes.has(code)) structural.push(`[内部信号越界] "${code}" 已在契约 enum（${contractCodes.get(code)}）——外发码不得挂内部道，须移回 unregistered 欠账或撤销契约登记`);
    if (serialized.has(code)) structural.push(`[内部信号越界] "${code}" 出现 error_code: 直写形态——响应序列化即外发，须登记契约而非挂内部道`);
    if (routesThrown.has(code)) structural.push(`[内部信号越界] "${code}" 出现在 server/routes/**——路由层即 HTTP 边界，须登记契约或重包域码`);
    if (!thrown.has(code)) structural.push(`[内部信号悬空] "${code}" 服务端已无抛点——条目须摘（棘轮只减不增）`);
  }

  // ── 双向对账 ──
  const violations = [...structural];
  for (const [code, files] of thrown) {
    if (!contractCodes.has(code) && !EXEMPT_UNREGISTERED.has(code) && !INTERNAL_SIGNALS.has(code)) {
      violations.push(`[未登记] 服务端抛 "${code}"（${files[0]}）但契约无此 error_code——enforce 会掩埋成 500（tr_43c615f5 同型）；确属进程内信号且不达 HTTP 边界者，移挂 internalSignals 车道（四要素＋机器面硬判）`);
    }
  }
  for (const [code, schema] of contractCodes) {
    if (!thrown.has(code) && !EXEMPT_DEAD_ENUM.has(code)) {
      violations.push(`[死枚举] 契约 ${schema} 含 "${code}" 但服务端无抛点——实现丢失或契约超前，须显式归位`);
    }
  }
  return {
    violations,
    readout: `error_codes=ok contract=${contractCodes.size} thrown=${thrown.size} unregistered_baseline=${EXEMPT_UNREGISTERED.size} internal_signals=${INTERNAL_SIGNALS.size} dead_enum_baseline=${EXEMPT_DEAD_ENUM.size}`,
  };
}

// ── 面③④（WP-122 error 族合一：唯一实现住 shared/error-registry-faces.mjs，此处引用并再导出）──
//   ③ freshness：生成物与抛点扫描一致（生成器 --check）。同语义派生行已登记 theschema-roles
//      （derivation-sync 在 vault 环境纳保）；但 CI 门禁阶段在 vault 构建步之前（quality.yml
//      步序 61 vs 120），派生同步在 CI 是 skip 态——本面是 freshness 唯一无条件执法点，不可省。
//   ④ 出生校验行为证明：strict 三态（未知码炸/已登记过/三工厂共享）。
import { auditRegistryFaces } from "./shared/error-registry-faces.mjs";
export { auditRegistryFaces };

function walkServerTexts() {
  const texts = new Map();
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      if (name === "__tests__" || name === "node_modules" || name === ".ledger") continue;
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) walk(full);
      else if ((name.endsWith(".cjs") || name.endsWith(".mjs")) && !name.includes(".test.")) {
        // 红队洞 8 加固：.mjs 服务/路由件同收（防新写 .mjs 即对两车道隐身）
        texts.set(path.relative(ROOT, full).split(path.sep).join("/"), fs.readFileSync(full, "utf-8"));
      }
    }
  })(SERVER);
  return texts;
}

async function main() {
  const fail = (lines) => {
    console.log(`error_codes=FAIL violations=${lines.length}`);
    for (const line of lines) console.log(`  ${line}`);
    process.exit(1);
  };
  if (!fs.existsSync(CONTRACT)) fail(["[结构] 契约文件不存在: contracts/http-api.openapi.json"]);
  const contract = JSON.parse(fs.readFileSync(CONTRACT, "utf-8"));
  const exemptions = fs.existsSync(EXEMPTIONS_PATH) ? JSON.parse(fs.readFileSync(EXEMPTIONS_PATH, "utf-8")) : {};
  const { violations, readout } = auditErrorCodes({ contract, exemptions, serverTexts: walkServerTexts() });
  violations.push(...(await auditRegistryFaces()));
  if (violations.length === 0) console.log(`${readout} registry_faces=ok（freshness＋出生校验 strict）`);
  else fail(violations);
}

// 红队洞 7 加固：import（测试件合成输入直调）不得触发真库扫描——直跑形态判定
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
