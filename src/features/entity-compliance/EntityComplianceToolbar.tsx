import { useEntityComplianceStore } from "./entity-compliance-store";
import { TableToolbar, TableToolbarSearch } from "@/components/table-toolbar";
import type { ComplianceFilter } from "./entity-compliance-types";
import { Loader2, RefreshCw, RotateCcw} from "lucide-react";
import { FilterSelect } from "@/components/filter-select";
import { TERM } from "@/constants/term-const";
import { ENTITY_COMPLIANCE_COPY, EC_TOOLBAR_COPY } from "./entity-compliance-copy";

const FILTERS: { value: ComplianceFilter; label: string }[] = [
  { value: "all", label: EC_TOOLBAR_COPY.FILTER_ALL },
  { value: "blocker", label: TERM.BLOCKER },
  { value: "warning", label: TERM.WARNING },
  { value: "info", label: TERM.INFO },
  { value: "healthy", label: ENTITY_COMPLIANCE_COPY.PASSED },
];

export function EntityComplianceToolbar() {
  const filter = useEntityComplianceStore((s) => s.filter);
  const query = useEntityComplianceStore((s) => s.query);
  const setFilter = useEntityComplianceStore((s) => s.setFilter);
  const setQuery = useEntityComplianceStore((s) => s.setQuery);
  const clearFilters = useEntityComplianceStore((s) => s.clearFilters);
  const refreshing = useEntityComplianceStore((s) => s.refreshing);
  const refreshAll = useEntityComplianceStore((s) => s.refreshAll);
  const hasFilters = filter !== "all" || query.length > 0;

  return (
    <TableToolbar testId="entity-compliance-toolbar">
      <TableToolbarSearch ariaLabel={EC_TOOLBAR_COPY.SEARCH_ARIA} placeholder={EC_TOOLBAR_COPY.SEARCH_PLACEHOLDER} value={query} onChange={(event) => setQuery(event.target.value)} />
      <FilterSelect ariaLabel={EC_TOOLBAR_COPY.FILTER_ARIA} title={EC_TOOLBAR_COPY.FILTER_TITLE} searchPlaceholder={EC_TOOLBAR_COPY.FILTER_SEARCH_PLACEHOLDER} variant="filter" value={filter === "all" ? "" : filter} onValueChange={(value) => setFilter(((value as string) || "all") as ComplianceFilter)} emptyTriggerLabel={EC_TOOLBAR_COPY.FILTER_TRIGGER} placeholder={EC_TOOLBAR_COPY.FILTER_TRIGGER} options={FILTERS.map((option) => ({ value: option.value === "all" ? "" : option.value, label: option.label, group: option.value === "all" ? EC_TOOLBAR_COPY.OPTION_GROUP_SCOPE : EC_TOOLBAR_COPY.OPTION_GROUP_SEVERITY }))} />
      <button type="button" title={EC_TOOLBAR_COPY.REFRESH_TITLE} aria-label={EC_TOOLBAR_COPY.REFRESH_ARIA} disabled={refreshing} onClick={() => void refreshAll({ announce: true })} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs text-text-sub hover:bg-surface-hover hover:text-text-main disabled:opacity-40">
        {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        {refreshing ? EC_TOOLBAR_COPY.REFRESHING : EC_TOOLBAR_COPY.REFRESH}
      </button>
      <button type="button" title={TERM.CLEAR_FILTER_ACTION} aria-label={EC_TOOLBAR_COPY.CLEAR_FILTER_ARIA} disabled={!hasFilters} onClick={clearFilters} className="flex h-8 w-8 items-center justify-center rounded-md text-text-hint hover:bg-surface-hover hover:text-text-main disabled:opacity-30">
        <RotateCcw className="h-4 w-4" />
      </button>
    </TableToolbar>
  );
}
