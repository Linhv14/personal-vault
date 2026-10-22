import type { LookalikeMatch } from "#core/lookalike.js";
import { send } from "../send.js";
import { state } from "../state.js";
import { showChip } from "../ui/chip.js";
import { menuHeading } from "../ui/menu.js";
import { menu } from "../ui/root.js";

export async function checkSite(): Promise<LookalikeMatch | null> {
  if (location.protocol !== "https:") {
    return null;
  }
  const response = await send({ type: "autofill:site-check" });
  const warning = response.ok && "lookalike" in response ? response.lookalike : null;
  const changed = warning?.target !== state.siteWarning?.target;
  state.siteWarning = warning;
  if (changed && !menu.hidden) {
    menu.querySelector(".heading")?.replaceWith(menuHeading());
  }
  return warning;
}

export function onPasswordPaste(event: ClipboardEvent): void {
  const target = event.target;
  if (!event.isTrusted || !(target instanceof HTMLInputElement) || target.type !== "password") {
    return;
  }
  void checkSite().then((warning) => warning && showChip(target, warning));
}
