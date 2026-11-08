// Component: Entity-Parent-Service
// @responsible: Entity parent_id validation — structural containment, NOT a relation.
// @context: Schema-And-Parent-Hierarchy (Slice 5)
// @invariants:
//   - parent_id is structural containment (architecture_node-id → parent architecture_node-id)
//   - parent_id is NOT a relation type; does not enter ontology 16 relation types
//   - parent_id does NOT generate BELONGS_TO edges
//   - At most one parent per child
//   - Unknown parent → blocker
//   - Self-reference → blocker
//   - Cycle → blocker (DFS)
//   - Non-Entity target → blocker

const fs = require("node:fs");
const path = require("node:path");
// WP-116 批2（SPEC-083 §二.3）：装载/补丁经文档装载端口出口（loadDocument＝宿主 parseEntityDocument
// 同底座委托，null 原型不变；patchFrontmatter 纯转发）——消费面禁直 require 宿主。
const { loadDocument, patchFrontmatter } = require("../../shared/document-load-port.cjs");

const { bindErrorFactory } = require("../../shared/error-factory.cjs");
const { writeVault, writeVaultExclusive, readVault } = require("../../shared/vault-io.cjs"); // PR-057：vault 唯一写通道（原子写＋归属取证日志；noLedger=记账归属维持现状）；PR-083：读签发凭据
const parentError = bindErrorFactory({ status: 400 });

/**
 * Create an Entity parent_id validator and writer.
 *
 * @param {object} options
 * @param {string} options.vaultPath - path to the Vault
 * @param {function} [options.readEntityIds] - function that returns Set of known Entity architecture-node-ids
 * @param {function} [options.readEntityType] - function(id) returns entity type or null
 * @param {object} [options.logger]
 */
