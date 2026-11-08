#!/usr/bin/env node
// check-fields-registry.mjs — 字段引用对账门禁（ADR-008 D2 / SPEC-015 §三.2）
// @responsible: 执法「server/管线消费的 frontmatter 字段名 ⊆ fields.yaml 声明集」——
//               防校验代码读未登记字段（字段漂移的假绿面）。
// @inputs: 知识库/TheSchema/fields.yaml（声明集：name ∪ aliases）；三个固定消费锚点：
//          ① profile-dimensions DIMENSIONS（画像扫描面，SPEC-020 波 2 单一定义随迁）
//          〔② REQUIRED_FIELDS／③ allowedByField 锚点已随平行账退役（SPEC-020 波 2）——
//            消费端字段清单从解析物派生，对账对象消失；防漏面见第四面＋derivation-sync〕
// @outputs: 红面=未登记字段被消费；advisory=声明集内无消费锚点触碰的字段（僵尸候选，人工裁定）。
//           PR-151 续·根治第五面：字典必填↔补齐契约↔选项包三方对账（repo 主源锚定，CI 可跑——
//           fields.yaml 新增文章必填漏登记契约即红，报错给出补齐链路；「检测自动、入口手工」的残类收口）。
// @context: 对账是「防漏」单向红（fail-closed 于消费侧）；声明侧只提示不拦截——title 等由
//           Obsidian/渲染面隐式消费，反向硬拦截必假红。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { resolveTheSchemaDir } from "./shared/theschema-root.mjs";

const require = createRequire(import.meta.url);
const YAML = require("yaml");
import { IDENTITY_EXEMPT } from "./shared/readiness-required.mjs";
const { resolveValueDomains } = require("../../server/shared/value-domain-resolver.cjs");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function resolveVault() {
  const fromEnv = process.env.VAULT_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return null;
  const line = fs.readFileSync(envPath, "utf8").split("\n").find((l) => l.trim().startsWith("VAULT_PATH="));
  if (!line) return null;
  const v = line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
  return v && fs.existsSync(v) ? v : null;
}

const ANCHORS = [
  {
    id: "vocabulary-profiling DIMENSIONS",
    file: "server/services/schema-profiling/profile-dimensions.cjs",
    // DIMENSIONS 单一定义（SPEC-020 波 2 随迁）里的 entityField/articleFields 字符串字面量
    extract: (content) => {
      const out = new Set();
      for (const m of content.matchAll(/entityField:\s*"([a-z_-]+)"/g)) out.add(m[1]);
      for (const m of content.matchAll(/articleFields:\s*\[([^\]]*)\]/g)) {
        for (const f of m[1].matchAll(/"([a-z_-]+)"/g)) out.add(f[1]);
      }
      return out;
    },
    minCount: 5,
  },
  // SPEC-020 波 2：REQUIRED_FIELDS 与 allowedByField 两锚点随平行账退役而退役——
  // 消费端不再硬编码字段清单（Python 从解析物派生必填集；合规经 resolvedValues 按名取值），
  // 「清单 ⊆ 声明集」的对账对象不复存在。防漏面转移：配方引用悬空（本门禁第四面）＋
  // 解析物漂移（derivation-sync）＋等价性测试（value-domain-resolver.test）。
];

