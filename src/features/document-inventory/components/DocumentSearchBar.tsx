import { useEffect, useMemo, useCallback, useState, useRef } from "react";
import { useClickOutside } from "@/hooks/useClickOutside";
import { Search } from "lucide-react";
import { CardNav } from "./CardNav";
import { FilterGroupPopover } from "./FilterGroupPopover";

import { useDocumentInventoryStore } from "@/features/document-inventory/document-inventory-store";
import type { DocumentSearchParams, DocumentFacetOption } from "@/features/document-inventory/document-inventory-types";
import { TERM } from "@/constants/term-const";
import { navigate } from "@/lib/navigation";
import { DOCUMENT_SEARCH_COPY } from "../document-inventory-copy";

const INDENT = { TRUNK: 8, L1: 24, L2: 40 } as const;
const LINE = "var(--color-line-subtle)";

/** 竖线 + 横线分支结构 — 纯 DOM 元素，不依赖 CSS 伪元素 */
function TreeGroup({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: "relative" }}>
      <span style={{
        position: "absolute",
        left: INDENT.TRUNK,
        top: 0,
        bottom: 6,
        width: 1,
        background: LINE,
      }} />
      {children}
    </div>
  );
}

function FilterSection({ label, options, selected, onChange }: {
  label: string;
  options: DocumentFacetOption[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <div style={{ marginBottom: 2 }}>
      {/* L1 — 横线分支 + 标题 */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: 3 }}>
        <span style={{
          width: INDENT.L1 - INDENT.TRUNK,
          height: 1,
          background: LINE,
          flexShrink: 0,
          marginLeft: INDENT.TRUNK,
        }} />
        <span style={{ fontSize: "var(--text-xs)", fontWeight: 500, color: "var(--color-text-hint)", marginLeft: 6, userSelect: "none" }}>{label}</span>
      </div>
      {/* L2 — 勾选项 */}
      {options.length === 0 ? (
        <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-placeholder)", paddingLeft: INDENT.L2, margin: 0 }}>{TERM.EMPTY_OPTIONS}</p>
      ) : (
        options.map((opt) => {
          const checked = selected.includes(opt.value);
          return (
            <label
              key={opt.value}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "3px 0 3px 0", paddingLeft: INDENT.L2, borderRadius: 6, cursor: "pointer", color: "var(--color-text-sub)", fontSize: "var(--text-xs)", lineHeight: 1.3, background: "transparent" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLLabelElement).style.backgroundColor = "var(--color-border-thin)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLLabelElement).style.backgroundColor = "transparent"; }}
            >
              <span style={{ display: "flex", alignItems: "center", minWidth: 0, flex: "1 1 auto" }}>
                <input type="checkbox" checked={checked}
                  onChange={() => onChange(checked ? selected.filter((v) => v !== opt.value) : [...selected, opt.value])}
                  style={{ width: 16, height: 16, flexShrink: 0, accentColor: "var(--color-accent-base)", margin: 0, cursor: "pointer" }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginLeft: 8 }}>{opt.value}</span>
              </span>
              <span style={{ flexShrink: 0, fontVariantNumeric: "tabular-nums", color: "var(--color-text-placeholder)", fontSize: "var(--text-xs)", marginLeft: 12 }}>{opt.count}</span>
            </label>
          );
        })
      )}
    </div>
  );
}

export interface DocumentSearchBarProps {
  /** If true, pressing Enter in the search box navigates to the document-inventory tab */
  navigateOnSearch?: boolean;
  className?: string;
  /** If true, start collapsed — only a hamburger icon shows until clicked */
  collapsed?: boolean;
  variant?: "card" | "toolbar";
}

/**
 * Shared search bar wrapping CardNav (search input + hamburger filter panel).
 *
 * Used by both DashboardView (navigateOnSearch, collapsed) and DocumentInventoryView (inline search).
 * Both pages share the same store, filter logic, and UI — edit once, sync everywhere.
 */
