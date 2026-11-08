// Component: Formal-Document-Node Boundary
// @responsible: 区分正式知识文章节点与误入正式图的候选节点。
// @inputs: master_graph Document node
// @outputs: applicability decision for downstream formal-graph checks
// @context: Vault derived graph

function normalizePath(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\\/g, "/").replace(/\/{2,}/g, "/").trim();
}

function documentSourcePath(node) {
  const properties = node?.properties && typeof node.properties === "object" && !Array.isArray(node.properties)
    ? node.properties
    : {};
  return normalizePath(
    properties.source_path
      || properties.sourcePath
      || properties.file_path
      || properties.filePath
      || properties.source_vault_path,
  );
}

function inspectFormalDocumentNode(node) {
  const sourcePath = documentSourcePath(node);
  if (sourcePath.includes("/raw/precleaned/")) {
    return {
      applicable: false,
      reason: "标准文章候选未获准参与正式图下游检查",
      sourcePath,
    };
  }
  return { applicable: true, reason: "正式图文档节点", sourcePath };
}

module.exports = { documentSourcePath, inspectFormalDocumentNode, normalizePath };
