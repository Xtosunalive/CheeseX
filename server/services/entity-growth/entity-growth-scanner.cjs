// Component: Entity-Growth-Scanner（ADR-007 D2 生长流传感器 · SPEC-005 A1）
// @responsible: 扫描文章正文 wikilink → 实体候选信号（未解析目标=新实体候选）。
//               产物纯内存现算（R2：可丢弃派生物，不落盘不缓存）；只读扫描（R1：不直写 Vault 源）。
// @inputs: vaultPath（文章目录 wiki/articles + raw）、实体索引（buildEntityIndexes 产物）
// @outputs: scanEntityCandidates({vaultPath, indexes, articleFiles?}) →
//           { candidates: [{ name, mentionCount, samples: [{file, coordinate, snippet}] }],
//             entityMentions: [{ name, mentionCount }], orphanEntities: [{ name, sourcePath }] }
// @context: 2026-10-08 ADR-007/MVP A1-A5；复用 entity-compliance-body-rules 的
//           extractTypedWikilinks/resolveTarget（B02/B04 同源提取器——生长传感器与合规检查同源）
// 噪音排除：代码块内 wikilink、日期笔记模式（YYYY-MM-DD-*）、指向 TheSchema 的链接、
//           已解析目标（实体存在/别名命中）。

const fs = require("node:fs");
const path = require("node:path");
const { extractTypedWikilinks, resolveTarget } = require("../entity-compliance/entity-compliance-body-rules.cjs");
const { resolveTheSchemaDir } = require("../../shared/theschema-root.cjs");
// WP-116 批1（SPEC-083 §二.1）：frontmatter 字段信号的 `---` 切分收进文档装载宿主（六态取值）；
// WP-116 批2（SPEC-083 §二.3）：正文 body 切分同口收进宿主（readBody 改 loadDocument 取 body）。
const { loadDocument, docField } = require("../../shared/document-load-port.cjs");

// 日期笔记模式：知识库常见的 journal/日报命名，不是实体候选
const DATE_NOTE_RE = /^\d{4}-\d{2}-\d{2}/;
// 扫描的文章目录（MVP：wiki/articles + raw；wiki/entities 自身是实体目录不扫）
const ARTICLE_DIRS = ["wiki/articles", "raw"];

function stripCodeBlocks(body) {
  // 围栏代码块 ```...``` 内的 wikilink 不是语义提及
  return String(body || "").replace(/```[\s\S]*?```/g, "");
}

function listArticleFiles(vaultPath) {
  // raw 实况含多层子目录（imported/precleaned/archive/drafts/candidates/boards）——递归收集。
  const out = [];
  const walk = (dir, rel) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const childRel = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(full, childRel);
      else if (entry.name.endsWith(".md")) out.push({ rel: childRel, full });
    }
  };
  for (const dir of ARTICLE_DIRS) walk(path.join(vaultPath, "知识库", dir), `知识库/${dir}`);
  return out;
}

function readBody(full) {
  const raw = fs.readFileSync(full, "utf8");
  // 去掉 frontmatter（候选来自正文提及，不含元数据区）——WP-116 批2：切分经文档装载宿主
  // （loadDocument 取 body；宿主对无 frontmatter/未闭合件 body=原文，有件 body=闭合边界后段 trim）。
  // 探针实测（/tmp 边界矩阵 11 元）：[[提及]] 计数逐元一致；body 差异仅 trim/CRLF 族
  // （旧正则对 CRLF 件不剥元数据区属旧缺陷，宿主语义与批 1 admission-policy W01 口径一致）。
  return loadDocument(raw, full).body;
}

