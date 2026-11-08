// @responsible: 确定性解析图节点标识并为影响分析重映射种子节点。
// Shared deterministic node identifier resolver.

const COMMON_PREFIXES = ["entity-", "system-", "concept-"];
const COMMON_SUFFIXES = [
  "-cluster", "-service", "-gateway", "-controller", "-center",
  "-extension", "-preview", "-online", "-edit",
];

function cleanIdentifier(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizedToken(value) {
  const clean = cleanIdentifier(value);
  return clean
    ? clean.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
    : null;
}

function architectureIds(node) {
  const props = node && node.properties && typeof node.properties === "object" && !Array.isArray(node.properties)
    ? node.properties
    : {};
  return [props.architecture_node_id, props["architecture-node-id"]]
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => value.trim());
}

function searchableIdentifiers(node) {
  const props = node && node.properties && typeof node.properties === "object" && !Array.isArray(node.properties)
    ? node.properties
    : {};
  return [node && node.id, node && node.label, node && node.name, props.name, props.title, ...architectureIds(node)]
    .filter((value) => typeof value === "string" && value.trim());
}

function createNodeIdResolver(nodes, edges) {
  const safeNodes = Array.isArray(nodes) ? nodes.filter((node) => cleanIdentifier(node && node.id)) : [];
  const safeEdges = Array.isArray(edges) ? edges : [];
  const byId = new Map(safeNodes.map((node) => [node.id.trim(), node]));

  function uniqueMatch(items) {
    return items.length === 1 ? items[0] : null;
  }

  // WP-107 D2（SPEC-046 I2／PR-231）：身份比较只用**整串等值**。
  // 撤掉的三条折叠路径原本会把「仅大小写／标点／全半角不同」的两个身份认成同一个——
  // 那等于让消费方按形状解析 ID（ADR-016 §二禁，I2 禁），且图上零痕迹。
  // 保留的是名称查找（按笔记标题链接＝Obsidian 语义，不是 ID 比较），且必须报出命中方式。
  // 返回 { nodeId, via }：via='id' 节点键等值；'arch-id' 架构身份等值；'label' 标题查找（唯一命中才算）。
  function resolveNodeRef(value) {
    const raw = cleanIdentifier(value);
    if (!raw) return { nodeId: null, via: null };
    if (byId.has(raw)) return { nodeId: raw, via: "id" };

    const archMatch = uniqueMatch(safeNodes
      .filter((node) => architectureIds(node).some((id) => id === raw))
      .map((node) => node.id));
    if (archMatch) return { nodeId: archMatch, via: "arch-id" };

    const lower = raw.toLowerCase();
    const labelMatch = uniqueMatch(safeNodes
      .filter((node) => cleanIdentifier(node.label) && node.label.trim().toLowerCase() === lower)
      .map((node) => node.id));
    if (labelMatch) return { nodeId: labelMatch, via: "label" };

    return { nodeId: null, via: null };
  }

  function resolveNodeId(value) {
    return resolveNodeRef(value).nodeId;
  }

  function degree(nodeId) {
    return safeEdges.reduce((count, edge) => {
      const from = cleanIdentifier(edge && (edge.from || edge.source));
      const to = cleanIdentifier(edge && (edge.to || edge.target));
      return count + (from === nodeId ? 1 : 0) + (to === nodeId ? 1 : 0);
    }, 0);
  }

  function candidates(raw) {
    const found = [];
    const seen = new Set();
    function push(nodeId) {
      if (nodeId && byId.has(nodeId) && !seen.has(nodeId)) {
        seen.add(nodeId);
        found.push(nodeId);
      }
    }

    push(resolveNodeId(raw));
    for (const prefix of COMMON_PREFIXES) {
      if (raw.startsWith(prefix)) push(resolveNodeId(raw.slice(prefix.length)));
    }
    for (const suffix of COMMON_SUFFIXES) push(resolveNodeId(`${raw}${suffix}`));
    return found;
  }

  function uniqueFuzzyMatch(raw) {
    const token = normalizedToken(raw);
    if (!token || token.length < 2) return null;
    const matches = safeNodes
      .filter((node) => searchableIdentifiers(node).some((value) => {
        const candidate = normalizedToken(value);
        return candidate && candidate.includes(token);
      }))
      .map((node) => node.id);
    return uniqueMatch([...new Set(matches)]);
  }

  function anchorImpactSeed(value) {
    const raw = cleanIdentifier(value);
    if (!raw) return { nodeId: null, remappedFrom: null };
    if (byId.has(raw)) return { nodeId: raw, remappedFrom: null };

    const direct = resolveNodeId(raw);
    if (direct) return { nodeId: direct, remappedFrom: direct === raw ? null : raw };

    const found = candidates(raw);
    const nodeId = found.length > 0
      ? found.slice().sort((left, right) => degree(right) - degree(left) || left.localeCompare(right))[0]
      : uniqueFuzzyMatch(raw);
    if (!nodeId) return { nodeId: null, remappedFrom: null };
    return { nodeId, remappedFrom: nodeId === raw ? null : raw };
  }

  return { resolveNodeId, resolveNodeRef, anchorImpactSeed };
}

module.exports = { createNodeIdResolver };
