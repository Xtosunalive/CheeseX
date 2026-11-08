// @responsible: 待处理问题 handling 分型——读时派生单源（#1395 切片1）。
// 按 (relationCandidate, proposedAction.type, issueKind) 三元判定处置模式；前端禁止复制此映射（规则 8）。
// 复合异常=同源多卡（source 分组承载），单卡单 handling；将来真出现单卡双语义，
// 扩展点=本函数（升级为主+次），契约枚举增量，前端零改动。

const ADJUDICATE_ACTIONS = new Set(["relation-candidate-review", "inference-review"]);
// P3-K（2026-10-07 Master 裁决）：wild_tag 的 schema-tag-adjudicate 补入 fix——
// 消除「徽章 note/按钮跳裁定/文案需裁定」三处口径打架；分型器与跳转按钮、issueExplanation 对齐。
const FIX_ACTIONS = new Set(["entity-repair", "entity-relation-repair", "derived-graph-repair", "article-association", "article-association-reload", "schema-tag-adjudicate"]);
const OPERATE_KINDS = new Set(["pipeline_failure", "release_publication_failure"]);

function deriveIssueHandling(raw) {
  if (!raw || typeof raw !== "object") return "note";
  const actionType = raw.proposedAction && typeof raw.proposedAction === "object" ? String(raw.proposedAction.type || "") : "";
  if (raw.relationCandidate !== undefined || ADJUDICATE_ACTIONS.has(actionType)) return "adjudicate";
  if (FIX_ACTIONS.has(actionType)) return "fix";
  if (OPERATE_KINDS.has(raw.issueKind)) return "operate";
  return "note"; // standardization_warning / 无动作无候选 / 未知类型 fail-safe（不暗示动作）
}

module.exports = { deriveIssueHandling, ADJUDICATE_ACTIONS, FIX_ACTIONS, OPERATE_KINDS };
