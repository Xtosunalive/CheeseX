#!/usr/bin/env node
// Component: Data-Chain-Checker — schema-driven JSON/SQLite/SA/layout verifier.
// @responsible: 校验 master、SQLite、SA、layout 与向量索引的数据链一致性。
// @inputs: Vault 路径、master_graph（WP-056 经读模型 port staging 工件出口）、SQLite（②类验库——语义本体）、SA、layout（WP-057 经 SA 族工件出口）
// @outputs: JSON 质量报告与进程退出码
// @context: Pipeline
//
// Phase 5 mode (--check-phase5): validates projection edges against approved sources.
// 实现见 scripts/quality/shared/phase5-projection-check.mjs（规则 2 按关注点拆分）。
// Checks: ghost_edges, unapproved_associations, tag_symptom_edges, provenance.
// With --check-determinism: runs pipeline twice, compares normalized hashes.
import fs from "node:fs";
import { SNAPSHOT_HASH_PATTERN } from "../../server/shared/version-contract.cjs"; // seq195：sha256 形状单源（审计族 R 收敛；仓内相对 require 不破坏零 npm 依赖）
import { resolvePythonPath } from "../../server/shared/python-path.cjs"; // W2-WP3：解释器解析单点（ADR-002）
// Phase 5 正式边检查已按关注点迁出（规则 2：单文件 ≤500 行）；本体单源派生见该模块。
import { checkPhase5 } from "./shared/phase5-projection-check.mjs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
// WP-049 L2：词表经装载入口取数（vocab-load-port＝唯一读取宿主）
import { loadVocabBundle } from "../../server/shared/vocab-load-port.cjs";
// WP-056 G-A：staging 图工件唯一读取出口（读模型 port 图族）
import { getStagedGraphArtifact, getStagedSAArtifacts } from "../../server/shared/read-model-port.cjs";
import { normalizeRetiredReference } from "../../server/shared/ontology-inheritance-resolver.cjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function requiredFile(filePath, label) {
  if (!fs.existsSync(filePath)) throw new Error(`${label} 不存在: ${filePath}`);
  return filePath;
}

function optionValue(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
}

function resolvePaths(args) {
  const fixtureVault = path.resolve(scriptDir, "../../test/fixtures/minimal-vault");
  const requestedVault = args.includes("--fixture")
    ? fixtureVault
    : process.env.KB_VAULT || process.env.VAULT_PATH || "";
  const vault = path.resolve(requestedVault);
  if (!vault || vault === path.parse(vault).root) {
    throw new Error("必须通过 KB_VAULT 或 VAULT_PATH 指定 Vault 根目录");
  }
  // SPEC-012 wave-2 图族：master_graph 真身迁 derived-index.db（vault 停写）。管线 Stage 6
  // VERIFY 时 Node 摄取（post-run hook）尚未跑，最新图在 data/staging（extract_graph 落点，
  // 字节与库将摄之值一致）——非 fixture 模式缺省读 staging；--fixture 静态验收读 fixture 快照文件。
  const dataDir = process.env.KB_DATA_DIR || path.resolve(scriptDir, "..", "..", "data");
  const masterDefault = args.includes("--fixture")
    ? path.join(vault, ".ledger", "master_graph.json")
    : path.join(dataDir, "staging", "master_graph.json");
  // WP-049 L2：词表取数经装载入口（同一 theschema-root 阶梯解析）——raw 视图＋`|| {}` 语义保持；
  // 缺件沿用 requiredFile 的 fail-closed 语义（label 不存在即抛）
  // PR-017 3.1：本体是「有哪些关系类型 / 各类型证据要求」的唯一事实源（规则 19，AGENTS.md:380
  // 禁 Web 端复制定义）。本门禁的「正式边」判据与「产出⊆本体」断言一律从此处派生，不再手写清单。
  const vocab = loadVocabBundle(vault, { files: ["enums", "ontology"] });
  for (const name of ["enums", "ontology"]) {
    if (vocab.files[name].state === "missing") requiredFile(path.join(vocab.dir, `${name}.yaml`), `${name}.yaml`);
  }
  const enums = vocab.files.enums.raw || {};
  const ontology = vocab.files.ontology.raw || {};
  // PR-082（Master 2026-10-20 批）：SA/layout 迁派生通用槽 data/staging/sa/（与 master_graph
  // 同读法——非 fixture 模式缺省读 staging；产品身份门控随通用槽退役，元层态合法）。
  // --fixture 静态验收仍读 fixture 内产品段快照（fixture 自带身份，冻结态不随通用槽改版）
  const fixtureMode = args.includes("--fixture");
  let semanticDefault;
  let layoutDefault;
  if (fixtureMode) {
    const projection = enums.architecture_projection || {};
    const product = String(projection.product || "").trim();
    const version = String(projection.version || "").trim();
    if (!product || !version) throw new Error("architecture_projection.product/version 缺失（fixture 模式）");
    const architectureDir = path.join(vault, "知识库", "architecture", product, version);
    semanticDefault = path.join(architectureDir, "semantic_architecture.json");
    layoutDefault = path.join(architectureDir, "architecture_layout.json");
  } else {
    semanticDefault = path.join(dataDir, "staging", "sa", "semantic_architecture.json");
    layoutDefault = path.join(dataDir, "staging", "sa", "architecture_layout.json");
  }
  return {
    vault,
    enums,
    ontology,
    ontologyPath: path.join(vocab.dir, "ontology.yaml"),
    master: optionValue(args, "--master", masterDefault),
    semantic: optionValue(args, "--semantic", semanticDefault),
    layout: optionValue(args, "--layout", layoutDefault),
    // SPEC-012 wave-2：document_index 库迁 repo 侧 data/（KB_DATA_DIR 或 repo data 缺省）
    db: optionValue(args, "--db", path.join(dataDir, "master_graph.db")),
  };
}

