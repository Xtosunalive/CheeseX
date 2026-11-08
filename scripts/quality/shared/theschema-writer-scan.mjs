// Component: TheSchema-Writer-Scan（check:schema-writers 检查面⑨的纯函数面——写者反向对账）
// @responsible: 实存写者 ⊆ 登记写者 ∪ 通道豁免。data-domains schema-rules-data.write_protocol 声明
//               「未登记写者出现＝违约信号，check:schema-writers 执法」，但此前只有①「登记→指针存在」
//               单向面，反向「实存→登记」无执法面（playbook 铁律「执法口径≥行为口径」的缺口——
//               completed 域内 9 个真实写者未登记而门禁全绿，2026-10-22 核查实证）。本面补齐反向。
// 判定规则（静态，.cjs/.mjs）：
//   ① 调用 repoWrite（仓内通道）的模块（通道本体除外）必为 TheSchema 写者——repo-schema-io 目的地
//      执法只允许 data/theschema，故凡调用即写 TheSchema；
//   ② 调用 vault 通道（writeVault／replaceVault／writeVaultExclusive）且引用 TheSchema 解析点
//      （resolveTheSchemaDir／vaultPaths.get*FilePath）的模块——跨通道同域写者候选（article_associations 类）。
//      保守扩面：仅读解析点而写内容域的模块（如 entity-repair 的修订指纹计算）也会命中——显式豁免
//      （附理由）而非收窄规则，宁误报须确认、不漏报（fail-closed 方向）。
// 边界：Python 写者（archive-enums-legacy.py 等）与 fs 直写不在本面扫描集——前者由①指针面登记对账，
//       后者由面⑦ repo 洁净面（写后未提交即红）兜底；生成器脚本按 theschema-roles generator 登记入 derivation-sync。
import path from "node:path";

