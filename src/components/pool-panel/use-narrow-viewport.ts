// useNarrowViewport — 任务池容器的窄视口判定（PR-026）
// 范式同构 use-mobile.tsx：matchMedia 优先（随动），缺失时 resize 回退（jsdom 环境走此路径，
// 初始判定为宽视口，现有测试零 mock 兼容）。
import * as React from "react";

export const POOL_NARROW_BREAKPOINT = 800;

function isNarrowViewport(): boolean {
  return typeof window !== "undefined" && window.innerWidth <= POOL_NARROW_BREAKPOINT;
}

export function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = React.useState(isNarrowViewport);

  React.useEffect(() => {
    const onChange = () => setNarrow(isNarrowViewport());
    setNarrow(isNarrowViewport());
    if (typeof window.matchMedia === "function") {
      const query = window.matchMedia(`(max-width: ${POOL_NARROW_BREAKPOINT}px)`);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    }
    window.addEventListener("resize", onChange);
    return () => window.removeEventListener("resize", onChange);
  }, []);

  return narrow;
}
