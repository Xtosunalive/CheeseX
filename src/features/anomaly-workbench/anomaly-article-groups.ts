/**
 * 待处理问题按文章来源聚合
 *
 * 以真实 evidence/sourcePath/articleId 形成稳定 key；
 * 禁止从标题或 nodeId 猜测物理文件。
 */
import { isAnomalyPending, type AnomalyIssue } from "./anomaly-workbench-types";

// ─── 类型 ────────────────────────────────────────────────────────────────────

export type ArticleGroup = {
  /** 稳定聚合 key（sourcePath 或 articleId 或系统诊断 issueId） */
  articleKey: string;
  /** 来源路径（可能为空，系统诊断无来源） */
  sourcePath: string;
  /** 展示标题（取第一条 issue 的标题或来源文件名） */
  displayTitle: string;
  /** 去重后的问题类型列表 */
  issueKindSummary: AnomalyIssue["issueKind"][];
  /** 待处理问题数（非 verified/blocked） */
  pendingCount: number;
  /** 总问题数 */
  totalCount: number;
  /** 是否为系统诊断（非文章级问题） */
  isSystemDiagnostic: boolean;
  /** 该组全部 issues */
  issues: AnomalyIssue[];
};

// ─── 辅助 ────────────────────────────────────────────────────────────────────

function actionRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** 判断路径是否为系统内部数据（非用户来源文档） */
function isSystemPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").trim();
  return normalized.startsWith(".ledger/") || normalized === "";
}

/** 只有全部证据指向同一来源时，才把该路径作为整组来源。 */
function extractSourcePath(issue: AnomalyIssue): string {
  const action = actionRecord(issue.proposedAction);
  const paths = [...new Set((issue.evidence || [])
    .map((item) => {
      const evidence = actionRecord(item);
      const path = evidence.path || evidence.sourcePath;
      return typeof path === "string" ? path.replace(/\\/g, "/").trim() : "";
    })
    .filter(Boolean))];
  if (paths.length === 1) return paths[0];
  const actionPath = typeof action.sourceKey === "string" ? action.sourceKey.replace(/\\/g, "/").trim() : "";
  return paths.length === 0 ? actionPath : "";
}

/** 从 issue 中提取 articleId */
function extractArticleId(issue: AnomalyIssue): string {
  const action = actionRecord(issue.proposedAction);
  return typeof action.articleId === "string" && action.articleId.trim() ? action.articleId.trim() : "";
}

// ─── 核心聚合函数 ────────────────────────────────────────────────────────────

/**
 * 将 issues 按文章来源聚合为文章组。
 *
 * 聚合规则：
 * 1. 有 Markdown sourcePath → 以 sourcePath 为 key
 * 2. 无 sourcePath 但有 articleId → 以 `article:{articleId}` 为 key
 * 3. 系统诊断（.ledger/ 路径或无来源）→ 以 `diagnostic:{issueId}` 为 key，每条独立
 */
export function groupIssuesByArticle(issues: AnomalyIssue[]): ArticleGroup[] {
  const groups = new Map<string, AnomalyIssue[]>();

  for (const issue of issues) {
    const sourcePath = extractSourcePath(issue);
    const articleId = extractArticleId(issue);
    const candidateId = issue.relationCandidate?.candidateId;

    let key: string;
    if (candidateId) {
      key = `candidate:${candidateId}`;
    } else if (sourcePath && !isSystemPath(sourcePath)) {
      key = sourcePath;
    } else if (articleId) {
      key = `article:${articleId}`;
    } else {
      // 系统诊断按 issueId 独立分组
      key = `diagnostic:${issue.issueId}`;
    }

    groups.set(key, [...(groups.get(key) || []), issue]);
  }

  return [...groups.entries()].map(([key, groupIssues]) => {
    const sourcePath = extractSourcePath(groupIssues[0]);
    const isCandidate = key.startsWith("candidate:");
    const isSystem = !isCandidate && (key.startsWith("diagnostic:") || isSystemPath(sourcePath));
    const kinds = [...new Set(groupIssues.map((i) => i.issueKind))];
    const pendingCount = groupIssues.filter((i) => isAnomalyPending(i.status)).length;
    const fileName = sourcePath ? sourcePath.split("/").pop() || sourcePath : "";
    const displayTitle = isSystem || isCandidate
      ? groupIssues[0].title
      : fileName || groupIssues[0].title;

    return {
      articleKey: key,
      sourcePath: isSystem ? "" : sourcePath,
      displayTitle,
      issueKindSummary: kinds,
      pendingCount,
      totalCount: groupIssues.length,
      isSystemDiagnostic: isSystem,
      issues: groupIssues,
    };
  });
}

/**
 * #1798：勾选保留归一——加载中/刷新瞬间 groups 为空时保留既有勾选（防止「补齐字段」
 * 等动作按钮随自动刷新消失且不恢复）；groups 就绪后按 articleKey 交集裁剪失效勾选。
 */
export function selectKeysWithinGroups(currentKeys: string[], groups: Pick<ArticleGroup, "articleKey">[]): string[] {
  const available = new Set(groups.map((group) => group.articleKey));
  if (available.size === 0) return currentKeys;
  return currentKeys.filter((key) => available.has(key));
}
