// Component: Gap-Engine — pure computation of governance gaps from topology data.
// @responsible: 从拓扑与投影数据计算悬空关系、缺失属性和治理缺口。
// @inputs: master_graph 拓扑、SA 组件与 Vault 路径信息
// @outputs: GapItem 治理缺口列表
// @context: Canvas
// Outputs GapItem with the canonical Vault-relative filePath used by the shared opener.

// KNOWN_LABELS＝「图已知节点类型」（5 键：含 BusinessDomain/Subdomain/Team），与
// contracts/graph-admission.json 的 entityLabels（2 键「可渲染实体」集，WP-030/PR-145 单源）
// 是两个语义不同的集合——本集合用于缺口计算时识别全部已知节点类型，不引用也不合并
// entityLabels（WP-030 合同 non_goals：不盲合）。
// 下文 cross_domain_ref 的 isEntity 判定＝2 键实体判定语义，吃契约单源（红队复核发现的
// 漏点，随批收敛）。
var GRAPH_ADMISSION = { entityLabels: ["ArchitectureComponent", "Module"] };
try { GRAPH_ADMISSION = require("../../../contracts/graph-admission.json"); } catch (_e) { /* 契约缺失回退内置缺省 */ }
const KNOWN_LABELS = new Set([
  "ArchitectureComponent", "Module",
  "BusinessDomain", "Subdomain",
  "Team",
]);

// 原则6 单源：low_confidence 缺口的置信度阈值唯一事实源。
// gap 条目的 threshold 字段由此下发，前端不得再硬编码 0.6；detail 串亦由本常量插值，
// 消除阈值「判定处」与「文案处」两份裸字面量。
const LOW_CONFIDENCE_THRESHOLD = 0.6;

// WP-031/PR-146：detail 人话文案唯一声明处——本引擎只插值不造句（学 field-rule-declarations）
const { GAP_DETAIL, plainLabels } = require("./gap-detail-declarations.cjs");

/**
 * @param {Set<string>} validNodeIds
 * @param {Array} keptEdges
 * @param {Array} allRawEdges
 * @param {Set<string>} allNodeIds
 * @param {Object<string,{id:string,label:string,category:string,labels:string[],filePath?:string}>} nodesById
 * @param {Set<string>} resolvedGapIds
 * @returns {{ gaps: Array, warnings: Array }}
 */
