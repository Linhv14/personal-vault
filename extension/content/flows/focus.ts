import { isCodeField, isDecoratable, wantsNewPassword } from "../detect.js";
import { state } from "../state.js";
import { closeMenu, menuRows } from "../ui/menu.js";
import { host, menu, shadow, trigger } from "../ui/root.js";
import { placeTrigger } from "../ui/trigger.js";
import { openFrameCardMenu } from "./card.js";
import { openMenu } from "./menu.js";
import { checkSite } from "./site-check.js";

export function onFocusIn(event: FocusEvent): void {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || state.filling || !isDecoratable(target)) {
    return;
  }
  if (state.activeInput !== target) {
    closeMenu();
  }
  state.activeInput = target;
  state.cardFrame = null;
  placeTrigger();
  void checkSite();
  const offersPassword = target.type === "password" && !target.value && wantsNewPassword(target);
  if (menu.hidden && (offersPassword || (isCodeField(target) && !target.value))) {
    void openMenu({ onlyIfUseful: true });
  }
}

export function onTriggerMouseDown(event: MouseEvent): void {
  event.preventDefault();
}

export function onTriggerClick(event: MouseEvent): void {
  if (!event.isTrusted) {
    return;
  }
  if (!menu.hidden) {
    closeMenu();
  } else if (!state.activeInput && state.cardFrame) {
    void openFrameCardMenu(state.cardFrame, false);
  } else {
    void openMenu({ onlyIfUseful: false });
  }
}

export function onMenuKeyDown(event: KeyboardEvent): void {
  const rows = menuRows();
  const index = rows.indexOf(shadow.activeElement as HTMLButtonElement);
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const step = event.key === "ArrowDown" ? 1 : -1;
    rows[(index + step + rows.length) % rows.length]?.focus();
  } else if (event.key === "Escape") {
    closeMenu();
    state.activeInput?.focus();
  }
}

export function onFieldClick(event: MouseEvent): void {
  const target = event.target;
  if (
    !event.isTrusted ||
    !(target instanceof HTMLInputElement) ||
    state.filling ||
    !isDecoratable(target)
  ) {
    return;
  }
  state.activeInput = target;
  placeTrigger();
  if (menu.hidden) {
    void openMenu({ onlyIfUseful: true });
  }
}

export function onFieldInput(event: Event): void {
  if (event.isTrusted && event.target === state.activeInput) {
    closeMenu();
  }
}

export function onPageMouseDown(event: MouseEvent): void {
  if (event.composedPath().includes(host)) {
    return;
  }
  closeMenu();
  if (event.target !== state.activeInput) {
    state.activeInput = null;
    state.cardFrame = null;
    trigger.hidden = true;
  }
}

export function onMenuNavKey(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    closeMenu();
  }
  if (event.key === "ArrowDown" && event.target === state.activeInput && !menu.hidden) {
    event.preventDefault();
    menuRows()[0]?.focus();
  }
}
