// GraphExplorerToolbar — 图谱检索枢纽拓扑 tab 工具栏：关系类型过滤 chip + 范围切换
// chip 色点/边色同源 RELATION_COLORS；中文标签取 ontology-registry SSOT（未登记类型显示原始枚举）
// 观感口径（2026-10-16 全表一致性扫描批延伸）：壳＝内嵌面语言（bg-surface-root，对齐工作区工具栏）；
// 分段与 chip＝药丸形（对齐全仓分段控件语言）；按钮底座＝ui/button（B1）；计数＝text-kg-xs（对齐表格 meta 刻度）。
import type { ScopeMode } from "@/lib/topology-types";
import { DEFAULT_RELATION_COLOR, RELATION_COLORS } from "@/lib/topology-types";
import { relationTypeLabel } from "@/lib/ontology";
import { Button } from "@/components/ui/button";
import { GRAPH_TOOLBAR_COPY, ddRelationCount, graphToolbarShownCount, graphToolbarTypeTitle } from "./data-dashboard-copy";

interface Props {
  /** 当前数据中出现的关系类型（去重排序） */
  availableTypes: string[];
  /** 已启用的过滤类型；空集 = 全部显示 */
  enabledTypes: Set<string>;
  onToggleType: (type: string) => void;
  scope: ScopeMode;
  onScopeChange: (scope: ScopeMode) => void;
  shownEdges: number;
  totalEdges: number;
}

const SCOPE_OPTIONS: Array<{ value: ScopeMode; label: string; hint: string }> = [
  { value: "full", label: GRAPH_TOOLBAR_COPY.SCOPE_FULL, hint: GRAPH_TOOLBAR_COPY.SCOPE_FULL_HINT },
  { value: "architecture", label: GRAPH_TOOLBAR_COPY.SCOPE_ARCH, hint: GRAPH_TOOLBAR_COPY.SCOPE_ARCH_HINT },
];

export function GraphExplorerToolbar({ availableTypes, enabledTypes, onToggleType, scope, onScopeChange, shownEdges, totalEdges }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-root px-3 py-2 ring-1 ring-border-thin">
      {availableTypes.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={GRAPH_TOOLBAR_COPY.TYPE_FILTER_ARIA}>
          {availableTypes.map((type) => {
            const on = enabledTypes.size === 0 || enabledTypes.has(type);
            const color = RELATION_COLORS[type] || DEFAULT_RELATION_COLOR;
            const label = relationTypeLabel(type);
            return (
              <Button
                key={type}
                type="button"
                variant="ghost"
                aria-pressed={on}
                onClick={() => onToggleType(type)}
                title={graphToolbarTypeTitle(type)}
                className={`h-auto gap-1.5 rounded-md px-2.5 py-1 text-xs ring-1 ${on ? "bg-accent-bg text-accent-base ring-accent-base/30 hover:bg-accent-bg" : "bg-surface-card text-text-hint ring-border-thin hover:text-text-sub"}`}
              >
                <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                {label}
              </Button>
            );
          })}
        </div>
      )}
      {/* 信息量口径（2026-10-16）：显示数＝类型过滤＋范围切换后可见边数；总数 0 隐藏（页面空态已表达，
          双 0 无信息）；无过滤时单数、过滤后双数示差 */}
      {totalEdges > 0 && (
        <span className="tabular-nums text-kg-xs text-text-hint" data-testid="relation-filter-count">
          {shownEdges === totalEdges ? ddRelationCount(totalEdges) : graphToolbarShownCount(shownEdges, totalEdges)}
        </span>
      )}
      <div className="ml-auto flex items-center gap-1" role="group" aria-label={GRAPH_TOOLBAR_COPY.SCOPE_SWITCH_ARIA}>
        {SCOPE_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            type="button"
            variant="ghost"
            aria-pressed={scope === opt.value}
            title={opt.hint}
            onClick={() => onScopeChange(opt.value)}
            className={`h-auto rounded-md px-3 py-1 text-xs ${scope === opt.value ? "bg-accent-base text-accent-contrast hover:bg-accent-base" : "text-text-sub hover:bg-surface-hover hover:text-text-main"}`}
          >
            {opt.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
