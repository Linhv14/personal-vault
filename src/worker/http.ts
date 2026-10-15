import type { Context } from "hono";
import { apiError, type ApiErrorCode } from "./errors.js";
import type { AppBindings } from "./types.js";

export type Result<T> =
  { ok: true; value: T } | { ok: false; status: 400 | 403 | 404 | 409; code: ApiErrorCode };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<T>(status: 400 | 403 | 404 | 409, code: ApiErrorCode): Result<T> {
  return { ok: false, status, code };
}

export function respond<T>(c: Context<AppBindings>, result: Result<T>, status: 200 | 201 = 200) {
  return result.ok
    ? c.json(result.value as object, status)
    : c.json(apiError(result.code), result.status);
}

export async function readJson(c: Context<AppBindings>): Promise<Record<string, unknown>> {
  const body = (await c.req.json().catch(() => null)) as unknown;
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
}

export function now(): number {
  return Math.floor(Date.now() / 1000);
}
