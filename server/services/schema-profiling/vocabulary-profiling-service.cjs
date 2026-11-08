// Component: Vocabulary-Profiling-Service（ADR-007 波1 引擎内核 · SPEC-006 §3.1）
// @responsible: 全维度词表 data profiling——layer/category/subdomain/module/tag 的使用计数、
//               死词检测、阶段判定（seed/growing/verified）、野生值检测（含 module 维度）。
//               业界对应：MDM Data profiling（值分布/频次/异常）+ Unused reference data cleanup。
// @inputs: vaultPath（只读）、ruleSet?（enums-loader 派生，缺省自读）、verifiedThreshold?（默认 3，参数注入不硬编码）
// @outputs: buildVocabularyProfile({vaultPath, ruleSet?, verifiedThreshold?}) →
//           { dimensions: { layer, category, subdomain, module, tag }, summary }
// @context: 2026-10-08 ADR-007 波1（设计文档 §6.0 波次表）；SPEC-005 entity-growth-scanner 模式推广。
//           R1：纯只读扫描，不直写 Vault 源；R2：画像=可丢弃派生物，现算不落盘不缓存
//           （与 rules-lifecycle「status 不落盘」同哲学——H1 事实源主权）。
//           词表单一事实源：正式词集只从 enums（buildRuleSet 派生）读取，不复制第二份词表（AGENTS 规则 9）。

const fs = require("node:fs");
const path = require("node:path");
const { buildRuleSet } = require("../../shared/enums-loader.cjs");
const { readEnums } = require("../../shared/schema-config.cjs");
const { scanEntities } = require("../entity-compliance/entity-source-scanner.cjs");
const { readLineage, withOrigin } = require("./vocabulary-lineage.cjs");
// WP-116 批1（SPEC-083 §二.1）：文章侧 frontmatter 切分收进文档装载宿主——手写 `^---\n…\n---`
// 切分（readFrontmatterText）退役；维度值经 docField 六态取值后按旧口径成形（见下方两个成形函数）。
const { loadDocument, docField } = require("../../shared/document-load-port.cjs");

// ── 阶段判定（SPEC-006 §3.2 纯函数）──
// 业界对应：Progressive enforcement 前置画像。seed=配置存在零使用；growing=野生活跃；
// verified=N 次以上被引用。阈值经参数注入不硬编码（AGENTS「不写死未验证的东西」）。
// 2026-10-08 22:06 Master 裁决：默认 N=1（真库现状全是测试数据，宽判定先跑起来）；
// 页面配置项可调——波 2 discovery 响应扩展时透传查询参数（本服务参数注入机制已就绪）。
const DEFAULT_VERIFIED_THRESHOLD = 1;

function classifyStage(usageCount, threshold) {
  const n = Number.isFinite(usageCount) ? Math.max(0, Math.floor(usageCount)) : 0;
  const t = Number.isFinite(threshold) && threshold > 0 ? Math.floor(threshold) : DEFAULT_VERIFIED_THRESHOLD;
  if (n === 0) return "seed";
  return n >= t ? "verified" : "growing";
}

// ── frontmatter tags 解析（值级）──
// WP-116 红队修复批（P2-2·ADR-015 死导出退役）：文本级 parseTagsField 已随批 1 扫描面收宿主
// （articleTagValues 承接其值级口径）而无人调用——函数、导出与其空转单测三件同批退役；
// tags 值级行为由扫描面单测（articleTagValues 经 buildVocabularyProfile）继续在册。
function normalizeTagValue(value) {
  return String(value || "").trim().replace(/^['"]|['"]$/g, "");
}

// ── 文章侧扫描面（与 entity-growth-scanner ARTICLE_DIRS + G1' tags 目录一致）──
const ARTICLE_DIRS = ["wiki/articles", "raw"];

function listArticleFiles(vaultPath) {
  const out = [];
  const walk = (dir, rel) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const childRel = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(full, childRel);
      else if (entry.name.endsWith(".md")) out.push({ rel: childRel, full });
    }
  };
  for (const dir of ARTICLE_DIRS) walk(path.join(vaultPath, "知识库", dir), `知识库/${dir}`);
  return out;
}

// 文章 frontmatter 装载（宿主单点切分）：无 frontmatter/空文件/未闭合块/空块/非映射产物 → null
// （与旧 readFrontmatterText 的 null=整文跳过同义——该文件全部维度不计）。
function readArticleFrontmatter(full) {
  const fm = loadDocument(fs.readFileSync(full, "utf8"), full).frontmatter;
  if (!fm || typeof fm !== "object" || Array.isArray(fm) || Object.keys(fm).length === 0) return null;
  return fm;
}

