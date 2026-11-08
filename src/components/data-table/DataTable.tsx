// ── DataTable 基座（P1 · 决策卡 §九）──
// L4 组件层：只消费 L3 preset 类（.data-table__*）＋L1 语义工具类，零内联样式/字面值。
// 三态（空/载/错）固定渲染在表体同位置（ tbody 首行 colSpan 全宽），切换零布局跳动。
// 键盘可达：行点击场景行可聚焦（tabIndex＋Enter/Space），O3 的机器落点。
import * as React from "react";
import { TERM } from "@/constants/term-const";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert } from "@/components/ui/alert";
import { Loader2, ChevronRight, Inbox } from "lucide-react";
import type { CardPreset, Column, Density, Expandable, RowSelection, TableEmptyProps } from "./types";
import { EditableCell as EditableCellImpl } from "./editable-cell-group";
import { DATA_TABLE_COPY, dataTableSelectRow } from "../components-copy";

export type DataTableProps<T> = {
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T, index: number) => string;
  density?: Density;
  loading?: boolean;
  /** 有值且非 loading 时显示错误态 */
  error?: React.ReactNode;
  onRetry?: () => void;
  /** 加载态文案（默认「加载中...」）——迁移表保留既有加载提示时使用（T03/T05 先例） */
  loadingLabel?: string;
  empty?: TableEmptyProps;
  toolbar?: React.ReactNode;
  meta?: React.ReactNode;
  pagination?: React.ReactNode;
  stickyHeader?: boolean;
  expandable?: Expandable<T>;
  rowSelection?: RowSelection<T>;
  onRowClick?: (row: T) => void;
  minWidth?: number;
  ariaLabel?: string;
  /** 行级动态类（antd rowClassName 同形）——选中/激活行高亮等由调用方给语义工具类（T03/T04 先例） */
  rowClassName?: (row: T) => string;
  /** 滚动容器附加类——限高滚动场景（T03：max-h + overflow-y，配 stickyHeader） */
  scrollClassName?: string;
  /** table 元素附加类——table-fixed 等表级布局约定与迁移测试约定类（T03/T05 先例） */
  tableClassName?: string;
  /** W2 起（O4）：卡片降级——窄屏卡片行＋隐藏表头，md+ 恢复表格（T05 为参照形态） */
  card?: CardPreset;
};

const ALIGN_CLASS: Record<string, string> = { left: "text-left", center: "text-center", right: "text-right" };

export function TableLoading({ label = TERM.LOADING }: { label?: string }) {
  return (
    <div data-testid="table-loading" className="flex items-center justify-center gap-2">
      <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
      <span>{label}</span>
    </div>
  );
}

export function TableEmptyState({ empty }: { empty: TableEmptyProps }) {
  const Icon = (empty.icon ?? Inbox) as React.FC<{ className?: string }>;
  return (
    <div data-testid="table-empty" className="flex flex-col items-center justify-center gap-1">
      <Icon aria-hidden className="h-5 w-5 opacity-60" />
      <span className="text-sm">{empty.title}</span>
      {empty.description ? <span className="text-xs opacity-70">{empty.description}</span> : null}
    </div>
  );
}