export function DocumentSearchBar({ navigateOnSearch = false, className, collapsed = false, variant = "card" }: DocumentSearchBarProps) {
  const {
    status, result, filters, initialLoad, setFilter, query,
  } = useDocumentInventoryStore();
  const [expanded, setExpanded] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Populate facets on mount so the hamburger filter dropdowns have options
  useEffect(() => {
    if (status === "idle" && !result) {
      void initialLoad();
    }
  }, [initialLoad, result, status]);

  // Debounced auto-query when filters change (e.g. checkbox toggle)
  useEffect(() => {
    if (status !== "loading") return;
    const timer = window.setTimeout(() => void query(), 300);
    return () => window.clearTimeout(timer);
  }, [filters, query, status]);

  // Click outside to collapse (only in collapsed mode)
  useClickOutside(collapsed && expanded, () => setExpanded(false), [wrapperRef]);

  const handleEnter = useCallback(() => {
    if (navigateOnSearch && filters.keyword?.trim()) {
      navigate("document-inventory");
    }
  }, [filters.keyword, navigateOnSearch]);

  const facets = result?.availableFilters;
  const setList = useCallback(
    (key: keyof DocumentSearchParams) => (values: string[]) => setFilter(key, values as never),
    [setFilter],
  );

  const navItems = useMemo(() => [
    {
      label: `▌${TERM.SEARCH_FILTER}`,
      bgColor: "var(--color-surface-hover)",
      textColor: "var(--color-text-main)",
      content: (
        <TreeGroup>
          <FilterSection label={TERM.CATEGORY_FILTER} options={facets?.arch_category || []} selected={filters.arch_category || []} onChange={setList("arch_category")} />
          <FilterSection label={TERM.LAYER_FILTER}     options={facets?.arch_layer || []}     selected={filters.arch_layer || []}     onChange={setList("arch_layer")} />
        </TreeGroup>
      ),
    },
    {
      label: `▌${TERM.TAG_AND_RELATION}`,
      bgColor: "var(--color-surface-hover)",
      textColor: "var(--color-text-main)",
      content: (
        <TreeGroup>
          <FilterSection label={TERM.TAG_FILTER}      options={facets?.tags || []}           selected={filters.tags || []}           onChange={setList("tags")} />
          <FilterSection label={TERM.RELATION_FILTER}  options={facets?.relationType || []}   selected={filters.relationType || []}   onChange={setList("relationType")} />
        </TreeGroup>
      ),
    },
  ], [facets, filters.arch_category, filters.arch_layer, filters.relationType, filters.tags, setList]);

  const searchSlot = (
    <label className="relative block w-full">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-hint" />
      <input
        aria-label={TERM.DOCUMENT_SEARCH_INPUT}
        value={filters.keyword || ""}
        onChange={(e) => setFilter("keyword", e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") handleEnter(); }}
        placeholder={DOCUMENT_SEARCH_COPY.SEARCH_PLACEHOLDER}
        className={variant === "toolbar"
          ? "h-8 w-full bg-transparent pl-9 pr-3 text-xs text-text-main outline-none placeholder:text-text-hint"
          : "h-9 w-full rounded-lg bg-transparent pl-9 pr-3 text-sm text-text-main outline-none ring-1 ring-border-thin placeholder:text-text-placeholder focus:ring-2 focus:ring-border-focus"}
      />
    </label>
  );

  if (variant === "toolbar") {
    return (
      <div className={`flex min-w-0 flex-1 flex-wrap items-center gap-1 ${className ?? ""}`}>
        <div className="min-w-56 flex-1">{searchSlot}</div>
        <FilterGroupPopover label={TERM.CATEGORY} triggerLabel={TERM.CATEGORY_FILTER} options={facets?.arch_category || []} selected={filters.arch_category || []} onChange={setList("arch_category")} />
        <FilterGroupPopover label={TERM.LAYER} triggerLabel={TERM.LAYER_FILTER} options={facets?.arch_layer || []} selected={filters.arch_layer || []} onChange={setList("arch_layer")} />
        <FilterGroupPopover label={TERM.TAG} triggerLabel={TERM.TAG_FILTER} options={facets?.tags || []} selected={filters.tags || []} onChange={setList("tags")} />
        <FilterGroupPopover label={TERM.RELATION} triggerLabel={TERM.RELATION_FILTER} options={facets?.relationType || []} selected={filters.relationType || []} onChange={setList("relationType")} />
      </div>
    );
  }

  const fullBar = (
    <CardNav
      className={className ?? "!relative !left-0 !translate-x-0 !w-full !max-w-none !top-0"}
      searchSlot={searchSlot}
      items={navItems}
      baseColor="var(--color-surface-card)"
      buttonBgColor="var(--color-accent-base)"
      buttonTextColor="var(--color-accent-contrast)"
    />
  );

  // Collapsed mode: show a floating hamburger only, expand on click
  if (collapsed) {
    if (!expanded) {
      return (
        <div className="flex justify-end w-full">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="flex items-center justify-center h-9 w-9 rounded-md bg-surface-card ring-1 ring-border-thin hover:ring-violet-7 transition-all"
            aria-label={DOCUMENT_SEARCH_COPY.EXPAND_SEARCH_ARIA}
            title={DOCUMENT_SEARCH_COPY.SEARCH_TITLE}
          >
            <Search className="h-4 w-4 text-text-hint" />
          </button>
        </div>
      );
    }
    return (
      <div ref={wrapperRef}>
        {fullBar}
      </div>
    );
  }

  // Normal mode: always visible
  return fullBar;
}
