import { expect } from "vitest";
import { VaultError, type ErrorCode } from "../src/core/errors.js";

export function jsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected a JSON object");
  }
  return value as Record<string, unknown>;
}

export async function readJsonObject(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  return jsonObject(value);
}

export function stringField(object: Record<string, unknown>, key: string): string {
  const value = object[key];
  if (typeof value !== "string") {
    throw new TypeError(`Expected ${key} to be a string`);
  }
  return value;
}

export function stringArrayField(object: Record<string, unknown>, key: string): string[] {
  const value = object[key];
  if (!Array.isArray(value) || !value.every((entry: unknown) => typeof entry === "string")) {
    throw new TypeError(`Expected ${key} to be a string array`);
  }
  return value;
}

export function numberField(object: Record<string, unknown>, key: string): number {
  const value = object[key];
  if (typeof value !== "number") {
    throw new TypeError(`Expected ${key} to be a number`);
  }
  return value;
}

export function objectField(object: Record<string, unknown>, key: string): Record<string, unknown> {
  return jsonObject(object[key]);
}

export function objectArrayField(
  object: Record<string, unknown>,
  key: string,
): Record<string, unknown>[] {
  const value = object[key];
  if (!Array.isArray(value)) {
    throw new TypeError(`Expected ${key} to be an array`);
  }
  return value.map(jsonObject);
}

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