// tags 值成形（旧 parseTagsField 口径的值级承接）：数组（仅原始值项）直收；标量（串/数字/布尔）
// 按文本拆逗号；空值=字段缺省返 null（不计数）。嵌套数组/对象项不收——YAML 把行内 wikilink
// （`[[主模块]]`）解析为嵌套流式序列，旧口径该形态不产生可计数标量（如实差异：块列表内
// wikilink 项旧口径按字面计，宿主下同为嵌套形态不收）。
function articleTagValues(value) {
  if (Array.isArray(value)) {
    if (value.some((item) => Array.isArray(item) || (item && typeof item === "object"))) return null;
    return value;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value).split(",");
  return null;
}

// 非标签维度值成形（旧块列表/标量正则口径）：数组（仅原始值项）收逐项；`[` 起始标量不收
// （旧标量正则排除面——行内 wikilink 形态不计，嵌套流式序列同理不收）；数字/布尔按文本；
// 空值/对象不收。
function articleDimValues(value) {
  if (Array.isArray(value)) {
    if (value.some((item) => Array.isArray(item) || (item && typeof item === "object"))) return [];
    return value;
  }
  if (typeof value === "string") return value.trim().startsWith("[") ? [] : [value.trim()];
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  return [];
}

// ── 维度定义（计数源口径）──
// layer/category/subdomain/module：实体侧为主；module/article_type/category-path 等文章侧字段
// 同样计入对应维度（文章 frontmatter 是事实使用面，不能只看实体）。
// tag：实体 + 文章双侧（与 discovery G1' 扫描面一致）。
const DIMENSIONS = require("./profile-dimensions.cjs"); // SPEC-020 波 2：维度单一定义（锚点对账见 check:fields-registry）

function toList(value, kind) {
  if (kind === "tags") {
    const raw = Array.isArray(value) ? value : (typeof value === "string" ? value.split(",") : []);
    return raw.map(normalizeTagValue).filter(Boolean);
  }
  if (kind === "list") {
    const raw = Array.isArray(value) ? value : (typeof value === "string" && value.trim() ? [value] : []);
    // wikilink 引用剥离（[[主模块]] → 主模块，N1/#829 口径——同 entity-source-scanner normalize）
    return raw.map((v) => String(v || "").trim().replace(/^\[\[|\]\]$/g, "").trim()).filter(Boolean);
  }
  // scalar：只认字符串
  return typeof value === "string" && value.trim() ? [value.trim().replace(/^\[\[|\]\]$/g, "").trim()] : [];
}

