// useMode — 显示模式状态（四态：light / dark / warm / auto）
// 作用域：模式领域唯一事实源；挂载点 = <html>（data-mode 属性 + .dark 类同步）。
// 行为契约（PR②，原型 cheeseh-app-prototype.html + dayecho-mode-button.html）：
//   ① 默认 auto（跟随系统）；手动选择持久化 localStorage（键 cheeseh-mode）并覆盖默认
//   ② auto 档实时监听 prefers-color-scheme，系统切深浅立即响应
//   ③ .dark 类喂 index.css 的 @custom-variant dark（dark 档时挂，其余档摘除）
//   ④ 防闪由 index.html 内联脚本负责（首帧前解析）；本 hook 只接管运行时
// F4 批（2026-10-26，体检 F4 收账）：状态自「每组件独立 useState」升级为模块级共享
// store（useSyncExternalStore 订阅）——此前各消费方（侧栏按钮/主题预览）各持一份副本，
// 被动消费方（Toaster）无法跟随切换；升级后全体消费方同源同步，对外 API 不变。
// 语义保持：初始挂载只落 DOM 不写存储（「用户没选过」不固化）；显式 setMode 才持久化。
import { useCallback, useSyncExternalStore } from "react";

export type ModeKind = "light" | "dark" | "warm" | "auto";
/** localStorage 键（与 index.html 防闪脚本同一约定） */
export const MODE_STORAGE_KEY = "cheeseh-mode";

const VALID: ReadonlySet<string> = new Set(["light", "dark", "warm", "auto"]);

function readStored(): ModeKind {
  try {
    const v = localStorage.getItem(MODE_STORAGE_KEY);
    if (v && VALID.has(v)) return v as ModeKind;
  } catch { /* 隐私模式等存取失败 → 回落默认 */ }
  return "auto";
}

/** auto → 按系统解析为 dark / light（warm 不是系统态，不参与解析）
 *  jsdom 无 matchMedia：降级视为 light（同 use-mobile 的守卫惯例） */
function resolve(mode: ModeKind): "light" | "dark" | "warm" {
  if (mode === "auto") {
    const dark = typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    return dark ? "dark" : "light";
  }
  return mode;
}

/** 把档位落到 <html>：data-mode 三态 + .dark 类（喂 @custom-variant） */
function applyToDocument(mode: ModeKind) {
  const r = resolve(mode);
  const el = document.documentElement;
  el.dataset.mode = r;
  el.classList.toggle("dark", r === "dark");
  el.style.colorScheme = r === "dark" ? "dark" : "light";
}

// ── 模块级共享 store（本文件单一实例；全体 useMode 消费方同源）──
let currentMode: ModeKind = readStored();
const listeners = new Set<() => void>();

function notify() { for (const listener of listeners) listener(); }

function subscribe(listener: () => void) {
  listeners.add(listener);
  // 首个订阅者挂载：把存值落到 DOM（对齐原「初始挂载即 applyToDocument」；不写存储）
  if (listeners.size === 1) applyToDocument(currentMode);
  return () => { listeners.delete(listener); };
}

function getSnapshot(): ModeKind { return currentMode; }

function setModeInternal(next: ModeKind) {
  if (!VALID.has(next) || next === currentMode) return;
  currentMode = next;
  applyToDocument(currentMode);
  try { localStorage.setItem(MODE_STORAGE_KEY, next); } catch { /* 存取失败不阻断 */ }
  notify();
}

// auto 档实时跟随系统——store 级唯一监听（此前每 hook 实例各挂一份，语义不变；
// 系统切深浅 → 落 DOM + 通知订阅者重渲染〔resolved 派生值随之更新〕）。
// jsdom 无 matchMedia：跳过监听（resolve 已降级 light，测试环境无系统跟随需求）。
if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (currentMode !== "auto") return;
    applyToDocument("auto");
    notify();
  });
}

export function useMode() {
  const mode = useSyncExternalStore(subscribe, getSnapshot);
  const setMode = useCallback((next: ModeKind) => setModeInternal(next), []);
  return { mode, setMode, resolved: resolve(mode) } as const;
}
