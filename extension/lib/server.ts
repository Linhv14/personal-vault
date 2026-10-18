declare const __VAULT_DEFAULT_SERVER__: string | undefined;

export function defaultServer(): string {
  return typeof __VAULT_DEFAULT_SERVER__ === "string" ? __VAULT_DEFAULT_SERVER__ : "";
}

export function isDefaultServer(apiUrl: string | undefined, fallback = defaultServer()): boolean {
  if (!apiUrl || !fallback) return false;
  try {
    return new URL(apiUrl).origin === new URL(fallback).origin;
  } catch {
    return false;
  }
}
