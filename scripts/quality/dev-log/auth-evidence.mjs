/**
 * auth-evidence.mjs — REQUIREMENTS 指令字段 → dev-log auth 值的证据解析器（#1876）。
 *
 * 退役记档（2026-10-24）：REQUIREMENTS.md 手写总账退役（#66 清空后十批实践迁 SPEC 证据列）；
 * parseAuthEvidenceFromRepo 对缺文件返回空表（全 none），钩子链不受影响。解析器保留：
 * 供历史仓库/回填解析复用；现行 auth 证据源为提交信息（dev-log 台账自动留痕）。
 *
 * 单源定位：auth 枚举定义在 contracts/dev-log.schema.json；「什么算 confirm 证据」
 * 的判定规则定义在本模块（唯一），生产者 B 与回填脚本都引用此处，不自持副本。
 *
 * 判定语义（保守优先——宁可少判不可误判）：
 * - confirm：条目的 → 指令 / → 指令原文 行含「用户 + 言说/决策动词」或用户原话引号。
 *   证据形态（实测 REQUIREMENTS 741 条归纳）：用户「原话」/ 用户先问「…」/ 用户裁决… /
 *   用户授权「…」/ 用户拍板 / 行首直接引号（间接引语）。
 * - none：无指令字段、指令行无用户证据（派生任务、独立验证者条目、AI 自主排查）。
 *   这是「未判定到证据」的保守缺省，不是「判定为无需授权」——升级路径留给人工。
 * - accept（人工收货）不在本解析器职责内：收货证据（复核关账/验收签收）形态
 *   与事前指令不同（散落在状态行/动作项），机读化另立批次，此处不臆造。
 */
import fs from "node:fs";
import path from "node:path";

// 言说/决策动词（用户后 0-5 字内出现即命中；实测覆盖 先问/问/裁决/指出/拍板/确认/口径/授权 等）
const SPEECH_VERB_ALTERNATION = [
  "先问", "问", "裁决", "指出", "拍板", "确认", "口径", "回答", "示意", "回复",
  "指示", "要求", "批准", "同意", "授权", "委托", "按阅读", "按", "说", "讲",
].join("|");

const SPEECH_RE = new RegExp(`用户[^，。；]{0,5}(?:${SPEECH_VERB_ALTERNATION})`);
const USER_QUOTE_START_RE = /^用户[「“‘]/;
const BARE_QUOTE_START_RE = /^[「“‘]/;

/**
 * 判定单条指令行是否构成 confirm 证据。
 * @param {string} directiveLine - → 指令：之后的整行文本
 * @returns {boolean}
 */
export function isConfirmEvidence(directiveLine) {
  const line = String(directiveLine || "");
  if (!line.trim()) return false;
  return SPEECH_RE.test(line) || USER_QUOTE_START_RE.test(line) || BARE_QUOTE_START_RE.test(line);
}

/**
 * 从 REQUIREMENTS.md markdown 中解析全部条目的指令证据。
 * @param {string} markdown - REQUIREMENTS.md 全文
 * @returns {Map<string, boolean>} req 号（不带 #）→ 是否 confirm 证据
 */
export function parseAuthEvidence(markdown) {
  const result = new Map();
  const sections = String(markdown || "").split(/^### #(\d+)\s/m);
  // split 产物：[前导, id1, body1, id2, body2, ...]
  for (let i = 1; i < sections.length - 1; i += 2) {
    const id = sections[i];
    const body = sections[i + 1];
    const m = body.match(/^→ (?:指令|指令原文)：(.*)$/m);
    result.set(id, m ? isConfirmEvidence(m[1]) : false);
  }
  return result;
}

/**
 * 便捷入口：按仓库根解析 REQUIREMENTS.md。
 * @param {string} root - 仓库根目录
 * @returns {Map<string, boolean>}
 */
export function parseAuthEvidenceFromRepo(root) {
  const requirementsPath = path.join(root, "REQUIREMENTS.md");
  const markdown = fs.existsSync(requirementsPath)
    ? fs.readFileSync(requirementsPath, "utf8")
    : "";
  return parseAuthEvidence(markdown);
}

/**
 * 按事件对象的 req 字段返回应回填的 auth 值。
 * @param {{req: string|null}} event - dev-log 事件（或含 req 的对象）
 * @param {Map<string, boolean>} evidence - parseAuthEvidence 产物
 * @returns {"confirm"|"none"} req 命中证据 → confirm；否则 none（保守缺省）
 */
export function resolveAuth(event, evidence) {
  const req = event && typeof event.req === "string" ? event.req.replace(/^#/, "") : null;
  if (req && evidence.get(req) === true) return "confirm";
  return "none";
}