const WRITER_FILE_RE = /([\w.-]+\.(?:cjs|mjs|js|py))/;
const REPO_CHANNEL_RE = /\brepoWrite\(/;
const VAULT_CHANNEL_RE = /\b(?:writeVault|replaceVault|writeVaultExclusive)\(/;
const THESCHEMA_REF_RE = /resolveTheSchemaDir|vaultPaths\.get\w+FilePath|getEnumsFilePath|getFieldsFilePath/;

/** 通道本体（不是写者，是写者经过的门）＋扫描器自身（注释含规则原文）——默认豁免集。 */
export const CHANNEL_BASENAMES = ["repo-schema-io.cjs", "vault-io.cjs", "theschema-writer-scan.mjs"];

/** 从 data-domains writers 条目（"xxx.cjs:121-131（说明）" 形）抽取登记写者文件名集。无文件指针的条目（如「AI 会话文件编辑」）跳过。 */
export function parseRegisteredWriters(writers) {
  const out = new Set();
  for (const w of writers || []) {
    const m = String(w).match(WRITER_FILE_RE);
    if (m) out.add(m[1]);
  }
  return out;
}

/** 扫描文件内容，判定 TheSchema 写者。files: [{ rel, content }]；返回 [{ file, reason }]。 */
export function scanTheSchemaWriters(files, { channelBasenames = CHANNEL_BASENAMES } = {}) {
  const hits = [];
  for (const f of files || []) {
    const rel = f.rel || f.path || "";
    const base = path.basename(rel);
    if (channelBasenames.includes(base)) continue;
    const content = String(f.content || "");
    if (REPO_CHANNEL_RE.test(content)) {
      hits.push({ file: rel, reason: "调用 repoWrite（仓内 TheSchema 唯一写通道）" });
    } else if (VAULT_CHANNEL_RE.test(content) && THESCHEMA_REF_RE.test(content)) {
      hits.push({ file: rel, reason: "vault 通道写 TheSchema 解析目录（跨通道同域）" });
    }
  }
  return hits;
}

/** 反向对账：实存写者（扫描命中）⊆ 登记写者 ∪ 豁免。返回违规描述数组（空＝绿）。 */
/**
 * 面⑩ 纯函数面（WP-079 唯一门）：TheSchema 文件的写通道不得由调用方自判。
 * 两谓词（默认拒绝，无隐藏放行；豁免须在门禁侧附理由且空转即摘）：
 *   A 直连仓内通道——除通道本体（repo-schema-io）与咽喉（theschema-write）外，任何模块直连仓内通道写函数即红；
 *   B vault 通道写 TheSchema 住址——调用 vault 写族且同模块引用 TheSchema 解析点、又不经咽喉者即红
 *     （tr_504310b2 的确切形状：resolver 路径喂 vault-io）。
 * @param {{rel:string, content:string}[]} files
 * @param {{throatFiles?:string[], channelBodies?:string[]}} opts
 * @returns {{file:string, pred:"A"|"B", text:string}[]}
 */
export function scanChannelThroatBypass(files, opts = {}) {
  const throat = new Set(opts.throatFiles || ["server/shared/theschema-write.cjs"]);
  // PR-208 清债第二批定性（红队自证推翻首版派生）：channelBodies 语义＝「通道判定合法集」——
  // 这些文件**自身**出现写调用即合法（通道族由 theschema-write.cjs 架构定义）；runtime-scope
  // write_primitive_allow 是「写原语持有登记」（含 human-edit-guard 等非通道件）——两名单同值
  // 而立法不同（同串异义），派生会发生「allow 增删误改通道判定」的语义耦合（实测 check-schema-writers
  // 全量面被误伤红）。故保留字面＋F3 豁免登记（register=PR-208）。
  const bodies = new Set(opts.channelBodies || ["server/shared/repo-schema-io.cjs", "server/shared/vault-io.cjs", "server/shared/repo-file-io.cjs", "scripts/quality/shared/theschema-writer-scan.mjs"]);
  const VAULT_WRITE_RE = /\b(?:writeVault|replaceVault|writeVaultExclusive|appendVaultJsonl)\s*\(/;
  const RESOLVER_RE = /resolveTheSchemaDir|displayTheSchemaPath|vaultPaths\.get\w+FilePath/;
  const hits = [];
  for (const f of files || []) {
    const rel = String(f.rel || f.path || "").split(path.sep).join("/");
    if (rel.includes("__tests__") || bodies.has(rel) || throat.has(rel)) continue;
    const content = String(f.content || "");
    if (/\brepoWrite\s*\(/.test(content)) {
      hits.push({ file: rel, pred: "A", text: "直连 repoWrite——TheSchema 写须经咽喉 theschema-write.cjs" });
    } else if (VAULT_WRITE_RE.test(content) && RESOLVER_RE.test(content) && !/theschema-write\.cjs/.test(content)) {
      hits.push({ file: rel, pred: "B", text: "vault 通道 + TheSchema 解析点且不经咽喉（tr_504310b2 同形）" });
    }
  }
  return hits;
}

/** 反向对账：命中集 ⊆ 豁免集；豁免空转（不再命中）同样红——只减不增。 */
export function reconcileChannelThroat({ scanned, exempt = [] }) {
  const errors = [];
  const allow = new Map(exempt);
  const seen = new Set();
  for (const hit of scanned || []) {
    seen.add(hit.file);
    if (allow.has(hit.file)) continue;
    errors.push(`[绕过唯一门] ${hit.file} 谓词${hit.pred}：${hit.text}——唯一门＝server/shared/theschema-write.cjs（通道由它按落点选，服务侧禁自判）；确属例外须登记理由`);
  }
  for (const file of allow.keys()) {
    if (!seen.has(file)) errors.push(`[唯一门豁免空转] ${file} 已不命中谓词——豁免条目须摘（只减不增）`);
  }
  return errors;
}

export function reconcileActualWriters({ scanned, registered, exempt = [] }) {
  const errors = [];
  const reg = registered instanceof Set ? registered : new Set(registered || []);
  for (const hit of scanned || []) {
    const base = path.basename(hit.file);
    if (reg.has(base) || exempt.includes(base)) continue;
    errors.push(`[写者未登记] ${hit.file}（${hit.reason}）不在 data-domains schema-rules-data.writers——实存写者须登记（file:line 可定位），通道本体才可豁免`);
  }
  return errors;
}
