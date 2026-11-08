import { useEffect, useState } from "react";

/**
 * 全屏状态跟踪（唯一定义；Mermaid 画布已随 seq212 退役，现由 ArchitectureProjectionFlow 消费）
 * @returns [isFullscreen, setFullscreen]
 */
export function useFullscreenState(): [boolean, (v: boolean) => void] {
  const [isFullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const h = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, []);
  return [isFullscreen, setFullscreen];
}
