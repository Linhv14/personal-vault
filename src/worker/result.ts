import type { ApiErrorCode } from "./errors.js";

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
