// TaxonomyListEditor — W4 迁移（决策卡 §12.1）：div 伪装行→DataTable 语义表（D12）；
// 行内输入收编 EditableCell（I5）；删除钮换 ui/button（B1）。删除对象＝未保存草稿值的可逆操作
// （保存前可放弃）——WP-146 件1 起去掉阻断确认：删除即执行＋sonner toast 5 秒内撤销（按原下标
// 回插，经 ref 读最新 values 防闭包过期）。
import { useRef, useState } from "react";
import { TERM } from "@/constants/term-const";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DataTable } from "@/components/data-table/DataTable";
import { EditableCell } from "@/components/data-table/editable-cell-group";
import type { Column } from "@/components/data-table/types";
import { Button } from "@/components/ui/button";
import { TAXONOMY_LIST_COPY, smLabelIndexAria } from "../schema-manager-copy";

interface TaxonomyListEditorProps {
  label: string;
  values: string[];
  disabled: boolean;
  onChange: (values: string[]) => void;
}

export function TaxonomyListEditor({ label, values, disabled, onChange }: TaxonomyListEditorProps) {
  const [newValue, setNewValue] = useState("");
  const normalizedNewValue = newValue.trim();
  // 撤销回插读最新 props（toast 闭包里的 values 会过期）
  const valuesRef = useRef(values);
  valuesRef.current = values;

  const addValue = () => {
    if (!normalizedNewValue || values.includes(normalizedNewValue)) return;
    onChange([...values, normalizedNewValue]);
    setNewValue("");
  };

  const deleteValue = (index: number) => {
    const removed = { index, value: values[index] };
    onChange(values.filter((_value, itemIndex) => itemIndex !== index));
    toast.success(TERM.DELETED_NOTICE, {
      duration: 5000,
      action: {
        label: TERM.UNDO_ACTION,
        onClick: () => {
          const next = [...valuesRef.current];
          next.splice(Math.min(removed.index, next.length), 0, removed.value);
          onChange(next);
        },
      },
    });
  };

  const columns: Array<Column<{ value: string; index: number }>> = [
    {
      key: "value",
      title: label,
      render: ({ value, index }) => (
        <EditableCell.Text
          aria-label={smLabelIndexAria(label, index + 1)}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(values.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}
        />
      ),
    },
    {
      key: "actions",
      title: "",
      align: "right",
      width: 48,
      render: ({ value, index }) => (
        <Button type="button" variant="ghost" size="icon" aria-label={`${TAXONOMY_LIST_COPY.DELETE_PREFIX}${label} ${value}`} title={`${TAXONOMY_LIST_COPY.DELETE_PREFIX}${label}`} disabled={disabled} onClick={() => deleteValue(index)} className="h-7 w-7 text-status-error hover:bg-status-error-3">
          <Trash2 className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  return (
    <section aria-label={`${label}${TAXONOMY_LIST_COPY.LIST_SUFFIX}`} className="space-y-3">
      <DataTable
        ariaLabel={`${label}${TAXONOMY_LIST_COPY.TABLE_SUFFIX}`}
        columns={columns}
        rows={values.map((value, index) => ({ value, index }))}
        rowKey={({ value, index }) => `${value}-${index}`}
        density="md"
        empty={{ title: `${TAXONOMY_LIST_COPY.EMPTY_PREFIX}${label}` }}
      />
      <div className="flex max-w-xl items-center gap-2">
        <input aria-label={`${TAXONOMY_LIST_COPY.ADD_PREFIX}${label}`} value={newValue} disabled={disabled} onChange={(event) => setNewValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addValue(); }} className="h-8 min-w-0 flex-1 rounded-md bg-surface-root px-2 text-sm text-text-main ring-1 ring-border-thin" />
        <button type="button" aria-label={`${TAXONOMY_LIST_COPY.ADD_ACTION_PREFIX}${label}`} onClick={addValue} disabled={disabled || !normalizedNewValue || values.includes(normalizedNewValue)} className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs text-text-main ring-1 ring-border-thin hover:bg-surface-hover disabled:opacity-40">
          <Plus className="h-4 w-4" />{TAXONOMY_LIST_COPY.ADD_ACTION}
        </button>
      </div>
    </section>
  );
}