// ── Phase 5 determinism helpers（--check-determinism 尚未接线，历史保留）──

function sha256Str(content) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function normalizeGraphStr(graph) {
  const nodes = (graph.nodes || []).map(n => ({ ...n })).sort((a, b) => (a.id || "").localeCompare(b.id || ""));
  const connections = (graph.connections || []).map(c => ({ ...c })).sort((a, b) => (a.edgeId || a.from || "").localeCompare(b.edgeId || b.from || ""));
  return JSON.stringify({ nodes, connections }, null, 2);
}

// ── Original validate ──

function validate(paths, skipConsistency) {
  // WP-056 G-A：master_graph 经读模型 port 的 staging 工件出口（读取路径收敛——校验语义零变化；
  // paths.master 保留：requiredFile 缺件 fail-closed 与报告 path 字段语义不变）
  const stagedGraph = getStagedGraphArtifact(path.dirname(paths.master));
  if (stagedGraph.raw === null) requiredFile(paths.master, "master_graph.json"); // 缺件走既有 fail-closed 报错
  const master = stagedGraph.raw !== null ? JSON.parse(stagedGraph.raw) : readJson(requiredFile(paths.master, "master_graph.json"));
  // WP-057 S-A：semantic/layout 经读模型 port 的 SA 族工件出口（staging 通用槽形态——
  // 读取路径收敛；requiredFile 缺件 fail-closed 保持）。fixture 模式读 vault architecture
  // 目录（路径形态判别：非 staging/sa 即 fixture 面——不依赖 args 传参）。
  let semantic;
  let layout;
  if (paths.semantic.includes(`${path.sep}staging${path.sep}sa${path.sep}`) || paths.semantic.includes("/staging/sa/")) {
    const dataDir = path.resolve(paths.semantic, "..", "..", "..");
    const saArtifacts = getStagedSAArtifacts(dataDir);
    semantic = saArtifacts.semantic.raw !== null ? JSON.parse(saArtifacts.semantic.raw) : readJson(requiredFile(paths.semantic, "semantic_architecture.json"));
    layout = saArtifacts.layout.raw !== null ? JSON.parse(saArtifacts.layout.raw) : readJson(requiredFile(paths.layout, "architecture_layout.json"));
  } else {
    semantic = readJson(requiredFile(paths.semantic, "semantic_architecture.json"));
    layout = readJson(requiredFile(paths.layout, "architecture_layout.json"));
  }
  const nodes = Array.isArray(master.nodes) ? master.nodes : [];
  const connections = Array.isArray(master.connections) ? master.connections : null;
  const components = Array.isArray(semantic.components) ? semantic.components : [];
  const dependencies = Array.isArray(semantic.dependencies) ? semantic.dependencies : null;
  const componentIds = new Set(components.map((item) => item?.id).filter(Boolean));
  const validCategories = new Set(paths.enums.arch_categories || []);
  const validRelations = new Set(
    paths.enums.architecture_projection?.projected_relation_types || [],
  );
  const ontologyRelationTypes = paths.ontology?.relation_types || {};
  const ontologyRelations = new Set(
    Object.entries(ontologyRelationTypes)
      .filter(([, def]) => def && (def.lifecycle_status === undefined || def.lifecycle_status === "approved"))
      .map(([type]) => type),
  );
  const legacyDeleteRelations = new Set(
    Object.entries(ontologyRelationTypes)
      .filter(([, def]) => def && def.legacy_policy === "delete")
      .map(([type]) => type),
  );
  const relationReferences = new Map();
  const referenceErrors = [];
  for (const relationType of new Set([...(connections || []), ...(dependencies || [])].map((item) => item?.relationType))) {
    try {
      relationReferences.set(relationType, normalizeRetiredReference(ontologyRelationTypes, relationType, {
        elementType: "relation_types", registries: paths.ontology,
      }));
    } catch (error) {
      referenceErrors.push({ original_id: relationType, code: error.code, message: error.message });
    }
  }
  const evidenceRelations = (connections || []).filter((item) => {
    const properties = item && typeof item.properties === "object" && !Array.isArray(item.properties) ? item.properties : {};
    const sources = Array.isArray(properties.sources) ? properties.sources : [];
    return ["entity-wikilink", "entity-wikilink+yaml"].includes(properties.source)
      || sources.some((source) => source && source.method === "entity_wikilink");
  });
  // ADR063 空态三值（#1744 收口）：空投影=源投影合法态，不再作为 blocker——
  // 「受管源全缺失 fail-closed」已单点收口于 document-source-scanner（受管根缺失抛
  // DOCUMENT_INDEX_UNAVAILABLE），runner Stage 0/0.5/1/3 亦已改判空态通过（Vault 33eb02b）；
  // 本 checker 再以「组件/节点数为 0」判违规即构成第二事实源（配5 双源病），曾致
  // 全量重建在 Stage 6 VERIFY 误判失败（空 wiki 后 SA 合法 0 组件，master 40 节点）。
  // 计数保留在 report.semantic/master 供观测，blockers 恒 0。
  const blockers = {
    emptyMasterNodes: 0,
    invalidMasterConnections: connections === null ? 1 : 0,
    emptySemanticComponents: 0,
    invalidSemanticDependencies: dependencies === null ? 1 : 0,
    invalidCategories: components.filter(
      (item) => validCategories.size > 0 && !validCategories.has(item?.category || item?.arch_category),
    ).length,
    nonArchitectureRelations: (dependencies || []).filter(
      (item) => !relationReferences.has(item?.relationType)
        || (validRelations.size > 0 && !validRelations.has(relationReferences.get(item?.relationType).resolved_id)),
    ).length,
    ontologyRelationDrift: (connections || []).filter(
      (item) => !relationReferences.has(item?.relationType),
    ).length,
    // 退役归一不得绕过既有 legacy_policy=delete 零产出约束。
    legacyDeleteRelationsProduced: (connections || []).filter(
      (item) => legacyDeleteRelations.has(item?.relationType)
        || legacyDeleteRelations.has(relationReferences.get(item?.relationType)?.resolved_id),
    ).length,
    danglingDependencies: (dependencies || []).filter(
      (item) => !componentIds.has(item?.from) || !componentIds.has(item?.to),
    ).length,
    untraceableArchitectureRelations: evidenceRelations.filter((item) => (
      typeof item.edgeId !== "string" || !item.edgeId.trim()
      || typeof item.sourceFile !== "string" || !item.sourceFile.trim()
      || typeof item.sourceHash !== "string" || !SNAPSHOT_HASH_PATTERN.test(item.sourceHash)
      || !Number.isInteger(item.lineNumber) || item.lineNumber < 1
      || typeof item.evidenceHash !== "string" || !item.evidenceHash.trim()
    )).length,
    relationContractDrift: evidenceRelations.filter((item) => {
      const properties = item.properties || {};
      return ["since", "until"].some((field) => {
        const nested = typeof properties[field] === "string" ? properties[field].trim() : "";
        const topLevel = typeof item[field] === "string" ? item[field].trim() : "";
        return nested !== topLevel;
      });
    }).length,
    layoutDrift: 0,
  };

  const layoutIds = new Set(Object.keys(layout.nodes || {}));
  blockers.layoutDrift = [...componentIds].filter((id) => !layoutIds.has(id)).length
    + [...layoutIds].filter((id) => !componentIds.has(id)).length;

  let consistency = { skipped: true, consistent: null };
  if (!skipConsistency) {
    // W2-WP3：解释器解析单点（ADR-002），防 PATH 污染时无 PyYAML 的 managed python3 使一致性脚本静默失败
    const result = spawnSync(resolvePythonPath(), [
      path.join(scriptDir, "check_consistency.py"),
      "--master", paths.master,
      "--db", paths.db,
      "--json",
    ], { encoding: "utf8" });
    try {
      consistency = JSON.parse((result.stdout || "").trim() || "{}");
    } catch {
      consistency = { consistent: false, error: "一致性脚本未返回合法 JSON" };
    }
    if (result.status !== 0 && consistency.consistent !== false) {
      consistency = { ...consistency, consistent: false, error: result.stderr || "一致性脚本失败" };
    }
  }

  // Check if SA files exist (Phase 5 doesn't require them, so don't fail on missing)
  if (!paths.semantic || !fs.existsSync(paths.semantic)) {
    // SA missing — acceptable for Phase 5 fixture vaults
    blockers.emptySemanticComponents = 0;
    blockers.invalidSemanticDependencies = 0;
    blockers.invalidCategories = 0;
    blockers.nonArchitectureRelations = 0;
    blockers.danglingDependencies = 0;
    blockers.layoutDrift = 0;
  }

  const blocked = Object.values(blockers).some((count) => count > 0)
    || consistency.consistent === false;
  return {
    ok: !blocked,
    master: { nodes: nodes.length, connections: connections?.length || 0, path: paths.master },
    semantic: { components: components.length, dependencies: dependencies?.length || 0, path: paths.semantic },
    layout: { nodes: layoutIds.size, groups: Object.keys(layout.groups || {}).length, path: paths.layout },
    ontology: {
      path: paths.ontologyPath,
      relation_types: ontologyRelations.size,
      legacy_delete_relations: [...legacyDeleteRelations].sort(),
      normalized_references: [...relationReferences.values()].filter((reference) => reference.replacement_chain.length > 1),
      reference_errors: referenceErrors,
    },
    blockers,
    consistency,
  };
}