function computeGaps(validNodeIds, keptEdges, allRawEdges, allNodeIds, nodesById, resolvedGapIds) {
  var gaps = [];
  var warnings = [];
  var seenGapKeys = {};
  var seenWarningKeys = {};

  resolvedGapIds = resolvedGapIds || new Set();
  // Degree map
  var degreeMap = {};
  var _i;
  var _nids = Array.from(validNodeIds);
  for (_i = 0; _i < _nids.length; _i++) degreeMap[_nids[_i]] = 0;
  for (_i = 0; _i < keptEdges.length; _i++) {
    var ke = keptEdges[_i];
    if (degreeMap[ke.source] !== undefined) degreeMap[ke.source]++;
    if (degreeMap[ke.target] !== undefined) degreeMap[ke.target]++;
  }

  // Per-entity gaps
  for (_i = 0; _i < _nids.length; _i++) {
    var nodeId = _nids[_i];
    var node = nodesById[nodeId];
    var label = node ? (node.label || nodeId) : nodeId;
    var filePath = node ? (node.filePath || null) : null;

    // isolated_entity
    if (degreeMap[nodeId] === 0) {
      seenGapKeys["isolated_entity:" + nodeId] = true;
      var iso = {
        id: "gap:isolated_entity:" + nodeId,
        type: "isolated_entity",
        severity: "warning",
        targetId: nodeId,
        targetLabel: label,
        detail: GAP_DETAIL.isolated_entity({ label: label }),
      };
      if (filePath) iso.filePath = filePath;
      gaps.push(iso);
    }

    // missing_document_ref
    var hasRef = false;
    for (var j = 0; j < allRawEdges.length; j++) {
      var re = allRawEdges[j];
      var reSource = re.source || re.from;
      var reType = re.type || re.relationType;
      if (reSource === nodeId && reType === "REFERENCES") { hasRef = true; break; }
    }
    if (!hasRef) {
      seenGapKeys["missing_document_ref:" + nodeId] = true;
      var mdr = {
        id: "gap:missing_document_ref:" + nodeId,
        type: "missing_document_ref",
        severity: "warning",
        targetId: nodeId,
        targetLabel: label,
        detail: GAP_DETAIL.missing_document_ref({ label: label }),
      };
      if (filePath) mdr.filePath = filePath;
      gaps.push(mdr);
    }
  }

  // low_confidence
  for (_i = 0; _i < keptEdges.length; _i++) {
    var le = keptEdges[_i];
    var confidence = (le.properties && typeof le.properties.confidence === "number")
      ? le.properties.confidence : 1;
    if (confidence < LOW_CONFIDENCE_THRESHOLD) {
      var lk = "low_confidence:" + le.source + "->" + le.target;
      if (!seenGapKeys[lk]) {
        seenGapKeys[lk] = true;
        var lSrcLabel = (nodesById[le.source] && nodesById[le.source].label) || le.source;
        var lTgtLabel = (nodesById[le.target] && nodesById[le.target].label) || le.target;
        var lcGap = {
          id: "gap:low_confidence:" + le.source + "->" + le.target,
          type: "low_confidence",
          severity: "warning",
          targetId: le.target,
          targetLabel: lTgtLabel,
          detail: GAP_DETAIL.low_confidence({ fromLabel: lSrcLabel, toLabel: lTgtLabel, confidence: confidence, threshold: LOW_CONFIDENCE_THRESHOLD }),
          threshold: LOW_CONFIDENCE_THRESHOLD,
          edgeInfo: { from: le.source, to: le.target, type: le.type || "?" },
        };
        // WP-031 红队项③：豁免归属=from 源实体文档——filePath 补齐（否则 UI 豁免引导无从定位）
        var lcSrcPath = (nodesById[le.source] && nodesById[le.source].filePath) || null;
        if (lcSrcPath) lcGap.filePath = lcSrcPath;
        gaps.push(lcGap);
      }
    }
  }

  // Edge-based gaps
  for (_i = 0; _i < allRawEdges.length; _i++) {
    var ae = allRawEdges[_i];
    var aSource = ae.source || ae.from;
    var aTarget = ae.target || ae.to;
    if (!validNodeIds.has(aSource)) continue;

    var aSrcLabel = (nodesById[aSource] && nodesById[aSource].label) || aSource;
    var aTgtLabel = (nodesById[aTarget] && nodesById[aTarget].label) || aTarget;
    var aEdgeType = ae.type || ae.relationType || "?";
    var aFilePath = (nodesById[aSource] && nodesById[aSource].filePath) || null;

    // dangling_dependency (blocker — breaks pipeline)
    if (!allNodeIds.has(aTarget)) {
      var dk = "dangling_dependency:" + aSource + "->" + aTarget;
      if (!seenGapKeys[dk]) {
        seenGapKeys[dk] = true;
        var dd = {
          id: "gap:dangling_dependency:" + aSource + "->" + aTarget,
          type: "dangling_dependency",
          severity: "blocker",
          targetId: aTarget,
          targetLabel: aTgtLabel,
          detail: GAP_DETAIL.dangling_dependency({ fromLabel: aSrcLabel, toLabel: aTgtLabel }),
          edgeInfo: { from: aSource, to: aTarget, type: aEdgeType },
        };
        if (aFilePath) dd.filePath = aFilePath;
        gaps.push(dd);
      }
      continue;
    }

    // cross_domain_ref
    var targetNode = nodesById[aTarget];
    var targetLabels = (targetNode && targetNode.labels) || [];
    var isEntity = GRAPH_ADMISSION.entityLabels.some(function (l) { return targetLabels.indexOf(l) >= 0; });
    if (!isEntity) {
      var ck = "cross_domain_ref:" + aSource + "->" + aTarget;
      if (!seenGapKeys[ck]) {
        seenGapKeys[ck] = true;
        var cd = {
          id: "gap:cross_domain_ref:" + aSource + "->" + aTarget,
          type: "cross_domain_ref",
          severity: "warning",
          targetId: aTarget,
          targetLabel: aTgtLabel,
          detail: GAP_DETAIL.cross_domain_ref({ fromLabel: aSrcLabel, toLabel: aTgtLabel, targetKind: plainLabels(targetLabels) }),
          edgeInfo: { from: aSource, to: aTarget, type: aEdgeType },
        };
        if (aFilePath) cd.filePath = aFilePath;
        gaps.push(cd);
      }
    }

    // suspicious_edge
    var hasKnownLabel = false;
    for (var k = 0; k < targetLabels.length; k++) {
      if (KNOWN_LABELS.has(targetLabels[k])) { hasKnownLabel = true; break; }
    }
    if (!hasKnownLabel) {
      var sk = "suspicious_edge:" + aSource + "->" + aTarget;
      if (!seenWarningKeys[sk]) {
        seenWarningKeys[sk] = true;
        warnings.push({
          id: "warn:suspicious_edge:" + aSource + "->" + aTarget,
          type: "suspicious_edge",
          targetId: aTarget,
          detail: '实体 "' + aSrcLabel + '" 出边指向节点 "' + aTgtLabel + '"，其 labels 不含任何已知合法身份标签（labels: ' + (targetLabels.join(", ") || "无") + '）',
          edgeInfo: { from: aSource, to: aTarget, type: aEdgeType },
        });
      }
    }
  }

  // WP-031 红队项②：豁免规则含未识别类型 → warnings 提示（宽容读不炸抽取，但用户写错值
  // 必须可发现——否则「以为豁免了实际没生效」无从区分）
  var GAP_TYPES_KNOWN = ["dangling_dependency", "isolated_entity", "low_confidence", "missing_document_ref", "cross_domain_ref"];
  var warnedUnknownRule = {};
  for (var _nid in nodesById) {
    var _rules = (nodesById[_nid] && Array.isArray(nodesById[_nid].exemptRules)) ? nodesById[_nid].exemptRules : [];
    for (var _ri = 0; _ri < _rules.length; _ri++) {
      if (GAP_TYPES_KNOWN.indexOf(_rules[_ri]) < 0 && !warnedUnknownRule[_nid + ":" + _rules[_ri]]) {
        warnedUnknownRule[_nid + ":" + _rules[_ri]] = true;
        var _wn = nodesById[_nid];
        warnings.push({
          id: "warn:unknown_exempt_rule:" + _nid + ":" + _rules[_ri],
          type: "unknown_exempt_rule",
          targetId: _nid,
          detail: '实体「' + ((_wn && _wn.label) || _nid) + '」的豁免规则包含未识别的缺口类型「' + _rules[_ri] + '」——合法类型：' + GAP_TYPES_KNOWN.join("、"),
        });
      }
    }
  }

  // Filter resolved（单条豁免，gapId 粒度）∪ exempt_rules（文档级批量豁免，类型×源实体文档粒度）
  // —— WP-031「同管道双粒度豁免」：同一条过滤管道、同一展示口径（豁免不进 gaps 清单），
  // 只是匹配粒度不同；豁免命中不静默——进 exempted 追溯清单（上层透出）。
  // 豁免归属：边类缺口（有 edgeInfo）＝from 端源实体文档；实体类缺口＝targetId 自身文档。
  var filteredGaps = [];
  var exempted = [];
  for (_i = 0; _i < gaps.length; _i++) {
    var g = gaps[_i];
    if (resolvedGapIds.has(g.id)) continue;
    var srcNode = g.edgeInfo ? g.edgeInfo.from : g.targetId;
    var srcInfo = nodesById[srcNode];
    var rules = (srcInfo && Array.isArray(srcInfo.exemptRules)) ? srcInfo.exemptRules : [];
    if (rules.indexOf(g.type) >= 0) {
      exempted.push({
        id: g.id,
        type: g.type,
        targetId: g.targetId,
        targetLabel: g.targetLabel,
        exemptedBy: srcNode,
      });
      continue;
    }
    filteredGaps.push(g);
  }

  return { gaps: filteredGaps, warnings: warnings, exempted: exempted };
}

module.exports = { computeGaps, KNOWN_LABELS, LOW_CONFIDENCE_THRESHOLD };
