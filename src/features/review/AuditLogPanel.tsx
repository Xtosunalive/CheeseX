// AuditLogPanel — 审计日志：已审核决策记录（谁+何时+动作）
// P1 样板迁移（决策卡 §九）：骨架/密度/三态走 DataTable 基座，状态逻辑原样保留。
import { TableToolbar, TableToolbarSearch } from "@/components/table-toolbar";
import { useState, useEffect, useCallback, useMemo } from "react";
import { TERM } from "@/constants/term-const";
import { useUniqueSorted } from "@/hooks/useUniqueSorted";
import { RefreshCw, Check, X, RotateCcw, Undo2} from "lucide-react";
import { FilterSelect } from "@/components/filter-select";
import { TableSortHeader, type TableSortDirection } from "@/components/table-sort-header";
import { Tag } from "@/components/ui/tag";
import { TablePagination, useTablePagination } from "@/components/table-pagination";
import { DataTable } from "@/components/data-table/DataTable";
import type { Column } from "@/components/data-table/types";
import { fetchReviewHistory } from "./review-api";
import { AUDIT_LOG_COPY, REVIEW_COPY, auditLogMetaText } from "./review-copy";
import type { ReviewRecord } from "./review-types";

type AuditSortField = "relation" | "action" | "reviewer" | "reason" | "decidedAt";

const ACTION_ICON: Record<string, React.FC<{ className?: string }>> = {
  approved: Check,
  rejected: X,
  reopen: RotateCcw,
  reset_to_pending: Undo2,
};

// 动作正名文案收编 review-copy（WP-150）；Record<string,string> 形态保留（未登记动作回退原文）
const ACTION_LABEL: Record<string, string> = AUDIT_LOG_COPY.ACTION_LABEL;

