export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export function parseJsonAs<T>(text: string, guard: (value: unknown) => value is T): T {
  const value: unknown = JSON.parse(text);
  if (!guard(value)) {
    throw new TypeError("JSON value has an unexpected shape");
  }
  return value;
}
