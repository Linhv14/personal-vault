import { logo } from "../../../src/ui/logo.js";
import type { TotpPrompt } from "../../lib/autofill-protocol.js";
import { send } from "../send.js";
import { t } from "../state.js";
import { setValue } from "../track.js";
import { fillCode, findOneTimeCodeField } from "../two-factor.js";
import { banner } from "./root.js";

export function showTotpBanner(prompt: TotpPrompt): void {
  banner.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = t("autofill.totp_title", { domain: prompt.domain });
  const detail = document.createElement("small");
  detail.textContent = prompt.target
    ? t(prompt.replace ? "autofill.totp_replace" : "autofill.totp_add", { title: prompt.target })
    : t("autofill.totp_new");

  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = t("autofill.save");
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.textContent = t("autofill.not_now");

  save.addEventListener("click", async (event) => {
    if (!event.isTrusted) {
      return;
    }
    const response = await send({ type: "autofill:totp-save" });
    if (response.ok && "saved" in response && response.saved) {
      const field = findOneTimeCodeField();
      if (field && response.code) {
        fillCode(field, response.code, setValue);
      }
      banner.replaceChildren(
        logo(24),
        t(field && response.code ? "autofill.totp_saved_filled" : "autofill.saved"),
      );
      setTimeout(() => (banner.hidden = true), 2500);
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
    void send({ type: "autofill:totp-dismiss" });
    banner.hidden = true;
  });

  const text = document.createElement("div");
  text.className = "text";
  text.append(title, detail);
  const actions = document.createElement("div");
  actions.className = "actions";
  actions.append(dismiss, save);
  banner.append(logo(28), text, actions);
  banner.hidden = false;
}