// ── 主入口 ──
function buildVocabularyProfile(options = {}) {
  const vaultPath = options.vaultPath;
  if (!vaultPath || typeof vaultPath !== "string") throw new Error("vaultPath is required");
  const threshold = Number.isFinite(options.verifiedThreshold) && options.verifiedThreshold > 0
    ? Math.floor(options.verifiedThreshold)
    : DEFAULT_VERIFIED_THRESHOLD;
  const ruleSet = options.ruleSet || buildRuleSet(readEnums(vaultPath));

  // 正式词集 + 别名映射（单一事实源：enums-loader 派生；disabled_tags 已被 formalTags 排除）
  const vocab = {
    layer: { words: new Set(ruleSet.archLayers || []), aliases: ruleSet.layerAliases || {} },
    category: { words: new Set(ruleSet.archCategories || []), aliases: ruleSet.categoryAliases || {} },
    // ADR-008 D1＋Master 2026-10-17 生长观察面：subdomain 词条 label 随画像输出（缺 label 计数=语义债可视化）
    subdomain: { words: new Set(ruleSet.subdomainIds || []), aliases: ruleSet.subdomainAliases || {}, labels: ruleSet.subdomainLabels || {} },
    module: { words: new Set(ruleSet.moduleNames || []), aliases: {} },
    tag: { words: new Set(ruleSet.formalTags || []), aliases: ruleSet.tagAliases || {} },
  };
  // tag 维度受控集含别名键（G1' 口径：别名也算已知）
  for (const aliasKey of Object.keys(vocab.tag.aliases)) vocab.tag.words.add(aliasKey);

  // 计数器：word -> 次数；野生值：value -> {count, files[]}
  const usage = {};
  const wild = {};
  for (const dim of DIMENSIONS) {
    usage[dim.key] = new Map();
    wild[dim.key] = new Map();
  }

  function recordValue(dimKey, rawValue, sourceFile) {
    const v = String(rawValue || "").trim();
    if (!v) return;
    const conf = vocab[dimKey];
    // PR-052：别名目标是数组形态（enums.schema.json 唯一契约，读侧已把标量 coerce 成数组）。
    // 归一时取首个正式目标；目标数组本身也做受控词判定（与字符串形态等价）。
    const aliasTargets = Array.isArray(conf.aliases[v]) ? conf.aliases[v] : [conf.aliases[v]];
    const aliasTarget = aliasTargets.find((target) => typeof target === "string" && target.trim() && conf.words.has(target.trim()));
    const canonical = aliasTarget ? aliasTarget.trim() : (conf.words.has(v) ? v : null);
    if (canonical) {
      usage[dimKey].set(canonical, (usage[dimKey].get(canonical) || 0) + 1);
    } else {
      const entry = wild[dimKey].get(v) || { value: v, count: 0, files: [] };
      entry.count += 1;
      if (entry.files.length < 10) entry.files.push(sourceFile);
      wild[dimKey].set(v, entry);
    }
  }

  // ① 实体侧扫描（wiki/entities/*.md，scanEntities 已做 frontmatter 归一）
  const entities = scanEntities(vaultPath);
  for (const entity of entities) {
    const fm = entity.frontmatter || {};
    const rel = path.relative(vaultPath, entity.file);
    for (const dim of DIMENSIONS) {
      const value = fm[dim.entityField];
      if (value === undefined || value === null) continue;
      for (const item of toList(value, dim.kind)) recordValue(dim.key, item, rel);
    }
  }

  // ② 文章侧扫描（wiki/articles + raw 全子树，frontmatter 字段使用计入）——WP-116 批1：
  // 切分与取值经宿主（loadDocument＋docField），值形态按旧正则口径承接（articleTagValues/articleDimValues）
  for (const f of listArticleFiles(vaultPath)) {
    let fm;
    try { fm = readArticleFrontmatter(f.full); } catch { continue; }
    if (!fm) continue;
    for (const dim of DIMENSIONS) {
      if (dim.kind === "tags") {
        const tags = articleTagValues(docField(fm, "tags").value);
        if (tags) for (const t of tags) recordValue(dim.key, t, f.rel);
        continue;
      }
      for (const field of dim.articleFields) {
        // 块列表（module:\n- x）与行内/标量都收
        for (const item of articleDimValues(docField(fm, field).value)) recordValue(dim.key, item, f.rel);
      }
    }
  }

  // ③ 汇总（R2：全部现算，响应即弃）
  const dimensions = {};
  const summary = { verifiedThreshold: threshold, totalWords: 0, totalDead: 0, totalGrown: 0, dimensions: {} };
  // ADR-007 波5 方案B：origin 血缘 join——grown=经发现通道晋升，blueprint=蓝图单方声明（缺省）。
  // 账本缺失返全蓝图（零失败）。stage 是「使用事实」，origin 是「来源事实」，两者正交。
  const lineage = readLineage(vaultPath);
  for (const dim of DIMENSIONS) {
    const conf = vocab[dim.key];
    const words = [];
    for (const word of conf.words) {
      const count = usage[dim.key].get(word) || 0;
      const label = conf.labels ? conf.labels[word] : undefined;
      words.push({ word, usageCount: count, stage: classifyStage(count, threshold), ...(label !== undefined ? { label } : {}) });
    }
    words.sort((a, b) => b.usageCount - a.usageCount || a.word.localeCompare(b.word, "zh-Hans-CN"));
    const deadWords = words.filter((w) => w.usageCount === 0).map((w) => w.word);
    const wildValues = [...wild[dim.key].values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "zh-Hans-CN"));
    const wordsWithOrigin = withOrigin(words, lineage[dim.key]);
    dimensions[dim.key] = { words: wordsWithOrigin, deadWords, wildValues };
    summary.dimensions[dim.key] = {
      total: words.length,
      seed: words.filter((w) => w.stage === "seed").length,
      growing: words.filter((w) => w.stage === "growing").length,
      verified: words.filter((w) => w.stage === "verified").length,
      grown: wordsWithOrigin.filter((w) => w.origin === "grown").length,
      dead: deadWords.length,
      wild: wildValues.length,
      // 生长观察面（ADR-008 D1）：缺语义词条计数——仅 subdomain 维度非零（其余维度词条天然是人话/带 label）
      unlabeled: words.filter((w) => w.label === undefined).length,
    };
    summary.totalWords += words.length;
    summary.totalDead += deadWords.length;
    summary.totalGrown += summary.dimensions[dim.key].grown;
  }
  return { dimensions, summary };
}

module.exports = {
  buildVocabularyProfile,
  classifyStage,
  listArticleFiles,
  DEFAULT_VERIFIED_THRESHOLD,
};
