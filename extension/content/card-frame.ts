import { isPaymentFrameUrl } from "../../src/core/payment-frames.js";
import { isCardFrameFill, type CardFrameCapture } from "../lib/autofill-protocol.js";
import { detectFields, isCardKind, type FormField } from "./forms/classify.js";
import { fillCard, setFieldValue } from "./forms/fill.js";
import { fillState, readCard, type FilledFields } from "./forms/read.js";

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
  chrome.runtime.onMessage.addListener((message: unknown, sender) => {
    if (sender.id !== chrome.runtime.id || sender.tab || !isCardFrameFill(message)) {
      return;
    }
    fillCard(detectFields(document), message.card, trackValue);
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
