import type { Suggestion } from "../../lib/autofill-protocol.js";
import {
  findPasswordFor,
  findUsernameField,
  passwordFields,
  scopeOf,
  wantsNewPassword,
} from "../detect.js";
import { send } from "../send.js";
import { state, t } from "../state.js";
import { setValue } from "../track.js";
import { avatar, badge, closeMenu, lockedRow, menuHeading, menuRow, note } from "../ui/menu.js";
import { menu } from "../ui/root.js";
import { placeTrigger } from "../ui/trigger.js";
import { aliasRows } from "./aliases.js";
import { offeredPasskeys, usePasskey } from "./passkey.js";

async function fillSuggestion(suggestion: Suggestion, password: HTMLInputElement): Promise<void> {
  const response = await send({ type: "autofill:fill", id: suggestion.id });
  closeMenu();
  if (!response.ok || !("credentials" in response)) {
    return;
  }
  const username = findUsernameField(password);
  if (username && response.credentials.username) {
    setValue(username, response.credentials.username);
  }
  setValue(password, response.credentials.password);
}

async function fillGenerated(password: HTMLInputElement): Promise<void> {
  const response = await send({ type: "autofill:generate" });
  closeMenu();
  if (!response.ok || !("password" in response)) {
    return;
  }
  const fields = passwordFields(scopeOf(password));
  const targets = fields.length >= 2 ? fields.slice(-2) : [password];
  for (const field of targets) {
    setValue(field, response.password);
  }
}

export async function openLoginMenu(input: HTMLInputElement, onlyIfUseful: boolean): Promise<void> {
  const password = findPasswordFor(input) ?? input;
  const signUp = wantsNewPassword(password);
  const [response, passkeys, aliases] = await Promise.all([
    send({ type: "autofill:suggest" }),
    offeredPasskeys(input),
    signUp && input !== password ? aliasRows(input) : Promise.resolve([]),
  ]);
  if (state.activeInput !== input) {
    return;
  }
  const nothingToOffer =
    response.ok &&
    "suggestions" in response &&
    response.suggestions.length === 0 &&
    passkeys.length === 0 &&
    !wantsNewPassword(password);
  if (onlyIfUseful && (!response.ok || nothingToOffer)) {
    return;
  }
  menu.replaceChildren(menuHeading());

  if (!response.ok) {
    menu.append(note(t("autofill.unavailable")));
  } else if ("locked" in response && response.locked) {
    menu.append(lockedRow());
  } else if ("suggestions" in response) {
    for (const passkey of passkeys) {
      menu.append(
        menuRow(
          passkey.userName || passkey.title,
          `${t("common.passkey")} · ${passkey.title}`,
          badge("key"),
          () => void usePasskey(passkey),
        ),
      );
    }
    for (const suggestion of response.suggestions) {
      menu.append(
        menuRow(
          suggestion.title,
          [suggestion.username, suggestion.vault].filter(Boolean).join(" · ") || undefined,
          avatar(suggestion.title),
          () => fillSuggestion(suggestion, password),
        ),
      );
    }
    menu.append(...aliases);
    if (wantsNewPassword(password)) {
      menu.append(
        menuRow(t("autofill.generate"), t("autofill.generate_hint"), badge("wand"), () =>
          fillGenerated(password),
        ),
      );
    } else if (response.suggestions.length === 0 && passkeys.length === 0) {
      menu.append(note(t("autofill.no_match", { domain: response.domain })));
    }
  }

  menu.hidden = false;
  placeTrigger();
}
