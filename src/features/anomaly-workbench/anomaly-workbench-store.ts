import { create } from "zustand";
import { fetchAnomalies, performAnomalyOperation, runAnomalyReconcile } from "./anomaly-workbench-api";
import { ANOMALY_REQUEST_COPY, ANOMALY_STORE_COPY, anomalyRefreshSummary, anomalyTargetSummary } from "./anomaly-workbench-copy";
import type { AnomalyIssue, AnomalyOperation, AnomalyViewStatus } from "./anomaly-workbench-types";
import { groupIssuesByArticle } from "./anomaly-article-groups";
import { matchAnomalyHandoff, parseAnomalyHandoff } from "@/lib/domain/anomaly-handoff";
import { readNavLocation } from "@/lib/navigation";

type AnomalyWorkbenchState = {
  issues: AnomalyIssue[];
  selectedIssueId: string | null;
  /**
   * WP-146 件2：文章组勾选集——行选与组勾选两视图的单一状态源。
   * 行选（select）自动并入所属文章组键；组内行全亮/勾选框/批量操作条均由本集合派生，
   * 不再在视图层维护第二份勾选状态。键取值与 groupIssuesByArticle 同源（canonical 组键）。
   */
  selectedArticleKeys: string[];
  status: AnomalyViewStatus;
  error: string | null;
  /** #1800：最近一次 operate 的结构化错误原样保留（ApiError，含 errorCode/details）——抽屉按错误码消费阻断明细 */
  operationApiError: unknown;
  refreshing: boolean;
  lastCheckedAt: string | null;
  refreshSummary: string | null;
  workingRevisions: Record<string, string | null | undefined>;
  load: (options?: { announce?: boolean; preferActionable?: boolean }) => Promise<void>;
  select: (issueId: string) => void;
  setArticleKeys: (update: string[] | ((current: string[]) => string[])) => void;
  operate: (operation: AnomalyOperation, payload?: Record<string, unknown>) => Promise<boolean>;
  reconcileAndLoad: () => Promise<void>;
};

