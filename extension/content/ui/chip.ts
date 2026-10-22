import { icon } from "../../../src/ui/icons.js";
import type { LookalikeMatch } from "../../../src/core/lookalike.js";
import { t } from "../state.js";
import { chip } from "./root.js";
import { pageRect } from "./trigger.js";

export function showChip(field: HTMLInputElement, warning: LookalikeMatch): void {
  const rect = pageRect(field);
  chip.replaceChildren(icon("alert"), t("autofill.lookalike_title", { domain: warning.target }));
  chip.style.left = `${Math.max(window.scrollX + 8, rect.left)}px`;
  chip.style.top = `${rect.bottom + 6}px`;
  chip.hidden = false;
  const hide = () => (chip.hidden = true);
  field.addEventListener("blur", hide, { once: true });
  setTimeout(hide, 8000);
}
