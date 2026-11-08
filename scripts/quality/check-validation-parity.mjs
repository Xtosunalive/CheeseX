#!/usr/bin/env node
// Component: Validation-Parity-Guard（校验规则一致性对账门禁）
// @responsible: SPEC-011 WP6 建立；SPEC-022 波 C 收缩——Python 校验器退役后双侧对账面（③④⑤py 半）退役，
//   门禁职责＝contracts/validation-rules.json 单源规则表 ↔ Node 唯一实现的指纹一致（改一漏一即红，PR-046 防复发）。
//
// 检查面（P0 构造协议七步对齐）：
//   ① 规则表完整性：contracts/validation-rules.json 存在且可解析，每条规则含必需字段
//   ② Node 实现指纹：enums-loader.cjs validateCategoryPath 的关键行为特征提取 + 比对
//   〔③④双侧指纹面随 SPEC-022 波 C 退役——Python 单实现化；面⑦改反信号探针防第三套读法复活〕
//
// 指纹计算方法（见规则表 fingerprint 字段）：
//   - structured-two-part:category-path：提取两段拆分逻辑、domain/subdomain 枚举引用来源、
//     troubleshoot 禁令——三个特征全部匹配才算一致（WP-040 定 A 两段式，topic 段退役——
//     PR-155 批清理三段式残迹：规则表/指纹特征/消费方与实现同步归位）
//
// @inputs: contracts/validation-rules.json；server/shared/enums-loader.cjs；
//          scripts/vault-runtime/validate-article.py；contracts/enums.schema.json
// @outputs: stdout validation_parity=ok|FAIL；非零退出 = 违规
// @context: Sync（CI 可跑）
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const RULES_PATH = path.join(ROOT, "contracts", "validation-rules.json");
const NODE_ENUMS_LOADER = path.join(ROOT, "server", "shared", "enums-loader.cjs");
// PR-052：enums.yaml 形态单一事实源——schema 文件与两侧消费点的指纹一并对账。
// 改 schema 但两侧实现未跟上（或反之只改实现不碰 schema）即红——形态漂移的结构性门禁。
const ENUMS_SCHEMA = path.join(ROOT, "contracts", "enums.schema.json");

const violations = [];

function fail(vs) {
  console.log(`validation_parity=FAIL violations=${vs.length}`);
  for (const v of vs.slice(0, 30)) console.log(`  ${v}`);
  process.exit(1);
}

// ── 检查面①：规则表完整性 ──
if (!fs.existsSync(RULES_PATH)) {
  fail(["[结构] contracts/validation-rules.json 不存在——WP6 交付物缺失"]);
}

let rulesDoc;
try {
  rulesDoc = JSON.parse(fs.readFileSync(RULES_PATH, "utf-8"));
} catch (e) {
  fail([`[结构] contracts/validation-rules.json JSON 解析失败: ${e.message}`]);
}

const rules = rulesDoc.rules;
if (!Array.isArray(rules) || rules.length === 0) {
  fail(["[结构] contracts/validation-rules.json rules 数组为空"]);
}

const REQUIRED_RULE_FIELDS = ["id", "field", "type", "nodeImpl", "fingerprint"]; // pythonImpl 列随 SPEC-022 波 C 退役
for (const rule of rules) {
  for (const f of REQUIRED_RULE_FIELDS) {
    if (!rule[f]) violations.push(`[规则不完整] 规则 ${rule.id || "?"} 缺少字段 ${f}`);
  }
}

