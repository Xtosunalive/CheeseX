// use-nav-location — navigation 域读侧订阅钩子（业务代码的唯一 hashchange 订阅点）
// 契约见 src/lib/navigation.ts 要点 ④：取路由/子路由/query 经本钩子或 readNavLocation()，
// 禁裸读 location.hash、禁自挂 hashchange（门禁 check-navigation 第三检查面执法）。
import { useEffect, useState } from "react";
import { readNavLocation, type NavLocation } from "@/lib/navigation";

/** 当前地址三段形态，随 hashchange 重渲染；同一 hash 不触发多余渲染 */
export function useNavLocation(): NavLocation {
  const [location, setLocation] = useState<NavLocation>(readNavLocation);
  useEffect(() => {
    const sync = () => {
      const next = readNavLocation();
      setLocation((prev) => (prev.hash === next.hash ? prev : next));
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  return location;
}
