// Component: Article-Validator-Service
// @responsible: 文章校验语义唯一实现（SPEC-022 波 A）——逐规则镜像 validate-article.py 现行为，
//   唯一分野＝登记的有意变更（仲裁依据＝已签收契约，非 Python 现行为——TALOS Fix Loop）：
//   ①status 规则：Python 硬编码实体侧三值 {有效,已归档,制定中}；契约（fields.yaml）文章侧
//     status 值域＝lifecycle.status（经 resolved-domains 解析物）——按契约实现。
//   Python 侧随波 C 退役；差分对账见 __tests__/validate-article-parity.test.cjs。
// @inputs: vaultPath（KB 根——知识库/ 的父目录）＋目标文章文件
// @outputs: {file, valid, errors, warnings}（消息文本与 Python 逐字对齐，除登记变更）＋五模式
// @context: 数据源与 Python 同源：resolved-domains.json（必填集）＋enums.yaml（经 normalizeEnums
//   咽喉——ADR-008 D1 归一，同 buildRuleSet 路径）。
"use strict";
const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const YAML = require("yaml");
const { normalizeEnums } = require("../../server/shared/enums-loader.cjs");

const VERSION_RE = /^(\d+\.\d+(?:\.\d+(?:\.\d+)?)?)(?:\s*→\s*(\d+\.\d+(?:\.\d+(?:\.\d+)?)?))?$/;
const TITLE_STRIP_RE = /^\d{2}-[^-]+-/;
const PLACEHOLDER_PATTERNS = new Set(["data", "待补充", "需补充", "未知", "unknown", "todo", "tbd", "暂无", "无"]);

/** 致命态：对应 Python 的 stderr＋sys.exit(2)（解析物缺失/损坏）。 */
class ValidatorFatal extends Error {
  constructor(stderr, code = 2) {
    super(stderr);
    this.stderr = stderr;
    this.exitCode = code;
  }
}

/**
 * 有意变更③（红队 M1）：闭合定界符取「行首独立的 ---」——Python split 在值内含 --- 时截断致 6 假错；
 * Node 锚定定界语义更正确，登记分叉不镜像。
 * 有意变更②（红队 H1）：纯数值 version 标量按 JS 数文本判格式（7.0→"7" 无小数点即非法）——
 * 契约 G1+G5 版本 id 恒为 X.Y[.Z[.W]] 字符串，数值形态属畸形输入（Python str(7.0)="7.0" 系浮点字面痕迹）。
 */
function splitFrontmatter(content) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!m) return null;
  return { fmSource: m[1], body: content.slice(m[0].length) };
}

function parseFrontmatter(filepath, content) {
  if (content === undefined) {
    try {
      content = fs.readFileSync(filepath, "utf8");
    } catch {
      return { fm: {}, body: "", readable: false };
    }
  }
  const split = splitFrontmatter(content);
  if (split) {
    let fm = {};
    try {
      fm = YAML.parse(split.fmSource) || {};
    } catch {
      fm = {};
    }
    return { fm, body: split.body, readable: true };
  }
  return { fm: {}, body: content, readable: true };
}

function extractModuleNames(moduleValue) {
  if (moduleValue === null || moduleValue === undefined) return [];
  let list = moduleValue;
  if (typeof list === "string") list = [list];
  if (!Array.isArray(list)) return [];
  const names = [];
  for (const m of list) {
    const s = String(m).trim();
    const match = /^\[\[([^\]]+)\]\]$/.exec(s);
    names.push(match ? match[1] : s);
  }
  return names;
}

function extractWikilinks(body) {
  const results = [];
  for (const m of String(body).matchAll(/\[\[([^\]]+)\]\]/g)) {
    const target = m[1];
    if (!target.startsWith("知识库/") && !target.startsWith("Attachments/")) {
      results.push(target.split("#")[0].split("|")[0]);
    }
  }
  return results;
}

function extractImageRefs(body) {
  const results = [];
  for (const m of String(body).matchAll(/!\[\[([^\]]+)\]\]/g)) results.push(m[1]);
  return results;
}

/** 元组比较（Python (1,2)>(1,2,3) 语义：前缀短者小）。 */
function tupleGreater(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return a.length > b.length;
}

