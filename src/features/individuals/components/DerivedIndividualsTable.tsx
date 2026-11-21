// WP-213（红队 M1②）：派生个体清单——DataTable 基座（自写表格退役；T11 豁免不适用）。
import { Search } from "lucide-react";
import { DataTable } from "@/components/data-table/DataTable";
import type { Column } from "@/components/data-table/types";
import { Button } from "@/components/ui/button";
import type { IndividualListItem } from "../individuals-types";
import { INDIVIDUALS_COPY } from "../individuals-copy";

interface Props {
  items: IndividualListItem[];
  onEdit: (item: IndividualListItem) => void;
  onRetire: (item: IndividualListItem) => void;
  busy?: boolean;
}

export function DerivedIndividualsTable({ items, onEdit, onRetire, busy }: Props) {
  const columns: Array<Column<IndividualListItem>> = [
    { key: "individualId", title: INDIVIDUALS_COPY.COL_ID, dataIndex: "individualId" },
    { key: "title", title: INDIVIDUALS_COPY.COL_TITLE, dataIndex: "title" },
    {
      key: "actions",
      title: INDIVIDUALS_COPY.COL_ACTIONS,
      render: (row: IndividualListItem) => (
        <span className="flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onEdit(row)}>{INDIVIDUALS_COPY.EDIT_ACTION}</Button>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onRetire(row)}>{INDIVIDUALS_COPY.RETIRE_ACTION}</Button>
        </span>
      ),
    },
  ];
  return (
    <DataTable
      ariaLabel={INDIVIDUALS_COPY.TABLE_ARIA}
      columns={columns}
      rows={items}
      rowKey={(row) => row.individualId}
      empty={items.length === 0 ? {
        icon: Search,
        title: INDIVIDUALS_COPY.LIST_EMPTY,
      } : undefined}
      minWidth={480}
    />
  );
}
