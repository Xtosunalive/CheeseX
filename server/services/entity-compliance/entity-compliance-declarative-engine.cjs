// Component: Entity-Compliance-Declarative-Engine（2026-09-12 第一性原理重写；旧版备份：归档/规则系统重写-20260911/）
// @responsible: 声明式实体规则统一校验引擎——规则声明（contracts/entity-readiness-rules.json）是唯一事实源：
//               检查方式(check)、严重度(severity 单值)、失败文案(message)、空值提醒(emptyMessage+onEmpty)、
//               执行门禁(gates)、字段展示名(fields) 全部在声明里；引擎只做「照着声明问文档」。
// @inputs: Entity frontmatter/body, ComplianceRuleSet(运行时枚举), EntityIndexes(全库索引)
// @outputs: Diagnostic[]（passed:false 才是问题；error=拦写 / warn=提醒 / info=仅展示）
// @context: Vault — ADR041 声明式规则集 + Ajv（复用 validateWithAjv，不 new Ajv）；ADR054 gates 声明。
//
// 第一性原理（重写裁决）：一条规则 = 一段人话。文案不再由 Ajv 英文原文 + 前端映射 + 字段名替换三层拼接，
// 而是声明里写好模板、引擎插值（{actual}/{since}/{until}/{count}…）后直出，前端零翻译。

const { createRequire } = require("node:module"); // #1809 起生效链：node --watch 自动重启，改声明/引擎无需手动重启
const requireMjs = createRequire(require("node:url").pathToFileURL(__filename).href);
const h = require("./entity-compliance-helpers.cjs");
const { KEBAB_RE, DATE_RE, SEMVER_RE } = h;
const br = require("./entity-compliance-body-rules.cjs");
const { normalizeString, isSemverLike, compareSemver, finding } = h;
const { extractTypedWikilinks, resolveTarget } = br;
const { validateWithAjv } = requireMjs("../../../scripts/quality/shared/ajv-schema-validation.mjs");
// seq210：字段中文名单源（shared/field-labels.mjs 实体域字典，node≥22 require(esm)）。
// 契约 contracts/entity-readiness-rules.json 的 fields 段只留 hint（填写要求），不再存中文名。
const { fieldLabel: sharedFieldLabel } = require("../../../shared/field-labels.mjs");

var rulesData;
try { rulesData = require("../../../contracts/entity-readiness-rules.json"); }
catch (_e) { rulesData = { fields: {}, rules: [] }; }
// 2026-10-27 降档（Master「做就做彻底」）：F 族字段校验从 registry 迁代码内声明——
// 两处合并后口径与迁出前逐字节等价（问题台/写门/E2E 引用 ruleId 零迁移）
const { FIELD_RULES } = require("../../shared/field-rule-declarations.cjs");
rulesData.rules = [...FIELD_RULES, ...rulesData.rules];
var RULES = rulesData.rules || [];
var FIELDS = rulesData.fields || {};
var RULE_BY_ID = {};
RULES.forEach(function (r) { RULE_BY_ID[r.id] = r; });
var FM_RULES = RULES.filter(function (r) { return r.group !== "body"; });

// 单字段形状检查（进 JSON Schema）的 check 集合；复合/索引/占位规则由复合段承接。
var SCHEMA_CHECKS = { "required": 1, "kebabcase": 1, "exact-true": 1, "enum-ref": 1, "semver": 1, "date": 1, "array-nonempty": 1 };

// ── 消息渲染（声明模板 + 上下文插值；{field} 自动补字段展示名）──

function renderMessage(rule, ctx) {
  ctx = ctx || {};
  var out = rule.message || "";
  Object.keys(ctx).forEach(function (k) {
    out = out.split("{" + k + "}").join(ctx[k] === undefined ? "" : String(ctx[k]));
  });
  return out;
}

function fieldLabel(field) {
  return sharedFieldLabel(field, "entity") || field;
}

// 键可能来自文档内容（分层/分类/关系类型等），普通取值会命中原型属性——
// constructor/toString 会被当成合法映射值或已注册类型。
function hasOwn(dict, key) {
  return !!dict && Object.prototype.hasOwnProperty.call(dict, key);
}

// ── frontmatter 归一化（别名/下划线/数组首元素，行为与旧版一致）──

