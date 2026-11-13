"use strict";

// WP-170（SPEC-095 §3.2 首批）：文章关系候选生成——纯函数单点。
// 输入＝标准化后的文章正文＋实体索引（名/别名→节点）＋类白名单（继承解析产物）；
// 输出＝候选边（py master_graph 边形状同源：{source,target,type,properties{reviewStatus:"pending"}}）。
// 红线（合同 non_goals）：白名单外零生成（按构造保证，非事后过滤）；候选永带 pending 态，
// 生效只经既有 review 人工裁决（B12 同族：推测只能建议）。
// 边 id 确定性（source+target+type+生成器）——重复标准化幂等去重由调用方按 id 合并。

const CANDIDATE_RELATION = "DOCUMENTS"; // 首批关系类型（Master 裁决B落位，2026-11-13）：正文实体匹配→「文档说明」候选。MENTIONS/REFERENCES 均候选禁产（candidate_enabled=false），DOCUMENTS 唯一开放且目标域含 Entity、语义贴合
const GENERATOR = "wp170-standardize-candidates";

function candidateEdgeId(source, target, type) {
  return [GENERATOR, source, target, type].join("::");
}

// 红队P1-3：文章节点挂 py 规范形 doc-article-<slug>（extract_graph.py L1774 同构——
// slugify=小写＋非\w→连字符；py \w 含 Unicode 字母数字，JS 以 \p{L}\p{N} 镜像，禁影子裸 articleId 节点）
function canonicalArticleNodeId(articleId) {
  const slug = String(articleId).toLowerCase().replace(/[^\p{L}\p{N}_]/gu, "-");
  return `doc-article-${slug}`;
}

/**
 * @param {string} body 文章正文
 * @param {string} articleNodeId 文章节点 id（source）
 * @param {Array<{nodeId:string, names:string[]}>} entityIndex 实体索引：每实体全部可匹配名（含别名，已归一）
 * @param {string[]} allowedRelations 类白名单（resolveClassInheritance → allows_relations.relation_ids）
 * @param {object} [options] { relation: 默认 MENTIONS }
 * @returns {{edges: Array, skippedOutOfWhitelist: number}} 候选边＋白名单外计数（按构造恒 0，留证）
 */
function generateRelationCandidates(body, articleNodeId, entityIndex, allowedRelations, options = {}) {
  const relation = options.relation || CANDIDATE_RELATION;
  const whitelist = new Set(allowedRelations || []);
  const relationTargetTypes = options.relationTargetTypes || null; // {类型: [目标类]}——本体 relation_types.target_types 单源
  const targetClassByNode = options.targetClassByNode || null; // {节点id: 类id}
  const text = typeof body === "string" ? body : "";
  const edges = [];
  const seen = new Set();
  let skippedOutOfWhitelist = 0;
  let skippedOutOfTypeScope = 0; // 红队P1-2：SHACL 范围拦截留痕（目标类不在关系声明域内）
  if (!whitelist.has(relation)) {
    // 白名单不含首批关系类型＝该文章类不允许提及关系：零生成（构造保证，非过滤）
    return { edges, skippedOutOfWhitelist: 1 };
  }
  const textLower = text.toLocaleLowerCase();
  for (const entity of Array.isArray(entityIndex) ? entityIndex : []) {
    const target = entity && entity.nodeId;
    if (!target || target === articleNodeId) continue;
    // 名形匹配：原名小写＋连字符/下划线→空格形（kebab id ↔ 空格显示名，py normalizeAlias 同族口径）
    const matched = (entity.names || []).find((name) => {
      if (typeof name !== "string" || name.length < 2) return false;
      const lower = name.toLocaleLowerCase();
      return textLower.includes(lower) || textLower.includes(lower.replace(/[-_]/g, " "));
    });
    if (!matched) continue;
    // 红队P1-2：关系声明的目标类域（target_types）在场即执法——目标类不合法零生成并留痕（合同验收条款3）
    if (relationTargetTypes && Array.isArray(relationTargetTypes[relation]) && targetClassByNode) {
      const allowedTargets = relationTargetTypes[relation];
      const targetClass = targetClassByNode[target];
      if (!targetClass || !allowedTargets.includes(targetClass)) {
        skippedOutOfTypeScope += 1;
        continue;
      }
    }
    const id = candidateEdgeId(articleNodeId, target, relation);
    if (seen.has(id)) continue;
    seen.add(id);
    edges.push({
      source: articleNodeId,
      target,
      type: relation,
      properties: {
        source: GENERATOR,
        link_type: relation,
        evidence_text: matched,
        sources: [articleNodeId],
        reviewStatus: "pending",
      },
    });
  }
  return { edges, skippedOutOfWhitelist, skippedOutOfTypeScope };
}

