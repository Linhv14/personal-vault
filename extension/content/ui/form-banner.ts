import { logo } from "#ui/logo.js";
import { brandMark, flagMark } from "#ui/marks.js";
import type { FormPrompt } from "#ext/lib/autofill-protocol.js";
import { CARD_BRAND_NAMES } from "#ext/lib/item-types.js";
import { send } from "../send.js";
import { t } from "../state.js";
import { badge } from "./menu.js";
import { banner } from "./root.js";

function formLeading(prompt: FormPrompt): HTMLElement {
  if (prompt.kind === "card") {
    return prompt.brand && prompt.brand !== "card" ? brandMark(prompt.brand) : badge("card");
  }
  if (prompt.phone) {
    return badge("phone");
  }
  if (prompt.country) {
    return flagMark(prompt.country);
  }
  return badge(prompt.random ? "globe" : "map-pin");
}

function formTitle(prompt: FormPrompt): string {
  if (prompt.kind === "card") {
    return t(prompt.update ? "autofill.update_card_title" : "autofill.save_card_title", {
      last4: prompt.last4 ?? "",
    });
  }
  if (prompt.phone) {
    return prompt.update && prompt.target
      ? t("autofill.add_phone_title", { title: prompt.target })
      : t("autofill.save_phone_title");
  }
  if (prompt.random && !prompt.update) {
    return t("autofill.keep_identity_title", { domain: prompt.domain });
  }
  return t(prompt.update ? "autofill.update_address_title" : "autofill.save_address_title");
}

function formDetail(prompt: FormPrompt): string {
  if (prompt.kind === "address") {
    return prompt.preview ?? "";
  }
  const brand = prompt.brand ? CARD_BRAND_NAMES[prompt.brand] : "";
  return [brand, prompt.expiry].filter(Boolean).join(" · ");
}

export function showFormBanner(prompt: FormPrompt): void {
  banner.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = formTitle(prompt);
  const detail = document.createElement("small");
  detail.textContent = formDetail(prompt);
  const text = document.createElement("div");
  text.className = "text";
  text.append(title, detail);

  const cvv = document.createElement("input");
  cvv.type = "checkbox";
  if (prompt.kind === "card" && prompt.hasCvv) {
    const label = document.createElement("label");
    label.className = "check";
    label.append(cvv, t("autofill.save_cvv"));
    text.append(label);
  }

  const never = document.createElement("button");
  never.type = "button";
  never.className = "link";
  never.textContent = t("autofill.never_here");
  text.append(never);

  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = t(prompt.update ? "autofill.update" : "autofill.save");
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.textContent = t("autofill.skip");

  save.addEventListener("click", async (event) => {
    if (!event.isTrusted) {
      return;
    }
    const response = await send({ type: "autofill:form-save", cvv: cvv.checked });
    if (response.ok && "saved" in response && response.saved) {
      banner.replaceChildren(logo(24), t("autofill.saved"));
      setTimeout(() => (banner.hidden = true), 2000);
    } else if (response.ok && "locked" in response && response.locked) {
      detail.textContent = t("autofill.unlock_to_save");
    } else {
      detail.textContent = t("autofill.save_failed");
    }
  });
  dismiss.addEventListener("click", (event) => {
    if (!event.isTrusted) {
      return;
    }
    void send({ type: "autofill:form-dismiss" });
    banner.hidden = true;
  });
  never.addEventListener("click", (event) => {
    if (!event.isTrusted) {
      return;
    }
    void send({ type: "autofill:form-dismiss", never: true });
    banner.hidden = true;
  });

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.append(dismiss, save);
  banner.append(formLeading(prompt), text, actions);
  banner.hidden = false;
}
