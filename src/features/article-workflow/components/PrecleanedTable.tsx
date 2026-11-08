// PrecleanedTable — W2 迁移（决策卡 §12.1）：骨架/三态/密度走 DataTable；卡片降级（O4）走基座 card
// （T05 为参照形态：窄屏卡片行＋隐藏表头，md+ 恢复表格）；行操作走 RowActions（B2）；
// 状态徽章换 ui/tag（D6）；时间收敛 formatDateTime（D9）。
// 退役为危险操作（B3）：SPEC-013 预演对话框（dryRun 计划呈现→确认退役）即其二次确认承载，
// 点击行内钮仅打开对话框不执行——不再叠加 alert-dialog 双弹窗（四格对照见卡 §12.1 W2 行注记）。
import { Eye, Rocket, Trash2 } from "lucide-react";
import { TableSortHeader, type TableSortDirection } from "@/components/table-sort-header";
import { DataTable } from "@/components/data-table/DataTable";
import type { Column } from "@/components/data-table/types";
import { RowActions, type RowAction } from "@/components/row-actions/RowActions";
import { Tag } from "@/components/ui/tag";
import { formatDateTime } from "@/lib/format";
import { TERM } from "@/constants/term-const";
import { type PrecleanedArticleItem } from "@/features/article-workflow/article-workflow-types";
import { standardizationStatusDisplay } from "@/lib/domain/StatusDisplay";
import type { ArticleSortField } from "./ArticleAdmissionWorkspace";
import {
  ARTICLE_SKILL_OUTCOME_COPY,
  PRECLEANED_TABLE_COPY,
  articleSkillKnownIssuesText,
  precleanedApproveActionLabel,
  precleanedOpenActionLabel,
  precleanedRetireActionLabel,
  precleanedRowActionsAria,
  precleanedWarningCountText,
} from "../article-workflow-copy";

type Props = {
  /** 勾选体系退役记录（2026-10-15，无消费者实证）：selectionItems/selectedIds/onSelectionChange 已删，
   *  行内动作（查看/审批发布/退役）均为单篇语义。批量需求再现时须先证明消费路径。 */
  items: PrecleanedArticleItem[];
  loading: boolean;
  sortField: ArticleSortField;
  sortDirection: TableSortDirection;
  emptyTitle: string;
  emptyDescription: string;
  onSortChange: (field: ArticleSortField, direction: TableSortDirection) => void;
  onOpen: (id: string) => void;
  /** SPEC-013 文章退役入口：传 null 关闭（列表行仅传文件名，正式版快照由服务端沿溯源链定位） */
  onRetire?: (item: PrecleanedArticleItem) => void;
  /** 审批与发布收敛（2026-10-15）：状态机动作行内入口 */
  onApprove?: (item: PrecleanedArticleItem) => void;
  /** 标准化动作迁入（2026-10-15 Master 裁）：按状态驱动——待标准化执行 validate→promote；
   *  已标准化场景本表已有 🚀 发布入口（对话框内含审批链），不在此重复。 */
  /** @deprecated WP-063：标准化由系统自动执行——本回调不再被行内动作消费 */
  onStandardize?: (item: PrecleanedArticleItem) => void;
  standardizingKeys?: string[];
  /** 行内标准化结果卡（key=sourcePath——与动作同侧渲染，2026-10-15 动作迁入） */
  skillOutcomes?: Record<string, { stage: string; validate: unknown; promote: { precleanedPath: string } | null; errorMessage: string | null }>;
};

