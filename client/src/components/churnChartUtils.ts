import { useLayoutEffect, useRef, useState } from "react";

export const CHART_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';

export function useContainerWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

let measureCtx: CanvasRenderingContext2D | null | undefined;

// Canvas text measurement, so a label gutter fits the longest name exactly
// instead of being guessed from a character count.
export function measureText(text: string, font: string): number {
  if (measureCtx === undefined) {
    measureCtx = document.createElement("canvas").getContext("2d");
  }
  if (!measureCtx) return text.length * 6.1;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

export function truncateToWidth(text: string, maxWidth: number, font: string): string {
  if (measureText(text, font) <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measureText(`${text.slice(0, mid)}…`, font) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}

// A round step (1, 2 or 5 times a power of ten) giving at most `maxTicks`
// gridlines, so the axis reads in whole numbers rather than in whatever the
// data's maximum happens to be.
export function niceStep(max: number, maxTicks: number): number {
  if (max <= 0) return 1;
  const rough = max / maxTicks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  for (const multiple of [1, 2, 5, 10]) {
    if (magnitude * multiple >= rough) return magnitude * multiple;
  }
  return magnitude * 10;
}

export function axisTicks(max: number, maxTicks: number): number[] {
  const step = niceStep(max, maxTicks);
  const ticks: number[] = [];
  for (let value = 0; value <= max + step / 2; value += step) ticks.push(value);
  return ticks;
}

export function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  if (value >= 1_000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
}