function unresolvedTargets(issue: AnomalyIssue): string[] {
  const action = issue.proposedAction;
  if (!action || typeof action !== "object" || Array.isArray(action)) return [];
  const value = (action as Record<string, unknown>).unresolvedTargets;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function targetChanges(previous: AnomalyIssue[], next: AnomalyIssue[]) {
  const previousTargets = new Set(previous.flatMap(unresolvedTargets));
  const nextTargets = new Set(next.flatMap(unresolvedTargets));
  return {
    resolved: [...previousTargets].filter((target) => !nextTargets.has(target)),
    added: [...nextTargets].filter((target) => !previousTargets.has(target)),
    remaining: nextTargets.size,
  };
}

function preferredIssueId(issues: AnomalyIssue[]): string | null {
  const fieldIssue = issues.find((issue) => {
    if (issue.issueKind !== "missing_field") return false;
    const action = issue.proposedAction;
    return Boolean(action && typeof action === "object" && !Array.isArray(action) && typeof (action as Record<string, unknown>).field === "string");
  });
  return fieldIssue?.issueId || issues[0]?.issueId || null;
}

export const useAnomalyWorkbenchStore = create<AnomalyWorkbenchState>((set, get) => ({
  issues: [], selectedIssueId: null, selectedArticleKeys: [], status: "idle", error: null, operationApiError: null, refreshing: false, lastCheckedAt: null, refreshSummary: null, workingRevisions: {},
  load: async (options = {}) => {
    const previousIssues = get().issues;
    const previousIssueIds = new Set(previousIssues.map((issue) => issue.issueId));
    if (get().issues.length === 0) set({ status: "loading", error: null });
    else set({ error: null, refreshing: options.announce === true });
    try {
      const result = await fetchAnomalies();
      const workingRevisions = (result as typeof result & { workingRevisions?: Record<string, string | null | undefined> }).workingRevisions ?? {};
      const handoff = parseAnomalyHandoff(readNavLocation().hash);
      const handoffIssue = handoff ? matchAnomalyHandoff(result.issues, handoff) : null;
      if (handoff && !handoffIssue) {
        set({
          issues: [],
          selectedIssueId: null,
          status: "error",
          error: ANOMALY_STORE_COPY.HANDOFF_MISS_ERROR,
          refreshing: false,
          lastCheckedAt: result.generatedAt,
          refreshSummary: null,
          workingRevisions,
        });
        return;
      }
      const selectedIssueId = get().selectedIssueId;
      const preservedSelection = handoffIssue?.issueId || (options.preferActionable
        ? preferredIssueId(result.issues)
        : result.issues.some((issue) => issue.issueId === selectedIssueId) ? selectedIssueId : preferredIssueId(result.issues));
      const nextIssueIds = new Set(result.issues.map((issue) => issue.issueId));
      const added = result.issues.filter((issue) => !previousIssueIds.has(issue.issueId)).length;
      const removed = [...previousIssueIds].filter((issueId) => !nextIssueIds.has(issueId)).length;
      const targets = targetChanges(previousIssues, result.issues);
      const targetSummary = anomalyTargetSummary(targets.resolved, targets.added, targets.remaining);
      const refreshSummary = options.announce
        ? anomalyRefreshSummary(targetSummary, added, removed, result.total)
        : get().refreshSummary;
      set({ issues: result.issues, status: result.issues.length ? "success" : "empty", selectedIssueId: preservedSelection, refreshing: false, lastCheckedAt: result.generatedAt, refreshSummary, workingRevisions });
    } catch (error) { set({ status: "error", refreshing: false, error: error instanceof Error ? error.message : ANOMALY_REQUEST_COPY.LIST_FETCH_FAILED }); }
  },
  select: (issueId) => {
    // WP-146 件2：行选→组勾选亮起（显式联动）——组键经 groupIssuesByArticle 同源提取，
    // 勾选集=批量动作粒度（Toolbar selectIssuesForKeys 对账），多组累计、不清空既有勾选。
    const groupKey = groupIssuesByArticle(get().issues).find((group) => group.issues.some((item) => item.issueId === issueId))?.articleKey;
    set((state) => ({
      selectedIssueId: issueId,
      selectedArticleKeys: groupKey && !state.selectedArticleKeys.includes(groupKey)
        ? [...state.selectedArticleKeys, groupKey]
        : state.selectedArticleKeys,
    }));
  },
  setArticleKeys: (update) => set((state) => {
    const next = typeof update === "function" ? update(state.selectedArticleKeys) : update;
    return next === state.selectedArticleKeys ? state : { selectedArticleKeys: next };
  }),
  operate: async (operation, payload = {}) => {
    const issueId = get().selectedIssueId;
    if (!issueId) return false;
    set({ status: "loading", error: null });
    try {
      const updated = await performAnomalyOperation(issueId, operation, payload);
      set((state) => ({ issues: state.issues.map((issue) => issue.issueId === updated.issueId ? updated : issue), status: "success", operationApiError: null }));
      if (operation === "confirm") await get().load({ announce: true });
      return true;
    } catch (error) {
      // #1800：原样保留 ApiError（errorCode/details），抽屉按 ENTITY_COMPLIANCE_BLOCKED 消费阻断明细
      set({ status: "error", error: error instanceof Error ? error.message : ANOMALY_REQUEST_COPY.OPERATION_FAILED, operationApiError: error });
      return false;
    }
  },
  reconcileAndLoad: async () => {
    // N3/#853：显式"刷新并重检"——先 reconcile（实时不再检出→自动销账）再拉列表。
    set({ refreshing: true, error: null });
    try {
      await runAnomalyReconcile();
      await get().load({ announce: true });
    } catch (error) {
      set({ status: "error", error: error instanceof Error ? error.message : ANOMALY_REQUEST_COPY.RECONCILE_RELOAD_FAILED });
    } finally {
      set({ refreshing: false });
    }
  },
}));
