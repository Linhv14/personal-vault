import { isVisible } from "../detect.js";
import { state } from "../state.js";
import { menu, trigger } from "./root.js";

export function pageRect(element: Element): DOMRect {
  const rect = element.getBoundingClientRect();
  return new DOMRect(
    rect.left + window.scrollX,
    rect.top + window.scrollY,
    rect.width,
    rect.height,
  );
}

export function fillFrom(origin: HTMLInputElement, fill: () => void): void {
  state.filling = true;
  try {
    fill();
  } finally {
    state.filling = false;
  }
  state.activeInput = origin;
  placeTrigger();
}

function followAnchor(): void {
  if (trigger.hidden) {
    state.following = false;
    return;
  }
  placeTrigger();
  requestAnimationFrame(followAnchor);
}

export function placeTrigger(): void {
  const anchor = state.activeInput ?? state.cardFrame;
  if (!anchor || !anchor.isConnected || !isVisible(anchor)) {
    trigger.hidden = true;
    return;
  }
  if (!state.following) {
    state.following = true;
    requestAnimationFrame(followAnchor);
  }
  const rect = pageRect(anchor);
  const size = Math.min(24, Math.max(18, rect.height - 10));
  trigger.style.width = trigger.style.height = `${size}px`;
  trigger.style.left = `${rect.right - size - 6}px`;
  trigger.style.top = `${rect.top + (rect.height - size) / 2}px`;
  trigger.hidden = false;
  if (!menu.hidden) {
    menu.style.left = `${Math.max(window.scrollX + 8, rect.right - 280)}px`;
    menu.style.top = `${rect.bottom + 6}px`;
  }
}