// ── 检查面②：Node 实现特征提取（enums-loader.cjs validateCategoryPath）──
if (!fs.existsSync(NODE_ENUMS_LOADER)) {
  violations.push(`[Node实现] ${NODE_ENUMS_LOADER} 不存在——enums-loader 缺失`);
} else {
  const nodeSource = fs.readFileSync(NODE_ENUMS_LOADER, "utf-8");

  // 特征提取：三个关键行为（两段式拆分＋双枚举闭合＋troubleshoot 禁令）
  const nodeFeatures = {
    twoPartSplit: /parts\.length\s*!==\s*2/.test(nodeSource),
    domainEnumCheck: /Object\.prototype\.hasOwnProperty\.call\(.*domain[s)]/s.test(nodeSource) || /hasOwnProperty.*domain/.test(nodeSource),
    subdomainEnumCheck: /knownIds\.includes\(subdomain\)/.test(nodeSource) || /domainSubdomains\.includes\(subdomain\)/.test(nodeSource) || /subdomains.*includes.*subdomain/s.test(nodeSource),
    // troubleshoot 禁令：检测条件判断逻辑（=== "troubleshoot"），不只是字面量出现
    troubleshootBan: /===\s*["']troubleshoot["']/.test(nodeSource),
  };

  const nodeMissing = Object.entries(nodeFeatures)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (nodeMissing.length > 0) {
    violations.push(
      `[Node实现] validateCategoryPath 缺少特征: ${nodeMissing.join(", ")}` +
      "——Node 侧校验与规则表期望不符（fingerprint: structured-two-part）",
    );
  }
}

// 〔SPEC-022 波 C 退役〕检查面③（Python 实现指纹）——validate-article.py 已退役，行为基线移交金标回归夹具。

// 〔SPEC-022 波 C 退役〕检查面④（双侧对比）——单实现后无双侧可对比。

// ── 检查面⑤：fingerprint 篡改检测——规则表中每条规则的 fingerprint 与实际源码提取特征比对 ──
// 防止有人改了 fingerprint 字段伪造"对账通过"而不改实现（改 fingerprint ≠ 改实现）。
// 每条规则：解析其 fingerprint，提取应有特征集，再与当前源码实际特征集比对——不一致即红。
const KNOWN_FINGERPRINT_FEATURES = {
  // fingerprint 前缀 → 期望从源码中提取到的特征描述
  "structured-two-part": {
    node: {
      twoPartSplit: /parts\.length\s*!==\s*2/.test(
        fs.existsSync(NODE_ENUMS_LOADER) ? fs.readFileSync(NODE_ENUMS_LOADER, "utf-8") : ""),
      domainEnumCheck: /Object\.prototype\.hasOwnProperty\.call\(.*domain[s)]/s.test(
        fs.existsSync(NODE_ENUMS_LOADER) ? fs.readFileSync(NODE_ENUMS_LOADER, "utf-8") : ""),
      subdomainEnumCheck: /knownIds\.includes\(subdomain\)/.test(
        fs.existsSync(NODE_ENUMS_LOADER) ? fs.readFileSync(NODE_ENUMS_LOADER, "utf-8") : "") || /domainSubdomains\.includes\(subdomain\)/.test(
        fs.existsSync(NODE_ENUMS_LOADER) ? fs.readFileSync(NODE_ENUMS_LOADER, "utf-8") : ""),
      troubleshootBan: /===\s*["']troubleshoot["']/.test(
        fs.existsSync(NODE_ENUMS_LOADER) ? fs.readFileSync(NODE_ENUMS_LOADER, "utf-8") : ""),
    },
  },
};

// 读取当前源码并缓存（避免重复读）
const nodeSource = fs.existsSync(NODE_ENUMS_LOADER) ? fs.readFileSync(NODE_ENUMS_LOADER, "utf-8") : "";

for (const rule of rules) {
  const fp = rule.fingerprint || "";
  // 只验证 structured-two-part 类型（目前唯一有源码级特征的类型）
  if (!fp.startsWith("structured-two-part")) continue;

  // fingerprint 必须包含 "no-troubleshoot" 标记（因为实现中有 troubleshoot 禁令）
  if (!fp.includes("no-troubleshoot")) {
    violations.push(
      `[fingerprint篡改⑤] 规则 ${rule.id} fingerprint 缺少 'no-troubleshoot' 标记` +
      `——fingerprint='${fp}' 与实现不符（Node 实现有 troubleshoot 禁令，fingerprint 必须声明）`,
    );
  }

  // fingerprint 必须包含 "domain:subdomain" 两段格式声明（WP-040 两段式，topic 段退役）
  if (!fp.includes("domain") || !fp.includes("subdomain") || fp.includes("topic")) {
    violations.push(
      `[fingerprint篡改⑤] 规则 ${rule.id} fingerprint 格式声明须为两段 domain/subdomain 且不得再含 topic` +
      `——fingerprint='${fp}'`,
    );
  }

  // fingerprint 声明了 "no-troubleshoot" → 实现中必须存在 troubleshoot 检查
  if (fp.includes("no-troubleshoot")) {
    const nodeHasTroubleshoot = /===\s*["']troubleshoot["']/.test(nodeSource);
    if (!nodeHasTroubleshoot) {
      violations.push(
        `[fingerprint篡改⑤] 规则 ${rule.id}: fingerprint 声明 no-troubleshoot 但 Node 实现中无 troubleshoot 检查` +
        `——实现与 fingerprint 声明脱节（只改了 fingerprint 而不改实现，或实现被删除）`,
      );
    }
  }
}

// PR-052 宽容路径行为探针：schema 每个 x-lenientPaths 声明的顶层键，
// 喂一个「对象内含标量字符串」的样本，断言读侧确实把它无损转成数组并留痕。
// 探针为真行为验证——不依赖源码正则，故「关掉 coerce / 改硬编码路径」必红。
function probeLenientCoercion(schemaDoc) {
  const paths = (schemaDoc && schemaDoc["x-lenientPaths"]) || [];
  if (!paths.length) return false;
  try {
    const { normalizeEnums } = require(NODE_ENUMS_LOADER);
    for (const pathExpr of paths) {
      const match = /^\/([^/]+)$/.exec(pathExpr);
      if (!match) return false;
      const key = match[1];
      const probe = { [key]: { __probe__: "标量样本" } };
      const result = normalizeEnums(probe);
      const coerced = result.data && result.data[key] && result.data[key].__probe__;
      if (!Array.isArray(coerced) || coerced[0] !== "标量样本") return false;
      if (!result.normalizationTrail.some((t) => t.path === `${key}.__probe__`)) return false;
    }
    return true;
  } catch (_e) {
    return false;
  }
}

// ── 检查面⑥（PR-052，PR-053 泛化后口径）：enums 形态单源指纹对账 ──
// PR-053 起三步管线泛化为全 TheSchema 共用引擎（server/shared/theschema-loader.cjs），
// enums-loader 委托引擎并保留 enums 专属缺省补齐与纯派生——本面对账「委托关系」而非「引擎本体」。
const ENUMS_WRITE_SERVICE = path.join(ROOT, "server", "services", "schema-manager", "enums-write-service.cjs");
const ENUMS_ROUTES = path.join(ROOT, "server", "routes", "enums-routes.cjs");
const THESCHEMA_LOADER = path.join(ROOT, "server", "shared", "theschema-loader.cjs");
const THESCHEMA_REGISTRY = path.join(ROOT, "contracts", "theschema.registry.json");

if (!fs.existsSync(ENUMS_SCHEMA)) {
  violations.push("[形态单源] contracts/enums.schema.json 不存在——enums.yaml 唯一形态源缺失");
} else {
  let schemaDoc;
  try {
    schemaDoc = JSON.parse(fs.readFileSync(ENUMS_SCHEMA, "utf-8"));
  } catch (e) {
    violations.push(`[形态单源] contracts/enums.schema.json 解析失败: ${e.message}`);
  }
  if (schemaDoc) {
    if (schemaDoc.$schema !== "http://json-schema.org/draft-07/schema#") {
      violations.push(`[形态单源] enums.schema.json $schema 必须是 draft-07（实为 ${schemaDoc.$schema}）——Ajv 实例按 draft-07 编译`);
    }
    if (!Array.isArray(schemaDoc["x-lenientPaths"]) || schemaDoc["x-lenientPaths"].length === 0) {
      violations.push("[形态单源] enums.schema.json 缺 x-lenientPaths 声明——宽容口径必须写在 schema 里，不得散落到代码（PR-052 A 口径）");
    }
    // 宽容路径只允许指向顶层已定义属性（防 schema 里写了指向不存在属性的宽容声明而两侧无从消费）
    for (const pathExpr of schemaDoc["x-lenientPaths"] || []) {
      const m = /^\/([^/]+)$/.exec(pathExpr);
      if (!m || !(schemaDoc.properties && schemaDoc.properties[m[1]])) {
        violations.push(`[形态单源] x-lenientPaths 声明 '${pathExpr}' 未匹配 schema.properties 中的顶层键`);
      }
    }
  }

  const loaderSource = fs.existsSync(NODE_ENUMS_LOADER) ? fs.readFileSync(NODE_ENUMS_LOADER, "utf-8") : "";
  const engineSource = fs.existsSync(THESCHEMA_LOADER) ? fs.readFileSync(THESCHEMA_LOADER, "utf-8") : "";
  // 手写形态三元式退役检查的范围：normalizeEnums（收口）到 emptyRuleSet（派生结尾）。
  const readPathStart = loaderSource.search(/function\s+normalizeEnums\b/);
  const readPathEnd = loaderSource.search(/function\s+emptyRuleSet\b/);
  const loaderReadPath = readPathStart >= 0 && readPathEnd > readPathStart ? loaderSource.slice(readPathStart, readPathEnd) : "";
  const enumsFeatures = {
    // 读侧：必须委托 TheSchema 通用引擎（不得自建第二套 Ajv/形态判定）
    delegatesToEngine: /theschema-loader\.cjs/.test(loaderSource) && /normalizeDocument\("enums"/.test(loaderSource),
    // 引擎本体：编译 Ajv 实例（严格 + 宽容同源 schema）
    compilesAjv: /new Ajv\(/.test(engineSource) && /\.compile\(/.test(engineSource),
    // 宽容路径必须真的生效——行为探针（不靠正则猜）：直接调用读侧 normalizeEnums，
    // 注入 schema 声明的每个 lenient 路径的标量样本，断言 trail 非空且已转成数组。
    // 写成空数组 / 硬编码路径 / 关掉 coerce → 探针红（正则版对此方向是假绿）。
    coerceLenientPaths: probeLenientCoercion(schemaDoc),
    // 局部降级而非抛错（PR-049 防线：真类型错误不升级 500）——引擎持有降级机制
    localDegradation: /degradedNodePaths/.test(engineSource) && /dropNode/.test(engineSource),
    // 手写形态三元式已退役——形态收口与派生路径不得再出现「typeof …object… ? … : {} / []」的空值兜底判定。
    // 锚点：三元式分支为空对象/空数组字面量（形态兜底的唯一可观察特征）。
    handwrittenTernaryRetired: !/typeof\s+[\w.[\]"']+\s*===\s*["']object["']\s*\?[\s\S]{0,120}?:\s*(\{\}|\[\])/.test(loaderReadPath),
  };
  const enumsMissing = Object.entries(enumsFeatures).filter(([, v]) => !v).map(([k]) => k);
  if (enumsMissing.length) {
    violations.push(
      `[形态单源] 读侧 enums-loader.cjs 缺少特征: ${enumsMissing.join(", ")}` +
      "——读侧未消费 contracts/enums.schema.json 唯一形态源（PR-052/PR-053）",
    );
  }

  const writeSource = fs.existsSync(ENUMS_WRITE_SERVICE) ? fs.readFileSync(ENUMS_WRITE_SERVICE, "utf-8") : "";
  const writeFeatures = {
    strictBeforeWrite: /validateEnumsStrict/.test(writeSource),
    postWriteSelfCheck: /assertCanonicalWrite/.test(writeSource) && /enums-write-noncanonical/.test(writeSource),
    loadsSchemaFile: /enums-loader\.cjs/.test(writeSource),
  };
  const writeMissing = Object.entries(writeFeatures).filter(([, v]) => !v).map(([k]) => k);
  if (writeMissing.length) {
    violations.push(
      `[形态单源] 写侧 enums-write-service.cjs 缺少特征: ${writeMissing.join(", ")}` +
      "——写侧缺落盘前严格校验或落盘后自校验（PR-052 验收③）",
    );
  }

  const routesSource = fs.existsSync(ENUMS_ROUTES) ? fs.readFileSync(ENUMS_ROUTES, "utf-8") : "";
  if (!/normalizeEnums/.test(routesSource)) {
    violations.push(
      "[形态单源] enums-routes.cjs 未消费 normalizeEnums——API 响应与读侧不同源（PR-052 验收⑤）",
    );
  }
}

// ── 检查面⑦（PR-053）：TheSchema 全量形态单源对账 ──
// 注册表登记的每份 yaml：schema 存在且 draft-07、宽容声明合法；每份文档过行为探针——
// 脏形态被局部降级且严格校验能报错（Node 咽喉真消费注册表）；Python 咽喉（schema_loader.py）
// 消费同一份注册表，validate-article 第三套读法退役（委托 schema_loader）。
const PYTHON_SCHEMA_LOADER = path.join(ROOT, "scripts", "vault-runtime", "schema_loader.py");

const EXPECTED_THESCHEMA_DOCS = ["enums", "article_associations", "dependencies", "ontology", "versions"];

if (!fs.existsSync(THESCHEMA_REGISTRY)) {
  violations.push("[TheSchema单源] contracts/theschema.registry.json 不存在——PR-053 注册表缺失");
} else {
  let registryDoc;
  try {
    registryDoc = JSON.parse(fs.readFileSync(THESCHEMA_REGISTRY, "utf-8"));
  } catch (e) {
    violations.push(`[TheSchema单源] theschema.registry.json 解析失败: ${e.message}`);
  }
  const documents = (registryDoc && registryDoc.documents) || {};
  for (const name of EXPECTED_THESCHEMA_DOCS) {
    if (!documents[name]) {
      violations.push(`[TheSchema单源] 注册表缺 '${name}' 登记——5 份 yaml 必须全部经唯一形态源`);
    }
  }

  let engine = null;
  try {
    engine = require(THESCHEMA_LOADER);
  } catch (e) {
    violations.push(`[TheSchema单源] theschema-loader.cjs 加载失败: ${e.message}`);
  }

  for (const name of Object.keys(documents)) {
    const schemaPath = path.join(ROOT, "contracts", documents[name].schema);
    if (!fs.existsSync(schemaPath)) {
      violations.push(`[TheSchema单源] ${documents[name].schema} 不存在——'${name}' 形态源缺失`);
      continue;
    }
    let schemaDoc;
    try {
      schemaDoc = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
    } catch (e) {
      violations.push(`[TheSchema单源] ${documents[name].schema} 解析失败: ${e.message}`);
      continue;
    }
    if (schemaDoc.$schema !== "http://json-schema.org/draft-07/schema#") {
      violations.push(`[TheSchema单源] ${documents[name].schema} $schema 必须是 draft-07（实为 ${schemaDoc.$schema}）`);
    }
    const lenientPaths = schemaDoc["x-lenientPaths"];
    if (!Array.isArray(lenientPaths)) {
      violations.push(`[TheSchema单源] ${documents[name].schema} 缺 x-lenientPaths 声明——宽容口径必须显式声明（空数组=全严格）`);
    } else {
      for (const pathExpr of lenientPaths) {
        const m = /^\/([^/]+)$/.exec(pathExpr);
        if (!m || !(schemaDoc.properties && schemaDoc.properties[m[1]])) {
          violations.push(`[TheSchema单源] ${documents[name].schema} x-lenientPaths 声明 '${pathExpr}' 未匹配 schema.properties 顶层键`);
        }
      }
    }
    // 行为探针：脏形态真降级 + 严格校验真报错（不靠正则猜，改引擎行为必红）
    if (engine) {
      try {
        const firstProp = Object.keys(schemaDoc.properties || {})[0];
        if (firstProp) {
          const declared = JSON.stringify(schemaDoc.properties[firstProp].type || "");
          // 按声明类型构造「必然非法」的脏值：object 位喂数字、number 位喂对象、array 位喂标量、string 位喂嵌套对象
          const dirtyValue = declared.includes("object")
            ? 42
            : declared.includes("array")
              ? "标量样本"
              : declared.includes("number")
                ? { 非法: "对象不为数值" }
                : declared.includes("string")
                  ? { 非法: "对象不为字符串" }
                  : 42;
          const dirty = { [firstProp]: dirtyValue };
          const strictErrors = engine.validateDocumentStrict(name, dirty);
          if (!strictErrors.length) {
            violations.push(`[TheSchema单源] '${name}' 严格校验探针失效——脏形态未报错（写侧闸门同源失守）`);
          }
          const normalized = engine.normalizeDocument(name, dirty);
          if (!normalized.degradedNodes.length) {
            violations.push(`[TheSchema单源] '${name}' 局部降级探针失效——脏形态未被降级（读侧咽喉未消费 schema）`);
          }
          const clean = engine.normalizeDocument(name, {});
          if (clean.degradedNodes.length || clean.normalizationTrail.length) {
            violations.push(`[TheSchema单源] '${name}' 空对象探针异常——合法空文档不应降级`);
          }
        }
      } catch (e) {
        violations.push(`[TheSchema单源] '${name}' 行为探针抛错: ${e.message}`);
      }
    }
  }

  // Python 咽喉同源对账：schema_loader.py 消费同一份注册表 + jsonschema 成熟库；
  // validate-article.py 第三套读法退役（load_enums_* 委托 schema_loader）。
  const pyLoaderSource = fs.existsSync(PYTHON_SCHEMA_LOADER) ? fs.readFileSync(PYTHON_SCHEMA_LOADER, "utf-8") : "";
  const pyLoaderFeatures = {
    loadsRegistry: /theschema\.registry\.json/.test(pyLoaderSource),
    usesJsonschemaLib: /^import\s+jsonschema/m.test(pyLoaderSource),
    exposesThroat: /def\s+normalize_the_schema\(/.test(pyLoaderSource),
    localDegradation: /_drop_at/.test(pyLoaderSource),
  };
  const pyLoaderMissing = Object.entries(pyLoaderFeatures).filter(([, v]) => !v).map(([k]) => k);
  if (pyLoaderMissing.length) {
    violations.push(
      `[TheSchema单源] Python 咽喉 schema_loader.py 缺少特征: ${pyLoaderMissing.join(", ")}` +
      "——Python 侧未消费同一份形态源（PR-053 验收③）",
    );
  }
  // 〔SPEC-022 波 C 改向〕原「validate-article.py 委托 schema_loader」检查随 Python 退役——
  // 改查 Node 校验库委托同一咽喉（第三套读法不得复活）。
  const validatorLib = path.join(ROOT, "scripts", "vault-runtime", "article-validator-lib.cjs");
  const validatorLibSource = fs.existsSync(validatorLib) ? fs.readFileSync(validatorLib, "utf-8") : "";
  // M2 修复（红队）：反信号探针为主——出现「直读 enums.yaml」的 IO 形态即红（注释里写关键词骗不过）；
  // 关键词正向匹配降为辅助。行为面对齐 probeLenientCoercion 先例（正则版对绕行是假绿）。
  const directReadSignals = [
    /readFileSync\([^)]*["']enums\.yaml["']/,          // fs 直读
    /["']知识库["']\s*,\s*["']TheSchema["']\s*,\s*["']enums\.yaml["']/, // 路径段拼装直读
  ];
  if (directReadSignals.some((re) => re.test(validatorLibSource))) {
    violations.push(
      "[TheSchema单源] article-validator-lib 存在 enums.yaml 直读信号——第三套读法复活即红（须经 enums-loader/normalizeEnums 咽喉）",
    );
  } else if (!/enums-loader\.cjs/.test(validatorLibSource) || !/normalizeEnums/.test(validatorLibSource)) {
    violations.push(
      "[TheSchema单源] article-validator-lib 未经 enums-loader/normalizeEnums 咽喉读 enums（辅助正向检查）",
    );
  }
}

if (violations.length === 0) {
  console.log(`validation_parity=ok rules=${rules.length} node=ok fingerprints=ok enums_schema=ok theschema=ok（SPEC-022 波 C：单实现）`);
} else {
  fail(violations);
}
