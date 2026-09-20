import { useLayoutEffect } from "react";

// Publishes the height of the visible viewport as a custom property, so the
// app shell can be sized from a number the browser reports rather than from
// a viewport unit. On a phone, 100vh counts the strip under the address bar,
// and dvh is only as reliable as the browser's support for it; innerHeight is
// what is actually on screen, and it changes as the bar shows and hides.
export function useAppHeight(): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const update = () => {
      root.style.setProperty("--app-height", `${window.innerHeight}px`);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.visualViewport?.removeEventListener("resize", update);
      root.style.removeProperty("--app-height");
    };
  }, []);
}
