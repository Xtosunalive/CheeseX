// @responsible: 从请求固定的不可变 Release 读取实体包含层级。
// Reads structural Entity containment only from the request-pinned immutable Release.
function createEntityParentReleaseReader(options) {
  const releaseReader = options.releaseReader;

  function readContainmentTree() {
    const raw = releaseReader.readArtifact("indexes/entity-containment.json");
    const index = JSON.parse(raw);
    const entities = Array.isArray(index.entities) ? index.entities : [];
    const ids = new Set(entities.map((entry) => entry?.entityId).filter(Boolean));
    const roots = [];
    const children = new Map();
    for (const entry of entities) {
      if (!entry?.entityId) continue;
      if (entry.parentId && ids.has(entry.parentId)) {
        if (!children.has(entry.parentId)) children.set(entry.parentId, []);
        children.get(entry.parentId).push(entry.entityId);
      } else {
        roots.push(entry.entityId);
      }
    }
    for (const values of children.values()) values.sort();
    return {
      roots: roots.sort(),
      children: Object.fromEntries([...children.entries()].sort(([left], [right]) => left.localeCompare(right))),
      totalEntities: ids.size,
    };
  }

  return { readContainmentTree };
}

module.exports = { createEntityParentReleaseReader };
