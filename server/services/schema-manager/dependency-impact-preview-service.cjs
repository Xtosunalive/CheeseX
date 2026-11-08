// @responsible: 校验依赖草稿并预览其版本、路径和文档影响及写入许可。
const { isActiveAt } = require("../../shared/version-contract.cjs");
const { displayTheSchemaPath } = require("../../shared/theschema-root.cjs");
// 依赖规则的只读查询/校验由 publication 拥有的写服务提供，经 options 注入为读端口，
// analysis 不直接 import publication 写服务；写命令（writeDependencies）仍留在 publication。
const { createDecisionEvidenceService } = require("../../shared/decision-lineage.cjs");

const { createError: serviceError } = require("../../shared/error-factory.cjs");
const { makeId } = require("../../shared/identity-port.cjs"); // WP-051 I-B：身份入口

function relationKey(rule) {
  // WP-051 I-B（SPEC-046 I1）：依赖影响行键经身份入口——source/type 含 | 不再撞键
  // （P2 实跑址 4：2 行入 1 行出漏判影响面）
  return makeId("dep", [rule.source, rule.type, rule.target]);
}

function activeRelations(items, version) {
  return new Map(items
    .filter((item) => isActiveAt(version, item.since || null, item.until || null))
    .map((item) => [relationKey(item), { source: item.source, target: item.target, type: item.type }]));
}

function pathsFrom(result) {
  return [result && result.downstream, result && result.upstream]
    .flatMap((direction) => direction && Array.isArray(direction.byHop) ? direction.byHop : [])
    .flatMap((group) => group.nodes || [])
    .flatMap((node) => node.paths || []);
}

function documentsFrom(result) {
  const documents = [result && result.downstream, result && result.upstream]
    .flatMap((direction) => direction && Array.isArray(direction.documentRefs) ? direction.documentRefs : []);
  return [...new Map(documents.map((item) => [item.documentId || item.relativePath || item.sourcePath, item])).values()];
}

function createDependencyImpactPreviewService(options) {
  const vaultPath = options.vaultPath;
  const getRegistry = options.getRegistry;
  const analyzeImpact = options.analyzeImpact;
  const changeDispositionService = options.changeDispositionService || null;
  const listDependencies = options.listDependencies;
  const validateDependencyPayload = options.validateDependencyPayload;
  if (typeof listDependencies !== "function" || typeof validateDependencyPayload !== "function") {
    throw new Error("createDependencyImpactPreviewService requires injected listDependencies and validateDependencyPayload read ports");
  }
  const evidenceService = options.decisionEvidenceService || createDecisionEvidenceService();

  function preview(items) {
    const validation = validateDependencyPayload(vaultPath, items);
    const errors = validation.diagnostics.filter((item) => item.severity === "error");
    if (errors.length) throw serviceError("VALIDATION_ERROR", "依赖规则草稿校验失败", 400, { diagnostics: validation.diagnostics });

    const current = listDependencies(vaultPath);
    const registry = typeof getRegistry === "function" ? getRegistry() : { products: {} };
    const affectedVersions = [];
    for (const [product, definition] of Object.entries(registry.products || {})) {
      for (const entry of definition.versions || []) {
        const currentRelations = activeRelations(current.items, entry.id);
        const draftRelations = activeRelations(validation.items, entry.id);
        const added = [...draftRelations].filter(([key]) => !currentRelations.has(key)).map(([, value]) => value);
        const removed = [...currentRelations].filter(([key]) => !draftRelations.has(key)).map(([, value]) => value);
        if (!added.length && !removed.length) continue;
        const componentIds = [...new Set([...added, ...removed].flatMap((relation) => [relation.source, relation.target]))].sort();
        let impact = null;
        // fail-closed：影响分析失败（analyzeImpact 抛错）不得伪装"无受影响路径/文档"——
        // 会影响依赖规则预览的正确性（影响面低估）。失败即抛错阻断。
        try {
          impact = typeof analyzeImpact === "function" ? analyzeImpact({ seedNodeIds: componentIds, maxHops: 2, direction: "both", minConfidence: 0, includeDocuments: true }) : null;
        } catch (error) {
          throw serviceError("IMPACT_ANALYSIS_FAILED", `依赖影响分析失败: ${error.message}`, 500, { product, version: entry.id, componentIds, cause: error.message });
        }
        const paths = pathsFrom(impact);
        affectedVersions.push({
          product,
          version: entry.id,
          status: entry.status,
          added,
          removed,
          componentIds,
          paths,
          documents: documentsFrom(impact),
          lineage: evidenceService.build({
            source: { kind: "relation", path: displayTheSchemaPath(vaultPath, "dependencies.yaml"), contentHash: validation.revision, coordinate: `dependency-preview:${product}:${entry.id}` },
            rule: { ruleId: "dependencies.version-range-preview", ruleRevision: validation.revision, reasonCode: "VERSION_RANGE_IMPACT" },
            scope: { product, version: entry.id },
          }),
        });
      }
    }
    const result = {
      revision: current.revision,
      diagnostics: validation.diagnostics,
      affectedVersions,
      summary: {
        versions: affectedVersions.length,
        relationsAdded: affectedVersions.reduce((sum, item) => sum + item.added.length, 0),
        relationsRemoved: affectedVersions.reduce((sum, item) => sum + item.removed.length, 0),
        components: new Set(affectedVersions.flatMap((item) => item.componentIds)).size,
        paths: affectedVersions.reduce((sum, item) => sum + item.paths.length, 0),
        documents: new Set(affectedVersions.flatMap((item) => item.documents.map((document) => document.documentId || document.relativePath || document.sourcePath))).size,
      },
    };
    return {
      ...result,
      reasoning: changeDispositionService && typeof changeDispositionService.evaluate === "function"
        ? changeDispositionService.evaluate({ affectedVersions })
        : null,
    };
  }

  function assertWriteAllowed(items) {
    const result = preview(items);
    if (changeDispositionService && typeof changeDispositionService.assertWriteAllowed === "function") changeDispositionService.assertWriteAllowed(result.reasoning);
    return result;
  }

  return { preview, assertWriteAllowed };
}

module.exports = { createDependencyImpactPreviewService, activeRelations };
