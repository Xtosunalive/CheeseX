import { useEffect, useRef } from "react";

/**
 * 窗口聚焦/回到前台时重拉（WP-145 收编：四份同款 effect 的单一事实源——
 * EntityComplianceView／AnomalyWorkbenchView／ArticleWorkflowView／DataDashboardView
 * 各自内联的「页面重回前台就重拉」监听归一；行为去重自四份既有实现的公共形态，不引入新依赖）。
 *
 * 行为：
 * - window "focus" → 触发 fn；
 * - document "visibilitychange" 且 visibilityState === "visible" → 触发 fn；
 * - opts.immediate 为 true → 挂载即触发一次 fn（对应原「进页拉一次」effect）；
 * - 卸载时移除全部监听，无遗留。
 *
 * fn 经 latest ref 透传（调用侧闭包每渲染重建也不会重挂监听）。各消费点的语义差异
 * （如 ArticleWorkflowView 的可见期轮询、AnomalyWorkbenchView 带参的挂载首拉）留在调用侧，本 hook 不吞并。
 */
export function useRefetchOnFocus(fn: () => void, opts?: { immediate?: boolean }): void {
  const immediate = opts?.immediate ?? false;
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (immediate) fnRef.current();
    const onFocus = () => fnRef.current();
    const onActive = () => {
      if (document.visibilityState === "visible") fnRef.current();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onActive);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onActive);
    };
  }, [immediate]);
}
