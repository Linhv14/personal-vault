import { signal } from "@preact/signals";

export type ToastKind = "success" | "error" | "info";

export interface ToastEntry {
  id: number;
  kind: ToastKind;
  message: string;
}

export const toasts$ = signal<ToastEntry[]>([]);
const MAX_TOASTS = 3;
const TOAST_MS: Record<ToastKind, number> = { success: 2800, info: 2800, error: 6000 };
let toastId = 0;

export function dismissToast(id: number): void {
  toasts$.value = toasts$.value.filter((entry) => entry.id !== id);
}

export function toast(message: string, kind: ToastKind = "success"): void {
  const id = ++toastId;
  const rest = toasts$.value.filter((entry) => entry.message !== message);
  toasts$.value = [...rest, { id, kind, message }].slice(-MAX_TOASTS);
  setTimeout(() => dismissToast(id), TOAST_MS[kind]);
}

function dialogOpen(): boolean {
  return typeof document !== "undefined" && document.querySelector("dialog[open]") !== null;
}

export const pending$ = signal(false);
export const failure$ = signal<string | null>(null);

export async function attempt(
  work: () => Promise<unknown>,
  describe: (failure: unknown) => string,
): Promise<boolean> {
  if (pending$.value) {
    return false;
  }
  failure$.value = null;
  pending$.value = true;
  try {
    await work();
    return true;
  } catch (failure) {
    const message = describe(failure);
    if (dialogOpen()) {
      failure$.value = message;
    } else {
      toast(message, "error");
    }
    return false;
  } finally {
    pending$.value = false;
  }
}
