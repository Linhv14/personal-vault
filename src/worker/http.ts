import type { Context } from "hono";
import { apiError } from "./errors.js";
import { logError } from "./log.js";
import type { Result } from "./result.js";
import type { AppBindings } from "./types.js";
import { isPlainObject } from "#core/json.js";

export function respond<T>(c: Context<AppBindings>, result: Result<T>, status: 200 | 201 = 200) {
  return result.ok
    ? c.json(result.value as object, status)
    : c.json(apiError(result.code, result.params), result.status);
}

export class InvalidBodyError extends Error {
  constructor() {
    super("Request body is not a JSON object");
    this.name = "InvalidBodyError";
  }
}

export async function readJson(c: Context<AppBindings>): Promise<Record<string, unknown>> {
  const body: unknown = await c.req.json().catch(() => null);
  if (!isPlainObject(body)) {
    throw new InvalidBodyError();
  }
  return body;
}

export function inBackground(
  c: Context<AppBindings>,
  event: string,
  task: () => Promise<unknown>,
): void {
  c.executionCtx.waitUntil(
    Promise.resolve()
      .then(task)
      .catch((error: unknown) => logError(event, error)),
  );
}