function normalizeFrontmatter(fm, ruleSet) {
  fm = fm || {};
  ruleSet = ruleSet || {};
  var out = {};
  Object.keys(fm).forEach(function (k) { out[k] = fm[k]; });
  if (fm.architecture_node_id !== undefined && out["architecture-node-id"] === undefined) {
    out["architecture-node-id"] = fm.architecture_node_id;
  }
  var aliasMaps = {
    arch_layer: ruleSet.layerAliases || {},
    arch_category: ruleSet.categoryAliases || {},
    arch_subdomain: ruleSet.subdomainAliases || {},
  };
  Object.keys(aliasMaps).forEach(function (field) {
    var v = out[field];
    if (typeof v === "string") {
      var map = aliasMaps[field];
      var nv = hasOwn(map, v) ? map[v] : v;
      if (nv !== v) out[field] = nv;
    }
  });
  ["module", "modules"].forEach(function (field) {
    var v = out[field];
    if (Array.isArray(v)) {
      out[field] = (typeof v[0] === "string" && v[0].trim()) ? v[0] : "";
    }
  });
  return out;
}

// ── JSON Schema 组装（severity==="error" 的单字段形状规则 → required/enum/pattern）──

function buildFrontmatterSchema(ruleSet) {
  var props = {};
  var required = [];
  var patterns = { kebabcase: KEBAB_RE.source, date: DATE_RE.source, semver: SEMVER_RE.source };
  FM_RULES.forEach(function (rule) {
    var field = rule.field;
    if (field.indexOf("/") >= 0) return;                    // 复合键（F09/F17）不进单字段 schema
    if (!SCHEMA_CHECKS[rule.check]) return;                 // unique-*/subdomain-policy/array-entry-semver/optional-any 走复合段
    var blocking = rule.required === true;                  // 必填是显式声明（required:true），不是 severity 的副作用
    if (blocking && required.indexOf(field) < 0) required.push(field);
    var emptyExempt = [
      { type: "null" },
      { const: "" },
      { type: "array", maxItems: 0 },
    ];
    var propSchema;
    if (rule.check === "enum-ref") {
      var values = (rule.enumKey && ruleSet[rule.enumKey]) || [];
      if (!values.length) {
        propSchema = { type: ["string", "number", "null"] };
      } else if (!blocking) {
        propSchema = { anyOf: emptyExempt.concat([{ type: "string", enum: values }]) };
      } else {
        propSchema = { type: "string", enum: values };
      }
    } else if (patterns[rule.check]) {
      propSchema = blocking
        ? { type: "string", pattern: patterns[rule.check] }
        : { anyOf: emptyExempt.concat([{ type: "string", pattern: patterns[rule.check] }]) };
    } else if (rule.check === "required") {
      // 必填＝至少含一个非空白字符。Ajv 的 required 只判键存在，minLength 又放过 "  "——
      // 留白身份等于两个实体共用一个空键，图上两条线并到同一节点
      propSchema = { type: ["string", "number"], pattern: "\\S" };
    } else if (rule.check === "exact-true") {
      propSchema = { type: "boolean", const: true };
    } else if (rule.check === "array-nonempty") {
      propSchema = { type: "array", minItems: 1 };
    }
    if (propSchema) props[field] = propSchema;
  });
  return { type: "object", additionalProperties: true, required: required, properties: props };
}

// ── Ajv error → 诊断（severity 单值；message 从声明渲染）──

function ruleForField(field) {
  for (var i = 0; i < FM_RULES.length; i++) {
    var r = FM_RULES[i];
    if (r.field === field && r.field.indexOf("/") < 0 && SCHEMA_CHECKS[r.check]) return r;
  }
  return null;
}

function mapSchemaErrors(errors) {
  var diags = [];
  errors.forEach(function (e) {
    var field = String(e.location || "").replace(/^frontmatter\./, "").replace(/^frontmatter/, "");
    var rule = ruleForField(field);
    if (!rule) return;
    // required 缺失时 Ajv 的 data 是父对象——插值会变成 [object Object]，缺失态不插值
    var actual = e.keyword === "required" ? "（未填写）" : e.data;
    diags.push({
      ruleId: rule.id, field: field, severity: rule.severity, passed: false,
      currentValue: actual,
      message: renderMessage(rule, { actual: actual, field: fieldLabel(field) }),
      hint: rule.hint || "", _group: rule.group, _keyword: e.keyword,
    });
  });
  return diags;
}

