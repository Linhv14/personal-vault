import type { Suggestion } from "#ext/lib/autofill-protocol.js";
import { send } from "../send.js";
import { state, t } from "../state.js";
import { setValue } from "../track.js";
import { fillCode } from "../two-factor.js";
import { badge, closeMenu, lockedRow, menuHeading, menuRow, note } from "../ui/menu.js";
import { menu } from "../ui/root.js";
import { placeTrigger } from "../ui/trigger.js";

async function fillOneTimeCode(suggestion: Suggestion, input: HTMLInputElement): Promise<void> {
  const response = await send({ type: "autofill:code", id: suggestion.id });
  closeMenu();
  if (response.ok && "code" in response && typeof response.code === "string") {
    fillCode(input, response.code, setValue);
  }
}

export async function openCodeMenu(input: HTMLInputElement, onlyIfUseful: boolean): Promise<void> {
  const response = await send({ type: "autofill:codes" });
  if (state.activeInput !== input) {
    return;
  }
  const empty = response.ok && "suggestions" in response && response.suggestions.length === 0;
  if (onlyIfUseful && (!response.ok || empty)) {
    return;
  }
  menu.replaceChildren(menuHeading());
  if (!response.ok) {
    menu.append(note(t("autofill.unavailable")));
  } else if ("locked" in response && response.locked) {
    menu.append(lockedRow());
  } else if ("suggestions" in response) {
    for (const suggestion of response.suggestions) {
      menu.append(
        menuRow(
          suggestion.title,
          [suggestion.username, suggestion.vault].filter(Boolean).join(" · ") || undefined,
          badge("clock"),
          () => void fillOneTimeCode(suggestion, input),
        ),
      );
    }
    if (response.suggestions.length === 0) {
      menu.append(note(t("autofill.no_codes", { domain: response.domain })));
    }
  }
  menu.hidden = false;
  placeTrigger();
}
