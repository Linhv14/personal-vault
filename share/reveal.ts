export const REVEAL_TIMEOUT_MS = 30_000;

export interface RevealGuard {
  revealed: () => void;
  hidden: () => void;
}

export function guardReveal(
  hide: () => void,
  target: Document = document,
  timeoutMs = REVEAL_TIMEOUT_MS,
): RevealGuard {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let shown = false;
  const conceal = () => {
    if (shown) {
      hide();
    }
  };
  target.addEventListener("visibilitychange", () => {
    if (target.visibilityState === "hidden") {
      conceal();
    }
  });
  return {
    revealed() {
      shown = true;
      clearTimeout(timer);
      timer = setTimeout(conceal, timeoutMs);
    },
    hidden() {
      shown = false;
      clearTimeout(timer);
    },
  };
}
