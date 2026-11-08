import { useMemo, useState } from "react";
import { TableToolbar, TableToolbarSearch } from "@/components/table-toolbar";
import { RotateCcw} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterSelect } from "@/components/filter-select";
import type { TableSortDirection } from "@/components/table-sort-header";
import { TablePagination, useTablePagination } from "@/components/table-pagination";
import { TERM } from "@/constants/term-const";
import { type PrecleanedArticleItem } from "@/features/article-workflow/article-workflow-types";
import { STANDARDIZATION_STATUS_DISPLAY } from "@/lib/domain/StatusDisplay";
import { useArticleWorkflowStore } from "@/features/article-workflow/article-workflow-store";
import type { ArticleWorkflowTask } from "@/features/article-workflow/article-workflow-types";
import { ArticleWorkflowSummary } from "./ArticleWorkflowSummary";
import { ArticleApprovalDialog } from "./ArticleApprovalDialog";
import { ArticleRetireDialog } from "./ArticleRetireDialog";
import { PrecleanedTable } from "./PrecleanedTable";
import { ARTICLE_ADMISSION_COPY, articleDraftCountText } from "../article-workflow-copy";

type Props = {
  items: PrecleanedArticleItem[];
  loading: boolean;
  onOpen: (id: string) => void;
};

export type ArticleSortField = "title" | "productModule" | "typeVersion" | "status" | "updatedAt";

const STATUS_SORT_RANK: Record<PrecleanedArticleItem["standardizationStatus"], number> = {
  pending_standardization: 0,
  blocked: 1,
  standardized: 2,
};

