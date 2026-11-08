import { useState, useEffect, useRef, useCallback } from "react";
import { useClickOutside } from "@/hooks/useClickOutside";
import { Search } from "lucide-react";
import { DocumentSearchBar } from "@/features/document-inventory/components";
import { TERM } from "@/constants/term-const";
import { readNavLocation } from "@/lib/navigation";
import { useNavLocation } from "@/hooks/use-nav-location";
import { SMALL_UI_COPY } from "../components-copy";

/**
 * FloatingSearch — 文档搜索，应用栏文档流内控件。
 *
 * 触发器渲染在应用栏右区（由 PageHeader 挂载）；搜索面板与遮罩保持
 * fixed 定位，顶部位置由共享变量 --app-bar-height 派生。
 *
 * Flow: click trigger / press `/` → open panel → autofocus → Enter →
 * navigate to #/document-inventory → auto-close.
 */
export function FloatingSearch() {
  const [open, setOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { route } = useNavLocation();

  // On document-inventory, focus the existing page search bar instead of opening the panel
  const triggerSearch = useCallback(() => {
    if (readNavLocation().route === "document-inventory") {
      const input = document.querySelector<HTMLInputElement>(`input[aria-label="${TERM.DOCUMENT_SEARCH_INPUT}"]`);
      input?.scrollIntoView?.({ block: "center", behavior: "smooth" });
      setTimeout(() => input?.focus(), 300);
      return;
    }
    setOpen((prev) => !prev);
  }, []);

  // Close when hash navigates to document-inventory
  useEffect(() => {
    if (route === "document-inventory") setOpen(false);
  }, [route]);

  // Autofocus the search input when the card opens
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      const input = cardRef.current?.querySelector<HTMLInputElement>(`input[aria-label="${TERM.DOCUMENT_SEARCH_INPUT}"]`);
      input?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, [open]);

  // Close on outside click / ESC
  useClickOutside(open, () => setOpen(false), [cardRef, buttonRef]);

  // `/` shortcut — ignored inside editing contexts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (target.isContentEditable || target.closest("[contenteditable='true']")) return;
      }
      e.preventDefault();
      triggerSearch();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [triggerSearch]);

  return (
    <>
      {/* ── 全屏压暗层（Master 2026-10-30 弹窗视觉一致性裁定）：与模态同口径盖过壳件
          （z-overlay > z-chrome，打开时顶栏一并变暗）；均匀压暗不再做中心渐进遮罩——
          渐进遮罩在四角留亮，与弹窗黑罩不一致。关闭＝外部点击 / ESC / 再按 /。 ── */}
      {open && (
        <div
          className="fixed inset-0 z-overlay opacity-100 transition-opacity duration-[var(--duration-base)]"
          style={{
            background: "var(--color-overlay)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
          }}
          aria-hidden="true"
        />
      )}

      {/* ── Search trigger — in-flow application bar control（纯图标，尺寸与实体全景一致；快捷键提示在 tooltip） ── */}
      <button
        ref={buttonRef}
        type="button"
        onClick={triggerSearch}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border-thin text-text-sub transition-all duration-[var(--duration-base)] hover:bg-surface-hover hover:text-text-main"
        aria-label={open ? TERM.CLOSE_DOCUMENT_SEARCH_ACTION : TERM.DOCUMENT_SEARCH_ACTION}
        title={open ? TERM.CLOSE_DOCUMENT_SEARCH_ACTION : `${TERM.DOCUMENT_SEARCH_ACTION}（/）`}
      >
        <Search className="h-4 w-4 shrink-0" />
      </button>

      {/* ── Glassmorphism expanded search card — only rendered when open, top-centered ── */}
      {open && (
        <div
          ref={cardRef}
          className="fixed top-[calc(var(--app-bar-height)+0.5rem)] right-4 left-4 z-overlay mx-auto max-w-[720px] transition-all duration-[var(--duration-base)] opacity-100 translate-y-0 scale-100"
        >
          <div
            className="rounded-2xl
              bg-[var(--color-glass)]
              backdrop-blur-2xl
              border border-border-thin
              shadow-[0_8px_32px_var(--color-overlay),0_2px_8px_var(--color-overlay),inset_0_0_0_1px_var(--color-border-thin)]"
          >
            <div className="p-5">
              <p className="text-xs text-text-hint mb-3">
                {SMALL_UI_COPY.FLOATING_SEARCH_INTRO}
              </p>
              <DocumentSearchBar navigateOnSearch />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
