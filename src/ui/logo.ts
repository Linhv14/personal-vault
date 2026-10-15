import { APP_NAME } from "../core/brand.js";

export function logoSvg(gradientId: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4fe0c3"/><stop offset="1" stop-color="#0b6e6b"/></linearGradient></defs><rect width="64" height="64" rx="16" fill="url(#${gradientId})"/><circle cx="32" cy="26" r="9" fill="#fff"/><path d="M27.4 30h9.2l3.1 17.6a2 2 0 0 1-2 2.4H26.3a2 2 0 0 1-2-2.4z" fill="#fff"/></svg>`;
}

export const LOGO_SVG = logoSvg("onepw-logo-fill");

let logoCount = 0;

export function logo(size: number): HTMLElement {
  const mark = document.createElement("span");
  mark.className = "logo";
  mark.style.width = mark.style.height = `${size}px`;
  mark.innerHTML = logoSvg(`onepw-logo-fill-${++logoCount}`);
  return mark;
}

export function wordmark(): HTMLElement {
  const word = document.createElement("span");
  word.className = "wordmark";
  const accent = document.createElement("span");
  accent.className = "wordmark-accent";
  accent.textContent = APP_NAME.slice(0, 1);
  word.append(accent, APP_NAME.slice(1));
  return word;
}

export function hydrateBrand(root: ParentNode): void {
  for (const slot of root.querySelectorAll<HTMLElement>("[data-logo]")) {
    slot.replaceWith(logo(Number(slot.dataset.logo)));
  }
  for (const slot of root.querySelectorAll<HTMLElement>("[data-wordmark]")) {
    slot.replaceWith(wordmark());
  }
}