// ── Read-source explicitness (E3 / ADR039) ──
// All read-derived-data response schemas must declare dataSource + workingRevision.
function checkDataSourceContract() {
  const contractPath = path.resolve(scriptDir, "../../contracts/http-api.openapi.json");
  if (!fs.existsSync(contractPath)) {
    return { passed: false, error: "OpenAPI contract 不存在: " + contractPath };
  }
  const spec = JSON.parse(fs.readFileSync(contractPath, "utf8"));
  const schemas = spec.components?.schemas || {};
  const requiredSchemas = [
    { name: "DashboardTopologyData", via: "allOf.[1]" },
    { name: "SearchDocumentsResponse", via: "properties" },
    { name: "CandidateSearchData", via: "properties" },
    { name: "ProductVersionList", via: "properties" },
    { name: "ArchitectureVersionState", via: "properties" },
    // B4 修复防复发（#970）：6 端点 dataSource 标注后，其响应 schema 必须声明 dataSource+workingRevision
    // （S122 范围外残余补全；新增端点若漏标 dataSource 会被本门禁拦截）
    // 注：KGQueryData/CanvasAdmissionData/ClassificationListData 为 allOf 包装（FormalReleaseIdentity + object），
    //     属性在 allOf[1]，与 DashboardTopologyData 同构 → via 用 allOf.[1]
    { name: "ImpactAnalysisResult", via: "properties" },
    { name: "KGQueryData", via: "allOf.[1]" },
    { name: "ArticleManifestQueryData", via: "allOf.[1]" },
    { name: "CanvasAdmissionData", via: "allOf.[1]" },
    { name: "ClassificationListData", via: "allOf.[1]" },
    { name: "ReviewHistoryResponse", via: "properties" },
    { name: "PendingReviewResponse", via: "properties" },
  ];
  const missing = [];
  for (const entry of requiredSchemas) {
    const schema = schemas[entry.name];
    if (!schema) { missing.push(entry.name + ":schema-missing"); continue; }
    const props = entry.via === "allOf.[1]"
      ? schema.allOf?.[1]?.properties || {}
      : schema.properties || {};
    if (!props.dataSource) missing.push(entry.name + ":dataSource");
    if (!props.workingRevision) missing.push(entry.name + ":workingRevision");
  }
  return { passed: missing.length === 0, missing, checked: requiredSchemas.length };
}

function main() {
  try {
    const args = process.argv.slice(2);
    const checkPhase5Flag = args.includes("--check-phase5");
    const skipConsistency = args.includes("--skip-consistency");
    const paths = resolvePaths(args);
    const report = validate(paths, skipConsistency);

    if (checkPhase5Flag) {
      const phase5 = checkPhase5(paths, args.includes("--check-determinism"));
      report.phase5 = phase5;
      if (!phase5.passed) report.ok = false;
    }

    const dataSourceContract = checkDataSourceContract();
    report.dataSourceContract = dataSourceContract;
    if (!dataSourceContract.passed) report.ok = false;

    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exitCode = 1;
  }
}

main();