export function TableErrorState({ error, onRetry }: { error: React.ReactNode; onRetry?: () => void }) {
  return (
    <div data-testid="table-error" className="flex flex-col items-center gap-2">
      <Alert variant="error" description={onRetry ? DATA_TABLE_COPY.ERROR_RETRY_HINT : undefined} className="w-full max-w-md">
        {error}
      </Alert>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md bg-surface-hover px-3 py-1.5 text-xs text-text-main transition-colors hover:bg-accent-bg"
        >
          {TERM.RETRY_ACTION}
        </button>
      ) : null}
    </div>
  );
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  density = "lg",
  loading = false,
  error = null,
  onRetry,
  empty,
  toolbar,
  meta,
  pagination,
  stickyHeader = false,
  expandable,
  rowSelection,
  onRowClick,
  minWidth,
  ariaLabel = DATA_TABLE_COPY.TABLE_ARIA_DEFAULT,
  loadingLabel,
  rowClassName,
  scrollClassName,
  tableClassName,
  card,
}: DataTableProps<T>) {
  const showToggleColumn = Boolean(expandable) && expandable?.toggleColumn !== false;
  const colCount = columns.length + (rowSelection ? 1 : 0) + (showToggleColumn ? 1 : 0);
  const showError = error != null && !loading;
  const cardMode = Boolean(card);

  return (
    <div className={`data-table${stickyHeader ? " data-table--sticky" : ""}`} data-density={density}>
      {toolbar ? <div className="data-table__toolbar">{toolbar}</div> : null}
      <div className={`data-table__scroll${scrollClassName ? ` ${scrollClassName}` : ""}`}>
        <table className={`data-table__table${tableClassName ? ` ${tableClassName}` : ""}`} style={minWidth ? { minWidth } : undefined} aria-label={ariaLabel}>
          <thead className={`data-table__thead bg-surface-hover/40 text-text-main${cardMode ? " hidden md:table-header-group" : ""}`}>
            <tr>
              {rowSelection ? (
                <th className="data-table__th data-table__th--selection" aria-label={rowSelection.headerLabel ?? DATA_TABLE_COPY.SELECT_ALL}>
                  {rowSelection.onToggleAll ? (
                    <Checkbox
                      checked={rows.length > 0 && rows.every((row, i) => rowSelection.selectedKeys.has(rowKey(row, i)))}
                      onCheckedChange={() => rowSelection.onToggleAll?.()}
                      aria-label={DATA_TABLE_COPY.SELECT_PAGE}
                    />
                  ) : null}
                </th>
              ) : null}
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`data-table__th ${col.fixed === "left" ? "data-table__cell--fixed-left" : ""} ${col.fixed === "right" ? "data-table__cell--fixed-right" : ""} ${ALIGN_CLASS[col.align ?? "left"]}`}
                  style={col.width ? { width: col.width } : undefined}
                >
                  {col.title}
                </th>
              ))}
              {showToggleColumn ? <th className="data-table__th" aria-label={TERM.EXPAND_ACTION} /> : null}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className={`data-table__row${cardMode ? " block md:table-row" : ""}`}>
                <td colSpan={colCount} className={`data-table__td${cardMode ? " block md:table-cell" : ""}`}>
                  <div className="data-table__state">
                    <TableLoading label={loadingLabel} />
                  </div>
                </td>
              </tr>
            ) : showError ? (
              <tr className={`data-table__row${cardMode ? " block md:table-row" : ""}`}>
                <td colSpan={colCount} className={`data-table__td${cardMode ? " block md:table-cell" : ""}`}>
                  <div className="data-table__state">
                    <TableErrorState error={error} onRetry={onRetry} />
                  </div>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr className={`data-table__row${cardMode ? " block md:table-row" : ""}`}>
                <td colSpan={colCount} className={`data-table__td${cardMode ? " block md:table-cell" : ""}`}>
                  <div className="data-table__state">
                    <TableEmptyState empty={empty ?? { title: TERM.EMPTY_DATA }} />
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((row, index) => {
                const key = rowKey(row, index);
                const expanded = expandable?.rowExpanded(row) ?? false;
                return (
                  <React.Fragment key={key}>
                    <tr
                      className={`data-table__row${onRowClick ? " data-table__row--interactive" : ""}${cardMode ? ` ${card!.rowClassName} md:table-row` : ""}${rowClassName?.(row) ? ` ${rowClassName(row)}` : ""}`}
                      {...(onRowClick
                        ? {
                            tabIndex: 0,
                            onClick: () => onRowClick(row),
                            onKeyDown: (event: React.KeyboardEvent<HTMLTableRowElement>) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                onRowClick(row);
                              }
                            },
                          }
                        : {})}
                    >
                      {rowSelection ? (
                        <td className="data-table__td data-table__cell--selection">
                          <Checkbox
                            checked={rowSelection.selectedKeys.has(key)}
                            onCheckedChange={() => rowSelection.onToggle(row)}
                            onClick={(event) => event.stopPropagation()}
                            aria-label={rowSelection.rowLabel ? rowSelection.rowLabel(row, index) : dataTableSelectRow(index + 1)}
                          />
                        </td>
                      ) : null}
                      {columns.map((col) => {
                        // 行分组列（groupOf）：组首行渲染 rowSpan 单元格，组内后续行跳过该 td（T04）
                        if (col.groupOf) {
                          const groupValue = col.groupOf(row);
                          const isFirstOfRun = index === 0 || col.groupOf(rows[index - 1]) !== groupValue;
                          if (!isFirstOfRun) return null;
                          let span = 1;
                          while (index + span < rows.length && col.groupOf(rows[index + span]) === groupValue) span += 1;
                          return (
                            <td
                              key={col.key}
                              rowSpan={span}
                              className={`data-table__td ${col.fixed === "left" ? "data-table__cell--fixed-left" : ""} ${col.fixed === "right" ? "data-table__cell--fixed-right" : ""} ${col.ellipsis ? "max-w-0 truncate" : ""} ${ALIGN_CLASS[col.align ?? "left"]} ${col.className ?? ""}`}
                            >
                              {col.render ? col.render(row, index, span) : ((row[col.dataIndex as keyof T] as React.ReactNode) ?? "—")}
                            </td>
                          );
                        }
                        return (
                          <td
                            key={col.key}
                            className={`data-table__td ${col.fixed === "left" ? "data-table__cell--fixed-left" : ""} ${col.fixed === "right" ? "data-table__cell--fixed-right" : ""} ${col.ellipsis ? "max-w-0 truncate" : ""} ${ALIGN_CLASS[col.align ?? "left"]} ${col.className ?? ""}`}
                            title={col.ellipsis && col.dataIndex ? String(row[col.dataIndex] ?? "") : undefined}
                          >
                            {col.render ? col.render(row, index) : col.dataIndex != null ? ((row[col.dataIndex] as React.ReactNode) ?? "—") : null}
                          </td>
                        );
                      })}
                      {showToggleColumn ? (
                        <td className="data-table__td data-table__cell--toggle">
                          <button
                            type="button"
                            aria-expanded={expanded}
                            aria-label={expanded ? DATA_TABLE_COPY.COLLAPSE_ROW : DATA_TABLE_COPY.EXPAND_ROW}
                            onClick={() => expandable?.onToggle(row)}
                            className="flex h-6 w-6 items-center justify-center rounded text-text-hint transition-transform hover:bg-surface-hover hover:text-text-main"
                          >
                            <ChevronRight aria-hidden className={`h-4 w-4 transition-transform ${expanded ? "rotate-90" : ""}`} />
                          </button>
                        </td>
                      ) : null}
                    </tr>
                    {expandable && expanded ? (
                      <tr className="data-table__row data-table__expanded">
                        <td colSpan={colCount}>{expandable.render(row)}</td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {meta ? <div className="data-table__meta">{meta}</div> : null}
      {pagination ? <div className="data-table__pagination">{pagination}</div> : null}
    </div>
  );
}

// 卡 §十二 I5 命名落点：DataTable.EditableCell（函数＋命名空间合并；
// namespace 内只放 const 绑定——re-export 语句在 namespace 中非法）
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace DataTable {
  export const EditableCell = EditableCellImpl;
}