// ── 空值提醒（onEmpty="warn" 且字段空 → 产提醒诊断，不拦写）──

function missingPatch(fm) {
  var diags = [];
  FM_RULES.forEach(function (rule) {
    var field = rule.field;
    if (field.indexOf("/") >= 0) return;
    if (rule.onEmpty !== "warn") return;
    if (!SCHEMA_CHECKS[rule.check] || rule.check === "required") return; // required 类缺失已由 schema 报
    var present = fm[field] !== undefined && fm[field] !== null && normalizeString(fm[field]) !== "";
    if (!present) {
      diags.push({
        ruleId: rule.id, field: field, severity: "warn", passed: false,
        currentValue: null,
        message: rule.emptyMessage || ("建议填写" + fieldLabel(field)),
        hint: rule.hint || "", _group: rule.group, _missing: true,
      });
    }
  });
  return diags;
}

// ── 复合规则（F05b / F09 / F10 / F02b / F02c；F17 占位不产诊断）──

function compositeRules(fm, ruleSet, indexes, selfFileName) {
  var out = [];
  indexes = indexes || {};
  function diag(rule, extra) {
    return Object.assign({
      ruleId: rule.id, field: rule.field, severity: rule.severity, passed: false,
      message: rule.message, hint: rule.hint || "", _group: rule.group,
    }, extra || {});
  }
  // F05b 子域类别白名单：无策略=不产诊断；有策略且违反=error
  var subdomain = normalizeString(fm.arch_subdomain);
  var category = normalizeString(fm.arch_category);
  var policy = subdomain && ruleSet.subdomainConstraints ? ruleSet.subdomainConstraints[subdomain] : null;
  if (policy && Array.isArray(policy.allowed_categories) && policy.allowed_categories.length) {
    if (policy.allowed_categories.indexOf(category) < 0) {
      var rule5b = RULE_BY_ID["F05b"];
      out.push(diag(rule5b, {
        currentValue: category || null, expected: policy.allowed_categories.join(" | "),
        message: renderMessage(rule5b, { subdomain: subdomain, actual: category || "", expected: policy.allowed_categories.join("、") }),
      }));
    }
  }
  // F09 有效期顺序：起点必须早于或等于终点（#1805：起点===终点合法，单版本有效）
  var since = normalizeString(fm.arch_since || ""), until = normalizeString(fm.arch_until || "");
  if (since && until && isSemverLike(since) && isSemverLike(until)) {
    if (!(compareSemver(since, until) <= 0)) {
      var rule09 = RULE_BY_ID["F09"];
      out.push(diag(rule09, { currentValue: since + " → " + until, message: renderMessage(rule09, { since: since, until: until }) }));
    }
  }
  // F10 版本覆盖数组：条目 version 须为 semver
  var ov = fm.arch_version_overrides;
  if (ov !== undefined && ov !== null) {
    var rule10 = RULE_BY_ID["F10"];
    if (!Array.isArray(ov)) {
      out.push(diag(rule10, { currentValue: typeof ov === "string" ? ov : JSON.stringify(ov), expected: "数组", message: renderMessage(rule10, { index: 0, actual: typeof ov === "string" ? ov : JSON.stringify(ov) }) }));
    } else {
      for (var i = 0; i < ov.length; i++) {
        var entry = ov[i]; if (!entry || typeof entry !== "object") continue;
        var ev = normalizeString(entry.version || "");
        if (ev && !isSemverLike(ev)) {
          out.push(diag(rule10, { currentValue: "条目 " + (i + 1) + ": " + ev, message: renderMessage(rule10, { index: i + 1, actual: ev }) }));
        }
      }
    }
  }
  // F02b/F02c 全库唯一性（声明化：旧为 service 层隐藏增补，现与全部规则同源）
  // F02c 收窄（2026-10-08 裁决 2）：精确同名才拦（normalizeString 全等）；近似名并存合法
  // （对齐 dictionary 粒度——正名管身份唯一，认人靠别名引导不靠拦近似名）。
  var nid = normalizeString(fm["architecture-node-id"] || fm["architecture_node_id"] || "");
  var title = normalizeString(fm.title || "");
  if (nid && indexes.duplicateIds && indexes.duplicateIds.has(nid)) {
    var ruleB = RULE_BY_ID["F02b"];
    // 点名持有者：只说「已被使用」用户无从下手；索引表可能是普通 {}（测试/写侧注入），不得沿原型链取
    var ownersAll = hasOwn(indexes.idOwners || {}, nid) ? indexes.idOwners[nid] : [];
    var holderList = ownersAll.filter(function (o) { return o && o.fileName !== selfFileName; });
    // 名单要有界、单条要净空：300 个持有者会把一条 422 明细撑到四五千字，
    // 标题里的换行会伪造出多行错误文案（复核实测）
    var holderText = holderList.slice(0, 3)
      .map(function (o) {
        var who = String(o.title || o.fileName || "未命名").replace(/\s+/g, " ").slice(0, 60);
        var where = String(o.fileName || o.sourcePath || "").replace(/\s+/g, " ").slice(0, 80);
        return who + "（" + where.split(/[/\\]/).pop() + "）";
      })
      .join("、");
    if (holderList.length > 3) holderText += " 等 " + holderList.length + " 处";
    var holders = holderText || "（索引未提供持有者）";
    out.push(diag(ruleB, {
      field: "architecture-node-id", currentValue: nid, expected: "全库唯一身份",
      holders: holders,
      message: renderMessage(ruleB, { actual: nid, holders: holders }),
    }));
  }
  if (title && indexes.duplicateTitles && indexes.duplicateTitles.has(title)) {
    var ruleC = RULE_BY_ID["F02c"];
    out.push(diag(ruleC, { field: "title", currentValue: title, message: renderMessage(ruleC, { actual: title }) }));
  }
  // F17 别名防撞（2026-10-08 裁决 2 新增，warn 级）：别名不得撞他人正名 + 别名不得互相撞。
  // 素材=duplicateAliases 索引（buildEntityIndexes 构建）；无策略=不产诊断；提醒不拦写。
  if (indexes.duplicateAliases && indexes.duplicateAliases.size) {
    var rule17 = RULE_BY_ID["F17"];
    if (rule17) {
      var ownAliases = Array.isArray(fm.aliases) ? fm.aliases.map(normalizeString).filter(Boolean) : [];
      var clashes = [];
      indexes.duplicateAliases.forEach(function (value) {
        if (ownAliases.indexOf(value) >= 0 || title === value) clashes.push(value);
      });
      if (clashes.length) {
        out.push(diag(rule17, {
          field: "aliases", currentValue: clashes.join("、"),
          expected: "别名不与任何实体的正名或其他别名重复",
          message: renderMessage(rule17, { actual: clashes.join("、"), owners: clashes.map(function (v) {
            // 自身键判定：注入的索引表可能是普通 {}（测试/写侧），不得沿原型链取到 constructor 之类函数
            var owners = hasOwn(indexes.aliasOwners, v) ? indexes.aliasOwners[v] : [];
            return v + "（持有者：" + owners.join("、") + "）";
          }).join("；") }),
        }));
      }
    }
  }
  return out;
}

