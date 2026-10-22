import type { AutofillRequest, AutofillResponse } from "../lib/autofill-protocol.js";

export async function send(request: AutofillRequest): Promise<AutofillResponse> {
  try {
    return await chrome.runtime.sendMessage<AutofillRequest, AutofillResponse>(request);
  } catch {
    return { ok: false, error: "unavailable" };
  }
}
