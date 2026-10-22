import type { Context } from "hono";
import { apiError, type ApiErrorCode } from "./errors.js";
import { logError } from "./log.js";
import type { AppBindings } from "./types.js";
import { isPlainObject } from "../core/json.js";

type Params = Record<string, string | number>;

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 401 | 403 | 404 | 409; code: ApiErrorCode; params?: Params };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<T>(
  status: 400 | 401 | 403 | 404 | 409,
  code: ApiErrorCode,
  params?: Params,
): Result<T> {
  return params ? { ok: false, status, code, params } : { ok: false, status, code };
}

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

export function now(): number {
  return Math.floor(Date.now() / 1000);
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
