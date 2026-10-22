import type { FormField } from "./forms/classify.js";
import { setFieldValue } from "./forms/fill.js";
import { filled } from "./state.js";

function trackValue(element: FormField, value: string, random: boolean): void {
  setFieldValue(element, value);
  if (!(element instanceof HTMLInputElement && element.type === "password")) {
    filled.set(element, { value: element.value, random });
  }
}

export function setValue(element: FormField, value: string): void {
  trackValue(element, value, false);
}

export function setRandomValue(element: FormField, value: string): void {
  trackValue(element, value, true);
}
