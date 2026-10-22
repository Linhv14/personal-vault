import type { AddressData, CardData } from "#ext/lib/autofill-protocol.js";
import { isCardKind, type DetectedField, type FormField } from "./classify.js";
import { addressValue, cardValue } from "./values.js";

export type Setter = (element: FormField, value: string) => void;

export function setFieldValue(element: FormField, value: string): void {
  const prototype =
    element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  element.focus();
  Reflect.set(prototype, "value", value, element);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

export function fillCard(fields: DetectedField[], card: CardData, set: Setter): number {
  let filled = 0;
  for (const field of fields) {
    if (!isCardKind(field.kind)) {
      continue;
    }
    const value = cardValue(field, card);
    if (value === null || value === "") {
      continue;
    }
    set(field.element, value);
    filled++;
  }
  return filled;
}

export function fillAddress(fields: DetectedField[], data: AddressData, set: Setter): number {
  let filled = 0;
  const ordered = [...fields].sort(
    (a, b) => Number(b.kind.startsWith("country")) - Number(a.kind.startsWith("country")),
  );
  for (const field of ordered) {
    if (isCardKind(field.kind)) {
      continue;
    }
    const value = addressValue(field, data, fields);
    if (value === null || value === "") {
      continue;
    }
    set(field.element, value);
    filled++;
  }
  return filled;
}
