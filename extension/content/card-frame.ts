import { isPaymentFrameUrl } from "../../src/core/payment-frames.js";
import type { CardData } from "../lib/autofill-protocol.js";
import { detectFields, fillCard, setFieldValue } from "./forms.js";

function inPaymentFrame(): boolean {
  try {
    return window.top !== window && isPaymentFrameUrl(location.href);
  } catch {
    return false;
  }
}

if (inPaymentFrame()) {
  void chrome.runtime.sendMessage({ type: "autofill:card-frame" }).catch(() => {});
  chrome.runtime.onMessage.addListener((message: unknown) => {
    const request = message as { type?: string; card?: CardData } | null;
    if (request?.type !== "7key:card-frame-fill" || !request.card) return;
    fillCard(detectFields(document), request.card, setFieldValue);
  });
}
