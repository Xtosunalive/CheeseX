// LayerEditor — 分层编辑器（SCHEMA-IA-001 批6：词条清单型编辑器迁移 DataTable 基座首例）
// 形态迁移：自研 div 网格行 → DataTable 语义表（列定义/三态/展开行/行操作统一件）；
// 行内编辑统一 EditableCell.Text；富选择（颜色/布局/域）保留 FilterSelect（基座纪律：
// 富控件调用方自管）；拖拽排序与展开区（允许实体类别/依赖的层）语义原样保留。
// 迁移不破坏面：测试零直接断言（grep 核实）；视图层 props 口径不变。
import * as React from "react";
import { useState } from "react";
import { Circle, Plus } from "lucide-react";
import type { LayerDef } from "./schema-manager-types";
import { LAYER_COLOR_MAP, LAYER_COLOR_OPTIONS, VALID_LAYOUTS } from "./schema-manager-types";
import { FilterSelect } from "@/components/filter-select";
import { DataTable } from "@/components/data-table/DataTable";
import { EditableCell } from "@/components/data-table/editable-cell-group";
import type { Column } from "@/components/data-table/types";
import { rowActionColumn } from "@/components/data-table/row-action-column";
import { LAYER_COPY } from "./schema-manager-copy";
import { TERM } from "@/constants/term-const";

interface LayerEditorProps {
  layers: LayerDef[];
  domains: Record<string, string>;
  categories: string[];
  onLayersChange: (layers: LayerDef[]) => void;
  disabled?: boolean;
}

interface LayerRow {
  layer: LayerDef;
  index: number;
}

