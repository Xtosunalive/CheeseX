// ModeToggle — 显示模式按钮/菜单（PR②）
// 复刻原型 dayecho-mode-button.html 交互细节：160ms 上浮弹出、Esc/点空白关闭、
// 按钮图标随档位换、当前项打勾（aria-checked）。颜色全部走 L1 语义 token。
// 用法：<ModeToggle />（侧栏底部；自带定位上下文——菜单向上弹出）
import { useEffect, useRef, useState } from "react";
import type { ModeKind } from "@/hooks/use-mode";
import { MODE_TOGGLE_COPY, modeToggleTriggerLabel } from "../components-copy";

const MODE_OPTIONS: { value: ModeKind; label: string; icon: JSX.Element }[] = [
  {
    value: "light",
    label: MODE_TOGGLE_COPY.LIGHT,
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
      </svg>
    ),
  },
  {
    value: "dark",
    label: MODE_TOGGLE_COPY.DARK,
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />
      </svg>
    ),
  },
  {
    value: "warm",
    label: MODE_TOGGLE_COPY.WARM,
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14z" />
        <path d="M5 19c3-4 6-7 10-9" />
      </svg>
    ),
  },
  {
    value: "auto",
    label: MODE_TOGGLE_COPY.AUTO,
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3.5" y="4.5" width="17" height="12" rx="2" />
        <path d="M8 20h8M12 16.5V20" />
      </svg>
    ),
  },
];

interface ModeToggleProps {
  mode: ModeKind;
  onModeChange: (mode: ModeKind) => void;
}

export function ModeToggle({ mode, onModeChange }: ModeToggleProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Esc 关闭 + 点空白关闭（原型同款行为）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const current = MODE_OPTIONS.find((o) => o.value === mode) ?? MODE_OPTIONS[3];

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={modeToggleTriggerLabel(current.label)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={modeToggleTriggerLabel(current.label)}
        onClick={() => setOpen((v) => !v)}
        className="grid size-[38px] place-items-center rounded-md border border-accent-base/30 bg-accent-bg text-accent-base transition-colors hover:bg-accent-bg-strong hover:border-accent-base/50 aria-expanded:border-accent-base/50 aria-expanded:bg-accent-bg-strong"
      >
        <span className="[&>svg]:h-[18px] [&>svg]:w-[18px] [&>svg]:fill-none [&>svg]:stroke-current [&>svg]:stroke-[1.8px] [&>svg]:[stroke-linecap:round] [&>svg]:[stroke-linejoin:round]">
          {current.icon}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label={MODE_TOGGLE_COPY.MENU_TITLE}
          className="absolute bottom-[calc(100%+8px)] right-0 z-docked w-[176px] rounded-md border border-border-thin bg-surface-card p-2 shadow-popover"
          style={{ animation: "modeMenuRise 160ms ease both" }}
        >
          <p className="mb-1.5 px-2 text-xs tracking-wider text-text-hint">{MODE_TOGGLE_COPY.MENU_TITLE}</p>
          {MODE_OPTIONS.map((opt) => {
            const on = opt.value === mode;
            return (
              <button
                key={opt.value}
                type="button"
                role="menuitemradio"
                aria-checked={on}
                onClick={() => { onModeChange(opt.value); setOpen(false); }}
                className="flex min-h-[38px] w-full items-center gap-2.5 rounded-sm bg-transparent px-2.5 text-left text-sm text-text-main transition-colors hover:bg-surface-hover aria-checked:font-bold"
              >
                <span
                  aria-hidden="true"
                  className={
                    on
                      ? "flex-none text-accent-base [&>svg]:h-[18px] [&>svg]:w-[18px] [&>svg]:fill-none [&>svg]:stroke-current [&>svg]:stroke-[1.8px] [&>svg]:[stroke-linecap:round] [&>svg]:[stroke-linejoin:round]"
                      : "flex-none text-text-hint [&>svg]:h-[18px] [&>svg]:w-[18px] [&>svg]:fill-none [&>svg]:stroke-current [&>svg]:stroke-[1.8px] [&>svg]:[stroke-linecap:round] [&>svg]:[stroke-linejoin:round]"
                  }
                >
                  {opt.icon}
                </span>
                <span className={on ? "text-accent-base" : undefined}>{opt.label}</span>
                {on && <span className="ml-auto text-accent-base" aria-hidden="true">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