// PR-158 批次一（副本→收据）：规则输入指纹——fields.yaml（必填/值域真身）＋enums.yaml（闭合枚举）
// 字节哈希。resolved-domains.json 是 fields 的投影（冗余，不入哈希）；两真身任一变化，旧收据失配。
// 消费方：applyValidationStamp 落收据键；审批 B3 现场计算时随拒绝详情回显。
function computeRulesHash(vaultPath) {
  // WP-049 余量批：两真身经词表装载端口（text utf8 更新＝字节哈希同值；缺件＝跳过但保留 \0 分隔，语义保持）
  const { loadVocabBundle } = require("../../server/shared/vocab-load-port.cjs");
  const bundle = loadVocabBundle(vaultPath, { files: ["fields", "enums"] });
  const hash = crypto.createHash("sha256");
  for (const name of ["fields", "enums"]) {
    const file = bundle.files[name];
    if (file && file.state === "present") hash.update(file.text, "utf8");
    hash.update("\u0000");
  }
  return `sha256:${hash.digest("hex")}`;
}

function createArticleValidator({ vaultPath, logger } = {}) {
  const log = logger || { warn: () => {}, info: () => {} };
  const kbRoot = path.join(vaultPath, "知识库");
  if (!fs.existsSync(kbRoot)) {
    throw new ValidatorFatal(`KB_VAULT 解析出的知识库目录不存在：${kbRoot}`);
  }
  // SPEC-023 波 2：经唯一解析点（vault 窗口优先＞仓内——切换后自动翻向 data/theschema）
  const { resolveTheSchemaDir } = require("../../server/shared/theschema-root.cjs");
  const schemaDir = resolveTheSchemaDir(vaultPath);
  const resolvedPath = path.join(schemaDir, "resolved-domains.json");
  const enumsPath = path.join(schemaDir, "enums.yaml");

  // ── 必填集装载（Python load_required_fields 同款三态：裸库软化／缺解析物 exit 2／正常派生）──
  let requiredFields = [];
  if (!fs.existsSync(schemaDir) || !fs.existsSync(enumsPath)) {
    log.warn("validate-article: (warn) 裸 vault 无 TheSchema——必填集软化（SPEC-020 波 2）");
  } else if (!fs.existsSync(resolvedPath)) {
    throw new ValidatorFatal("validate-article: resolved-domains.json 不存在——先跑 npm run project:resolved-domains（SPEC-020 波 2）");
  } else {
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
    } catch (exc) {
      throw new ValidatorFatal(`validate-article: resolved-domains.json 损坏/不可读（${exc.message}）——重跑 npm run project:resolved-domains（SPEC-020 波 2）`);
    }
    const rows = doc.byField || [];
    if (!rows.length) log.warn("validate-article: (warn) 解析物 byField 为空——必填检查软化");
    for (const row of rows) {
      if (!row || typeof row !== "object" || !("name" in row)) {
        log.warn(`validate-article: (warn) 解析物行缺 name，已跳过：${JSON.stringify(row)}`);
        continue;
      }
      if (row.required === "是" && (row.scope || []).includes("article")) requiredFields.push(row.name);
    }
  }

  // ── enums 装载（同 Python schema_loader 视图；经 normalizeEnums 咽喉）──
  let enumsData = {};
  let subdomainIdsByDomain = {};
  let articleStatusValues = [];
  // WP-053 V-A：enums 经装载端口（raw＝旧裸 parse 同形；normalizeEnums 收口面保持）
  {
    const raw = require("../../server/shared/vocab-load-port.cjs").readVocabDoc(vaultPath, "enums", null);
    if (raw !== null) {
      const { data } = normalizeEnums(raw);
      enumsData = data;
    for (const [domain, entries] of Object.entries(data.subdomains || {})) {
      const ids = new Set();
      for (const item of entries || []) {
        if (typeof item === "string" && item.trim()) ids.add(item.trim());
        else if (item && typeof item === "object" && typeof item.id === "string" && item.id.trim()) ids.add(item.id.trim());
      }
      subdomainIdsByDomain[domain] = ids;
    }
    // 有意变更①（PR-138 双源收敛）：文章侧 status 值域＝写方面并集——
    // lifecycle.status（autoFill 默认与词表）∪ statusMachine.values（status-event-writer 可写回值，
    // 含"已驳回"）。两单源各守其位（词表/迁移执法表），校验面只认"有写入方的值"，消双源 WARNING 误报。
    if (Array.isArray(data.lifecycle && data.lifecycle.status)) articleStatusValues = data.lifecycle.status.slice();
    try {
      const smValues = require("../../contracts/entity-readiness-rules.json").statusMachine.values || [];
      for (const v of smValues) if (!articleStatusValues.includes(v)) articleStatusValues.push(v);
    } catch (_e) { /* 契约缺失回退 lifecycle 单源 */ }
    }
  }
  const domains = Object.keys(enumsData.domains || {});
  const moduleNames = new Set(Object.keys(enumsData.modules || {}));
  const articleTypes = new Set(enumsData.article_types || []);
  const docTypes = new Set(enumsData.doc_types || []);

  function validate(filepath, rawContent) {
    const errors = [];
    const warnings = [];
    if (rawContent === undefined && !fs.existsSync(filepath)) {
      errors.push(`文件不存在: ${filepath}`);
      return { errors, warnings };
    }
    const { fm, body } = rawContent === undefined ? parseFrontmatter(filepath) : parseFrontmatter(filepath, rawContent);
    const fname = path.basename(filepath);

    // 1. 必填字段
    for (const field of requiredFields) {
      const val = fm[field];
      const missing =
        val === null || val === undefined ||
        ((typeof val === "string" || Array.isArray(val)) && val.length === 0) ||
        (Array.isArray(val) && val.length === 1 && typeof val[0] === "string" && val[0].trim() === "");
      if (missing) errors.push(`frontmatter 缺必填字段: ${field}`);
    }

    // 2. title 与文件名一致性（warn）
    const title = fm.title ?? "";
    if (title) {
      const bare = fname.replace(/\.md$/, "");
      const stripped = bare.replace(TITLE_STRIP_RE, "");
      if (String(title).trim() !== bare && String(title).trim() !== stripped) {
        warnings.push(`title '${title}' 与文件名 '${bare}' 不一致`);
      }
    }

    // 3. module 值域
    const modules = extractModuleNames(fm.module);
    if (modules.length) {
      for (const m of modules) {
        if (!moduleNames.has(m)) errors.push(`module '${m}' 不在 enums.yaml modules 列表中`);
      }
    } else if (!fm.module) {
      warnings.push("module 字段为空");
    }

    // 4. version 格式
    const version = fm.version ?? "";
    if (version && String(version).trim()) {
      const s = String(version).trim();
      const m = VERSION_RE.exec(s);
      if (!m) {
        errors.push(`version '${s}' 格式非法`);
      } else if (m[2]) {
        const v1 = m[1].split(".").map(Number);
        const v2 = m[2].split(".").map(Number);
        if (tupleGreater(v1, v2)) warnings.push(`version 范围起始 > 结束: ${s}`);
      }
    }

    // 5. tags
    const tags = fm.tags;
    if (!tags || (Array.isArray(tags) && tags.length === 0)) warnings.push("tags 字段为空");

    // 6. wikilink 目标存在性（warn）——索引＝kbRoot 下全部 .md 基名
    const wikiIndex = buildWikilinkIndex();
    for (const target of extractWikilinks(body)) {
      if (!target || target.startsWith("#")) continue;
      const clean = target.replace(/ /g, "").replace(/\//g, "");
      const found = wikiIndex.has(target) || wikiIndex.has(clean) || wikiIndex.has(target.replace(/ /g, ""));
      if (!found) warnings.push(`wikilink [[${target}]] 目标文件不存在`);
    }

    // 7. 图片引用路径（warn）
    for (const ref of extractImageRefs(body)) {
      if (!ref.startsWith("知识库/Attachments/")) warnings.push(`图片引用路径不规范: ![[${ref}]]`);
    }

    // 8. status（有意变更①：文章侧＝lifecycle 值域，非实体三值——差分登记项）
    const status = fm.status ?? "";
    if (!status) {
      warnings.push("status 字段为空");
    } else if (articleStatusValues.length && !articleStatusValues.includes(status)) {
      warnings.push(`status 值不标准: '${status}'`);
    }

    // 9/10. doc-type 与 article_type 枚举（warn）
    const docType = fm["doc-type"] ?? "";
    if (docType && docTypes.size && !docTypes.has(docType)) warnings.push(`doc-type '${docType}' 不在标准枚举中`);
    const at = fm.article_type ?? "";
    if (at && articleTypes.size && !articleTypes.has(at)) warnings.push(`article_type '${at}' 不在标准枚举中`);

    // 11. category-path 两段式（WP-040，Master 2026-10-29「2A」——topic 段退役；消息与 enums-loader 逐字对齐）
    const cpRaw = String(fm["category-path"] || "").trim().replace(/^['"]+|['"]+$/g, "");
    if (cpRaw) {
      const parts = cpRaw.split(":");
      if (parts.length !== 2) {
        errors.push(`category-path '${cpRaw}' 格式非法，应为 domain:subdomain`);
      } else {
        const [domain, subdomain] = parts;
        if (domain === "troubleshoot" || subdomain === "troubleshoot") {
          errors.push(`category-path '${cpRaw}' 使用历史排错口径；请改为 ops:<合法subdomain>，如 ops:maintain`);
        }
        if (!domains.includes(domain)) {
          errors.push(`category-path domain '${domain}' 不在 enums.yaml domains 中`);
        } else {
          const valid = subdomainIdsByDomain[domain] || new Set();
          if (!valid.has(subdomain)) {
            errors.push(`category-path subdomain '${subdomain}' 不在 ${domain} 合法子域中；合法值：${[...valid].sort().join(", ")}`);
          }
        }
      }
    }

    return { errors, warnings };
  }

  function buildWikilinkIndex() {
    const index = new Set();
    const walk = (dir) => {
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith(".md")) index.add(e.name.replace(/\.md$/, ""));
      }
    };
    walk(kbRoot);
    return index;
  }

  function buildWikilinkPathIndex() {
    const index = {};
    const walk = (dir) => {
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith(".md")) {
          const rel = path.relative(kbRoot, full);
          const name = e.name.replace(/\.md$/, "");
          const clean = name.replace(/ /g, "").replace(/\//g, "");
          for (const key of [name, clean]) {
            const arr = (index[key] = index[key] || []);
            if (!arr.includes(rel)) arr.push(rel);
          }
        }
      }
    };
    walk(kbRoot);
    return index;
  }

  function isGitTracked(relpath) {
    try {
      execFileSync("git", ["ls-files", "--error-unmatch", relpath], { cwd: kbRoot, stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  function ledger(action, relPaths) {
    if (process.env.VAULT_GIT_LEDGER_DISABLE === "1") return;
    try {
      execFileSync("git", ["add", ...relPaths], { cwd: kbRoot, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", `cli: ${action}`], { cwd: kbRoot, stdio: "ignore" });
    } catch {
      /* 验真无变更跳过；失败仅告警不抛（与 Python ledger 同款 best-effort） */
    }
  }

  // 校验章纯函数（PR-151 修复③）：删除既有 validation_* 键后按校验结果落 5 键——CLI stampFrontmatter
  // 与服务端 Web 写路径（validation-stamp-service）共用同一实现，章语义不建第二份。
  // 返回 null＝frontmatter 不可安全序列化（调用方各自 fail-closed）。
  function applyValidationStamp(rawContent, result) {
    const split = splitFrontmatter(rawContent);
    if (!split) return null;
    // H1 修复（红队）：经 parseDocument 序列化——原始 scalar 保形（version: 7.0 不被数值化改写为 7；
    // 引号风格/列表缩进维持作者原貌），仅增删 validation_* 键。
    const doc = YAML.parseDocument(split.fmSource);
    if (doc.errors && doc.errors.length) return null;
    const fm = doc.toJS() || {};
    for (const key of Object.keys(fm)) {
      if (key.startsWith("validation_")) doc.delete(key);
    }
    // 收据身份（PR-158 批次一）：对「剥除 validation_* 后的完整文档」取哈希——重章不改哈希，
    // 内容改哈希必变。章自此只是审计收据（status=最近一次结论，仅展示），不参与任何裁决。
    const unstamped = `---\n${doc.toString()}---${split.body}`;
    doc.set("validation_content_hash", `sha256:${crypto.createHash("sha256").update(unstamped).digest("hex")}`);
    doc.set("validation_rules_hash", computeRulesHash(vaultPath));
    const valid = result.errors.length === 0;
    doc.set("validation_status", valid && result.warnings.length === 0 ? "passed" : valid ? "warnings" : "failed");
    doc.set("validation_errors", result.errors.length);
    doc.set("validation_warnings", result.warnings.length);
    doc.set("validation_timestamp", new Date().toISOString().replace(/\.\d{3}Z$/, "Z"));
    const summaryParts = [];
    if (result.errors.length) summaryParts.push(`ERROR(${result.errors.length}): ${result.errors.slice(0, 3).join("; ")}`);
    if (result.warnings.length) summaryParts.push(`WARN(${result.warnings.length}): ${result.warnings.slice(0, 3).join("; ")}`);
    doc.set("validation_summary", summaryParts.join(" | "));
    // doc.toString() 尾自带换行——直接拼 split.body 保持正文区逐字节（多拼一个 \n 会让重章漂移正文首行空行）
    return `---\n${doc.toString()}---${split.body}`;
  }

  function stampFrontmatter(filepath, result) {
    let content = "";
    try {
      content = fs.readFileSync(filepath, "utf8");
    } catch {
      return false;
    }
    const newContent = applyValidationStamp(content, result);
    if (newContent === null) return false;
    fs.writeFileSync(filepath, newContent, "utf8");
    return true;
  }

  function listArticles(dirpath) {
    return fs.readdirSync(dirpath).filter((f) => f.endsWith(".md")).sort();
  }

  function classifyAuthor(fm) {
    const author = fm.author;
    if (author === null || author === undefined) return ["MISSING", null];
    const val = String(author).trim();
    if (!val) return ["MISSING", null];
    if (PLACEHOLDER_PATTERNS.has(val.toLowerCase())) return ["PLACEHOLDER", val];
    return ["REAL", val];
  }

  function detectStale(dirpath) {
    const files = listArticles(dirpath);
    const results = [];
    let stale = 0;
    let fresh = 0;
    let never = 0;
    for (const fname of files) {
      const { fm } = parseFrontmatter(path.join(dirpath, fname));
      const storedErrors = fm.validation_errors ?? null;
      const storedWarnings = fm.validation_warnings ?? null;
      const current = validate(path.join(dirpath, fname));
      const entry = {
        file: fname,
        stored_errors: storedErrors,
        stored_warnings: storedWarnings,
        current_errors: current.errors.length,
        current_warnings: current.warnings.length,
      };
      if (storedErrors === null && storedWarnings === null) {
        entry.stale = false;
        entry.reason = "never_stamped";
        never += 1;
      } else if (storedErrors === current.errors.length && storedWarnings === current.warnings.length) {
        entry.stale = false;
        entry.reason = "current";
        fresh += 1;
      } else {
        entry.stale = true;
        const parts = [];
        if (storedErrors !== current.errors.length) parts.push(`errors: stored=${storedErrors} current=${current.errors.length}`);
        if (storedWarnings !== current.warnings.length) parts.push(`warnings: stored=${storedWarnings} current=${current.warnings.length}`);
        entry.reason = parts.join("; ");
        stale += 1;
      }
      results.push(entry);
    }
    return {
      exitCode: stale === 0 ? 0 : 1,
      summary: { mode: "detect_stale", directory: dirpath, total: results.length, stale, fresh, never_stamped: never, results },
    };
  }

  function detectUntrackedWikilinks(dirpath) {
    const pathIndex = buildWikilinkPathIndex();
    const files = listArticles(dirpath);
    const results = [];
    for (const fname of files) {
      const { body } = parseFrontmatter(path.join(dirpath, fname));
      for (const target of extractWikilinks(body)) {
        if (!target || target.startsWith("#")) continue;
        const clean = target.replace(/ /g, "").replace(/\//g, "");
        const matched = pathIndex[target] || pathIndex[clean] || [];
        for (const relpath of matched) {
          if (!isGitTracked(relpath)) {
            results.push({
              file: fname,
              wikilink: target,
              target_path: relpath,
              exists_on_disk: true,
              git_tracked: false,
              risk: "untracked_target",
              message: `[[${target}]] → ${relpath} 存在但未被 git 跟踪，checkout 环境会断链`,
            });
          }
        }
      }
    }
    return {
      exitCode: results.length === 0 ? 0 : 1,
      summary: { mode: "detect_untracked_wikilinks", directory: dirpath, total_articles_scanned: files.length, untracked_targets: results.length, results },
    };
  }

  function detectAuthorPlaceholders(dirpath) {
    const files = listArticles(dirpath);
    const results = [];
    const counts = { REAL: 0, PLACEHOLDER: 0, MISSING: 0 };
    for (const fname of files) {
      const { fm } = parseFrontmatter(path.join(dirpath, fname));
      const [quality, value] = classifyAuthor(fm);
      counts[quality] += 1;
      results.push({ file: fname, author_quality: quality, author_value: value });
    }
    return {
      exitCode: counts.PLACEHOLDER === 0 && counts.MISSING === 0 ? 0 : 1,
      summary: { mode: "detect_author_placeholders", directory: dirpath, total: results.length, counts, results },
    };
  }

  function qualitySummary(dirpath) {
    const files = listArticles(dirpath);
    const pathIndex = buildWikilinkPathIndex();
    const staleFiles = [];
    for (const fname of files) {
      const { fm } = parseFrontmatter(path.join(dirpath, fname));
      const storedE = fm.validation_errors ?? null;
      const storedW = fm.validation_warnings ?? null;
      if (storedE === null && storedW === null) continue;
      const current = validate(path.join(dirpath, fname));
      if (storedE !== current.errors.length || storedW !== current.warnings.length) {
        staleFiles.push({ file: fname, stored_errors: storedE, stored_warnings: storedW, current_errors: current.errors.length, current_warnings: current.warnings.length });
      }
    }
    const untracked = [];
    for (const fname of files) {
      const { body } = parseFrontmatter(path.join(dirpath, fname));
      for (const target of extractWikilinks(body)) {
        if (!target || target.startsWith("#")) continue;
        const clean = target.replace(/ /g, "").replace(/\//g, "");
        for (const relpath of pathIndex[target] || pathIndex[clean] || []) {
          if (!isGitTracked(relpath)) untracked.push({ file: fname, wikilink: target, target_path: relpath });
        }
      }
    }
    const authorCounts = { REAL: 0, PLACEHOLDER: 0, MISSING: 0 };
    const authorIssues = [];
    for (const fname of files) {
      const { fm } = parseFrontmatter(path.join(dirpath, fname));
      const [q, v] = classifyAuthor(fm);
      authorCounts[q] += 1;
      if (q !== "REAL") authorIssues.push({ file: fname, author_quality: q, author_value: v });
    }
    const hasIssues = staleFiles.length > 0 || untracked.length > 0 || authorCounts.PLACEHOLDER > 0 || authorCounts.MISSING > 0;
    return {
      exitCode: hasIssues ? 1 : 0,
      summary: {
        mode: "quality_summary",
        directory: dirpath,
        total_articles: files.length,
        stale_stamps: staleFiles.length,
        stale_details: staleFiles,
        untracked_wikilink_targets: untracked.length,
        untracked_details: untracked,
        author_quality: { REAL: authorCounts.REAL, PLACEHOLDER: authorCounts.PLACEHOLDER, MISSING: authorCounts.MISSING },
        author_issues: authorIssues,
        overall_status: hasIssues ? "needs_attention" : "clean",
      },
    };
  }

  return {
    kbRoot,
    validateFile(filepath) {
      const { errors, warnings } = validate(filepath);
      return { file: path.basename(filepath), valid: errors.length === 0, errors, warnings };
    },
    // PR-151 修复③：内存内容校验入口——Web 写路径（补字段/标准化/修复）写前对 patched 内容现算结论，
    // 不落盘即可得「当前值的校验结果」，与 validateFile 同一 validate 单源。
    validateContent(filepath, rawContent) {
      const { errors, warnings } = validate(filepath, rawContent);
      return { file: path.basename(filepath), valid: errors.length === 0, errors, warnings };
    },
    applyValidationStamp,
    validateAndStamp(filepath) {
      const result = this.validateFile(filepath);
      const stamped = stampFrontmatter(filepath, result);
      if (stamped) ledger(`validate-article --stamp ${result.file}`, [path.relative(kbRoot, filepath)]);
      result.stamped = stamped;
      return result;
    },
    detectStale,
    detectUntrackedWikilinks,
    detectAuthorPlaceholders,
    qualitySummary,
  };
}

module.exports = { createArticleValidator, ValidatorFatal, computeRulesHash };