// 合并候选进既有边集：生成器域幂等去重（properties.source+source+target+type）；
// 已有人工裁决边不复活——裁决身份与图侧/账本同源（stableEdgeId 六段派生，ADR054 D2 F3 账本主权）。
const { stableEdgeId } = require("../../shared/edge-identity.cjs");

function mergeCandidateEdges(existingEdges, decidedEdgeIds, candidateEdges) {
  const decided = new Set(decidedEdgeIds || []);
  const byKey = new Map();
  for (const edge of Array.isArray(existingEdges) ? existingEdges : []) {
    byKey.set(edgeKeyOf(edge), edge);
  }
  let added = 0;
  for (const edge of Array.isArray(candidateEdges) ? candidateEdges : []) {
    const key = edgeKeyOf(edge);
    if (decided.has(stableEdgeId(edge)) || byKey.has(key)) continue;
    byKey.set(key, edge);
    added += 1;
  }
  return { edges: [...byKey.values()], added };
}

function edgeKeyOf(edge) {
  const generator = (edge && edge.properties && edge.properties.source) || "";
  const source = edge && (edge.from || edge.source);
  const target = edge && (edge.to || edge.target);
  const type = edge && (edge.relationType || edge.type);
  return [generator, source, target, type].join("::"); // 双形态（edges/connections）身份段口径
}

module.exports = { GENERATOR, CANDIDATE_RELATION, candidateEdgeId, generateRelationCandidates, mergeCandidateEdges };

// ── 发射器（装配件）：标准化成功 → 生成候选 → 追加进 staging 图 → 触发摄取/投影（经注入回调）──
// 失败不阻断标准化主链（候选为增强面）；staging 图缺席＝基底不在（空库/管线未跑）→跳过不报错。
const DK = require("../../shared/document-keys.cjs"); // 键名单点（结构位禁手抄——document-keys 哨兵执法）
const { readStagedGraph: readStagedGraphDefault, writeStagedGraph: writeStagedGraphDefault } = require("../../shared/persistence/article-graph-staging.cjs"); // staging 读写经 persistence 层（SPEC-012 WP-J）