function dedupe(diags) {
  var seen = {}; return diags.filter(function (d) { var k = d.ruleId + "|" + (d.field || "") + "|" + d.severity; if (seen[k]) return false; seen[k] = true; return true; });
}

// ── Frontmatter 诊断：Ajv 结构化 + 空值提醒 + 复合规则 + 全量占位（buildGroups 分组依赖每规则在组内出现）──

function runFrontmatterDiagnostics(fm, ruleSet, indexes, selfFileName) {
  var diags = [];
  var normFm = normalizeFrontmatter(fm, ruleSet);
  var schema;
  try { schema = buildFrontmatterSchema(ruleSet); } catch (_e) { schema = null; }
  if (schema) {
    var errs = validateWithAjv(normFm, schema, "frontmatter");
    diags = diags.concat(mapSchemaErrors(errs));
  }
  diags = diags.concat(missingPatch(normFm));
  diags = diags.concat(compositeRules(normFm, ruleSet, indexes, selfFileName));
  diags = dedupe(diags);
  var present = {};
  diags.forEach(function (d) { present[d.ruleId] = true; });
  FM_RULES.forEach(function (rule) {
    if (present[rule.id]) return;
    if (rule.id === "F02b" || rule.id === "F02c") return;   // 唯一性：通过即无诊断（全量占位无意义）
    var rawVal = (fm || {})[rule.field];
    diags.push({
      ruleId: rule.id, field: rule.field, severity: rule.severity || "info",
      passed: true, message: "通过", hint: rule.hint || "", _group: rule.group,
      currentValue: (Array.isArray(rawVal) && rawVal.length) ? rawVal : undefined,
    });
  });
  return diags;
}

