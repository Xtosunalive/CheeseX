import { TableToolbar } from "@/components/table-toolbar";
import { useEffect, useMemo } from "react";
import { RotateCcw } from "lucide-react";
import { DocumentResultCard, FilterChipBar, DocumentSearchBar } from "./components";
import { useDocumentInventoryStore } from "./document-inventory-store";
import type { DocumentSearchParams } from "./document-inventory-types";
import { getNavQueryParam } from "@/lib/navigation";
import { PageContainer } from "@/components/page-container";
import { TERM } from "@/constants/term-const";
import { Statistic } from "@/components/statistic";
import { isNoCurrentReleaseText } from "@/lib/api";
import { DOCUMENT_INVENTORY_VIEW_COPY, documentCandidateTotalText, documentPendingExtractionText } from "./document-inventory-copy";

export function DocumentInventoryView() {
  const {
    status, error, result, candidateResult, filters, expandedCards,
    initialLoad, loadNode, query, clearAllFilters, clearFilter, toggleCard,
  } = useDocumentInventoryStore();
  const nodeId = useMemo(() => getNavQueryParam("nodeId"), []);
  // PR-151：无正式 Release 时 0 计数原因可见——不再裸 0（用户实录：清单页只显 0，「已标准化未发布」的
  // 中间态被吞掉）。仍不进错误横幅（Master 2026-10-29「空态即结构」裁定不变），只在主视觉说明原因。
  // WP-070：零发布态由服务端 200＋availability（kind=no-formal-release）表达——卡片副文案取契约指引，
  // 不再挂错误路径内联（红队 2026-11-02 第四文案源收编）
  const noReleaseIndex = result?.availability?.kinds.indexOf("no-formal-release") ?? -1;
  const noReleaseHint = noReleaseIndex >= 0 ? result?.availability?.hints[noReleaseIndex] : undefined;

  useEffect(() => { if (nodeId) void loadNode(nodeId); else void initialLoad(); }, [initialLoad, loadNode, nodeId]);
  const chips = Object.entries(filters)
    .filter(([key]) => !["limit", "offset"].includes(key))
    .map(([key, value]) => ({ key, label: `${key}: ${Array.isArray(value) ? value.join(", ") : value}` }));

  return (
    <PageContainer>

      {/* WP-037 P7 锚点：文档总数主视觉。
          WP-134 波1 曾把值改成 summary.totalResults——红队反例②自查成立，那是错的：
          totalResults＝本次命中数 matched.length（document-inventory-service.cjs:186-191），
          随关键词/节点筛选变；标签「正式版文档总数」要的是全量 summary.totalDocuments
          （＝current.documents.length，不受筛选影响）。波1 提交信息里「全量在 summary.totalResults」
          一句同步在 SPEC-074 §6.9 更正入账。未加载/后端未给＝null →「—」。 */}
      <Statistic
        size="xl"
        label={DOCUMENT_INVENTORY_VIEW_COPY.TOTAL_STAT_LABEL}
        value={result?.summary?.totalDocuments ?? null}
        hint={DOCUMENT_INVENTORY_VIEW_COPY.TOTAL_STAT_HINT}
        sub={noReleaseHint ? <span className="text-status-warn" data-testid="inventory-no-release">{noReleaseHint}</span> : undefined}
      />

      {/* Document search bar — shared component, kept in sync with DashboardView */}
      {!nodeId && (
        <TableToolbar testId="document-search-toolbar">
          <DocumentSearchBar variant="toolbar" />
          <button
            type="button"
            onClick={() => clearAllFilters()}
            title={DOCUMENT_INVENTORY_VIEW_COPY.CLEAR_FILTERS_TITLE}
            aria-label={DOCUMENT_INVENTORY_VIEW_COPY.CLEAR_FILTERS_ARIA}
            disabled={chips.length === 0}
            className="flex h-8 w-8 items-center justify-center rounded-md text-text-hint hover:bg-surface-hover hover:text-text-main disabled:opacity-30"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </TableToolbar>
      )}

      {!nodeId && (
        <FilterChipBar chips={chips} onClear={(key) => clearFilter(key as keyof DocumentSearchParams)} />
      )}

      {status === "loading" && <p className="py-12 text-center text-sm text-text-hint">{DOCUMENT_INVENTORY_VIEW_COPY.SEARCHING}</p>}

      {/* Master 2026-10-29：空态即结构——发布前常态无卡，检索工具条照常（结果区自然留空） */}

      {status === "error" && !isNoCurrentReleaseText(error) && (
        <div className="rounded-lg ring-1 ring-status-error-6 bg-status-error-2 p-6 text-center">
          <p className="text-sm text-status-error">{error}</p>
          <button onClick={() => void query()} className="mt-3 inline-flex items-center gap-1.5 px-4 h-9 rounded-md bg-accent-bg text-[var(--color-accent-fg)] text-sm font-medium transition-all duration-[var(--duration-base)] hover:bg-[var(--color-accent-bg)] active:scale-[0.97] ring-1 ring-[var(--color-border-focus)]">{TERM.RETRY_ACTION}</button>
        </div>
      )}

      {status === "empty" && <p className="py-12 text-center text-sm text-text-hint">{DOCUMENT_INVENTORY_VIEW_COPY.EMPTY_NO_MATCH}</p>}

      {status === "idle" && result && result.availability?.empty && (
        // WP-070（展示类空态）：指引文案由服务端经空态语义契约单源组装（availability.hints）——
        // 前端不再写死第二份（此前内联「正式库暂无已索引文档…」即第三文案源），依赖序由服务端排好
        <div className="rounded-lg bg-surface-root px-4 py-3 text-sm text-text-hint" role="note" data-testid="inventory-availability">
          {result.availability.hints.map((hint, index) => <p key={result.availability?.kinds[index] ?? index}>{hint}</p>)}
          {result.summary.pendingExtraction > 0 && <span className="ml-2 text-status-warn">{documentPendingExtractionText(result.summary.pendingExtraction)}</span>}
        </div>
      )}

      <div className="space-y-3">
        {result?.documents?.map((document) => (
          <DocumentResultCard key={document.documentId} document={document} expanded={Boolean(expandedCards[document.documentId])} onToggle={() => toggleCard(document.documentId)} />
        ))}
      </div>

      {!nodeId && candidateResult && candidateResult.items.length > 0 && (
        <section aria-labelledby="candidate-name-results" className="border-t border-border-thin pt-4">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 id="candidate-name-results" className="text-sm font-medium text-text-main">
              {DOCUMENT_INVENTORY_VIEW_COPY.CANDIDATE_RESULTS_TITLE}
              {candidateResult.dataSource === "precleaned-worktree" && (
                <span className="ml-1.5 rounded bg-status-warn-2 px-1 py-0.5 text-xs text-status-warn ring-1 ring-status-warn-6" title={DOCUMENT_INVENTORY_VIEW_COPY.CANDIDATE_BADGE_TITLE}>{DOCUMENT_INVENTORY_VIEW_COPY.CANDIDATE_BADGE}</span>
              )}
            </h2>
            <span className="text-xs text-text-hint">{documentCandidateTotalText(candidateResult.total)}</span>
          </div>
          <ul className="divide-y divide-border-thin rounded-lg bg-surface-root px-3 ring-1 ring-border-thin">
            {candidateResult.items.map((candidate, index) => (
              <li key={`${candidate.title}-${index}`} className="py-2 text-sm text-text-sub">{candidate.title}</li>
            ))}
          </ul>
        </section>
      )}
    </PageContainer>
  );
}
