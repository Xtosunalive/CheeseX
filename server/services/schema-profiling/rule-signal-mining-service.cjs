// Component: Rule-Signal-Mining-Service（ADR-007 波1 引擎内核 · SPEC-006 §3.3）
// @responsible: 规则信号采集（rule mining 最小版）——问题台违规模式聚类 → 规则候选信号。
//               业界对应：Rule mining / rule candidates from violation patterns
//               （MDM「monitoring tells you when the automation needs attention. Rules drift, sources change」）。
// @inputs: issues（问题台 issue 流——anomaly workbench list() 形态：{issueId, issueKind, evidence:[{ruleId,...}]}）
// @outputs: mineRuleCandidates(issues, {minCount?}) →
//           { signals: [{ key, issueKind, ruleId, count, sampleIssueIds }],
//             totalIssues, clusteredIssues, unclusteredIssues }
// @context: 2026-10-08 ADR-007 波1。输出仅是候选信号——不写 entity-readiness-rules、不自动立规；
//           立规走波 3 裁定通道（R1：源走过裁定通道，采集器不直写规则源）。
//           纯函数零 IO（可丢弃派生物，R2 同哲学）。

const DEFAULT_MIN_COUNT = 2; // 单次违规是噪音，同模式出现 ≥2 次才算信号

function mineRuleCandidates(issues, options = {}) {
  const minCount = Number.isFinite(options.minCount) && options.minCount > 0
    ? Math.floor(options.minCount)
    : DEFAULT_MIN_COUNT;
  const list = Array.isArray(issues) ? issues : [];
  const clusters = new Map(); // key -> {issueKind, ruleId, count, sampleIssueIds:Set}
  let clustered = 0;

  for (const issue of list) {
    if (!issue || typeof issue !== "object") continue;
    const issueId = typeof issue.issueId === "string" && issue.issueId ? issue.issueId : null;
    const issueKind = typeof issue.issueKind === "string" && issue.issueKind ? issue.issueKind : null;
    if (!issueKind) continue;
    const evidence = Array.isArray(issue.evidence) ? issue.evidence : [];
    const ruleIds = [...new Set(evidence
      .map((e) => e && typeof e.ruleId === "string" && e.ruleId.trim() ? e.ruleId.trim() : null)
      .filter(Boolean))];
    if (ruleIds.length === 0) {
      // 无 ruleId 的问题不参与聚类（信息不足以定位规则面）
      continue;
    }
    clustered += 1;
    for (const ruleId of ruleIds) {
      const key = `${issueKind}::${ruleId}`;
      const entry = clusters.get(key) || { issueKind, ruleId, count: 0, sampleIssueIds: new Set(), sampleTitle: null };
      entry.count += 1;
      if (issueId && entry.sampleIssueIds.size < 3) entry.sampleIssueIds.add(issueId);
      if (!entry.sampleTitle && typeof issue.title === "string" && issue.title.trim()) entry.sampleTitle = issue.title.trim();
      clusters.set(key, entry);
    }
  }

  const signals = [...clusters.values()]
    .filter((c) => c.count >= minCount)
    .map((c) => ({ key: `${c.issueKind}::${c.ruleId}`, issueKind: c.issueKind, ruleId: c.ruleId, count: c.count, sampleIssueIds: [...c.sampleIssueIds], sampleTitle: c.sampleTitle }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  return {
    signals,
    totalIssues: list.length,
    clusteredIssues: clustered,
    unclusteredIssues: list.length - clustered,
  };
}

module.exports = { mineRuleCandidates, DEFAULT_MIN_COUNT };
