// Component: YAML-Frontmatter-Parser
// @responsible: Parse Obsidian Markdown into { frontmatter, body } — pure, no fs
// @inputs: raw markdown string
// @outputs: { sourcePath, fileName, frontmatter: object, body: string }
// @context: Vault

const yaml = require("yaml");
const path = require("path");

/**
 * Parse a Markdown string into frontmatter object and body.
 * Handles empty/absent frontmatter gracefully.
 * @param {string} raw - full file content
 * @param {string} sourcePath - absolute path (used for fileName extraction only)
 * @returns {{ sourcePath: string, fileName: string, frontmatter: object, body: string }}
 */
// WP-050 D1/D-B：frontmatter 产物 null 原型深变换——内容键（实体 product/status 等可写值）
// 作对象键的原型命中从结构上不可表达（P1 文档面病根：entity-repair :117-118 等址）。
function nullProtoDeep(value) {
  if (Array.isArray(value)) return value.map(nullProtoDeep);
  if (value && typeof value === "object") {
    const out = Object.create(null);
    for (const key of Object.keys(value)) out[key] = nullProtoDeep(value[key]);
    return out;
  }
  return value;
}

// WP-116（SPEC-083 §二.1）：`---` frontmatter 切分＋解析核心——全仓生产代码唯一切分点。
// 缺省入口 parseEntityDocument（宽容）与严格入口 parseEntityDocumentStrict（可报错）共用本步；
// 本函数自身不裁决宽容/严格，只收集各步判别信息，由入口决定处置。
function splitAndParseFrontmatter(raw) {
  const split = { started: false, unclosed: false, endIdx: -1, parsed: undefined, yamlError: null };
  if (typeof raw === "string" && raw.startsWith("---")) {
    split.started = true;
    // Find closing ---
    const endIdx = raw.indexOf("\n---", 3);
    if (endIdx < 0) {
      split.unclosed = true;
      return split;
    }
    split.endIdx = endIdx;
    try {
      split.parsed = yaml.parse(raw.slice(3, endIdx).trim()) || {};
    } catch (e) {
      split.yamlError = e;
    }
  }
  return split;
}

function parseEntityDocument(raw, sourcePath) {
  const fileName = sourcePath ? path.basename(sourcePath) : "";
  const result = { sourcePath: sourcePath || "", fileName, frontmatter: {}, body: raw || "" };

  if (!raw || typeof raw !== "string") return result;
  const split = splitAndParseFrontmatter(raw);
  if (!split.started || split.unclosed) return result;

  if (split.yamlError) {
    // YAML parse failed — return empty frontmatter, keep body intact
    result.frontmatter = Object.create(null);
  } else {
    result.frontmatter = nullProtoDeep(split.parsed);
  }
  result.body = raw.slice(split.endIdx + 4).trim();
  return result;
}

/**
 * WP-116（SPEC-083 §二.1）：严格通道——fail-closed 消费方（projection 的 parseMarkdown）委托入口。
 * 与 parseEntityDocument 共用同一切分/解析核心，但三边界不吞错，逐态给出判别诊断：
 *   - unclosed-frontmatter：未闭合 `---`；
 *   - invalid-yaml：非法 YAML（message 逐字携带底层 yaml 库 detail）；
 *   - frontmatter-not-object：frontmatter 解析结果非普通对象（标量/数组等）。
 * diagnostics 非空时 doc 仅为尽力产物，消费方必须以 diagnostics 为准；诊断为空时
 * doc.frontmatter 为 yaml 原生解析结果（Object.prototype，未做 null 原型变换——与
 * parseEntityDocument 的 null 原型产物不同，这是两个宿主的历史形状差异，保持不变）。
 * @param {string} raw - full file content
 * @param {string} sourcePath - absolute path (used for fileName extraction only)
 * @returns {{ doc: { sourcePath: string, fileName: string, frontmatter: object, body: string }, diagnostics: Array<{code: string, message: string}> }}
 */