function createEntityParentService(options) {
  const vaultPath = path.resolve(options.vaultPath);
  const logger = options.logger || { info() {}, error() {} };

  /**
   * Read all Entity architecture-node-ids from the Vault.
   * Scans the governed Entity source directory for Markdown files with architecture-node-id frontmatter.
   */
  function readEntityIndex() {
    if (options.readEntityIds && options.readEntityType) {
      const ids = options.readEntityIds();
      return {
        ids: ids instanceof Set ? ids : new Set(ids),
        getType: options.readEntityType,
      };
    }

    // Default: scan Vault for Entity Markdown files
    const governedEntitiesDir = path.join(vaultPath, "知识库", "wiki", "entities");
    const legacyEntitiesDir = path.join(vaultPath, "wiki", "entities");
    const entitiesDir = fs.existsSync(governedEntitiesDir) ? governedEntitiesDir : legacyEntitiesDir;
    const index = new Map(); // id → { filePath, type }

    if (!fs.existsSync(entitiesDir)) return { ids: new Set(), getType: () => null, index };

    function scanDir(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) { scanDir(fullPath); continue; }
        if (!entry.name.endsWith(".md")) continue;

        try {
          const content = fs.readFileSync(fullPath, "utf8");
          const fm = loadDocument(content, fullPath).frontmatter;
          const nodeId = fm["architecture-node-id"] || fm["architecture_node_id"];
          const entityType = fm["entity_type"] || fm["type"] || null;
          if (nodeId) {
            index.set(nodeId, { filePath: fullPath, type: entityType });
          }
        } catch { /* skip unreadable files */ }
      }
    }
    scanDir(entitiesDir);

    return {
      ids: new Set(index.keys()),
      getType: (id) => index.get(id)?.type || null,
      index,
    };
  }

  /**
   * Read the current parent_id of an Entity from its source Markdown.
   */
  function readParent(entityId) {
    const entityIndex = readEntityIndex();
    const entry = entityIndex.index.get(entityId);
    if (!entry) throw parentError("ENTITY_NOT_FOUND", `Entity "${entityId}" not found`, 404);

    const content = fs.readFileSync(entry.filePath, "utf8");
    const fm = loadDocument(content, entry.filePath).frontmatter;
    return fm["parent_id"] || null;
  }

  /**
   * Validate a proposed parent_id for an Entity.
   * Returns { valid: true } or throws a blocking error.
   *
   * @param {string} childId - the child Entity's architecture-node-id
   * @param {string|null} parentId - the proposed parent architecture-node-id (null = remove parent)
   */
  function validateParent(childId, parentId) {
    // Null parent is always valid (removing parent)
    if (parentId === null || parentId === undefined || parentId === "") {
      return { valid: true, action: "remove" };
    }

    const entityIndex = readEntityIndex();

    // Self-reference check
    if (childId === parentId) {
      throw parentError("SELF_REFERENCE",
        `Entity "${childId}" cannot be its own parent`, 400,
        { childId, parentId });
    }

    // Parent must exist as a known Entity
    if (!entityIndex.ids.has(parentId)) {
      throw parentError("UNKNOWN_PARENT",
        `Parent "${parentId}" is not a known Entity architecture-node-id`, 400,
        { childId, parentId });
    }

    // Parent must be an Entity type (not Document, Concept, etc.)
    const parentType = entityIndex.getType(parentId);
    if (parentType && !isEntityType(parentType)) {
      throw parentError("NON_ENTITY_TARGET",
        `Parent "${parentId}" has type "${parentType}" which is not an Entity type`, 400,
        { childId, parentId, parentType });
    }

    // Cycle detection: walk up from parentId to see if we reach childId
    detectCycle(childId, parentId, entityIndex);

    return { valid: true, action: "set" };
  }

  /**
   * Check if a type string represents an Entity type.
   * Entity types are structural knowledge nodes, not Documents or Concepts.
   */
  function isEntityType(type) {
    if (!type) return true; // Unknown types are allowed (conservative)
    const nonEntityTypes = new Set([
      "Document", "Article", "Concept", "Product", "ProductVersion",
      "Plate", "Subdomain", "BusinessDomain",
    ]);
    return !nonEntityTypes.has(type);
  }

  /**
   * DFS cycle detection: walk up from parentId through existing parent_id links.
   * If we reach childId, there's a cycle.
   */
  function detectCycle(childId, parentId, entityIndex) {
    const visited = new Set([childId]);
    let current = parentId;
    const chain = [childId, parentId];

    while (current) {
      if (current === childId) {
        throw parentError("CYCLE_DETECTED",
          `Setting parent of "${childId}" to "${parentId}" would create a cycle: ${chain.join(" → ")}`,
          400, { childId, parentId, chain });
      }
      if (visited.has(current)) break; // Already checked this node
      visited.add(current);
      chain.push(current);

      // Read current node's parent
      try {
        const nextParent = readParentFromIndex(current, entityIndex);
        current = nextParent;
      } catch {
        current = null; // If we can't read the parent, stop the chain
      }
    }
  }

  /**
   * Read parent_id from the entity index without re-scanning the Vault.
   */
  function readParentFromIndex(entityId, entityIndex) {
    const entry = entityIndex.index.get(entityId);
    if (!entry) return null;

    try {
      const content = fs.readFileSync(entry.filePath, "utf8");
      const fm = loadDocument(content, entry.filePath).frontmatter;
      return fm["parent_id"] || null;
    } catch {
      return null;
    }
  }

  /**
   * Write parent_id to an Entity's source Markdown frontmatter.
   * Only called after validateParent() passes.
   *
   * @param {string} childId
   * @param {string|null} parentId
   */
  function writeParent(childId, parentId) {
    // Validate first
    validateParent(childId, parentId);

    const entityIndex = readEntityIndex();
    const entry = entityIndex.index.get(childId);
    if (!entry) throw parentError("ENTITY_NOT_FOUND", `Entity "${childId}" not found`, 404);

    const { content, sha256 } = readVault(entry.filePath);
    const parsed = loadDocument(content, entry.filePath);
    if (Object.keys(parsed.frontmatter).length === 0) {
      throw parentError("NO_FRONTMATTER", `Entity "${childId}" has no readable frontmatter`, 400);
    }
    // B9（裁决 #9 选 B）：parent_id 清空后保留键、值为空串，不再删键。
    const newContent = patchFrontmatter(content, { parent_id: parentId || "" });

    try {
      writeVault(entry.filePath, newContent, { expectedContentHash: sha256, domain: "entity-growth", summary: "父实体回写" }); // SPEC-012 WP-I＋PR-083 凭据
    } catch (error) {
      if (error.code === "VAULT_REVISION_CONFLICT") throw parentError("ENTITY_REVISION_CONFLICT", `Entity "${childId}" 已被并发修改，请重试`, 409, error.details);
      throw error;
    }
    logger.info({ event: "entity-parent-written", childId, parentId, filePath: entry.filePath });
    return { childId, parentId, filePath: entry.filePath };
  }

  /**
   * Read the containment tree for display purposes.
   * Returns a read-only hierarchical structure.
   * This is NOT a relation — it's structural containment from parent_id.
   */
  function readContainmentTree() {
    const entityIndex = readEntityIndex();
    const children = new Map(); // parentId → [childId, ...]
    const roots = [];

    for (const [id, entry] of entityIndex.index) {
      const parentId = readParentFromIndex(id, entityIndex);
      if (parentId && entityIndex.ids.has(parentId)) {
        if (!children.has(parentId)) children.set(parentId, []);
        children.get(parentId).push(id);
      } else {
        roots.push(id);
      }
    }

    for (const values of children.values()) values.sort();
    return { roots: roots.sort(), children: Object.fromEntries([...children.entries()].sort()), totalEntities: entityIndex.ids.size };
  }

  return {
    validateParent,
    writeParent,
    readParent,
    readContainmentTree,
    readEntityIndex,
  };
}

module.exports = { createEntityParentService };
