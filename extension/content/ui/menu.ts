import type { LookalikeMatch } from "#core/lookalike.js";
import { icon, type IconName } from "#ui/icons.js";
import { logo, wordmark } from "#ui/logo.js";
import { send } from "../send.js";
import { state, t } from "../state.js";
import { menu } from "./root.js";
import { placeTrigger } from "./trigger.js";

export function closeMenu(): void {
  menu.hidden = true;
  menu.replaceChildren();
}

export function showMenu(): void {
  menu.hidden = false;
  placeTrigger();
}

export function menuRow(
  label: string,
  detail: string | undefined,
  leading: HTMLElement,
  onPick: () => void,
): HTMLButtonElement {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "row";
  const text = document.createElement("span");
  text.className = "text";
  const strong = document.createElement("strong");
  strong.textContent = label;
  text.append(strong);
  if (detail) {
    const small = document.createElement("small");
    small.textContent = detail;
    text.append(small);
  }
  row.append(leading, text);
  row.addEventListener("click", (event) => {
    if (!event.isTrusted) {
      return;
    }
    if (state.siteWarning && !row.dataset.armed) {
      return armRow(row);
    }
    onPick();
  });
  return row;
}

function armRow(row: HTMLButtonElement): void {
  row.dataset.armed = "1";
  row.classList.add("armed");
  const text = row.querySelector(".text");
  let detail = text?.querySelector("small");
  if (text && !detail) {
    detail = document.createElement("small");
    text.append(detail);
  }
  if (detail) {
    detail.textContent = t("autofill.fill_anyway");
  }
  row.focus();
}

export function avatar(title: string): HTMLElement {
  const node = document.createElement("span");
  node.className = "avatar";
  node.textContent = [...title.trim()][0]?.toUpperCase() ?? "?";
  return node;
}

export function badge(name: IconName): HTMLElement {
  const node = document.createElement("span");
  node.className = "badge";
  node.append(icon(name));
  return node;
}

export function note(text: string): HTMLElement {
  const node = document.createElement("p");
  node.className = "note";
  node.textContent = text;
  return node;
}

export function menuHeading(): HTMLElement {
  if (state.siteWarning) {
    return warningHeading(state.siteWarning);
  }
  const heading = document.createElement("div");
  heading.className = "heading";
  heading.append(logo(16), wordmark());
  return heading;
}

function warningHeading(warning: LookalikeMatch): HTMLElement {
  const heading = document.createElement("div");
  heading.className = "heading warning";
  const title = document.createElement("strong");
  title.textContent = t("autofill.lookalike_title", { domain: warning.target });
  heading.append(icon("alert"), title);
  return heading;
}

export function lockedRow(): HTMLButtonElement {
  const row = menuRow(t("autofill.locked"), t("autofill.locked_hint"), badge("lock"), () => {
    void send({ type: "autofill:open-popup" });
    closeMenu();
  });
  row.dataset.armed = "1";
  return row;
}

export function menuRows(): HTMLButtonElement[] {
  return [...menu.querySelectorAll<HTMLButtonElement>("button.row")];
}