export function PrecleanedTable({ items, loading, sortField, sortDirection, emptyTitle, emptyDescription, onSortChange, onOpen, onRetire, onApprove, skillOutcomes = {} }: Props) {
  const columns: Array<Column<PrecleanedArticleItem>> = [
    {
      key: "title",
      title: <TableSortHeader label={PRECLEANED_TABLE_COPY.COL_TITLE} active={sortField === "title"} direction={sortDirection} ascendingLabel={PRECLEANED_TABLE_COPY.COL_TITLE_ASC} descendingLabel={PRECLEANED_TABLE_COPY.COL_TITLE_DESC} onChange={(direction) => onSortChange("title", direction)} />,
      width: "28%",
      className: "min-w-0",
      render: (item) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-text-main">{item.title}</p>
          <p className="truncate text-xs text-text-hint" title={item.sourcePath}>{item.sourcePath}</p>
          <p className="mt-1 truncate text-xs text-text-sub md:hidden">{[item.product, item.module, item.articleType, item.version].filter(Boolean).join(" · ") || TERM.EMPTY_CLASSIFICATION}</p>
          <p className="mt-1 text-xs text-text-hint md:hidden">{formatDateTime(item.updatedAt)}</p>
        </div>
      ),
    },
    {
      key: "productModule",
      title: <TableSortHeader label={PRECLEANED_TABLE_COPY.COL_PRODUCT_MODULE} active={sortField === "productModule"} direction={sortDirection} ascendingLabel={PRECLEANED_TABLE_COPY.COL_PRODUCT_MODULE_ASC} descendingLabel={PRECLEANED_TABLE_COPY.COL_PRODUCT_MODULE_DESC} onChange={(direction) => onSortChange("productModule", direction)} />,
      width: "16%",
      className: "hidden md:table-cell",
      render: (item) => <div><p className="truncate text-text-sub">{item.product || "-"}</p><p className="truncate text-xs text-text-hint">{item.module || "-"}</p></div>,
    },
    {
      key: "typeVersion",
      title: <TableSortHeader label={PRECLEANED_TABLE_COPY.COL_TYPE_VERSION} active={sortField === "typeVersion"} direction={sortDirection} ascendingLabel={PRECLEANED_TABLE_COPY.COL_TYPE_VERSION_ASC} descendingLabel={PRECLEANED_TABLE_COPY.COL_TYPE_VERSION_DESC} onChange={(direction) => onSortChange("typeVersion", direction)} />,
      width: "15%",
      className: "hidden md:table-cell",
      render: (item) => <div><p className="truncate text-text-sub">{item.articleType || "-"}</p><p className="truncate text-xs text-text-hint">{item.version || "-"}</p></div>,
    },
    {
      key: "status",
      title: <TableSortHeader label={PRECLEANED_TABLE_COPY.COL_STATUS} active={sortField === "status"} direction={sortDirection} ascendingLabel={PRECLEANED_TABLE_COPY.COL_STATUS_ASC} descendingLabel={PRECLEANED_TABLE_COPY.COL_STATUS_DESC} onChange={(direction) => onSortChange("status", direction)} />,
      width: "16%",
      render: (item) => (
        <div>
          <Tag tone={standardizationStatusDisplay(item.standardizationStatus).tone}>{standardizationStatusDisplay(item.standardizationStatus).label}</Tag>
          {item.standardizationWarningCount > 0 && <p className="mt-1 text-xs text-status-warn" title={PRECLEANED_TABLE_COPY.WARNING_TITLE}>{precleanedWarningCountText(item.standardizationWarningCount)}</p>}
        </div>
      ),
    },
    {
      key: "updatedAt",
      title: <TableSortHeader label={PRECLEANED_TABLE_COPY.COL_UPDATED_AT} active={sortField === "updatedAt"} direction={sortDirection} ascendingLabel={PRECLEANED_TABLE_COPY.COL_UPDATED_AT_ASC} descendingLabel={PRECLEANED_TABLE_COPY.COL_UPDATED_AT_DESC} onChange={(direction) => onSortChange("updatedAt", direction)} />,
      width: "13%",
      className: "hidden md:table-cell",
      render: (item) => <span className="text-xs text-text-hint">{formatDateTime(item.updatedAt)}</span>,
    },
    {
      key: "actions",
      title: "",
      width: 48,
      align: "right",
      // 卡片降级格位：窄屏 actions 落在第二行右侧（col-start-2 row-start-2 在 md+ 表格布局下被忽略）
      className: "col-start-2 row-start-2",
      render: (item) => {
        // WP-063：标准化由系统自动执行（哈希变更→状态回退→自动 standardize）——行内标准化按钮退役。
        const actions: Array<RowAction<PrecleanedArticleItem>> = [];
        actions.push({ key: "open", label: precleanedOpenActionLabel(item.title), onRun: (row) => onOpen(row.id), icon: Eye });
        if (onApprove) {
          actions.push({ key: "approve", label: precleanedApproveActionLabel(item.title), onRun: onApprove, icon: Rocket });
        }
        if (onRetire) {
          actions.push({ key: "retire", label: precleanedRetireActionLabel(item.title), onRun: onRetire, icon: Trash2, danger: true });
        }
        return (
          <div className="flex w-full justify-end">
            <RowActions row={item} actions={actions} ariaLabel={precleanedRowActionsAria(item.title)} />
          </div>
        );
      },
    },
  ];

  return (
    <DataTable
      ariaLabel={PRECLEANED_TABLE_COPY.TABLE_ARIA}
      columns={columns}
      rows={items}
      rowKey={(item) => item.id}
      density="md"
      loading={loading && items.length === 0}
      loadingLabel={PRECLEANED_TABLE_COPY.LOADING_LABEL}
      empty={{ title: emptyTitle, description: emptyDescription }}
      tableClassName="table-fixed md:min-w-[820px]"
      card={{ rowClassName: "grid grid-cols-[minmax(0,1fr)_auto] items-start" }}
      expandable={{
        rowExpanded: (item) => Boolean(skillOutcomes[item.sourcePath]),
        onToggle: () => undefined,
        render: (item) => <SkillOutcomeCard outcome={skillOutcomes[item.sourcePath]} />,
        toggleColumn: false,
      }}
    />
  );
}

function SkillOutcomeCard({ outcome }: { outcome: { stage: string; validate: unknown; promote: { precleanedPath: string } | null; errorMessage: string | null } }) {
  if (!outcome) return null;
  return (
    outcome.errorMessage
      ? <p role="status" className="text-xs text-status-error">{ARTICLE_SKILL_OUTCOME_COPY.FAILED}：{outcome.errorMessage}</p>
      : <div role="status" className="text-xs">
          <p className="text-status-fact">{ARTICLE_SKILL_OUTCOME_COPY.DONE} <span className="text-text-hint" title={outcome.promote?.precleanedPath}>{outcome.promote?.precleanedPath}</span></p>
          {typeof outcome.validate === "object" && outcome.validate && (() => {
            const v = outcome.validate as { errors?: string[]; warnings?: string[]; autoFilled?: string[] };
            const issues = [...(v.errors || []), ...(v.warnings || [])];
            if (issues.length === 0 && !(v.autoFilled || []).length) return null;
            return (
              <div className="mt-1 text-status-warn">
                {issues.length > 0 && <p>{articleSkillKnownIssuesText(issues.length)}</p>}
                {issues.map((issue, index) => <p key={index}>{issue}</p>)}
                {(v.autoFilled || []).length > 0 && <p className="text-text-hint">{ARTICLE_SKILL_OUTCOME_COPY.AUTO_FILLED_PREFIX}{(v.autoFilled || []).join("、")}</p>}
              </div>
            );
          })()}
        </div>
  );
}
