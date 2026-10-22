import { icon } from "#ui/icons.js";
import { logo } from "#ui/logo.js";
import type { PendingPrompt } from "#ext/lib/autofill-protocol.js";
import { send } from "../send.js";
import { t } from "../state.js";
import { banner } from "./root.js";

function bannerField(label: string, input: HTMLInputElement, extra?: HTMLElement): HTMLElement {
  const row = document.createElement("label");
  row.className = "field";
  const caption = document.createElement("span");
  caption.textContent = label;
  const box = document.createElement("span");
  box.className = "field-box";
  box.append(input);
  if (extra) {
    box.append(extra);
  }
  row.append(caption, box);
  return row;
}

export function showBanner(prompt: PendingPrompt): void {
  banner.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = t(prompt.update ? "autofill.update_title" : "autofill.save_title", {
    domain: prompt.domain,
  });
  const detail = document.createElement("small");
  detail.hidden = true;

  const username = document.createElement("input");
  username.type = "text";
  username.autocomplete = "off";
  username.spellcheck = false;
  username.value = prompt.username ?? "";
  const password = document.createElement("input");
  password.type = "password";
  password.autocomplete = "off";
  password.spellcheck = false;
  password.value = prompt.password;
  const reveal = document.createElement("button");
  reveal.type = "button";
  reveal.className = "reveal";
  const showReveal = () => {
    const hidden = password.type === "password";
    reveal.replaceChildren(icon(hidden ? "eye" : "eye-off"));
    reveal.setAttribute("aria-label", t(hidden ? "common.show" : "common.hide"));
  };
  showReveal();
  reveal.addEventListener("click", (event) => {
    if (!event.isTrusted) {
      return;
    }
    password.type = password.type === "password" ? "text" : "password";
    showReveal();
  });
  const fields = document.createElement("div");
  fields.className = "fields";
  fields.append(
    bannerField(t("common.username"), username),
    bannerField(t("common.password"), password, reveal),
  );

  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = t(prompt.update ? "autofill.update" : "autofill.save");
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.textContent = t("autofill.not_now");
  password.addEventListener("input", () => (save.disabled = !password.value));

  save.addEventListener("click", async (event) => {
    if (!event.isTrusted || !password.value) {
      return;
    }
    const response = await send({
      type: "autofill:save",
      username: username.value,
      password: password.value,
    });
    if (response.ok && "saved" in response && response.saved) {
      banner.replaceChildren(logo(28), t("autofill.saved"));
      setTimeout(() => (banner.hidden = true), 2000);
      return;
    }
    detail.hidden = false;
    detail.textContent =
      response.ok && "locked" in response && response.locked
        ? t("autofill.unlock_to_save")
        : t("autofill.save_failed");
  });
  dismiss.addEventListener("click", (event) => {
    if (!event.isTrusted) {
      return;
    }
    void send({ type: "autofill:dismiss" });
    banner.hidden = true;
  });

  const never = document.createElement("button");
  never.type = "button";
  never.className = "link";
  never.textContent = t("autofill.never_here");
  never.addEventListener("click", (event) => {
    if (!event.isTrusted) {
      return;
    }
    void send({ type: "autofill:dismiss", never: true });
    banner.hidden = true;
  });

  const text = document.createElement("div");
  text.className = "text";
  text.append(title, detail, never);
  const actions = document.createElement("div");
  actions.className = "actions";
  actions.append(dismiss, save);
  banner.append(logo(28), text, fields, actions);
  banner.hidden = false;
}