export function LayerEditor({ layers, domains, categories, onLayersChange, disabled }: LayerEditorProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const updateLayer = (index: number, patch: Partial<LayerDef>) => {
    onLayersChange(layers.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  };

  const removeLayer = (index: number) => {
    onLayersChange(layers.filter((_, i) => i !== index));
  };

  const addLayer = () => {
    onLayersChange([...layers, { id: "", label: "", color: "gray", layout: "central" as const }]);
  };

  const handleDrop = (index: number) => {
    if (dragIndex === null || dragIndex === index) {
      setDragIndex(null);
      return;
    }
    const next = [...layers];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(index, 0, moved);
    onLayersChange(next);
    setDragIndex(null);
  };

  const rows: LayerRow[] = layers.map((layer, index) => ({ layer, index }));

  const columns: Array<Column<LayerRow>> = [
    {
      key: "id",
      title: "ID",
      width: 128,
      render: ({ layer, index }) => (
        <EditableCell.Text
          aria-label={LAYER_COPY.ROW_ARIA(index + 1, LAYER_COPY.COL_ID)}
          value={layer.id}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateLayer(index, { id: e.target.value })}
          placeholder="ID"
          disabled={disabled}
        />
      ),
    },
    {
      key: "label",
      title: LAYER_COPY.COL_LABEL,
      render: ({ layer, index }) => (
        <EditableCell.Text
          aria-label={LAYER_COPY.ROW_ARIA(index + 1, LAYER_COPY.COL_LABEL)}
          value={layer.label}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateLayer(index, { label: e.target.value })}
          placeholder={LAYER_COPY.COL_LABEL}
          disabled={disabled}
        />
      ),
    },
    {
      key: "color",
      title: LAYER_COPY.COL_COLOR,
      width: 120,
      render: ({ layer, index }) => (
        <span className="flex items-center gap-1.5">
          <Circle
            className="h-3 w-3 shrink-0"
            fill={LAYER_COLOR_MAP[layer.color] ?? LAYER_COLOR_MAP.gray}
            stroke={LAYER_COLOR_MAP[layer.color] ?? LAYER_COLOR_MAP.gray}
            aria-hidden
          />
          <FilterSelect
            ariaLabel={`${layer.label || layer.id || LAYER_COPY.FALLBACK_LAYER_NAME}${LAYER_COPY.COLOR_ARIA_SUFFIX}`}
            title={LAYER_COPY.COLOR_PICK_TITLE}
            searchPlaceholder={LAYER_COPY.COLOR_FILTER_PLACEHOLDER}
            value={layer.color}
            onValueChange={(value) => updateLayer(index, { color: value as string })}
            disabled={disabled}
            className="w-20 rounded-lg"
            options={LAYER_COLOR_OPTIONS.map((color) => ({ value: color, label: color, group: LAYER_COPY.GROUP_COLOR }))}
          />
        </span>
      ),
    },
    {
      key: "layout",
      title: LAYER_COPY.COL_LAYOUT,
      width: 132,
      render: ({ layer, index }) => (
        <FilterSelect
          ariaLabel={`${layer.label || layer.id || LAYER_COPY.FALLBACK_LAYER_NAME}${LAYER_COPY.LAYOUT_ARIA_SUFFIX}`}
          title={LAYER_COPY.LAYOUT_PICK_TITLE}
          searchPlaceholder={LAYER_COPY.LAYOUT_FILTER_PLACEHOLDER}
          value={layer.layout}
          onValueChange={(value) => updateLayer(index, { layout: value as LayerDef["layout"] })}
          disabled={disabled}
          className="w-28 rounded-lg"
          options={VALID_LAYOUTS.map((layout) => ({ value: layout, label: layout, group: LAYER_COPY.GROUP_LAYOUT }))}
        />
      ),
    },
    {
      key: "actions",
      title: "",
      width: 72,
      render: ({ index }) => (
        <span
          draggable={!disabled}
          onDragStart={() => setDragIndex(index)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => handleDrop(index)}
          onDragEnd={() => setDragIndex(null)}
          title={LAYER_COPY.DRAG_HANDLE_TITLE}
          className={`inline-flex cursor-grab text-text-placeholder hover:text-text-sub ${disabled ? "cursor-default" : ""}`}
        >
          ⠿
        </span>
      ),
    },
    ...(disabled
      ? []
      : [rowActionColumn<LayerRow>({ label: LAYER_COPY.DELETE_ROW_ACTION, danger: true, onRun: (row) => removeLayer(row.index) })]),
  ];

  return (
    <div className="space-y-3">
      {!disabled && (
        <button
          onClick={addLayer}
          className="flex items-center gap-1.5 rounded-md border border-dashed border-border-thin bg-surface-hover px-3 py-1.5 text-xs text-text-main/80 hover:bg-surface-root transition-colors"
        >
          <Plus className="h-4 w-4" />
          {LAYER_COPY.ADD_LAYER}
        </button>
      )}
      <DataTable
        ariaLabel={LAYER_COPY.TABLE_ARIA}
        columns={columns}
        rows={rows}
        rowKey={(row) => `layer-${row.index}`}
        density="sm"
        expandable={{
          rowExpanded: (row) => expandedIndex === row.index,
          onToggle: (row) => setExpandedIndex(expandedIndex === row.index ? null : row.index),
          render: ({ layer, index }) => (
            <div className="grid gap-3 p-2 md:grid-cols-3">
              <FilterSelect
                ariaLabel={`${layer.label || layer.id}${LAYER_COPY.DOMAIN_ARIA_SUFFIX}`}
                title={LAYER_COPY.DOMAIN_PICK_TITLE}
                value={layer.domain_id || ""}
                onValueChange={(value) => updateLayer(index, { domain_id: value as string })}
                disabled={disabled}
                options={[
                  { value: "", label: LAYER_COPY.DOMAIN_UNBOUND, group: LAYER_COPY.GROUP_SCOPE },
                  ...Object.entries(domains).map(([value, label]) => ({ value, label, group: TERM.DOMAIN })),
                ]}
              />
              <fieldset>
                <legend className="text-xs text-text-hint">{LAYER_COPY.LEGEND_ALLOWED_CATEGORIES}</legend>
                <div className="mt-1 flex flex-wrap gap-2">
                  {categories.map((category) => (
                    <label key={category} className="text-xs text-text-main">
                      <input
                        className="mr-1"
                        type="checkbox"
                        disabled={disabled}
                        checked={(layer.allowed_categories || []).includes(category)}
                        onChange={() =>
                          updateLayer(index, {
                            allowed_categories: (layer.allowed_categories || []).includes(category)
                              ? (layer.allowed_categories || []).filter((item) => item !== category)
                              : [...(layer.allowed_categories || []), category],
                          })
                        }
                      />
                      {category}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="text-xs text-text-hint">{LAYER_COPY.LEGEND_ALLOWED_DEPENDENCIES}</legend>
                <div className="mt-1 flex flex-wrap gap-2">
                  {layers
                    .filter((candidate) => candidate.id !== layer.id)
                    .map((candidate) => (
                      <label key={candidate.id} className="text-xs text-text-main">
                        <input
                          className="mr-1"
                          type="checkbox"
                          disabled={disabled}
                          checked={(layer.allowed_dependencies || []).includes(candidate.id)}
                          onChange={() =>
                            updateLayer(index, {
                              allowed_dependencies: (layer.allowed_dependencies || []).includes(candidate.id)
                                ? (layer.allowed_dependencies || []).filter((item) => item !== candidate.id)
                                : [...(layer.allowed_dependencies || []), candidate.id],
                            })
                          }
                        />
                        {candidate.label || candidate.id}
                      </label>
                    ))}
                </div>
              </fieldset>
            </div>
          ),
        }}
        empty={{ title: LAYER_COPY.EMPTY }}
      />
    </div>
  );
}

