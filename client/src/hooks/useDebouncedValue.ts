import { useEffect, useState } from "react";

// Holds a value back until it has stopped changing for `delayMs`. A value that
// a viewer drives by typing then reaches a query key once per pause rather
// than once per keystroke, so the fetch it feeds runs once rather than on
// every letter.
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    if (value === settled) return;
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, settled, delayMs]);

  return settled;
}
