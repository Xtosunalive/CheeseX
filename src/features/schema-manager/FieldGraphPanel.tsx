import { useEffect, useState } from "react";
import { TERM } from "@/constants/term-const";
import { ChevronDown, GitBranch, Lock } from "lucide-react";
import { apiFetchEnvelope, unwrapEnvelope } from "@/lib/api";
import { FIELD_GRAPH_COPY } from "./schema-manager-copy";
import { DataTable } from "@/components/data-table/DataTable";
import type { Column } from "@/components/data-table/types";
import type { components } from "@/lib/generated/api-types";

// SPEC-020 波 3：字段值域引用图谱只读面板——「字段的合法取值从哪来、怎么算、现在有几个」上页。
// 数据单源 GET /api/schema/field-graph（fields.yaml 配方结构渲染＋resolved-domains.json 值集合流）；
// 页面零手写内容。接口失败→明示「图谱暂不可用」，不降级空表（fail-visible 不假象）。
// 红队低-1 修复：消费契约生成类型（消灭手写镜像第二份账）
type FieldGraphRow = components["schemas"]["FieldGraphRow"];

const GRAPH_COLUMNS: Array<Column<FieldGraphRow>> = [
  {
    key: "name",
    title: FIELD_GRAPH_COPY.COL_NAME,
    render: (row) => (
      <span className="whitespace-nowrap">
        <code className="text-text-main">{row.name}</code>
        <span className="ml-1 text-text-placeholder">{row.scope.join("/")}</span>
      </span>
    ),
  },
  {
    key: "recipe",
    title: FIELD_GRAPH_COPY.COL_RECIPE,
    render: (row) => (
      <span className="text-text-sub">
        <Lock className="mr-1 inline h-3 w-3 text-text-placeholder" aria-hidden />
        {row.recipe}
      </span>
    ),
  },
  {
    key: "valueCount",
    title: FIELD_GRAPH_COPY.COL_VALUE_COUNT,
    render: (row) => {
      if (row.domainKind === "stale") {
        return <span className="whitespace-nowrap text-status-error" title={FIELD_GRAPH_COPY.STALE_TITLE}>{FIELD_GRAPH_COPY.STALE_LABEL}</span>;
      }
      if (row.domainKind === "composite" && Array.isArray(row.composite)) {
        const parts = (row.composite as Array<Record<string, unknown>>).map((seg) => {
          if (seg && seg.op === "free_slug") return FIELD_GRAPH_COPY.SEGMENT_FREE_SLUG;
          const scoped = seg && typeof seg === "object" && "scoped" in seg && seg.scoped && typeof seg.scoped === "object";
          const values = seg && typeof seg === "object" && "values" in seg && Array.isArray(seg.values) ? (seg.values as unknown[]).length : null;
          return `${String((seg as Record<string, unknown>).source || "?")}${scoped ? FIELD_GRAPH_COPY.SEGMENT_SCOPED_SUFFIX : values !== null ? ` ${values}${FIELD_GRAPH_COPY.SEGMENT_VALUES_SUFFIX}` : ""}`;
        });
        return <span className="whitespace-nowrap text-text-sub" title={FIELD_GRAPH_COPY.COMPOSITE_TITLE}>{parts.join(FIELD_GRAPH_COPY.SEGMENT_JOIN)}</span>;
      }
      return <span className="whitespace-nowrap text-text-sub">{row.valueCount === null ? FIELD_GRAPH_COPY.VALUE_FREE : `${row.valueCount}${FIELD_GRAPH_COPY.SEGMENT_VALUES_SUFFIX}`}</span>;
    },
  },
  {
    key: "meta",
    title: FIELD_GRAPH_COPY.COL_META,
    render: (row) => {
      const ac = row.aliasCount ?? 0;
      return (
      <span className="whitespace-nowrap text-text-placeholder">
        {ac > 0 ? FIELD_GRAPH_COPY.META_ALIAS(ac) : ""}
        {row.default != null ? `${ac > 0 ? FIELD_GRAPH_COPY.META_DEFAULT_DIVIDER : ""}${FIELD_GRAPH_COPY.META_DEFAULT_PREFIX}${String(row.default)}` : ""}
      </span>
      );
    },
  },
];

export function FieldGraphPanel() {
  const [rows, setRows] = useState<FieldGraphRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!open || rows) return;
    void unwrapEnvelope(apiFetchEnvelope<{ byField: FieldGraphRow[] }>("/api/schema/field-graph"), FIELD_GRAPH_COPY.UNAVAILABLE)
      .then((data) => setRows(data.byField))
      .catch((e: Error) => setError(e.message || FIELD_GRAPH_COPY.UNAVAILABLE));
  }, [open, rows, reloadKey]);

  return (
    <div className="mb-4 rounded-md border border-border bg-card" data-testid="field-graph-panel">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-sub hover:bg-muted/50"
        aria-expanded={open}
      >
        <GitBranch className="h-4 w-4 shrink-0" />
        <span>{FIELD_GRAPH_COPY.HEADER_PREFIX}{rows ? `${rows.length}${FIELD_GRAPH_COPY.HEADER_COUNT_SUFFIX}` : FIELD_GRAPH_COPY.HEADER_LOADING_SUFFIX}{FIELD_GRAPH_COPY.HEADER_SUFFIX}</span>
        <ChevronDown className={`ml-auto h-4 w-4 transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && (
        <div className="border-t border-border px-3 py-2">
          {error && (
            <p className="text-sm text-status-error" data-testid="field-graph-error">
              {FIELD_GRAPH_COPY.ERROR_PREFIX}{error}{FIELD_GRAPH_COPY.ERROR_SUFFIX}{" "}
              <button
                type="button"
                className="ml-1 underline"
                onClick={() => { setError(null); setReloadKey((k) => k + 1); }}
                data-testid="field-graph-retry"
              >
                {FIELD_GRAPH_COPY.RETRY_ACTION}
              </button>
            </p>
          )}
          {!error && !rows && <p className="text-sm text-text-placeholder">{TERM.LOADING}</p>}
          {rows && (
            <DataTable
              ariaLabel={FIELD_GRAPH_COPY.TABLE_ARIA}
              columns={GRAPH_COLUMNS}
              rows={rows}
              rowKey={(row, index) => `${row.name}-${row.scope.join(",")}-${index}`}
              density="sm"
              minWidth={900}
              empty={{ title: FIELD_GRAPH_COPY.EMPTY }}
            />
          )}
        </div>
      )}
    </div>
  );
}