function createRelationCandidateEmitter({ vaultPath, dataDir, afterStaged, logger, io = {} }) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function readSubstrateWithRetry(articleId) {
    // 图族自刷新窗口（外部写触发全量重算）基底瞬时空缺——有界重试后仍缺即降级（空库常态）
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let graph = null;
      if (typeof readLiveGraphRef === "function") graph = readLiveGraphRef();
      if (graph && typeof graph === "object" && (Array.isArray(graph.edges) || Array.isArray(graph.connections))) return { graph };
      if (attempt < 2) await sleep(250);
    }
    return { graph: null };
  }
  let readLiveGraphRef = null;
  return async function emitRelationCandidates({ body, articleId }) {
    // IO 惰性解析（调用时取 io.*）：可测试性（测试可中途替换桩）且与装配期解耦。
    // 基底＝活库图（io.readLiveGraph，装配件注入 readGraphArtifactText(derivedIndexStore)）——
    // staging 是瞬态出口（boot 摄取后即被移走，graph-artifacts-import-done removed），不可作读源。
    readLiveGraphRef = io.readLiveGraph || null;
    const writeStagedGraph = io.writeStagedGraph || ((d, g) => writeStagedGraphDefault(d, g));
    const scanEntitiesIo = io.scanEntities;
    const resolveWhitelistIo = io.resolveWhitelist;
    const readDecidedEdgeIdsIo = io.readDecidedEdgeIds;
    try {
      const { graph: liveGraph } = await readSubstrateWithRetry(articleId);
      if (!liveGraph) {
        logger && logger.info && logger.info({ event: "relation-candidates-skipped", articleId, reason: "活库图缺席（图族自刷新窗口或空库，重试后仍缺）" });
        return { staged: false, reason: "活库图缺席（重试后仍缺）" };
      }
      const graph = JSON.parse(JSON.stringify(liveGraph)); // 深拷贝再改——不改活库读视图
      // 活库图双形态：raw 摄取形（nodes/edges）与 vault 落库形（nodes/connections）——按在场数组探测，
      // 候选按同形态映射回写（保字节形态一致，禁混写）
      const form = Array.isArray(graph.edges) ? "edges" : Array.isArray(graph.connections) ? "connections" : null;
      if (!form) {
        logger && logger.info && logger.info({ event: "relation-candidates-skipped", articleId, reason: "活库图无边数组（形态未识）" });
        return { staged: false, reason: "活库图形态未识" };
      }
      const whitelist = resolveWhitelistIo ? resolveWhitelistIo() : [];
      const entities = scanEntitiesIo ? scanEntitiesIo() : [];
      const entityIndex = entities.map((entity) => {
        const fm = entity.frontmatter || {};
        const nodeId = fm[DK.ENTITY.architectureNodeId] || entity.sourceKey || entity.fileName || "";
        return { nodeId, names: [fm[DK.ENTITY.title], nodeId, ...(entity.aliases || [])].filter(Boolean) };
      });
      const articleNodeId = canonicalArticleNodeId(articleId);
      // 目标类映射单事实：scanEntities 扫的是 wiki/entities＝本体 Entity 类管辖（node_types 定义）；
      // 关系目标类域（target_types）经装配件单源注入——在场即执法（P1-2）
      const targetClassByNode = Object.fromEntries(entityIndex.map((entity) => [entity.nodeId, "Entity"]));
      const generated = generateRelationCandidates(String(body || ""), articleNodeId, entityIndex, whitelist, {
        relationTargetTypes: typeof io.readRelationTargetTypes === "function" ? io.readRelationTargetTypes() : null,
        targetClassByNode,
      }).edges;
      const candidates = form === "connections"
        ? generated.map((e) => {
            const connection = { from: e.source, to: e.target, relationType: e.type, properties: e.properties };
            connection.edgeId = stableEdgeId(connection); // 落库形预置同源身份（review 路由按 conn.edgeId 严格查找）
            return connection;
          })
        : generated;
      const decidedEdgeIds = readDecidedEdgeIdsIo ? readDecidedEdgeIdsIo() : [];
      const { edges: merged, added } = mergeCandidateEdges(graph[form], decidedEdgeIds, candidates);
      if (!added) {
        logger && logger.info && logger.info({ event: "relation-candidates-noop", articleId, generated: generated.length });
        return { staged: true, added: 0 };
      }
      graph[form] = merged;
      // 文章节点缺席则补位（py 节点形状同源：labels+properties.name）——悬边会被 normalizeTopology 丢弃
      const nodeIds = new Set((graph.nodes || []).map((n) => n && n.id));
      if (!nodeIds.has(articleNodeId)) {
        graph.nodes = [...(graph.nodes || []), { id: articleNodeId, labels: ["Document"], properties: { name: articleId } }];
      }
      writeStagedGraph(dataDir, graph);
      if (typeof afterStaged === "function") afterStaged();
      logger && logger.info && logger.info({ event: "relation-candidates-staged", articleId, added });
      return { staged: true, added };
    } catch (error) {
      logger && logger.warn && logger.warn({ event: "relation-candidates-failed", articleId, error: error && error.message,
        consequence: "关系候选未生成——增强面降级，标准化主链不受影响" });
      return { staged: false, error: true };
    }
  };
}

module.exports.createRelationCandidateEmitter = createRelationCandidateEmitter;
