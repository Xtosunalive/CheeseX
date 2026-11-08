// Component: Entity-Alias-Index
// @responsible: 建立规范化 alias/title/id 到 entity sourceKey 的反向索引并检测冲突。
// @inputs: EntityDocument[]
// @outputs: owners/conflicts
// @context: Vault

function normalizeAlias(value) { return typeof value === "string" ? value.trim().toLocaleLowerCase() : ""; }
function aliasesOf(frontmatter) {
  const raw = frontmatter.aliases;
  if (Array.isArray(raw)) return raw.filter((value) => typeof value === "string" && value.trim());
  if (typeof raw === "string" && raw.trim()) return [raw.trim()];
  return [];
}
function buildAliasIndex(entities) {
  // 键来自文档内容（正名/ID/别名），普通 {} 会让 constructor/toString 等键命中原型属性——
  // owners["constructor"] 会拿到函数再 .includes 直接 TypeError，故用无原型字典。
  const owners = Object.create(null);
  for (const entity of entities) {
    const fm = entity.frontmatter || {};
    const values = [fm.title, fm["architecture-node-id"], ...aliasesOf(fm)];
    for (const value of values) {
      const key = normalizeAlias(value); if (!key) continue;
      if (!owners[key]) owners[key] = [];
      const sourceKey = entity.sourceKey || entity.sourcePath || entity.fileName || "";
      if (!owners[key].includes(sourceKey)) owners[key].push(sourceKey);
    }
  }
  const conflicts = Object.create(null);
  for (const [key, sourceKeys] of Object.entries(owners)) if (sourceKeys.length > 1) conflicts[key] = sourceKeys;
  return { owners, conflicts };
}
module.exports = { normalizeAlias, aliasesOf, buildAliasIndex };