// ── Body 规则（B01-B04：判定沿用提取器；失败文案从声明渲染）──

function runBodyDiagnostics(body, ruleSet, indexes) {
  var diags = [];
  indexes = indexes || {};
  var parsed = extractTypedWikilinks(body);
  function push(ruleId, passed, ctx, extra) {
    var rule = RULE_BY_ID[ruleId];
    if (!rule || passed) return;
    diags.push(Object.assign({
      ruleId: ruleId, field: rule.field, severity: rule.severity, passed: false,
      message: renderMessage(rule, ctx), hint: rule.hint || "", _group: rule.group,
    }, extra || {}));
  }
  // B01 类型化关系：零声明或存在 ::[[target]] 空类型 → 失败
  var missingTypeTargets = [];
  var re = /(?:^|\s)::\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, m;
  while ((m = re.exec(body || "")) !== null) if (m[1].trim() && missingTypeTargets.indexOf(m[1].trim()) < 0) missingTypeTargets.push(m[1].trim());
  push("B01", parsed.typed.length > 0 && missingTypeTargets.length === 0, {}, {
    currentValue: missingTypeTargets.length ? "关系类型为空：" + missingTypeTargets.join("、") : "0 条",
    hint: missingTypeTargets.length ? "请在 :: 前填写关系类型，例如 依赖::[[" + missingTypeTargets[0] + "]]" : "普通 [[target]] 仅表示 Obsidian 引用；架构关系请使用如 依赖::[[target]]",
  });
  // B02 wikilink 目标可解析（2026-10-08 裁决 2：别名命中=善意提示轨道，不再是 unresolved 误报）
  // 注意顺序：别名命中虽可解析，但须先判 aliasOf 归入提示轨道——不能在 resolveTarget 里提前 return。
  var unresolved = [];
  var aliasHints = []; // [{target, aliasOf}] 建议改用正名
  parsed.allTargets.forEach(function (t) {
    var canonical = br.aliasOf ? br.aliasOf(t, indexes) : null;
    if (canonical) { aliasHints.push({ target: t, aliasOf: canonical }); return; }
    if (!resolveTarget(t, indexes) && unresolved.indexOf(t) < 0) unresolved.push(t);
  });
  push("B02", unresolved.length === 0, { count: unresolved.length, targets: unresolved.slice(0, 5).join("、") }, {
    unresolvedTargets: unresolved, currentValue: unresolved.slice(0, 5).join(", "),
  });
  // B02 附注（别名善意提示）：正文用别名连线可解析但建议改用正名（轻提醒，非违规）
  if (aliasHints.length) {
    var rule02 = RULE_BY_ID["B02"];
    diags.push({
      ruleId: "B02", field: rule02 ? rule02.field : "wikilink 目标", severity: "warn", passed: true,
      currentValue: aliasHints.map(function (h) { return h.target + "→" + h.aliasOf; }).join("、"),
      message: "别名连线建议改用正名：" + aliasHints.map(function (h) { return h.target + " → " + h.aliasOf; }).join("、") + "（别名只用于检索认人，不用于连线寻址）",
      hint: "别名可解析不报错；将 [[别名]] 改为 [[正名]] 可让关系寻址更稳", _group: "body", _aliasHint: true,
    });
  }
  // B03 文档引用（关联型关系或任意类型化关系 > 0）
  var relCount = parsed.typed.filter(function (x) { return x.type === "关联"; }).length;
  push("B03", relCount > 0 || parsed.typed.length > 0, {}, { currentValue: relCount + " 关联" });
  // B04 关系类型已注册
  var known = (ruleSet && ruleSet.wikilinkTypeLabels) || {};
  var unknown = parsed.typed.filter(function (t) { return !hasOwn(known, t.type); }).map(function (t) { return t.type; })
    .filter(function (v, i, a) { return a.indexOf(v) === i; });
  push("B04", unknown.length === 0, { count: unknown.length, labels: unknown.join(", ") }, {
    currentValue: unknown.join(", "), hint: "已知类型: " + Object.keys(known).join("、"),
    // 2026-10-08 裁决 4：未知类型的完整链接载荷（type/target/coordinate/snippet）随诊断下发——
    // collector relation_conflict 轨道的证据源（重写时曾丢失，仅存类型名致轨道死代码）
    unknownRelations: parsed.typed.filter(function (t) { return !hasOwn(known, t.type); }),
  });
  return diags;
}

