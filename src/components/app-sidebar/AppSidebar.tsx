// AppSidebar — 全局导航（基于官方 shadcn aria sidebar 模板）
// 5 个任务域分组 + 全部二级页面常驻可见
// 交互由 SidebarProvider 接管（受控 open + pinned 持久化 + 快捷键 b + 移动端抽屉）
//
// 保留项（用户明确）：
// - aria-label / data-testid 测试契约
// - 选中态 bg-accent-base text-accent-contrast（#788/#793 语义；2026-10-05 收尾批 text-white 收口）
// - data-navigation-kind="route" 路由标识
// - onNavigate 路由行为不变
// 移除项（#1747 用户拍板）：侧边栏悬停 Tooltip 全部下线（分组标题+菜单项），
// MVP 步骤徽标不再经 tooltip 展示；说明句/徽标数据链已整链退役（#1756 翻案，见 ADR053）
//
// PR③ 侧栏皮肤（参考 shadcn 文档站侧边栏，Master 2026-10-29 拍板）：
// - 顶部 = 版本切换器（应用名＋版本，version-switcher）＋ 搜索框（search-form）
// - 导航项 = 纯文字无图标（分组标题为弱化小字，选中项浅灰圆角底）
// - 底部 = 设置入口（头像+「设置」）+ 模式按钮（ModeToggle，向上弹菜单）
// - 图标字段单源在 NAV_GROUPS 数据结构（App.tsx），PageHeader 等其他消费方共用
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/aria/sidebar";
import { TERM } from "@/constants/term-const";
import type { NavGroup } from "@/components/app-navigation";
import { useMode } from "@/hooks/use-mode";
import { ModeToggle } from "@/components/app-shell/mode-toggle";
import { BrandSwitcher } from "./BrandSwitcher";
import { SidebarSearch } from "./SidebarSearch";
import { APP_SHELL_COPY } from "../components-copy";

interface AppSidebarProps {
  activeNav: string;
  navGroups: NavGroup[];
  onNavigate: (id: string) => void;
}

export function AppSidebar({ activeNav, navGroups, onNavigate }: AppSidebarProps) {
  const { mode, setMode } = useMode();

  return (
    // 侧边栏已无任何悬停 Tooltip（#1747）；若未来恢复，勿在此套裸 Provider——
    // Radix 默认 delayDuration=700 会就近覆盖 SidebarProvider 内建的官方 0ms（#1746）
    <Sidebar
      variant="floating"
      collapsible="offcanvas"
      role="complementary"
      aria-label={TERM.GLOBAL_NAVIGATION}
      data-testid="global-navigation"
    >
      {/* ── 顶部品牌区：logo＋应用名＋版本（对应 shadcn 文档站 version-switcher）。
          收起钮不在侧栏内——floating 布局由内容区 header 的 SidebarTrigger 控制 ── */}
      <SidebarHeader className="p-2 pb-0">
        <BrandSwitcher />
      </SidebarHeader>

      {/* ── 常驻搜索框：页面快速跳转（对应 search-form）── */}
      <SidebarSearch navGroups={navGroups} onNavigate={onNavigate} />

      <SidebarContent className="gap-0 px-3 pb-3">
        {navGroups.map((group) => {
          const GroupIcon = group.icon;

          // 单项组 → 直接 SidebarMenuButton（无子菜单）
          if (group.items.length === 1) {
            const item = group.items[0];
            const isActive = item.id === activeNav;
            return (
              <SidebarGroup key={group.id} className="p-0">
                <SidebarGroupContent>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        isActive={isActive}
                        data-navigation-kind="route"
                        aria-current={isActive ? "page" : undefined}
                        onClick={() => onNavigate(item.id)}
                        className={
                          isActive
                            ? "rounded-sm bg-accent-base text-accent-contrast hover:bg-accent-base hover:text-accent-contrast"
                            : "rounded-sm text-text-sub hover:bg-surface-hover hover:text-text-main"
                        }
                      >
                        <span className="text-[0.82rem] font-semibold">{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            );
          }

          // 多项组 → 分组标题 + SidebarMenuSub 纯文字项（原型皮肤：无图标）
          const isGroupActive = group.items.some((item) => item.id === activeNav);
          return (
            <SidebarGroup key={group.id} className="p-0">
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    {/* 分组标题（原型 nav-group-title：margin 12px 10px 4px）：label 保持裸文本子节点——
                        测试 getByText 契约（application-bar.test.tsx:123）要求命中 button 本身 */}
                    <SidebarMenuButton
                      isActive={isGroupActive}
                      aria-current={isGroupActive ? "location" : undefined}
                      className="mt-3 h-auto min-h-0 cursor-default whitespace-normal rounded-none px-0 py-1 text-[0.7rem] font-bold tracking-[0.05em] text-text-hint hover:bg-transparent focus-visible:bg-transparent"
                    >
                      <GroupIcon className="hidden" aria-hidden />
                      {group.label}
                    </SidebarMenuButton>
                    <SidebarMenuSub className="mx-0 border-l-0 px-0">
                      {group.items.map((item) => {
                        const isActive = item.id === activeNav;
                        return (
                          <SidebarMenuSubItem key={item.id}>
                            <SidebarMenuSubButton
                              isActive={isActive}
                              data-navigation-kind="route"
                              aria-current={isActive ? "page" : undefined}
                              onClick={() => onNavigate(item.id)}
                              className={
                                isActive
                                  ? "min-h-[30px] rounded-sm bg-accent-base px-[10px] text-accent-contrast hover:bg-accent-base hover:text-accent-contrast"
                                  : "min-h-[30px] rounded-sm px-[10px] text-text-sub hover:bg-surface-hover hover:text-text-main"
                              }
                            >
                              <span className="text-[0.82rem] font-semibold">{item.label}</span>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        );
                      })}
                    </SidebarMenuSub>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      {/* ── 底部：设置入口（头像+文字）+ 模式按钮（PR③ 原型皮肤；offcanvas 收起时整个侧栏移出，无需单藏）── */}
      <SidebarFooter className="mt-auto border-t border-sidebar-border px-3 py-3">
        <div className="relative flex items-center gap-1">
          <button
            type="button"
            aria-label={APP_SHELL_COPY.SETTINGS}
            onClick={() => onNavigate("schema")}
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md bg-transparent px-2 py-1.5 text-left font-bold text-text-main transition-colors hover:bg-surface-hover"
          >
            <span
              aria-hidden="true"
              className="grid size-[26px] shrink-0 place-items-center rounded-full bg-accent-base/15 text-accent-base [&>svg]:h-3.5 [&>svg]:w-3.5"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="9" r="4" />
                <path d="M4.5 20c1.2-3.6 4.2-5.5 7.5-5.5s6.3 1.9 7.5 5.5" />
              </svg>
            </span>
            <span className="truncate text-sm">{APP_SHELL_COPY.SETTINGS}</span>
          </button>
          <ModeToggle mode={mode} onModeChange={setMode} />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
