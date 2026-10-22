import { APP_NAME, WORDMARK } from "#core/brand.js";

export const BRAND_INK = "#171513";
export const BRAND_ORANGE = "#FF6A3D";

const DIAL_PATH =
  "M130.0 94.1L135.0 12.2A116 116 0 0 1 214.2 50.4L153.3 105.2A34 34 0 0 0 130.0 94.1ZM155.8 108.4L222.9 61.2A116 116 0 0 1 242.4 147.0L161.5 133.6A34 34 0 0 0 155.8 108.4ZM160.6 137.5L239.3 160.5A116 116 0 0 1 184.5 229.3L144.6 157.7A34 34 0 0 0 160.6 137.5ZM140.9 159.5L172.0 235.3A116 116 0 0 1 84.0 235.3L115.1 159.5A34 34 0 0 0 140.9 159.5ZM111.4 157.7L71.5 229.3A116 116 0 0 1 16.7 160.5L95.4 137.5A34 34 0 0 0 111.4 157.7ZM94.5 133.6L13.6 147.0A116 116 0 0 1 33.1 61.2L100.2 108.4A34 34 0 0 0 94.5 133.6ZM102.7 105.2L41.8 50.4A116 116 0 0 1 121.0 12.2L126.0 94.1A34 34 0 0 0 102.7 105.2Z";

export function logoSvg(_id = "", animated = false, bare = false): string {
  const dial = animated ? ' class="logo-dial"' : "";
  const tile = bare ? "" : `<rect width="256" height="256" rx="60" fill="${BRAND_INK}"/>`;
  const scale = bare ? 1.08 : 0.74;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" aria-hidden="true">${tile}<g transform="translate(128 128) scale(${scale}) translate(-128 -128)"><g${dial}><path d="${DIAL_PATH}" fill="${BRAND_ORANGE}"/></g></g></svg>`;
}

export const LOGO_SVG = logoSvg();

export function logo(size: number, animated = false, bare = false): HTMLElement {
  const mark = document.createElement("span");
  mark.className = "logo";
  mark.style.width = mark.style.height = `${size}px`;
  mark.innerHTML = logoSvg("", animated, bare);
  return mark;
}

export function wordmark(): HTMLElement {
  const word = document.createElement("span");
  word.className = "wordmark";
  const accent = document.createElement("span");
  accent.className = "wordmark-accent";
  word.setAttribute("aria-label", APP_NAME);
  accent.textContent = WORDMARK.accent;
  word.append(accent, WORDMARK.rest);
  return word;
}

export function hydrateBrand(root: ParentNode): void {
  for (const slot of root.querySelectorAll<HTMLElement>("[data-logo]")) {
    slot.replaceWith(
      logo(
        Number(slot.dataset.logo),
        slot.dataset.logoAnimated !== undefined,
        slot.dataset.logoBare !== undefined,
      ),
    );
  }
  for (const slot of root.querySelectorAll<HTMLElement>("[data-wordmark]")) {
    slot.replaceWith(wordmark());
  }
}
