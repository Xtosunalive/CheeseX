// WP-220（迁移试点·Master 2026-11-22 点名文章准入页）：文章清单影子视图——只读复刻老页面
// 的"看数据"骨架，列名走 field-view 派生标签、状态走 StatusDisplay 显示词单源；
// 写操作（审批/标准化/发布/退役）不在此面——业务守卫语义留文章准入页（不可派生）。
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { DataTable } from "@/components/data-table/DataTable";
import type { Column } from "@/components/data-table/types";
import { fieldLabel } from "@/lib/generated/field-view";
import { standardizationStatusDisplay } from "@/lib/domain/StatusDisplay";
import { fetchPrecleanedArticles } from "@/features/article-workflow/article-workflow-api";
import type { PrecleanedArticleItem } from "@/features/article-workflow/article-workflow-types";
import { INDIVIDUALS_COPY } from "../individuals-copy";

export function ArticleShadowTable() {
  const [items, setItems] = useState<PrecleanedArticleItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPrecleanedArticles()
      .then((list) => setItems(list.items ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) return <p role="alert" className="text-xs text-status-error">{error}</p>;

  const columns: Array<Column<PrecleanedArticleItem>> = [
    { key: "title", title: fieldLabel("title", "article"), dataIndex: "title" },
    { key: "product", title: fieldLabel("product", "article"), dataIndex: "product" },
    { key: "module", title: fieldLabel("module", "article"), dataIndex: "module" },
    { key: "articleType", title: fieldLabel("article_type", "article"), dataIndex: "articleType" },
    {
      key: "standardizationStatus",
      title: INDIVIDUALS_COPY.SHADOW_STATUS_COL,
      render: (row: PrecleanedArticleItem) => standardizationStatusDisplay(row.standardizationStatus).label,
    },
  ];

  return (
    <DataTable
      ariaLabel={INDIVIDUALS_COPY.SHADOW_TABLE_ARIA}
      columns={columns}
      rows={items}
      rowKey={(row) => row.id}
      empty={items.length === 0 ? {
        icon: Search,
        title: INDIVIDUALS_COPY.SHADOW_EMPTY,
      } : undefined}
      minWidth={640}
    />
  );
}