// PR-043B：读 frontmatter 的 module 字段（字段引用信号源）。正文 wikilink 之外的第二个
// 信号通道——module 值合法但无实体时与正文提及同样构成生长候选（2026-10-11 实战：
// 文章 module 指向"可观测性"，问题单报缺实体但候选卡不显示，用户被逼手工建页）。
// WP-116 批1：切分与取值经宿主——module 值取字符串标量（数字/布尔按文本；列表/对象形态
// 旧正则不匹配 → null，保持）；空串/缺键/空值返 null。
function readFrontmatterModule(full) {
  const doc = loadDocument(fs.readFileSync(full, "utf8"), full);
  const probe = docField(doc, "module");
  const value = probe.value;
  if (probe.state !== "present" && probe.state !== "empty-string") return null;
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return null;
  const text = typeof value === "string" ? value : String(value);
  return text.trim().replace(/^["']|["']$/g, "") || null;
}

// PR-043B：模块词表（合法值集合）。字段信号只收词表内的值——词表外的野生值归 wild_tag
// 通道（问题工作台）管，不进生长候选（边界：候选=合法但缺实体，野生=不合法待裁定）。
function loadModuleVocabulary(vaultPath) {
  try {
    // WP-049 余量批：经词表装载端口（raw 同形；吞错语义保持——字段信号静默关闭）
    const { readVocabDoc } = require("../../shared/vocab-load-port.cjs");
    const enums = readVocabDoc(vaultPath, "enums", null);
    const modules = (enums && enums.modules && typeof enums.modules === "object") ? enums.modules : {};
    return new Set(Object.keys(modules));
  } catch (_e) {
    return new Set(); // 词表不可读 → 字段信号静默关闭（正文 wikilink 通道不受影响）
  }
}

function entityFileExists(vaultPath, name) {
  return fs.existsSync(path.join(vaultPath, "知识库", "wiki", "entities", `${name}.md`));
}

function scanEntityCandidates({ vaultPath, indexes, articleFiles }) {
  const files = articleFiles || listArticleFiles(vaultPath);
  const candidateMap = new Map(); // name -> { mentionCount, samples[], sources }
  const mentionMap = new Map(); // 已解析实体名 -> count（A4 成熟度现算）
  const moduleVocab = vaultPath ? loadModuleVocabulary(vaultPath) : new Set();

  for (const f of files) {
    let body;
    try { body = stripCodeBlocks(readBody(f.full)); } catch (_e) { continue; }
    const { allTargets } = extractTypedWikilinks(body);
    const seen = new Set(); // 同文重复提及只计样例一次，计数累积
    for (const item of allTargets) {
      const name = item.trim();
      if (!name || DATE_NOTE_RE.test(name)) continue;
      if (name.startsWith("TheSchema")) continue;
      const resolved = resolveTarget(name, indexes || {});
      if (resolved) {
        if (!seen.has(name)) { seen.add(name); mentionMap.set(name, (mentionMap.get(name) || 0) + 1); }
        continue;
      }
      const entry = candidateMap.get(name) || { name, mentionCount: 0, samples: [], sources: ["body-mention"] };
      entry.mentionCount += 1;
      if (entry.sources && !entry.sources.includes("body-mention")) entry.sources.push("body-mention");
      if (entry.samples.length < 3) {
        const idx = String(body).indexOf(`[[${name}`);
        entry.samples.push({
          file: f.rel,
          coordinate: idx >= 0 ? `col:${idx}` : `file:${path.basename(f.full)}`,
          snippet: idx >= 0 ? String(body).slice(Math.max(0, idx - 30), idx + name.length + 4).replace(/\n/g, " ") : "",
        });
      }
      candidateMap.set(name, entry);
    }

    // PR-043B：字段引用信号——frontmatter module 值在词表内、无实体文件、且正文未产候选时收候选
    if (vaultPath) {
      try {
        const moduleName = readFrontmatterModule(f.full);
        if (moduleName && moduleVocab.has(moduleName) && !entityFileExists(vaultPath, moduleName)) {
          const resolved = resolveTarget(moduleName, indexes || {});
          if (!resolved && !candidateMap.has(moduleName)) {
            candidateMap.set(moduleName, {
              name: moduleName,
              mentionCount: 1,
              sources: ["field-reference"],
              samples: [{
                file: f.rel,
                coordinate: "frontmatter:module",
                snippet: `module: ${moduleName}`,
              }],
            });
          }
        }
      } catch (_e) { /* 单文件字段读取失败不阻断扫描 */ }
    }
  }

  const candidates = [...candidateMap.values()].sort((a, b) => b.mentionCount - a.mentionCount || a.name.localeCompare(b.name));
  const entityMentions = [...mentionMap.entries()].map(([name, mentionCount]) => ({ name, mentionCount }))
    .sort((a, b) => b.mentionCount - a.mentionCount || a.name.localeCompare(b.name)); // WP-052 T1：并列计数 name 次级键（对照面 candidates :141 同款——P4-1）
  return { candidates, entityMentions };
}

// A5 卫生信号：零提及实体（ indexes.titleLookup 的 key 减去 mentionMap 的 key）
function scanOrphanEntities(indexes, entityMentions) {
  const mentioned = new Set((entityMentions || []).map((m) => m.name));
  const orphans = [];
  for (const [title] of Object.entries((indexes && indexes.titleLookup) || {})) {
    if (!mentioned.has(title)) orphans.push({ name: title });
  }
  return orphans.sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { scanEntityCandidates, scanOrphanEntities, listArticleFiles, DATE_NOTE_RE };
