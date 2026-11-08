// AssociationDecisionList — W3 迁移（决策卡 §12.1）：div 伪装行→DataTable 语义表（D12）；
// 行点击走基座 onRowClick（键盘可达 O3 随基座获得）；审计状态换 ui/tag（D6：stale=warn/有效=fact）。
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { DataTable } from "@/components/data-table/DataTable";
import type { Column } from "@/components/data-table/types";
import { Tag } from "@/components/ui/tag";
import type { ArticleAssociationData } from "@/features/article-associations/article-associations-types";
import { AA_DECISION_LIST_COPY, ARTICLE_ASSOCIATION_COPY, ASSOCIATION_ACTION_LABELS, aaItemCount } from "@/features/article-associations/article-associations-copy";

const ACTION_LABEL = ASSOCIATION_ACTION_LABELS;

type DecisionRow = ArticleAssociationData["decisions"][number];

/**
 * 已保存文章映射（审计决策行）。显示收敛（2026-10-15 Master 裁）：幽灵行（源已删）在服务端
 * 投影层已过滤不显示；可见的 stale 行=文章在但内容变了——出口是「重新指定」，不是移除。
 */
export function AssociationDecisionList({ data, onSelect }: { data: ArticleAssociationData; onSelect: (articleId: string) => void }) {
  if (data.decisions.length === 0) return null;
  const articleTitles = new Map(data.articles.map((item) => [item.articleId, item.title]));
  const columns: Array<Column<DecisionRow>> = [
    {
      key: "article",
      title: AA_DECISION_LIST_COPY.COL_ARTICLE,
      render: (item) => <span className="truncate text-text-main" title={articleTitles.get(item.articleId) || ARTICLE_ASSOCIATION_COPY.UNNAMED_ARTICLE}>{articleTitles.get(item.articleId) || ARTICLE_ASSOCIATION_COPY.UNNAMED_ARTICLE}</span>,
    },
    {
      key: "action",
      title: AA_DECISION_LIST_COPY.COL_ACTION,
      width: 100,
      render: (item) => <span className="text-text-sub">{ACTION_LABEL[item.action]}</span>,
    },
    {
      key: "count",
      title: AA_DECISION_LIST_COPY.COL_ITEMS,
      width: 90,
      render: (item) => <span className="tabular-nums text-text-hint">{aaItemCount(item.componentIds.length + item.versionIds.length)}</span>,
    },
    {
      key: "status",
      title: AA_DECISION_LIST_COPY.COL_AUDIT,
      width: 130,
      render: (item) => item.stale
        ? <Tag tone="warn"><AlertTriangle className="h-4 w-4" />{AA_DECISION_LIST_COPY.STALE}</Tag>
        : <Tag tone="fact"><CheckCircle2 className="h-4 w-4" />{AA_DECISION_LIST_COPY.VALID}</Tag>,
    },
  ];
  return (
    <section aria-label={AA_DECISION_LIST_COPY.SECTION_ARIA}>
      <h2 className="mb-2 text-sm font-semibold text-text-main">{AA_DECISION_LIST_COPY.HEADING}</h2>
      <DataTable
        ariaLabel={AA_DECISION_LIST_COPY.TABLE_ARIA}
        columns={columns}
        rows={data.decisions}
        rowKey={(item) => item.decisionId}
        onRowClick={(item) => onSelect(item.articleId)}
      />
    </section>
  );
}
