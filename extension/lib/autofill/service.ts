import type { AutofillRequest, AutofillResponse } from "../autofill-protocol.js";
import { handleFormRequest } from "../form-save.js";
import { siteWarning } from "../site-warning.js";
import { openVault } from "../vault/decrypt.js";
import { cardHandlers } from "./cards.js";
import type { AutofillHandlers } from "./handler.js";
import { identityHandlers } from "./identities.js";
import { loginHandlers } from "./login.js";
import { savePromptHandlers } from "./save-prompt.js";
import { formsAllowed, isVaultServer, type TrustedSender } from "./senders.js";
import { totpHandlers } from "./totp.js";

type FormRequest = Parameters<typeof handleFormRequest>[0];

async function formHandler(request: FormRequest, sender: TrustedSender) {
  return handleFormRequest(request, sender, await formsAllowed(sender));
}

const handlers: AutofillHandlers<AutofillRequest["type"]> = {
  ...loginHandlers,
  ...savePromptHandlers,
  ...totpHandlers,
  ...cardHandlers,
  ...identityHandlers,
  "autofill:form-capture": formHandler,
  "autofill:form-pending": formHandler,
  "autofill:form-save": formHandler,
  "autofill:form-dismiss": formHandler,

  "autofill:site-check": async (_request, sender) => {
    if (await isVaultServer(sender.url)) {
      return { ok: true, lookalike: null };
    }
    const vault = await openVault();
    if (!vault) {
      return { ok: true, lookalike: null };
    }
    return { ok: true, lookalike: siteWarning(sender.url, vault.items) };
  },

  "autofill:open-popup": async () => {
    await chrome.action.openPopup?.().catch(() => {});
    return { ok: true, saved: false };
  },
};

export async function handleAutofill(
  request: AutofillRequest,
  sender: TrustedSender,
): Promise<AutofillResponse> {
  const handler = handlers[request.type] as (
    request: AutofillRequest,
    sender: TrustedSender,
  ) => Promise<AutofillResponse>;
  return await handler(request, sender);
}
