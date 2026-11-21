// WP-210（SPEC-100 批 4）：派生个体清单表——列＝个体 ID/标题/操作（编辑/退役）。
import type { IndividualListItem } from "../individuals-types";
import { INDIVIDUALS_COPY } from "../individuals-copy";

interface Props {
  items: IndividualListItem[];
  onEdit: (item: IndividualListItem) => void;
  onRetire: (item: IndividualListItem) => void;
  busy?: boolean;
}

export function DerivedIndividualsTable({ items, onEdit, onRetire, busy }: Props) {
  if (items.length === 0) return <p className="text-xs text-text-hint">{INDIVIDUALS_COPY.LIST_EMPTY}</p>;
  return (
    <table className="w-full text-xs" data-testid="individuals-table">
      <thead>
        <tr className="text-left text-text-hint">
          <th className="px-2 py-1">{INDIVIDUALS_COPY.COL_ID}</th>
          <th className="px-2 py-1">{INDIVIDUALS_COPY.COL_TITLE}</th>
          <th className="px-2 py-1">{INDIVIDUALS_COPY.COL_ACTIONS}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.individualId} className="border-t border-border-thin">
            <td className="px-2 py-1">{item.individualId}</td>
            <td className="px-2 py-1">{item.title}</td>
            <td className="px-2 py-1">
              <button type="button" className="mr-2 rounded px-2 py-0.5 ring-1 ring-border-thin" disabled={busy} onClick={() => onEdit(item)}>{INDIVIDUALS_COPY.EDIT_ACTION}</button>
              <button type="button" className="rounded px-2 py-0.5 ring-1 ring-status-error-6 text-status-error" disabled={busy} onClick={() => onRetire(item)}>{INDIVIDUALS_COPY.RETIRE_ACTION}</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
