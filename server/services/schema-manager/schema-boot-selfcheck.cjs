// Component: Schema-Boot-Selfcheck（PR-109 缺口①）
// @responsible: boot 期对真 TheSchema 全量执行既有校验器——校验执法活性元保障（校验器存在≠生效）
// @inputs: vaultPath（经 resolveTheSchemaDir 定位 TheSchema）；可选 schemaDir（测试注入缝——缺省走 resolver）
// @outputs: runSchemaBootSelfCheck({ vaultPath, schemaDir?, logger?, telemetry? }) →
//   { outcome: "clean"|"violations"|"skipped", executed, livenessViolations, dataViolations, reason? }
// @context: Schema-Manager。断线三例史（validateOntologyPayload 曾全 server 零调用／validateNodeType
//   改名第 5 处漏项零调用期未暴露／PR-102 装配哑键）均经人工批外暴露——本模块把「校验器断线」变
//   「启动即报警」。观测不拦截：违例只落 telemetry trace（kind schema-selfcheck-run，尽力而为）＋
//   结构化 warn，不阻断启动（PR-100 断链 warn 先例；OpenMAIC「provider 拒启」经对源核实为端点级
//   fail-closed 非启动拦截，不采纳拒启口径）。anomaly 台不写——workbench 读时整表删光重插会覆盖
//   直插行（WP-013 PR-104 分析先例）。
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");
const { resolveTheSchemaDir } = require("../../shared/theschema-root.cjs");
const { normalizeDocument } = require("../../shared/theschema-loader.cjs");
const schemaValidators = require("./schema-validators.cjs");
const { enumsSegmentViolations } = require("../../shared/schema-write-guards.cjs");

// 期望校验器面（活性注册表）：schema-validators 全函数导出＋schema-write-guards 册外面闸门。
// 任一缺失/非函数＝活性违例——validateNodeType domain→category 改名漏项史的防复发面：
// 改名/删除须同批更新此表，否则 boot 即报（「校验器的校验」）。
// validateRemovedSubdomainUsage 仅注册活性不执行：它是写时闸门（previous/next 语义），
// boot 快照无删词语境，执行无意义且需现算全量画像。
const EXPECTED_VALIDATORS = {
  "schema-validators.cjs": [
    "validateDomains",
    "validateSubdomains",
    "validateLayers",
    "validateStringArray",
    "validateStringMap",
    "validateModules",
    "validateSubdomainConstraints",
    "validatePolicyReferences",
    "validateRemovedSubdomainReferences",
    "validateRemovedSubdomainUsage",
    "validateSection",
    "validateNodeType",
    "validateRelationType",
    "validateOntologyPayload",
    // PR-183：两枚附加条件校验器随咽喉导出同批登记（活性注册表＝导出面双向对账，漏登记即红）
    "validateElementLifecycles",
    "validateRetirementChains",
  ],
  "schema-write-guards.cjs": ["enumsSegmentViolations"],
};

const VALIDATOR_MODULES = {
  "schema-validators.cjs": schemaValidators,
  "schema-write-guards.cjs": { enumsSegmentViolations },
};

function livenessViolationsForMissingExports() {
  const missing = [];
  for (const [moduleName, names] of Object.entries(EXPECTED_VALIDATORS)) {
    for (const name of names) {
      if (typeof VALIDATOR_MODULES[moduleName][name] !== "function") {
        missing.push(`期望校验器缺失: ${moduleName}#${name}`);
      }
    }
  }
  return missing;
}

// 单校验器执行包装：抛错归活性违例（校验器自身故障——断线的另一形态），返回值归数据违例
function runValidator(label, fn, executed, livenessViolations) {
  executed.push(label);
  try {
    return fn() || [];
  } catch (error) {
    livenessViolations.push(`${label} 抛错: ${error.message}`);
    return [];
  }
}

function recordTraceSafe(telemetry, payload) {
  if (telemetry && typeof telemetry.recordTrace === "function") {
    try {
      telemetry.recordTrace("schema-selfcheck-run", payload);
    } catch {
      /* 遥测不得阻断自检（recordTrace 自身已尽力而为，双保险） */
    }
  }
}

/**
 * boot 自检：真 TheSchema 上全量执行既有校验器（与写路径同一套函数——单一事实源）。
 * 同步执行（纯读＋内存校验，毫秒级）；main.cjs 以 fire-and-forget 包装，失败只告警。
 */