export function ArticleAdmissionWorkspace(props: Props & { uploads?: ArticleWorkflowTask[] }) {
  const [query, setQuery] = useState("");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [modulesFilter, setModulesFilter] = useState<string[]>([]);
  const [sortField, setSortField] = useState<ArticleSortField>("updatedAt");
  const [retireTarget, setRetireTarget] = useState<PrecleanedArticleItem | null>(null);
  const [approveTarget, setApproveTarget] = useState<PrecleanedArticleItem | null>(null);
  // 标准化动作迁入（2026-10-15）：草稿路径从上传任务反查（基名匹配）——行内按钮按状态出现
  const runSkillByPath = useArticleWorkflowStore((st) => st.runStandardizationSkillByPath);
  const skillOutcomeMap = useArticleWorkflowStore((st) => st.skillOutcomes);
  const skillRunningIds = useArticleWorkflowStore((st) => st.skillRunningIds);
  const draftPathFor = (item: PrecleanedArticleItem) => {
    const base = item.fileName;
    return (props.uploads || []).find((t) => (t.draftPath || "").endsWith("/" + base) || (t.draftPath || "").endsWith(base))?.draftPath || null;
  };
  const standardizeItem = (item: PrecleanedArticleItem) => {
    const draftPath = draftPathFor(item);
    if (draftPath) void runSkillByPath(draftPath, item.sourcePath); // key=sourcePath（结果卡消费侧同键）
  };
  const [sortDirection, setSortDirection] = useState<TableSortDirection>("desc");
  const modules = useMemo(() => [...new Set(props.items.map((item) => item.module).filter(Boolean))].sort(), [props.items]);
  const filteredItems = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return props.items.filter((item) => {
      if (statuses.length > 0 && !statuses.includes(item.standardizationStatus)) return false;
      if (modulesFilter.length > 0 && !modulesFilter.includes(item.module)) return false;
      if (!keyword) return true;
      return [item.title, item.fileName, item.sourcePath, item.product, item.module, item.articleType, item.version].some((value) => value.toLowerCase().includes(keyword));
    });
  }, [modulesFilter, props.items, query, statuses]);
  const sortedItems = useMemo(() => [...filteredItems].sort((left, right) => {
    const comparison = sortField === "title"
      ? left.title.localeCompare(right.title, "zh-CN")
      : sortField === "productModule"
        ? [left.product, left.module].join("\u0000").localeCompare([right.product, right.module].join("\u0000"), "zh-CN")
        : sortField === "typeVersion"
          ? [left.articleType, left.version].join("\u0000").localeCompare([right.articleType, right.version].join("\u0000"), "zh-CN")
          : sortField === "status"
            ? STATUS_SORT_RANK[left.standardizationStatus] - STATUS_SORT_RANK[right.standardizationStatus]
            : left.updatedAt.localeCompare(right.updatedAt);
    return sortDirection === "asc" ? comparison : -comparison;
  }), [filteredItems, sortDirection, sortField]);
  const { page, pageItems, pageSize, setPage } = useTablePagination(sortedItems);

  const filtered = query.trim() || statuses.length > 0 || modulesFilter.length > 0;
  const statusOptions = Object.entries(STANDARDIZATION_STATUS_DISPLAY).map(([value, display]) => ({ value, label: display.label, group: TERM.STANDARDIZATION_VALIDATION }));

  function clearFilters() {
    setQuery("");
    setStatuses([]);
    setModulesFilter([]);
  }

  return (
    <div>
      <ArticleWorkflowSummary items={props.items} />
      {/* 工具行（全局统一 UX，保持现状）及以下内容维持卡片内边距；卡片头全出血 */}
      <div className="space-y-3 p-3 md:p-4">
      <TableToolbar>
        <TableToolbarSearch ariaLabel={ARTICLE_ADMISSION_COPY.SEARCH_ARIA} placeholder={ARTICLE_ADMISSION_COPY.SEARCH_PLACEHOLDER} value={query} onChange={(event) => setQuery(event.target.value)} />
        <FilterSelect ariaLabel={ARTICLE_ADMISSION_COPY.STATUS_FILTER_ARIA} title={ARTICLE_ADMISSION_COPY.STATUS_FILTER_TITLE} searchPlaceholder={ARTICLE_ADMISSION_COPY.STATUS_FILTER_ARIA} multiple variant="filter" value={statuses} onValueChange={(value) => setStatuses(value as string[])} emptyLabel={ARTICLE_ADMISSION_COPY.STATUS_FILTER_EMPTY} placeholder={ARTICLE_ADMISSION_COPY.STATUS_FILTER_PLACEHOLDER} options={statusOptions} />
        <FilterSelect ariaLabel={ARTICLE_ADMISSION_COPY.MODULE_FILTER_ARIA} title={ARTICLE_ADMISSION_COPY.MODULE_FILTER_TITLE} searchPlaceholder={ARTICLE_ADMISSION_COPY.MODULE_FILTER_ARIA} multiple variant="filter" value={modulesFilter} onValueChange={(value) => setModulesFilter(value as string[])} emptyLabel={ARTICLE_ADMISSION_COPY.MODULE_FILTER_EMPTY} placeholder={ARTICLE_ADMISSION_COPY.MODULE_FILTER_PLACEHOLDER} options={modules.map((value) => ({ value, label: value, group: ARTICLE_ADMISSION_COPY.MODULE_FILTER_GROUP }))} />
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-text-hint" title={TERM.CLEAR_FILTER_ACTION} aria-label={TERM.CLEAR_FILTER_ACTION} disabled={!filtered} onClick={clearFilters}><RotateCcw className="h-4 w-4" /></Button>
      </TableToolbar>
      <div className="flex items-center justify-between px-1 text-kg-xs text-text-hint"><span>{articleDraftCountText(sortedItems.length, props.items.length)}</span></div>
      <PrecleanedTable items={pageItems} loading={props.loading} sortField={sortField} sortDirection={sortDirection} emptyTitle={props.items.length === 0 ? "" : ARTICLE_ADMISSION_COPY.EMPTY_NO_RESULT_TITLE} emptyDescription={props.items.length === 0 ? "" : ARTICLE_ADMISSION_COPY.EMPTY_NO_RESULT_DESCRIPTION} onSortChange={(field, direction) => { setSortField(field); setSortDirection(direction); }} onOpen={props.onOpen} onRetire={setRetireTarget} onApprove={setApproveTarget} onStandardize={standardizeItem} standardizingKeys={skillRunningIds} skillOutcomes={skillOutcomeMap} />
      <TablePagination ariaLabel={ARTICLE_ADMISSION_COPY.PAGINATION_ARIA} page={page} pageSize={pageSize} total={sortedItems.length} loading={props.loading} onPageChange={setPage} />
      <ArticleApprovalDialog open={approveTarget !== null} articleId={approveTarget?.id ?? null} title={approveTarget?.title ?? ""} onClose={() => setApproveTarget(null)} />
      <ArticleRetireDialog open={retireTarget !== null} basename={retireTarget?.fileName ?? null} title={retireTarget?.title ?? ""} onClose={() => setRetireTarget(null)} onRetired={() => { setRetireTarget(null); void useArticleWorkflowStore.getState().reload(true); }} />
      </div>
    </div>
  );
}