// ── PR-151 续·根治：字典必填 ↔ 补齐契约 ↔ 选项包 三方对账（纯函数——测试直引，main 经 repo 主源调用）──
// 三方事实：①fields.yaml（required=是 ∧ scope∋article）②contracts/entity-readiness-rules.json
// article 段（required/fields.control/optionsKey）③contracts/http-api.openapi.json
// ArticleFieldOptions（选项包 required 集＋optionsKey 枚举）。中文名一环由 field-labels-ssot 测试锁。
export function checkCompletionParity({ fieldsDoc, rulesArticle, articleFieldOptions }) {
  const errors = [];
  const dictRequired = new Set(
    (fieldsDoc.fields || [])
      .filter((f) => f && typeof f.name === "string" && f.required === "是" && Array.isArray(f.scope) && f.scope.includes("article"))
      .map((f) => f.name),
  );
  const contractRequired = new Set(rulesArticle.required || []);
  const contractFields = rulesArticle.fields || {};
  const identityExempt = IDENTITY_EXEMPT; // 身份策略键单源（WP-132：与 required 生成器共享——promote 自动生成占位，非字典必填）
  for (const name of dictRequired) {
    const meta = contractFields[name];
    if (!meta) errors.push(`[补齐缺口] 字典必填 '${name}' 未登记契约 article.fields——补齐表单无入口；登记 contracts/entity-readiness-rules.json article 段（control/required/optionsKey）＋shared/field-labels.mjs 文章域字典（键集由 field-labels-ssot 测试锁）＋选项包入 ArticleFieldOptions`);
    else if (!meta.control) errors.push(`[补齐缺口] 字典必填 '${name}' 契约未声明 control——无 Web 补齐控件（无 control 占位仅限 article_id 身份键）`);
    if (!contractRequired.has(name)) errors.push(`[必填漂移] 字典必填 '${name}' 不在契约 article.required——写路径必填执法面漏一字段`);
  }
  for (const name of contractRequired) {
    if (!dictRequired.has(name) && !identityExempt.has(name)) errors.push(`[必填滞留] 契约 article.required 含 '${name}' 但字段字典非必填——平行账回潮，按字典语义修契约`);
  }
  const bagNames = new Set(articleFieldOptions.required || []);
  const optionsKeyEnum = new Set((((articleFieldOptions.properties || {}).articleFields || {}).items || {}).properties?.optionsKey?.enum || []);
  for (const [name, meta] of Object.entries(contractFields)) {
    if (name === "$comment" || !meta || typeof meta !== "object" || !meta.control) continue;
    if (meta.optionsKey && meta.optionsKey !== "versions" && !bagNames.has(meta.optionsKey)) {
      errors.push(`[选项包悬空] article.fields '${name}' optionsKey '${meta.optionsKey}' 无对应选项包（ArticleFieldOptions required）——表单无选项可取；登记包键＋optionsKey 枚举并 npm run gen:api-types`);
    }
  }
  for (const key of optionsKeyEnum) {
    if (key !== "versions" && !bagNames.has(key)) errors.push(`[选项包枚举悬空] optionsKey 枚举 '${key}' 不是选项包键——API 词汇表与包面漂移`);
  }
  return errors;
}