function runAllDiagnostics(entity, ruleSet, indexes) {
  var fm = (entity && entity.frontmatter) || {};
  var body = (entity && entity.body) || "";
  return runFrontmatterDiagnostics(fm, ruleSet, indexes, (entity && entity.fileName) || "").concat(runBodyDiagnostics(body, ruleSet, indexes));
}

// ── 自动盘点导出（规则清单 Markdown 生成区，供 check:entity-readiness-inventory 比对）──

function exportRuleInventory() {
  var lines = [];
  lines.push("<!-- BEGIN-GENERATED-ENTITY-READINESS-INVENTORY -->");
  lines.push("");
  lines.push("> 本表由 `exportRuleInventory()` 自动生成，禁止手改。改 rules.json 后运行 `npm run check:entity-readiness-inventory` 重新生成。");
  lines.push("");
  lines.push("| 规则 | 字段 | 检查 | severity | 空值行为 | 门禁 | 失败文案 |");
  lines.push("|---|---|---|---|---|---|---|");
  RULES.forEach(function (rule) {
    var gates = (rule.gates || []).length ? rule.gates.map(function (g) { return g.split(".").pop(); }).join(",") : "—";
    var emptyB = rule.onEmpty === "warn" ? "warn 提醒" : (rule.severity === "error" ? "error（缺失即违规）" : "通过");
    var msg = (rule.message || "").replace(/\|/g, "\\|");
    lines.push("| " + [rule.id, rule.field, rule.check, rule.severity, emptyB, gates, msg].join(" | ") + " |");
  });
  lines.push("");
  lines.push("### severity 分层");
  lines.push("");
  var bySev = { "error": [], "warn": [], "info": [] };
  RULES.forEach(function (rule) { (bySev[rule.severity] = bySev[rule.severity] || []).push(rule.id); });
  lines.push("- **阻断(error)**：" + (bySev["error"].join(", ") || "无"));
  lines.push("- **建议(warn)**：" + (bySev["warn"].join(", ") || "无"));
  lines.push("- **参考(info)**：" + (bySev["info"].join(", ") || "无"));
  lines.push("");
  lines.push("<!-- END-GENERATED-ENTITY-READINESS-INVENTORY -->");
  return lines.join("\n");
}

// ── Diagnostic → legacy finding converter（service/route 消费面不变）──

// 注：本处第二个入参保持「英文键或规则号」（seq210 未改动它）——本次是等价重构，只换字段中文名的取值
// 来源（从契约 fields[*].label 换成 shared/field-labels.mjs），不改变任何下发的文案。
// 「EDIT 分支下发的是英文键、前端需自备一份中文映射」是另一个已存在的现象，
// 已单独记录待裁定，不在本次改动范围内（改动它会让本批不再是等价重构）。
function diagnosticToFinding(diag) {
  return finding(diag.ruleId, diag.field || diag.ruleId, diag.severity, diag.passed, {
    field: diag.field, value: diag.currentValue, expected: diag.expected,
    message: diag.message, hint: diag.hint, _group: diag._group,
    unresolvedTargets: diag.unresolvedTargets,
    unknownRelations: diag.unknownRelations,
  });
}

function fieldKebabPattern(field) {
  var rule = FM_RULES.filter(function (r) { return r.field === field && r.check === "kebabcase"; })[0];
  return rule ? KEBAB_RE.source : undefined;
}

exports.runFrontmatterDiagnostics = runFrontmatterDiagnostics;
exports.runBodyDiagnostics = runBodyDiagnostics;
exports.runAllDiagnostics = runAllDiagnostics;
exports.fieldKebabPattern = fieldKebabPattern;
exports.exportRuleInventory = exportRuleInventory;
exports.diagnosticToFinding = diagnosticToFinding;
exports.buildFrontmatterSchema = buildFrontmatterSchema;
exports.RULE_FIELDS = FIELDS;
