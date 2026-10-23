import { useEffect, useState } from "preact/hooks";

const FIRST_ROWS = 60;

export function useProgressiveRows<T>(rows: readonly T[]): readonly T[] {
  const [whole, setWhole] = useState(false);
  useEffect(() => {
    if (whole) {
      return;
    }
    const frame = requestAnimationFrame(() => setWhole(true));
    return () => cancelAnimationFrame(frame);
  }, [whole]);
  return whole ? rows : rows.slice(0, FIRST_ROWS);
}
