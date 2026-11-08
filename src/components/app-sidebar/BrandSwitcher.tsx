// BrandSwitcher — 侧边栏顶部品牌区（对应 shadcn 文档站 version-switcher 位置）
// 布局：圆角方块 logo ＋ 应用名（粗体）＋ 版本号（小字）
// 注：当前无多版本/多工作区可切换，故为静态品牌展示（非按钮、无下拉），
// 不放假交互；版本号与 package.json 单源一致。
import { SidebarMenu, SidebarMenuItem } from "@/components/aria/sidebar";
import { TERM } from "@/constants/term-const";

const APP_VERSION = "1.0.0";

export function BrandSwitcher() {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <div className="flex h-12 w-full items-center gap-2.5 px-2">
          {/* 圆角方块 logo：浅色模式黑底白兽，深色模式亮底黑兽 */}
          <div className="flex aspect-square size-9 shrink-0 items-center justify-center rounded-xl bg-text-main">
            <img
              src="/brand-logo.png"
              alt={TERM.APP_NAME}
              className="size-6 object-contain dark:hidden"
            />
            <img
              src="/brand-logo-dark.png"
              alt=""
              className="hidden size-6 object-contain dark:block"
            />
          </div>
          <div className="grid flex-1 min-w-0 text-left leading-tight">
            <span className="truncate text-[0.95rem] font-bold text-text-main">
              cheeseh
            </span>
            <span className="truncate text-xs text-text-hint">
              v{APP_VERSION}
            </span>
          </div>
        </div>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
