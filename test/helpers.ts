import { expect } from "vitest";
import { VaultError, type ErrorCode } from "../src/core/errors.js";

/**
 * Assert on the error *code*, never the message.
 *
 * Messages are localized and get reworded; codes are the contract. A test that
 * matches prose breaks on a typo fix and passes when the wrong error is thrown
 * with similar wording.
 */
export function expectCode(fn: () => unknown, code: ErrorCode): void {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  expect(thrown, `expected ${code} to be thrown`).toBeInstanceOf(VaultError);
  expect((thrown as VaultError).code).toBe(code);
}

export async function expectCodeAsync(promise: Promise<unknown>, code: ErrorCode): Promise<void> {
  let thrown: unknown;
  try {
    await promise;
  } catch (error) {
    thrown = error;
  }
  expect(thrown, `expected ${code} to be thrown`).toBeInstanceOf(VaultError);
  expect((thrown as VaultError).code).toBe(code);
}
