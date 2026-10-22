import {
  findUsernameField,
  isVisible,
  namesAccount,
  passwordFields,
  scopeOf,
  USERNAME_INPUTS,
} from "../detect.js";
import { send } from "../send.js";
import { state } from "../state.js";
import { banner } from "../ui/root.js";
import { showBanner } from "../ui/save-banner.js";

const OUTCOME_WAIT_MS = 10_000;
const OUTCOME_STABLE_MS = 1_000;
const OUTCOME_POLL_MS = 250;

function capturedPassword(scope: ParentNode): string {
  const values = passwordFields(scope)
    .map((field) => field.value)
    .filter(Boolean);
  const repeated = values.find((value, index) => values.indexOf(value) !== index);
  return repeated ?? values.at(-1) ?? "";
}

export function rememberIdentifier(scope: ParentNode): void {
  const field = [...scope.querySelectorAll<HTMLInputElement>(USERNAME_INPUTS)].find(
    (input) => isVisible(input) && input.value.trim() && namesAccount(input),
  );
  if (field) {
    void send({ type: "autofill:identifier", username: field.value.trim() });
  }
}

export async function capture(scope: ParentNode): Promise<void> {
  const fields = passwordFields(scope);
  if (fields.length === 0) {
    if (scope !== document) {
      rememberIdentifier(scope);
    }
    return;
  }
  const password = capturedPassword(scope);
  if (!password) {
    return;
  }
  if (password === state.lastCapture.password && Date.now() - state.lastCapture.at < 3000) {
    return;
  }
  state.lastCapture = { password, at: Date.now() };

  const username = findUsernameField(fields[0]!)?.value.trim() || undefined;
  const response = await send({ type: "autofill:capture", username, password });
  if (response.ok && "prompt" in response && response.prompt) {
    banner.hidden = true;
    watchOutcome(fields);
  }
}

function loginRejected(fields: HTMLInputElement[]): boolean {
  return fields.some(
    (field) =>
      field.isConnected && isVisible(field) && field.getAttribute("aria-invalid") === "true",
  );
}

function loginFormShown(fields: HTMLInputElement[]): boolean {
  return (
    fields.some((field) => field.isConnected && isVisible(field)) || passwordFields().length > 0
  );
}

export function watchOutcome(fields: HTMLInputElement[]): void {
  clearInterval(state.outcomeTimer);
  const deadline = Date.now() + OUTCOME_WAIT_MS;
  let goneSince = 0;
  const stop = (outcome: "confirm" | "dismiss") => {
    clearInterval(state.outcomeTimer);
    state.outcomeTimer = undefined;
    if (outcome === "dismiss") {
      void send({ type: "autofill:dismiss" });
      return;
    }
    void send({ type: "autofill:confirm" }).then((response) => {
      if (response.ok && "prompt" in response && response.prompt) {
        showBanner(response.prompt);
      }
    });
  };
  state.outcomeTimer = setInterval(() => {
    if (loginRejected(fields)) {
      return stop("dismiss");
    }
    if (loginFormShown(fields)) {
      goneSince = 0;
      if (Date.now() > deadline) {
        stop("dismiss");
      }
      return;
    }
    goneSince ||= Date.now();
    if (Date.now() - goneSince >= OUTCOME_STABLE_MS) {
      stop("confirm");
    }
  }, OUTCOME_POLL_MS);
}

export function onEnterKey(event: KeyboardEvent): void {
  const target = event.target;
  if (event.key === "Enter" && target instanceof HTMLInputElement) {
    if (target.type === "password") {
      void capture(scopeOf(target));
    } else if (target.form) {
      rememberIdentifier(target.form);
    }
  }
}

export function onLoginSubmit(event: SubmitEvent): void {
  if (event.target instanceof HTMLFormElement) {
    void capture(event.target);
  }
}

export function onLoginButtonClick(event: MouseEvent): void {
  const button = (event.target as Element | null)?.closest?.(
    'button, input[type="submit"], [role="button"]',
  );
  if (!button) {
    return;
  }
  const scope = (button as HTMLButtonElement).form ?? button.closest("form") ?? document;
  if (passwordFields(scope).some((field) => field.value)) {
    void capture(scope);
  } else if (scope !== document) {
    rememberIdentifier(scope);
  }
}