function parseEntityDocumentStrict(raw, sourcePath) {
  const diagnostics = [];
  const fileName = sourcePath ? path.basename(sourcePath) : "";
  const doc = { sourcePath: sourcePath || "", fileName, frontmatter: {}, body: raw || "" };
  if (!raw || typeof raw !== "string") return { doc, diagnostics };

  const split = splitAndParseFrontmatter(raw);
  if (!split.started) return { doc, diagnostics };
  if (split.unclosed) {
    diagnostics.push({ code: "unclosed-frontmatter", message: "unclosed frontmatter" });
    return { doc, diagnostics };
  }
  doc.body = raw.slice(split.endIdx + 4).trim();
  if (split.yamlError) {
    diagnostics.push({ code: "invalid-yaml", message: `invalid YAML: ${split.yamlError.message}` });
    return { doc, diagnostics };
  }
  doc.frontmatter = split.parsed;
  if (!split.parsed || typeof split.parsed !== "object" || Array.isArray(split.parsed)) {
    diagnostics.push({ code: "frontmatter-not-object", message: "frontmatter must be an object" });
  }
  return { doc, diagnostics };
}

function unsafeFrontmatterError(message) {
  const error = new Error(message);
  error.code = "UNSAFE_FRONTMATTER";
  error.status = 422;
  return error;
}

function frontmatterBounds(raw) {
  const bomLength = raw.startsWith("﻿") ? 1 : 0;
  if (raw.slice(bomLength, bomLength + 3) !== "---") throw unsafeFrontmatterError("源文件缺少 YAML frontmatter");
  const firstBreak = raw.indexOf("\n", bomLength + 3);
  const close = raw.indexOf("\n---", firstBreak);
  if (firstBreak < 0 || close < 0) throw unsafeFrontmatterError("无法定位 frontmatter 边界");
  return { contentStart: firstBreak + 1, close };
}

/**
 * Pure frontmatter text transform: apply whitelisted field changes to an existing
 * YAML frontmatter block without reformatting the rest of the document. No fs, no policy.
 * @param {string} raw - full markdown file content
 * @param {object} changes - field → value map to upsert
 * @param {{ deleteWhenEmptyFields?: Set<string>|string[] }} [options]
 *   deleteWhenEmptyFields — fields removed (not written) when their new value is "".
 * @returns {string} rewritten file content
 */
function patchFrontmatter(raw, changes, options = {}) {
  const deleteWhenEmpty = options.deleteWhenEmptyFields instanceof Set
    ? options.deleteWhenEmptyFields
    : new Set(Array.isArray(options.deleteWhenEmptyFields) ? options.deleteWhenEmptyFields : []);
  const bounds = frontmatterBounds(raw);
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const lines = raw.slice(bounds.contentStart, bounds.close).replace(/\r\n/g, "\n").split("\n");
  for (const field of Object.keys(changes)) {
    const starts = [];
    const fieldPattern = new RegExp("^" + field.replace(/-/g, "\\-") + ":(?:\\s|$)");
    for (let i = 0; i < lines.length; i++) if (fieldPattern.test(lines[i])) starts.push(i);
    if (starts.length > 1) throw unsafeFrontmatterError("字段重复，无法安全修改: " + field);
    if (deleteWhenEmpty.has(field) && changes[field] === "") {
      if (starts.length === 1) lines.splice(starts[0], 1);
      continue;
    }
    const serialized = yaml.stringify({ [field]: changes[field] }).trimEnd().split("\n");
    if (starts.length === 0) { lines.push.apply(lines, serialized); continue; }
    const start = starts[0];
    if (/(^|\s)#/.test(lines[start].slice(lines[start].indexOf(":") + 1))) throw unsafeFrontmatterError("目标字段包含注释，需在 Obsidian 修改: " + field);
    let end = start + 1;
    while (end < lines.length && !/^[A-Za-z_][A-Za-z0-9_-]*:(?:\s|$)/.test(lines[end])) end++;
    lines.splice(start, end - start, ...serialized);
  }
  return raw.slice(0, bounds.contentStart) + lines.join(eol) + raw.slice(bounds.close);
}

module.exports = { frontmatterBounds, parseEntityDocument, parseEntityDocumentStrict, patchFrontmatter };