function main() {
  const vault = resolveVault();
  const errors = [];
  const advisories = [];

  // ── 第五面（PR-151 续·根治）：repo 主源锚定的三方对账——先于 vault skip 执行，CI 无 vault 也跑 ──
  {
    const repoFields = path.join(ROOT, "data/theschema/fields.yaml"); // 主源（GIT-CONTEXT §一：SPEC-023 迁入本仓）
    const rulesFile = path.join(ROOT, "contracts/entity-readiness-rules.json");
    const openapiFile = path.join(ROOT, "contracts/http-api.openapi.json");
    if (!fs.existsSync(repoFields)) {
      console.error("check-fields-registry: [主源缺失] data/theschema/fields.yaml 不存在——repo 主源损坏（SPEC-023 迁入本仓后必备件）");
      process.exit(1);
    }
    // WP-053 V-C：词法面抓到的漏网——fields 经装载端口（repoFields 变量名保留：展示/报错面）
    const parityErrors = checkCompletionParity({
      fieldsDoc: require("../../server/shared/vocab-load-port.cjs").readVocabDoc(path.dirname(repoFields), "fields", null) || {},
      rulesArticle: (JSON.parse(fs.readFileSync(rulesFile, "utf8")).article) || {},
      articleFieldOptions: ((((JSON.parse(fs.readFileSync(openapiFile, "utf8")).components || {}).schemas || {}).ArticleFieldOptions) || {}),
    });
    for (const e of parityErrors) errors.push(e);
  }
  if (!vault) {
    // WP-132 fail-open 修复（原缺陷：第五面在 skip 前 runs、errors 却随 return 丢弃——PR-151「CI 可跑」
    //   实为哑炮，红从未到达退出码；实测篡改 required 即哑）。skip 前先裁第五面：有红即 exit 1（fail-closed），
    //   无红才明示 skip（exit 0）。红绿夹具见 __tests__/check-fields-registry.test.mjs。
    if (errors.length > 0) {
      console.error(`check-fields-registry: FAIL violations=${errors.length}（第五面 repo 主源对账——无 vault 环境照常执法）`);
      for (const e of errors) console.error(`  ${e}`);
      process.exit(1);
    }
    // CI gates 步先于 e2e vault 构建执行（schema-writers 同款先例）：vault 未解析时本门禁无事实源可对账——
    // 明示 skip（exit 0），本地/有 vault 环境跑全量。
    console.log("check-fields-registry: (skip VAULT_PATH 未解析——fields.yaml 是 vault 侧事实源，本环境无对账面；第五面已过)");
    return;
  }
  // WP-049 余量批：三件经词表装载端口（raw 同旧裸 parse；缺件语义保持）
  const { loadVocabBundle } = require("../../server/shared/vocab-load-port.cjs");
  const vocab = loadVocabBundle(vault, { files: ["fields", "enums", "versions"] });
  const fieldsFile = vocab.files.fields;
  if (!fieldsFile || fieldsFile.state !== "present") {
    console.error("check-fields-registry: fields.yaml 不存在——字段字典未落档（ADR-008 D2）");
    process.exit(1);
  }
  const declared = new Set();
  const declaredPrimary = new Set();
  for (const field of (fieldsFile.raw || {}).fields || []) {
    declared.add(field.name);
    declaredPrimary.add(field.name);
    for (const alias of field.aliases || []) declared.add(alias);
  }

  let consumedTotal = 0;
  for (const anchor of ANCHORS) {
    const file = path.join(ROOT, anchor.file);
    if (!fs.existsSync(file)) {
      errors.push(`[锚点缺失] ${anchor.file} 不存在——消费锚点清单需与代码同步（漂移即红）`);
      continue;
    }
    const consumed = anchor.extract(fs.readFileSync(file, "utf8"));
    // 红队复核改进项（2026-10-17）：锚点文件存在但内部重构（常量改名等）使正则失配时，
    // 若无下限断言则静默漏检（fail-open）。棘轮式 minCount——提取面缩水即红，扩展时随锚点声明升。
    if (consumed.size < (anchor.minCount || 1)) {
      errors.push(`[锚点失配] ${anchor.id} 提取 ${consumed.size} 个字段 < 基线 ${anchor.minCount}——锚点正则与代码漂移（常量改名/重构），须同步锚点`);
    }
    consumedTotal += consumed.size;
    for (const field of consumed) {
      if (!declared.has(field)) errors.push(`[未登记消费] ${anchor.id} 消费字段 '${field}' 不在 fields.yaml 声明集（name ∪ aliases）`);
    }
  }

  // ── SPEC-020 波 1：值域引用悬空执法（配方数据化的对账面）──
  // resolveValueDomains 是唯一解释器（server/shared/value-domain-resolver.cjs）；
  // 其 errors 即门禁红：引用不存在的段/别名表/未知 op 均拦（fail-closed）。
  // 红队复核批补两面：versions.yaml 存在性（D1——version_registry/product_closure 配方依赖它）；
  // value_domain 非对象（D5——写侧 strict 之外的读侧防线）。
  {
    const enumsFile = vocab.files.enums;
    const versionsFile = vocab.files.versions;
    const enums = enumsFile && enumsFile.state === "present" ? (enumsFile.raw || {}) : {};
    const versions = versionsFile && versionsFile.state === "present" ? (versionsFile.raw || {}) : {};
    const fieldsDoc = fieldsFile.raw || {};
    for (const field of fieldsDoc.fields || []) {
      if (field && field.value_domain !== undefined && !field.value_domain) {
        errors.push(`[值域形态] 字段 '${field.name}' value_domain 非对象（null/标量）——须按契约结构声明`);
      }
    }
    const needsVersions = (fieldsDoc.fields || []).some(
      (f) => f && typeof f.value_domain === "object" && f.value_domain !== null && (f.value_domain.source === "versions" || (f.value_domain.resolve && ["product_closure", "version_registry"].includes(f.value_domain.resolve.op))),
    );
    if (needsVersions && (!versionsFile || versionsFile.state !== "present")) {
      errors.push("[跨文件源缺失] versions.yaml 不存在——version_registry/product_closure 配方失去事实源（fail-closed）");
    }
    const resolution = resolveValueDomains({ fields: fieldsDoc, enums, versions });
    for (const e of resolution.errors) errors.push(e);
  }

  if (errors.length) {
    for (const e of errors) console.error("check-fields-registry: " + e);
    console.error(`check-fields-registry: FAIL（${errors.length} 红；声明 ${declaredPrimary.size} 主字段，消费锚点提取 ${consumedTotal} 字段）`);
    process.exit(1);
  }

  // advisory：声明集内无任何锚点触碰的主字段（僵尸候选——隐式消费合法，人工裁定去留）
  const touched = new Set();
  for (const anchor of ANCHORS) {
    const file = path.join(ROOT, anchor.file);
    if (!fs.existsSync(file)) continue;
    for (const f of anchor.extract(fs.readFileSync(file, "utf8"))) touched.add(f);
  }
  for (const name of declaredPrimary) {
    if (!touched.has(name)) advisories.push(name);
  }
  // ── ADR-009 D2（SPEC-017 #11）：主体注册表↔目录双向对账 ──
  // 正向：mounted/paused 主体目录须存在（悬空红）；反向：subjects/ 下无注册的目录（无主红——防绕注册表私建主体）。
  const subjectsFile = path.join(resolveTheSchemaDir(vault), "subjects.yaml");
  if (fs.existsSync(subjectsFile)) {
    const YAML = require("yaml");
    const subjectsDoc = YAML.parse(fs.readFileSync(subjectsFile, "utf8")) || {};
    const rows = (subjectsDoc.subjects || []).filter(Boolean);
    const registered = new Set(rows.map((s) => String(s.id || "").trim()).filter(Boolean));
    const mounted = new Set(rows.filter((s) => s.status === "mounted").map((s) => String(s.id || "").trim()).filter(Boolean));
    const subjectsDir = path.join(resolveTheSchemaDir(vault), "subjects");
    const onDisk = fs.existsSync(subjectsDir) ? fs.readdirSync(subjectsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];
    const subjectErrors = [];
    // 悬空检查只对 mounted——paused=数据在归档包（TALOS 05-archive 同构），重挂载时目录才落位
    for (const id of mounted) {
      if (!onDisk.includes(id)) subjectErrors.push(`[主体悬空] mounted 主体 '${id}' 但 subjects/ 目录不存在`);
    }
    for (const dir of onDisk) {
      if (!registered.has(dir)) subjectErrors.push(`[主体无主] subjects/${dir} 目录未在 subjects.yaml 注册（绕注册表私建主体即红）`);
    }
    if (subjectErrors.length) {
      for (const e of subjectErrors) console.error("check-fields-registry: " + e);
      console.error(`check-fields-registry: FAIL（主体对账 ${subjectErrors.length} 红）`);
      process.exit(1);
    }
  }

  console.log(`check-fields-registry: ok（声明 ${declaredPrimary.size} 主字段＋${declared.size - declaredPrimary.size} 别名；消费锚点 ${consumedTotal} 字段全部在册）`);
  if (advisories.length) console.log(`check-fields-registry: advisory——无消费锚点触碰的主字段（隐式消费或僵尸候选，人工裁定）：${advisories.join("、")}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
