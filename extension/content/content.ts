import { createTranslator, resolveLocale } from "#i18n/index.js";
import type { LocalePreference } from "#i18n/index.js";
import { onWindowBlur } from "./flows/card.js";
import {
  onFieldClick,
  onFieldInput,
  onFocusIn,
  onMenuKeyDown,
  onMenuNavKey,
  onPageMouseDown,
  onTriggerClick,
  onTriggerMouseDown,
} from "./flows/focus.js";
import { onFormButtonClick, onFormCaptureMessage, onFormSubmit } from "./flows/form-save.js";
import {
  onEnterKey,
  onLoginButtonClick,
  onLoginSubmit,
  watchOutcome,
} from "./flows/save-prompt.js";
import { onPasswordPaste } from "./flows/site-check.js";
import { scheduleSetupScan } from "./flows/totp-setup.js";
import { send } from "./send.js";
import { state, t } from "./state.js";
import { showFormBanner } from "./ui/form-banner.js";
import { host, menu, trigger } from "./ui/root.js";
import { showBanner } from "./ui/save-banner.js";
import { placeTrigger } from "./ui/trigger.js";

trigger.addEventListener("mousedown", onTriggerMouseDown);
trigger.addEventListener("click", onTriggerClick);
menu.addEventListener("keydown", onMenuKeyDown);
document.addEventListener("click", onFieldClick, true);
document.addEventListener("input", onFieldInput, true);
document.addEventListener("focusin", onFocusIn, true);
window.addEventListener("blur", onWindowBlur);
document.addEventListener("mousedown", onPageMouseDown, true);
document.addEventListener("keydown", (event) => {
  onMenuNavKey(event);
  onEnterKey(event);
});
document.addEventListener("submit", onLoginSubmit, true);
document.addEventListener("click", onLoginButtonClick, true);
window.addEventListener("scroll", placeTrigger, true);
window.addEventListener("resize", placeTrigger);
document.addEventListener("submit", onFormSubmit, true);
document.addEventListener("click", onFormButtonClick, true);
document.addEventListener("paste", onPasswordPaste, true);
chrome.runtime.onMessage?.addListener(onFormCaptureMessage);

async function start(): Promise<void> {
  const { locale } = await chrome.storage.local.get<{ locale?: LocalePreference }>("locale");
  state.translate = createTranslator(resolveLocale(locale));
  trigger.title = t("autofill.trigger");
  trigger.setAttribute("aria-label", trigger.title);
  document.documentElement.append(host);

  const response = await send({ type: "autofill:pending" });
  if (response.ok && "prompt" in response && response.prompt) {
    if (response.prompt.confirmed) {
      showBanner(response.prompt);
    } else {
      watchOutcome([]);
    }
  } else {
    const form = await send({ type: "autofill:form-pending" });
    if (form.ok && "form" in form && form.form) {
      showFormBanner(form.form);
    }
  }

  if (document.activeElement instanceof HTMLInputElement) {
    onFocusIn({ target: document.activeElement } as unknown as FocusEvent);
  }

  scheduleSetupScan();
  new MutationObserver(scheduleSetupScan).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

void start();
