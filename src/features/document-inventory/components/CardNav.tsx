import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import { useClickOutside } from "@/hooks/useClickOutside";
import { createPortal } from "react-dom";
import "./CardNav.css";
import { DOCUMENT_SEARCH_COPY } from "../document-inventory-copy";

export interface CardNavLink {
  label: string;
  href: string;
  ariaLabel: string;
  onClick?: () => void;
}

export interface CardNavItem {
  label: string;
  bgColor: string;
  textColor: string;
  links?: CardNavLink[];
  content?: ReactNode;
}

export interface CardNavProps {
  className?: string;
  searchSlot?: ReactNode;
  items: CardNavItem[];
  baseColor?: string;
  menuColor?: string;
  buttonBgColor?: string;
  buttonTextColor?: string;
}

export function CardNav({
  className,
  searchSlot,
  items,
  baseColor = "var(--color-surface-card)",
  menuColor = "var(--color-text-main)",
  buttonBgColor = "var(--color-accent-base)",
}: CardNavProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // 弹窗挂载瞬间 CSS 原生强制滚动置顶，零 JS 钩子时序依赖
  const setPanelRef = useCallback((el: HTMLDivElement | null) => {
    panelRef.current = el;
    if (el) el.scrollTop = 0;
  }, []);

  // 弹窗定位 — position:fixed + portal to body 彻底脱离父级包含块
  const panelStyle: React.CSSProperties = (() => {
    if (!btnRef.current) return { visibility: "hidden" };
    const r = btnRef.current.getBoundingClientRect();
    return {
      position: "fixed",
      left: r.left,
      top: r.bottom + 8,
      width: 280,
      maxHeight: 420,
      // Keep the portalled menu above page content, but below global drawers (z-modal).
      zIndex: 40,
      backgroundColor: "var(--color-surface-card)",
      minWidth: 240,
      padding: "8px 0",
      overflow: "auto",
    };
  })();

  // 滚动/缩放时重算弹窗位置
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!open) return;
    const bump = () => setTick((t) => t + 1);
    window.addEventListener("resize", bump);
    window.addEventListener("scroll", bump, true);
    return () => {
      window.removeEventListener("resize", bump);
      window.removeEventListener("scroll", bump, true);
    };
  }, [open]);

  // 点击外部 / Escape 关闭
  useClickOutside(open, () => setOpen(false), [containerRef, panelRef]);

  return (
    <div ref={containerRef} className={`card-nav-container ${className ?? ""}`} style={{ zIndex: 10 }}>
      <div className="card-nav" style={{ backgroundColor: baseColor }}>
        {/* 汉堡按钮 */}
        <button
          ref={btnRef}
          type="button"
          className="card-nav-hamburger-btn"
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={DOCUMENT_SEARCH_COPY.FILTER_MENU_ARIA}
          onClick={() => setOpen((prev) => !prev)}
          style={{
            backgroundColor: open ? buttonBgColor : "transparent",
            borderColor: open ? buttonBgColor : "var(--color-line-edge)",
          }}
        >
          <svg width="18" height="14" viewBox="0 0 18 14" fill="none">
            <rect x="0" y="0"  width="18" height="2" rx="1" fill={menuColor} />
            <rect x="0" y="6"  width="18" height="2" rx="1" fill={menuColor} />
            <rect x="0" y="12" width="18" height="2" rx="1" fill={menuColor} />
          </svg>
        </button>

        {/* 搜索框 */}
        {searchSlot && <div className="card-nav-search">{searchSlot}</div>}

        {/* 下拉面板 → portal 到 body */}
        {open &&
          createPortal(
            <div ref={setPanelRef} className="card-nav-dropdown" role="menu" style={panelStyle}>
              {items.map((item, idx) => {
                const isLast = idx === items.length - 1;
                return (
                  <div
                    key={item.label}
                    className="dropdown-section"
                    style={{
                      padding: isLast ? "0" : "4px 0 8px 0",
                      borderBottom: isLast ? "none" : "1px solid var(--color-line-faint)",
                      marginBottom: isLast ? 0 : 4,
                    }}
                  >
                    <p
                      style={{
                        fontSize: "var(--text-sm)",
                        fontWeight: 600,
                        color: "var(--color-text-sub)",
                        padding: "4px 16px 6px",
                        margin: 0,
                        userSelect: "none",
                      }}
                    >
                      {item.label}
                    </p>
                    <div style={{ padding: "0 16px" }}>
                      {item.content ??
                        (item.links ?? []).map((link) => (
                          <a
                            key={link.label}
                            role="menuitem"
                            href={link.href}
                            aria-label={link.ariaLabel}
                            style={{
                              display: "block",
                              width: "100%",
                              textAlign: "left",
                              padding: "6px 4px",
                              margin: "2px 0",
                              borderRadius: 6,
                              fontSize: "var(--text-sm)",
                              color: "var(--color-text-hint)",
                              textDecoration: "none",
                              border: "none",
                              background: "none",
                              cursor: "pointer",
                            }}
                            onMouseEnter={(e) => {
                              (e.target as HTMLElement).style.backgroundColor =
                                "var(--color-line-faint)";
                            }}
                            onMouseLeave={(e) => {
                              (e.target as HTMLElement).style.backgroundColor = "transparent";
                            }}
                            onClick={(e) => {
                              if (link.onClick) {
                                e.preventDefault();
                                link.onClick();
                                setOpen(false);
                              }
                            }}
                          >
                            {link.label}
                          </a>
                        ))}
                    </div>
                  </div>
                );
              })}
            </div>,
            document.body,
          )}
      </div>
    </div>
  );
}