// 动作徽章走 ui/tag 语义 tone（状态列统一批 2026-10-16；原手写色块为 D6 族漏网件）
const ACTION_TONE: Record<string, "fact" | "error" | "warn" | "neutral"> = {
  approved: "fact",
  rejected: "error",
  reopen: "warn",
  reset_to_pending: "neutral",
};

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function AuditLogPanel() {
  const [records, setRecords] = useState<ReviewRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [actions, setActions] = useState<string[]>([]);
  const [reviewers, setReviewers] = useState<string[]>([]);
  const [sortField, setSortField] = useState<AuditSortField>("decidedAt");
  const [sortDirection, setSortDirection] = useState<TableSortDirection>("desc");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchReviewHistory();
      setRecords(
        [...data.records].sort(
          (a, b) => new Date(b.decidedAt).getTime() - new Date(a.decidedAt).getTime(),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : TERM.LOAD_FAILED);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const actionOptions = useUniqueSorted(records, (r) => r.action);
  const reviewerOptions = useUniqueSorted(records, (r) => r.reviewer, Boolean);
  const visibleRecords = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return records
      .filter((record) => {
        if (actions.length > 0 && !actions.includes(record.action)) return false;
        if (reviewers.length > 0 && !reviewers.includes(record.reviewer)) return false;
        return !keyword || [record.sourceLabel, record.targetLabel, record.reviewer, record.reason, record.action].some((value) => (value ?? "").toLowerCase().includes(keyword));
      })
      .sort((left, right) => {
        const comparison = sortField === "relation"
          ? `${left.sourceLabel}\u0000${left.targetLabel}`.localeCompare(`${right.sourceLabel}\u0000${right.targetLabel}`, "zh-CN")
          : sortField === "action"
            ? left.action.localeCompare(right.action, "zh-CN")
            : sortField === "reviewer"
              ? (left.reviewer ?? "").localeCompare((right.reviewer ?? ""), "zh-CN")
              : sortField === "reason"
                ? (left.reason ?? "").localeCompare((right.reason ?? ""), "zh-CN")
                : left.decidedAt.localeCompare(right.decidedAt);
        return sortDirection === "asc" ? comparison : -comparison;
      });
  }, [actions, query, records, reviewers, sortDirection, sortField]);
  const { page, pageItems, pageSize, setPage } = useTablePagination(visibleRecords);

  const columns: Array<Column<ReviewRecord>> = [
    {
      key: "relation",
      title: <TableSortHeader label={AUDIT_LOG_COPY.COL_RELATION} active={sortField === "relation"} direction={sortDirection} ascendingLabel={AUDIT_LOG_COPY.COL_RELATION_ASC} descendingLabel={AUDIT_LOG_COPY.COL_RELATION_DESC} onChange={(direction) => { setSortField("relation"); setSortDirection(direction); }} />,
      render: (r) => <>{r.sourceLabel} → {r.targetLabel}</>,
      className: "text-text-main",
    },
    {
      key: "action",
      title: <TableSortHeader label={AUDIT_LOG_COPY.COL_ACTION} active={sortField === "action"} direction={sortDirection} ascendingLabel={AUDIT_LOG_COPY.COL_ACTION_ASC} descendingLabel={AUDIT_LOG_COPY.COL_ACTION_DESC} onChange={(direction) => { setSortField("action"); setSortDirection(direction); }} />,
      render: (r) => {
        const Icon = ACTION_ICON[r.action] ?? Check;
        return (
          <Tag tone={ACTION_TONE[r.action] ?? "neutral"}>
            <Icon className="h-3 w-3" />
            {ACTION_LABEL[r.action] ?? r.action}
          </Tag>
        );
      },
    },
    {
      key: "reviewer",
      title: <TableSortHeader label={AUDIT_LOG_COPY.COL_REVIEWER} active={sortField === "reviewer"} direction={sortDirection} ascendingLabel={AUDIT_LOG_COPY.COL_REVIEWER_ASC} descendingLabel={AUDIT_LOG_COPY.COL_REVIEWER_DESC} onChange={(direction) => { setSortField("reviewer"); setSortDirection(direction); }} />,
      render: (r) => r.reviewer,
      className: "text-text-sub",
    },
    {
      key: "reason",
      title: <TableSortHeader label={AUDIT_LOG_COPY.COL_REASON} active={sortField === "reason"} direction={sortDirection} ascendingLabel={AUDIT_LOG_COPY.COL_REASON_ASC} descendingLabel={AUDIT_LOG_COPY.COL_REASON_DESC} onChange={(direction) => { setSortField("reason"); setSortDirection(direction); }} />,
      render: (r) => r.reason || "—",
      ellipsis: true,
      className: "max-w-[160px] text-text-hint",
    },
    {
      key: "decidedAt",
      title: <TableSortHeader label={AUDIT_LOG_COPY.COL_TIME} active={sortField === "decidedAt"} direction={sortDirection} ascendingLabel={AUDIT_LOG_COPY.COL_TIME_ASC} descendingLabel={AUDIT_LOG_COPY.COL_TIME_DESC} onChange={(direction) => { setSortField("decidedAt"); setSortDirection(direction); }} />,
      render: (r) => formatTime(r.decidedAt),
      align: "right",
      className: "text-text-hint",
    },
  ];

  return (
    <div className="space-y-3">
      <TableToolbar>
        <TableToolbarSearch ariaLabel={AUDIT_LOG_COPY.SEARCH_ARIA} placeholder={AUDIT_LOG_COPY.SEARCH_PLACEHOLDER} value={query} onChange={(event) => setQuery(event.target.value)} />
        <FilterSelect ariaLabel={AUDIT_LOG_COPY.FILTER_ACTION_ARIA} title={AUDIT_LOG_COPY.FILTER_ACTION_TITLE} searchPlaceholder={AUDIT_LOG_COPY.FILTER_ACTION_SEARCH} multiple variant="filter" value={actions} onValueChange={(value) => setActions(value as string[])} emptyLabel={AUDIT_LOG_COPY.EMPTY_ALL_ACTIONS} placeholder={AUDIT_LOG_COPY.PLACEHOLDER_ACTION} options={actionOptions.map((value) => ({ value, label: ACTION_LABEL[value] || value, group: AUDIT_LOG_COPY.GROUP_ACTION }))} />
        <FilterSelect ariaLabel={AUDIT_LOG_COPY.FILTER_REVIEWER_ARIA} title={AUDIT_LOG_COPY.FILTER_REVIEWER_TITLE} searchPlaceholder={AUDIT_LOG_COPY.FILTER_REVIEWER_SEARCH} multiple variant="filter" value={reviewers} onValueChange={(value) => setReviewers(value as string[])} emptyLabel={AUDIT_LOG_COPY.EMPTY_ALL_REVIEWERS} placeholder={AUDIT_LOG_COPY.PLACEHOLDER_REVIEWER} options={reviewerOptions.map((value) => ({ value, label: value, group: AUDIT_LOG_COPY.GROUP_REVIEWER }))} />
        <button type="button" title={TERM.CLEAR_FILTER_ACTION} aria-label={AUDIT_LOG_COPY.CLEAR_ARIA} disabled={!query && actions.length === 0 && reviewers.length === 0} onClick={() => { setQuery(""); setActions([]); setReviewers([]); }} className="flex h-8 w-8 items-center justify-center rounded-md text-text-hint hover:bg-surface-hover hover:text-text-main disabled:opacity-30"><RotateCcw className="h-4 w-4" /></button>
        <button type="button" title={AUDIT_LOG_COPY.REFRESH} aria-label={AUDIT_LOG_COPY.REFRESH} onClick={load} className="flex h-8 w-8 items-center justify-center rounded-md text-text-hint hover:bg-surface-hover hover:text-text-main"><RefreshCw className="h-4 w-4" /></button>
      </TableToolbar>

      <DataTable
        ariaLabel={AUDIT_LOG_COPY.TABLE_ARIA}
        columns={columns}
        rows={pageItems}
        rowKey={(r, i) => `${r.source}→${r.target}-${r.decidedAt}-${i}`}
        loading={loading}
        error={error}
        onRetry={load}
        empty={records.length === 0 ? { title: AUDIT_LOG_COPY.EMPTY_EMPTY } : { title: REVIEW_COPY.EMPTY_NO_MATCH, description: AUDIT_LOG_COPY.EMPTY_NO_MATCH_HINT }}
        meta={<span className="tabular-nums text-kg-xs text-text-hint">{auditLogMetaText(visibleRecords.length, records.length)}</span>}
        pagination={<TablePagination ariaLabel={AUDIT_LOG_COPY.PAGINATION_ARIA} page={page} pageSize={pageSize} total={visibleRecords.length} loading={loading} onPageChange={setPage} />}
        minWidth={820}
      />
    </div>
  );
}
