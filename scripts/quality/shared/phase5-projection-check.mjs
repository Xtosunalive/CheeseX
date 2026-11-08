// Phase 5 投影检查 — master_graph 正式边的 ghost / 批准继承 / 结构化属性 / 证据完整性检查。
// 由 scripts/quality/check-data-chain.mjs 按关注点迁出（规则 2：单文件 ≤500 行），行为等价。
//
// PR-017 3.1-4 收编：正式边判据不再手写清单，改由本体派生（唯一事实源，规则 19 / 配5 双源病）。
// 复用管道同款 registry（buildCapabilityRegistry）与证据解析（evidenceValue），与正式消费方同源；
// 同类先例：scripts/quality/check-product-acceptance.mjs:131。
import fs from "node:fs";
import path from "node:path";
import { buildCapabilityRegistry } from "../../../server/shared/relation-capability-selector.cjs";
import { evidenceValue } from "../../../server/shared/formal-relation-selector.cjs";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function requiredFile(filePath, label) {
  if (!fs.existsSync(filePath)) throw new Error(`${label} 不存在: ${filePath}`);
  return filePath;
}

function parseFrontmatter(text) {
  // Minimal frontmatter parser that handles string/list values
  const m = text.match(/^---\s*\n(.*?)\n---/s);
  if (!m) return {};
  const raw = m[1];
  const result = {};
  const lines = raw.split("\n");
  let currentKey = null;
  let inList = false;
  let listItems = [];
  for (const line of lines) {
    const kv = line.match(/^(\w[\w_-]*)\s*:\s*(.*)/);
    if (kv) {
      if (inList && listItems.length) { result[currentKey] = listItems; }
      inList = false;
      listItems = [];
      currentKey = kv[1];
      const val = kv[2].trim();
      if (!val) { inList = true; listItems = []; }
      else if (val.startsWith("[") && val.endsWith("]")) {
        const inner = val.slice(1, -1).trim();
        result[currentKey] = inner ? inner.split(",").map(s => s.trim().replace(/^["']|["']$/g, "")) : [];
      } else {
        result[currentKey] = val.replace(/^["']|["']$/g, "");
      }
    } else if (inList) {
      const item = line.match(/^\s*-\s+(.*)/);
      if (item) listItems.push(item[1].trim().replace(/^["']|["']$/g, ""));
    }
  }
  if (inList && listItems.length) result[currentKey] = listItems;

  // Parse architecture_associations from raw YAML block
  result._parsed_associations = [];
  const assocMatch = raw.match(/architecture_associations:\s*\n([\s\S]*?)(?=\n\S|\n---|$)/);
  if (assocMatch) {
    let current = {};
    for (const line of assocMatch[1].split("\n")) {
      const stripped = line.trim();
      if (!stripped) continue;
      if (stripped.startsWith("- ")) {
        if (Object.keys(current).length) result._parsed_associations.push(current);
        current = {};
        const itemVal = stripped.slice(2).trim();
        if (itemVal.includes(":")) {
          const [k, v] = itemVal.split(":", 1);
          current[k.trim()] = v.trim().replace(/^["']|["']$/g, "");
        }
        continue;
      }
      const km = line.match(/^\s+(\w[\w_-]*):\s*(.*)/);
      if (km) current[km[1]] = km[2].trim().replace(/^["']|["']$/g, "");
    }
    if (Object.keys(current).length) result._parsed_associations.push(current);
  }

  return result;
}

function walkDir(dir) {
  const results = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else results.push(full);
    }
  }
  return results;
}

function scanVaultArticles(vaultPath) {
  const articles = [];
  const roots = [
    path.join(vaultPath, "知识库", "raw", "approved"),
    path.join(vaultPath, "知识库", "raw", "precleaned"),
    path.join(vaultPath, "知识库", "wiki", "entities"),
    path.join(vaultPath, "知识库", "wiki", "articles"),
  ];
  const seen = new Set();
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const dirent of walkDir(root)) {
      if (!dirent.endsWith(".md")) continue;
      if (seen.has(dirent)) continue;
      seen.add(dirent);
      try {
        const text = fs.readFileSync(dirent, "utf8");
        const fm = parseFrontmatter(text);
        const aid = fm.article_id || "";
        if (!aid) continue;
        articles.push({
          articleId: aid,
          title: fm.title || aid,
          sourcePath: path.relative(vaultPath, dirent),
          frontmatter: fm,
          body: text,
        });
      } catch (_) { /* skip unreadable */ }
    }
  }
  return articles;
}

function loadApprovedIds(vaultPath) {
  const approved = new Set();
  const tasksPath = path.join(vaultPath, "知识库", "raw", "approved", "article-upload-tasks.json");
  if (fs.existsSync(tasksPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(tasksPath, "utf8"));
      for (const art of (data.articles || [])) {
        if (art.status === "approved") approved.add(art.articleId);
      }
    } catch (_) { /* ignore */ }
  }
  // Also check approved directory for md files
  const approvedDir = path.join(vaultPath, "知识库", "raw", "approved");
  if (fs.existsSync(approvedDir)) {
    for (const fn of fs.readdirSync(approvedDir)) {
      if (!fn.endsWith(".md")) continue;
      try {
        const text = fs.readFileSync(path.join(approvedDir, fn), "utf8");
        const fm = parseFrontmatter(text);
        if (fm.article_id) approved.add(fm.article_id);
      } catch (_) { /* ignore */ }
    }
  }
  return approved;
}

// 把 master_graph 的边适配成 formal-relation-selector.evidenceValue 期望的输入形状。
// 边的 properties 即事实载荷；顶层字段（to/from/sourceFile…）作为 relation 传入，
// 让 target_identity（别名 to）等本体证据字段可被解析——与正式消费方口径一致。
function phase5EvidenceInput(conn) {
  const properties = conn && typeof conn.properties === "object" && !Array.isArray(conn.properties)
    ? conn.properties
    : {};
  const assertion = properties.assertion && typeof properties.assertion === "object" ? properties.assertion : {};
  const evidence = properties.evidence && typeof properties.evidence === "object" ? properties.evidence : {};
  return { assertion, evidence, evidenceList: [], properties, relation: conn };
}

export function checkPhase5(paths, checkDeterminism) {
  const master = readJson(requiredFile(paths.master, "master_graph.json"));
  const connections = Array.isArray(master.connections) ? master.connections : [];
  const nodes = Array.isArray(master.nodes) ? master.nodes : [];
  const nodeIds = new Set(nodes.map(n => n.id).filter(Boolean));

  // Build article registry from vault
  const articles = scanVaultArticles(paths.vault);
  const articleIds = new Set(articles.map(a => a.articleId));
  const approvedIds = loadApprovedIds(paths.vault);

  // Build article frontmatter lookup for edge validation
  const articleMap = {};
  for (const a of articles) {
    articleMap[a.articleId] = a;
  }

  // Counters
  let ghostEdges = 0;
  let unapprovedAssociations = 0;
  let tagSymptomEdges = 0;
  let provenanceIncomplete = 0;
  const edgeTypeCounts = {};

  // PR-017 3.1-4 收编：正式边判据不再手写清单，改由本体派生（唯一事实源，规则 19 / 配5 双源病）。
  //   formalEdgeTypes        = 至少有一条 approved_only 断言政策（= 进入正式投影、证据须可追溯）
  //   approvalInheritedTypes = 含 article_association 政策（批准从源文章继承）
  //   structuredPropertyTypes= 含 structured_property 政策（证据来自结构化属性，非标签）
  //   formalPoliciesByType   = 该类型的 approved_only 政策（证据按边的 source_kind 命中，非并集）
  const registry = buildCapabilityRegistry(paths.ontology);
  const formalEdgeTypes = new Set();
  const approvalInheritedTypes = new Set();
  const structuredPropertyTypes = new Set();
  const formalPoliciesByType = new Map();
  for (const [type, entry] of registry.relations) {
    const formalPolicies = (entry.assertionPolicies || []).filter(
      (policy) => policy.workingProjection === "approved_only",
    );
    if (formalPolicies.length === 0) continue;
    formalEdgeTypes.add(type);
    formalPoliciesByType.set(type, formalPolicies);
    for (const policy of formalPolicies) {
      if (policy.sourceKind === "article_association") approvalInheritedTypes.add(type);
      if (policy.sourceKind === "structured_property") structuredPropertyTypes.add(type);
    }
  }
  const provenanceMissingFields = {};
  let policyUnresolvedEdges = 0;

  for (const conn of connections) {
    const rtype = conn.relationType || "UNKNOWN";
    edgeTypeCounts[rtype] = (edgeTypeCounts[rtype] || 0) + 1;

    // Ghost edge: source or target node doesn't exist
    if (!nodeIds.has(conn.from) || !nodeIds.has(conn.to)) {
      ghostEdges++;
      continue;
    }

    // Check formal projection edges for provenance + approval
    if (formalEdgeTypes.has(rtype)) {
      const props = conn.properties || {};

      // 批准继承：含 article_association 政策的关系（本体派生；当前 = DOCUMENTS / APPLIES_TO）
      // 必须来自已批准文章
      if (approvalInheritedTypes.has(rtype)) {
        const srcArticle = props.source_article || "";
        if (srcArticle && articleIds.has(srcArticle) && !approvedIds.has(srcArticle)) {
          unapprovedAssociations++;
        }
      }

      // 结构化属性语义：含 structured_property 政策的关系（本体派生；当前 = HAS_SYMPTOM）
      // 证据须来自结构化属性，不得由标签兜底
      if (structuredPropertyTypes.has(rtype)) {
        const srcArticle = props.source_article || "";
        const art = articleMap[srcArticle];
        if (art) {
          const symptoms = art.frontmatter.symptoms;
          const hasSymptoms = Array.isArray(symptoms) ? symptoms.length > 0
            : (typeof symptoms === "string" && symptoms.trim());
          if (!hasSymptoms) {
            tagSymptomEdges++;
          }
        }
      }

      // 证据完整性：政策按边的 source_kind 命中（与正式消费方同口径），字段清单取自该政策的
      // required_evidence（单源），解析复用同款 evidenceValue（不另造「本体字段名→边字段名」映射）。
      // 不使用政策并集——并集会过度要求（如 REFERENCES 的 team-placeholder 政策本就零证据要求）。
      const policies = formalPoliciesByType.get(rtype) || [];
      const sourceKind = typeof props.source === "string" ? props.source.trim()
        : typeof props.sourceKind === "string" ? props.sourceKind.trim() : "";
      const matched = policies.filter((policy) => policy.sourceKind === sourceKind);
      // 命中唯一 → 用之；无 source_kind 可判但该类型只有一条政策 → 用之；否则无法判定（fail-closed）
      const policy = matched.length === 1
        ? matched[0]
        : (matched.length === 0 && policies.length === 1 ? policies[0] : null);
      if (!policy) {
        policyUnresolvedEdges++;
        provenanceIncomplete++;
      } else {
        const missing = (policy.requiredEvidence || []).filter(
          (field) => evidenceValue(phase5EvidenceInput(conn), field) === undefined,
        );
        if (missing.length > 0) {
          provenanceIncomplete++;
          for (const field of missing) {
            provenanceMissingFields[field] = (provenanceMissingFields[field] || 0) + 1;
          }
        }
      }
    }
  }

  const passed = ghostEdges === 0 && unapprovedAssociations === 0 && tagSymptomEdges === 0
    && provenanceIncomplete === 0;

  return { passed, ghost_edges: ghostEdges, unapproved_associations: unapprovedAssociations,
    tag_symptom_edges: tagSymptomEdges, provenance_incomplete: provenanceIncomplete,
    provenance_missing_fields: provenanceMissingFields,
    policy_unresolved_edges: policyUnresolvedEdges,
    edge_type_counts: edgeTypeCounts, approved_article_count: approvedIds.size,
    total_article_count: articles.length,
    formal_edge_types: [...formalEdgeTypes].sort(),
    ontology_relation_count: registry.relations.size,
    projection_deterministic: "not_checked", determinism: { checked: false } };
}
