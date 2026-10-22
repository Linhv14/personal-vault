import { hasPaymentFrames, passwordFields } from "../detect.js";
import { fillState, isSubmitLike, readAddress, readCard } from "../forms/read.js";
import { detectFields, formKindOf, isCardKind, type DetectedField } from "../forms/classify.js";
import { send } from "../send.js";
import { filled, state } from "../state.js";
import { showFormBanner } from "../ui/form-banner.js";
import { isStandalonePhone } from "./address.js";

function lonePhone(fields: DetectedField[]): string | undefined {
  const withValue = fields.filter(({ element }) => element.value.trim());
  const only = withValue.length === 1 ? withValue[0] : undefined;
  if (
    !only ||
    only.kind !== "tel" ||
    !(only.element instanceof HTMLInputElement) ||
    !isStandalonePhone(only.element) ||
    formKindOf(only.element, fields) !== null ||
    !fillState([only], filled).typed
  ) {
    return undefined;
  }
  return only.element.value.trim();
}

async function captureForm(scope: ParentNode): Promise<void> {
  if (location.protocol !== "https:") {
    return;
  }
  if (passwordFields(scope).some((field) => field.value)) {
    return;
  }
  const fields = detectFields(scope);
  const cardFields = fields.filter((field) => isCardKind(field.kind));
  const placeFields = fields.filter((field) => !isCardKind(field.kind));
  const typedCard = cardFields.some((field) => field.kind === "cc-number" && field.element.value);
  const framed = hasPaymentFrames(scope === document ? document : scope);
  const kind = placeFields[0] ? formKindOf(placeFields[0].element, fields) : null;
  const cardState = fillState(cardFields, filled);
  const placeState = fillState(placeFields, filled);
  const card = typedCard || framed ? readCard(cardFields) : undefined;
  const address =
    kind && (placeState.typed || placeState.random) ? readAddress(placeFields) : undefined;
  const phone = card || address ? undefined : lonePhone(placeFields);
  if (!card && !address && !phone) {
    return;
  }
  const key = JSON.stringify([card, address, phone]);
  if (key === state.lastFormCapture.key && Date.now() - state.lastFormCapture.at < 3000) {
    return;
  }
  state.lastFormCapture = { key, at: Date.now() };
  const response = await send({
    type: "autofill:form-capture",
    ...(card ? { card, untouched: !cardState.typed } : {}),
    ...(address ? { address, random: placeState.random } : {}),
    ...(phone ? { address: { phone }, lonePhone: true } : {}),
  });
  if (response.ok && "form" in response && response.form) {
    showFormBanner(response.form);
  }
}

export function onFormSubmit(event: SubmitEvent): void {
  if (event.target instanceof HTMLFormElement) {
    void captureForm(event.target);
  }
}

export function onFormButtonClick(event: MouseEvent): void {
  if (!event.isTrusted) {
    return;
  }
  const button = (event.target as Element | null)?.closest?.(
    'button, input[type="submit"], input[type="button"], [role="button"]',
  );
  if (!button || !isSubmitLike(button)) {
    return;
  }
  const scope = (button as HTMLButtonElement).form ?? button.closest("form") ?? document;
  void captureForm(scope);
}

export function onFormCaptureMessage(message: unknown): void {
  if ((message as { type?: unknown } | null)?.type === "7key:form-capture") {
    void captureForm(document);
  }
}
