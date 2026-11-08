import { useEffect, type RefObject } from "react";

/**
 * 点击外部 / Esc 关闭（唯一定义，收敛 FloatingSearch/DocumentSearchBar/CardNav 重复监听）
 * @param open 当前是否打开
 * @param onClose 关闭回调
 * @param refs 需要排除的 ref（点击这些内部元素不关闭）
 */
export function useClickOutside(
  open: boolean,
  onClose: () => void,
  refs: Array<RefObject<HTMLElement | null>>,
) {
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      const inside = refs.some((ref) => ref.current?.contains(target));
      if (!inside) onClose();
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open, onClose, refs]);
}
