import type { MessageKey, Translate } from "../../src/i18n/index.js";

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

export function translatePage(t: Translate, root: ParentNode = document): void {
  for (const node of root.querySelectorAll<HTMLElement>("[data-i18n]")) {
    node.textContent = t(node.dataset["i18n"] as MessageKey);
  }
  for (const node of root.querySelectorAll<HTMLInputElement>("[data-i18n-placeholder]")) {
    node.placeholder = t(node.dataset["i18nPlaceholder"] as MessageKey);
  }
  for (const node of root.querySelectorAll<HTMLElement>("[data-i18n-title]")) {
    node.title = t(node.dataset["i18nTitle"] as MessageKey);
    node.setAttribute("aria-label", node.title);
  }
}