function runSchemaBootSelfCheck({ vaultPath, schemaDir, logger, telemetry }) {
  const log = logger || { info() {}, warn() {}, error() {} };
  const executed = [];
  const livenessViolations = livenessViolationsForMissingExports();
  const dataViolations = [];

  // WP-049 余量批：三件经词表装载端口（data/degraded 与旧逐件收口同源；schemaDir 测试注入
  // 经 loadVocabFromDir 保持）。逐件单独装载：坏一件只报该件 liveness、不吞其余件检查
  // （既有隔离语义）；缺文件按既有 skip 惯例：不假红、不阻断。
  const { loadVocabBundle, loadVocabFromDir } = require("../../shared/vocab-load-port.cjs");
  const loadOne = (name) => (schemaDir ? loadVocabFromDir(schemaDir, { files: [name] }) : loadVocabBundle(vaultPath, { files: [name] }));
  const results = {};
  for (const name of ["enums", "ontology", "fields"]) {
    try {
      results[name] = { file: loadOne(name).files[name] };
    } catch (error) {
      results[name] = { error };
    }
  }
  const present = (name) => (results[name].error ? true : Boolean(results[name].file && results[name].file.state === "present"));
  if (!present("enums") || !present("ontology")) {
    const reason = `TheSchema 缺文件（enums.yaml=${present("enums")}，ontology.yaml=${present("ontology")}）`;
    log.info({ event: "schema-selfcheck-skipped", reason });
    const summary = { outcome: "skipped", reason, executed, livenessViolations, dataViolations };
    recordTraceSafe(telemetry, { ...summary, at: new Date().toISOString() });
    return summary;
  }

  const documents = { enums: {}, ontology: {}, fields: { fields: [] } };
  for (const name of ["enums", "ontology", "fields"]) {
    if (name === "fields" && !present(name)) continue;
    const outcome = results[name];
    if (outcome.error) {
      livenessViolations.push(`${name}.yaml 读取抛错: ${outcome.error.message}`);
      continue;
    }
    documents[name] = outcome.file.data;
    for (const node of outcome.file.degradedNodes) {
      dataViolations.push(`${name}.${node.path}: ${(node.errors || []).join("; ")}`);
    }
  }
  const { enums: enumsDoc, ontology: ontologyDoc, fields: fieldsDoc } = documents;

  // ①写网关准入同源：enums 顶层键须在册（theschema-roles 段覆盖）
  const unregistered = runValidator(
    "enumsSegmentViolations",
    () => enumsSegmentViolations(enumsDoc),
    executed,
    livenessViolations,
  );
  for (const key of unregistered) dataViolations.push(`enums 顶层键未注册: ${key}`);

  // ②节校验：按前端节键分发（validateSection 口径），经 SECTION_YAML_KEY_MAP 取 yaml 段
  for (const section of schemaValidators.VALID_SECTIONS) {
    const yamlKey = schemaValidators.SECTION_YAML_KEY_MAP[section];
    if (enumsDoc[yamlKey] === undefined) continue;
    // PR-054/035：validateSection 第三参升级为全量 doc（subdomain_constraints 语义校验需 domains/subdomains/categories）
    const errors = runValidator(
      `validateSection(${section})`,
      () => schemaValidators.validateSection(section, enumsDoc[yamlKey], enumsDoc),
      executed,
      livenessViolations,
    );
    for (const error of errors) dataViolations.push(`enums.${yamlKey}: ${error}`);
  }

  // ③跨段引用（layers→domains/categories、subdomain_constraints→domains/categories）
  const referenceErrors = runValidator(
    "validatePolicyReferences",
    () => schemaValidators.validatePolicyReferences(enumsDoc),
    executed,
    livenessViolations,
  );
  for (const error of referenceErrors) dataViolations.push(`enums 跨段引用: ${error}`);

  // ④本体双向互查（node_types.allows_relations ↔ relation_types 键集、source/target_types ↔ node 键集）
  //    全量 payload 对全量 merged——互查函数可见全部键（与 ontology-routes PUT 闸门同构）
  const ontologyErrors = runValidator(
    "validateOntologyPayload",
    () => schemaValidators.validateOntologyPayload(ontologyDoc, ontologyDoc, ontologyDoc, fieldsDoc),
    executed,
    livenessViolations,
  );
  for (const error of ontologyErrors) dataViolations.push(`ontology: ${error}`);

  const summary = {
    outcome: livenessViolations.length || dataViolations.length ? "violations" : "clean",
    executed,
    livenessViolations,
    dataViolations,
  };
  if (summary.outcome === "clean") {
    log.info({ event: "schema-selfcheck-clean", executed: executed.length, validators: summary.executed });
  } else {
    warnViolations(log, summary);
  }
  recordTraceSafe(telemetry, { ...summary, at: new Date().toISOString() });
  return summary;
}

function warnViolations(log, summary) {
  if (summary.livenessViolations && summary.livenessViolations.length) {
    log.warn({ event: "schema-selfcheck-liveness-violation", count: summary.livenessViolations.length, violations: summary.livenessViolations });
  }
  if (summary.dataViolations && summary.dataViolations.length) {
    log.warn({ event: "schema-selfcheck-data-violation", count: summary.dataViolations.length, sample: summary.dataViolations.slice(0, 10) });
  }
}

module.exports = { runSchemaBootSelfCheck, EXPECTED_VALIDATORS };
