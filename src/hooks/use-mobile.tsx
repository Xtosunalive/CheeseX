import * as React from "react";

export const MOBILE_BREAKPOINT = 768;

export function isMobileViewport() {
  return typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT;
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(isMobileViewport);

  React.useEffect(() => {
    const onChange = () => setIsMobile(isMobileViewport());
    setIsMobile(isMobileViewport());
    if (typeof window.matchMedia === "function") {
      const query = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    }
    window.addEventListener("resize", onChange);
    return () => window.removeEventListener("resize", onChange);
  }, []);

  return isMobile;
}
