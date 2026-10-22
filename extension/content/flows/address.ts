import { flagMark } from "../../../src/ui/marks.js";
import type { AddressData, AutofillRequest } from "../../lib/autofill-protocol.js";
import { scopeOf } from "../detect.js";
import { detectFields } from "../forms/classify.js";
import { fillAddress } from "../forms/fill.js";
import { countryHint } from "../forms/values.js";
import { send } from "../send.js";
import { state, t } from "../state.js";
import { setRandomValue, setValue } from "../track.js";
import { badge, closeMenu, lockedRow, menuHeading, menuRow, note, showMenu } from "../ui/menu.js";
import { menu } from "../ui/root.js";
import { fillFrom } from "../ui/trigger.js";
import { aliasRows } from "./aliases.js";

async function fillAddressFrom(request: AutofillRequest, input: HTMLInputElement): Promise<void> {
  const response = await send(request);
  closeMenu();
  if (!response.ok || !("identity" in response)) {
    return;
  }
  const data: AddressData = response.identity;
  const random = request.type === "autofill:random-address";
  fillFrom(input, () =>
    fillAddress(detectFields(scopeOf(input)), data, random ? setRandomValue : setValue),
  );
}

export async function openAddressMenu(
  input: HTMLInputElement,
  onlyIfUseful: boolean,
  profile = false,
): Promise<void> {
  const [response, aliases] = await Promise.all([
    send({ type: "autofill:identities" }),
    aliasRows(input),
  ]);
  if (state.activeInput !== input) {
    return;
  }
  const empty =
    response.ok &&
    "identities" in response &&
    response.identities.length === 0 &&
    aliases.length === 0;
  if (onlyIfUseful && (!response.ok || empty)) {
    return;
  }
  menu.replaceChildren(menuHeading());
  if (!response.ok) {
    menu.append(note(t("autofill.unavailable")));
    showMenu();
    return;
  }
  if ("locked" in response && response.locked) {
    menu.append(lockedRow());
  }
  if ("identities" in response) {
    for (const identity of response.identities) {
      menu.append(
        menuRow(
          identity.title,
          [identity.detail, identity.vault].filter(Boolean).join(" · ") || undefined,
          identity.country ? flagMark(identity.country) : badge("person"),
          () => void fillAddressFrom({ type: "autofill:identity", id: identity.id }, input),
        ),
      );
    }
  }
  menu.append(...aliases);
  const country = countryHint(
    detectFields(scopeOf(input)),
    location.hostname,
    document.documentElement.lang,
  );
  for (const code of country === "VN" ? (["VN", "US"] as const) : (["US", "VN"] as const)) {
    menu.append(
      menuRow(
        t(profile ? "autofill.random_profile" : "autofill.random_address"),
        t(code === "VN" ? "autofill.random_in_vn" : "autofill.random_in_us"),
        flagMark(code),
        () => fillAddressFrom({ type: "autofill:random-address", country: code }, input),
      ),
    );
  }
  showMenu();
}
