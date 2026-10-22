import { isPaymentFrameUrl } from "#core/payment-frames.js";
import { brandMark } from "#ui/marks.js";
import { scopeOf } from "../detect.js";
import { detectFields } from "../forms/classify.js";
import { fillCard } from "../forms/fill.js";
import { send } from "../send.js";
import { state, t } from "../state.js";
import { setValue } from "../track.js";
import { badge, closeMenu, lockedRow, menuHeading, menuRow, note, showMenu } from "../ui/menu.js";
import { menu } from "../ui/root.js";
import { fillFrom, placeTrigger } from "../ui/trigger.js";
import { checkSite } from "./site-check.js";

async function fillCardItem(id: string, input: HTMLInputElement): Promise<void> {
  const response = await send({ type: "autofill:card", id });
  closeMenu();
  if (!response.ok || !("card" in response)) {
    return;
  }
  fillFrom(input, () => fillCard(detectFields(scopeOf(input)), response.card, setValue));
}

export async function openCardMenu(input: HTMLInputElement, onlyIfUseful: boolean): Promise<void> {
  const response = await send({ type: "autofill:cards" });
  if (state.activeInput !== input) {
    return;
  }
  const empty = response.ok && "cards" in response && response.cards.length === 0;
  if (onlyIfUseful && (!response.ok || empty)) {
    return;
  }
  menu.replaceChildren(menuHeading());
  if (!response.ok) {
    menu.append(note(t("autofill.unavailable")));
  } else if ("locked" in response && response.locked) {
    menu.append(lockedRow());
  } else if ("cards" in response) {
    for (const card of response.cards) {
      menu.append(
        menuRow(
          `•••• ${card.last4}`,
          [card.title, card.vault].filter(Boolean).join(" · ") || undefined,
          card.brand === "card" ? badge("card") : brandMark(card.brand),
          () => void fillCardItem(card.id, input),
        ),
      );
    }
    if (response.cards.length === 0) {
      menu.append(note(t("autofill.no_cards")));
    }
  }
  showMenu();
}

async function fillCardFrom(id: string): Promise<void> {
  const response = await send({ type: "autofill:card", id });
  closeMenu();
  if (!response.ok || !("card" in response)) {
    return;
  }
  fillCard(detectFields(document), response.card, setValue);
}

export async function openFrameCardMenu(
  frame: HTMLIFrameElement,
  onlyIfUseful: boolean,
): Promise<void> {
  const response = await send({ type: "autofill:cards" });
  if (state.cardFrame !== frame) {
    return;
  }
  const empty = response.ok && "cards" in response && response.cards.length === 0;
  if (onlyIfUseful && (!response.ok || empty)) {
    return;
  }
  menu.replaceChildren(menuHeading());
  if (!response.ok) {
    menu.append(note(t("autofill.unavailable")));
  } else if ("locked" in response && response.locked) {
    menu.append(lockedRow());
  } else if ("cards" in response) {
    for (const card of response.cards) {
      menu.append(
        menuRow(
          `•••• ${card.last4}`,
          [card.title, card.vault].filter(Boolean).join(" · ") || undefined,
          card.brand === "card" ? badge("card") : brandMark(card.brand),
          () => void fillCardFrom(card.id),
        ),
      );
    }
    if (response.cards.length === 0) {
      menu.append(note(t("autofill.no_cards")));
    }
  }
  showMenu();
}

export function onWindowBlur(): void {
  setTimeout(() => {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLIFrameElement) || !isPaymentFrameUrl(focused.src)) {
      return;
    }
    if (state.cardFrame !== focused) {
      closeMenu();
    }
    state.activeInput = null;
    state.cardFrame = focused;
    placeTrigger();
    void checkSite();
    if (menu.hidden) {
      void openFrameCardMenu(focused, true);
    }
  }, 0);
}
