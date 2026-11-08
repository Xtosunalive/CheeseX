import { ArrowDownNarrowWide, ArrowUpNarrowWide, Check, ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { tableSortAria, tableSortMenuLabel } from "../components-copy";

export type TableSortDirection = "asc" | "desc";

type Props = {
  label: string;
  active: boolean;
  direction: TableSortDirection;
  ascendingLabel: string;
  descendingLabel: string;
  onChange: (direction: TableSortDirection) => void;
};

function MenuCheck({ active }: { active: boolean }) {
  return <span className="flex h-4 w-4 shrink-0 items-center justify-center">{active && <Check className="h-4 w-4" />}</span>;
}

// 观感口径（Master 2026-10-16 裁定）：默认态＝表头基准（主色＋semibold，与不可排序纯文本表头同观感）；
// 三态保留——hover 浅底、当前排序列 accent 紫。此前默认灰 hint/medium 系历史 affordance 设计，
// 同页混排可排序/不可排序两表时撞脸（article-workflow 实见），收敛为主色基准。
// 几何口径（antd 对照批二修）：文字顶格于单元格内距（无按钮内缩、无负外距——首版 -mx 外扩
// 在 md 密度下把文字拉到距边框 2px，Master 实见贴边，本修撤销）、箭头贴列右缘（justify-between）、
// 不定高；悬停高亮＝整格（preset `.data-table__th:has(> button):hover`，antd th-has-sorters 同构），
// 按钮不再自带底色。交互仍为下拉菜单（卡 §十三.2 裁定不动）。

export function TableSortHeader({ label, active, direction, ascendingLabel, descendingLabel, onChange }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={tableSortAria(label)} className={`group inline-flex max-w-full w-full items-center justify-between gap-1 text-left font-semibold outline-none focus-visible:ring-1 focus-visible:ring-border-focus ${active ? "text-accent-base" : "text-text-main"}`}>
          <span className="truncate">{label}</span>
          {active ? direction === "desc" ? <ArrowDownNarrowWide className="h-4 w-4 shrink-0" /> : <ArrowUpNarrowWide className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0 opacity-70 group-hover:opacity-100" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="w-48 rounded-xl border-0 bg-popover p-1 text-xs text-popover-foreground shadow-popover ring-1 ring-border-thin">
        <DropdownMenuLabel className="px-2.5 py-1.5 text-kg-xs font-medium text-text-hint">{tableSortMenuLabel(label)}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onChange("asc")} className="gap-2 rounded-lg px-2.5 py-2 text-xs focus:bg-surface-hover focus:text-text-main"><MenuCheck active={active && direction === "asc"} /><ArrowUpNarrowWide className="h-4 w-4" />{ascendingLabel}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onChange("desc")} className="gap-2 rounded-lg px-2.5 py-2 text-xs focus:bg-surface-hover focus:text-text-main"><MenuCheck active={active && direction === "desc"} /><ArrowDownNarrowWide className="h-4 w-4" />{descendingLabel}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
