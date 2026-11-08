// SidebarSearch — 侧边栏常驻搜索框（对应 shadcn 文档站 search-form 位置）
// 真实能力：页面快速跳转——输入页面名实时过滤，回车跳第一个、点击跳对应；
// 纯前端，数据源为 NAV_GROUPS（不引入全局内容搜索，那需后端建索引）。
// 基础件走 ui-kit（Input/Button），不写原生表单控件。
import * as React from "react";
import { Search } from "lucide-react";
import type { NavGroup } from "@/components/app-navigation";
import { SidebarGroup, SidebarGroupContent } from "@/components/aria/sidebar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SIDEBAR_SEARCH_COPY } from "../components-copy";

interface SidebarSearchProps {
  navGroups: NavGroup[];
  onNavigate: (id: string) => void;
}

export function SidebarSearch({ navGroups, onNavigate }: SidebarSearchProps) {
  const [query, setQuery] = React.useState("");
  const [focused, setFocused] = React.useState(false);

  const allPages = navGroups.flatMap((g) =>
    g.items.map((item) => ({ id: item.id, label: item.label, groupLabel: g.label }))
  );

  const q = query.trim().toLowerCase();
  const matches = q
    ? allPages.filter((p) => p.label.toLowerCase().includes(q)).slice(0, 8)
    : [];

  const open = focused && q.length > 0;

  const go = (id: string) => {
    onNavigate(id);
    setQuery("");
    setFocused(false);
  };

  return (
    <SidebarGroup className="relative p-2 pt-0">
      <SidebarGroupContent className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 z-sticky size-4 -translate-y-1/2 text-text-hint" />
        <Input
          type="text"
          value={query}
          aria-label={SIDEBAR_SEARCH_COPY.SEARCH_ARIA}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && matches.length > 0) {
              e.preventDefault();
              go(matches[0].id);
            }
          }}
          placeholder={SIDEBAR_SEARCH_COPY.SEARCH_PLACEHOLDER}
          className="h-9 rounded-lg border-border-thin bg-surface-card pl-8 text-text-main placeholder:text-text-hint focus-visible:border-accent-base focus-visible:ring-0"
        />
        {open && (
          <div className="absolute left-2 right-2 top-10 z-popover overflow-hidden rounded-md border border-border-thin bg-card shadow-popover">
            {matches.length === 0 ? (
              <div className="px-3 py-2 text-xs text-text-hint">{SIDEBAR_SEARCH_COPY.NO_MATCH}</div>
            ) : (
              matches.map((m) => (
                <Button
                  key={m.id}
                  type="button"
                  variant="ghost"
                  // onMouseDown 先于 input blur，避免下拉先消失
                  onMouseDown={(e) => {
                    e.preventDefault();
                    go(m.id);
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-none px-3 py-2 text-sm font-normal hover:bg-surface-hover"
                >
                  <span className="truncate text-text-main">{m.label}</span>
                  <span className="shrink-0 text-xs text-text-hint">{m.groupLabel}</span>
                </Button>
              ))
            )}
          </div>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
