import { isPaymentFrameUrl } from "../../src/core/payment-frames.js";
import type { CardData, CardFrameCapture } from "../lib/autofill-protocol.js";
import { detectFields, fillCard, isCardKind, setFieldValue, type FormField } from "./forms.js";
import { fillState, readCard, type FilledFields } from "./form-capture.js";

function inPaymentFrame(): boolean {
  try {
    return window.top !== window && isPaymentFrameUrl(location.href);
  } catch {
    return false;
  }
}

const filled: FilledFields = new WeakMap();

function trackValue(element: FormField, value: string): void {
  setFieldValue(element, value);
  filled.set(element, { value: element.value, random: false });
}

function reportCard(submit: boolean): void {
  if (location.protocol !== "https:") {
    return;
  }
  const fields = detectFields(document).filter((field) => isCardKind(field.kind));
  const card = readCard(fields);
  if (Object.keys(card).length === 0) {
    return;
  }
  const message: CardFrameCapture = {
    type: "autofill:card-frame-capture",
    card,
    untouched: !fillState(fields, filled).typed,
    submit,
  };
  void chrome.runtime.sendMessage(message).catch(() => {});
}

if (inPaymentFrame()) {
  void chrome.runtime.sendMessage({ type: "autofill:card-frame" }).catch(() => {});
  chrome.runtime.onMessage.addListener((message: unknown) => {
    const request = message as { type?: string; card?: CardData } | null;
    if (request?.type !== "7key:card-frame-fill" || !request.card) {
      return;
    }
    fillCard(detectFields(document), request.card, trackValue);
  });
  document.addEventListener(
    "change",
    (event) => {
      if (event.isTrusted && event.target instanceof Element) {
        reportCard(false);
      }
    },
    true,
  );
  document.addEventListener("submit", () => reportCard(true), true);
}
