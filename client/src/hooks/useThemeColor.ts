import { useEffect, useState } from "react";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function readVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

// The canvas, WebGL and SVG-gradient components paint with a real colour
// value rather than a var() reference, so this resolves one of the theme's
// custom properties from the root element, and again when the colour scheme
// flips.
export function useThemeColor(name: string, fallback: string): string {
  const [color, setColor] = useState(() => readVar(name, fallback));

  useEffect(() => {
    const update = () => setColor(readVar(name, fallback));
    update();
    const mq = window.matchMedia(DARK_QUERY);
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [name, fallback]);

  return color;
}

export function usePrefersDark(): boolean {
  const [dark, setDark] = useState(
    () => typeof window !== "undefined" && window.matchMedia(DARK_QUERY).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(DARK_QUERY);
    const handler = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return dark;
}
