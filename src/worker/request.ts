import type { Context } from "hono";
import type { AppBindings } from "./types.js";

export function clientIp(c: Context<AppBindings>): string {
  return c.req.header("CF-Connecting-IP") ?? "unknown";
}

export function isOpenRegistration(env: AppBindings["Bindings"]): boolean {
  return env.REGISTRATION_MODE === "open";
}

export function requestLocale(c: Context<AppBindings>, requested: unknown): "en" | "vi" {
  if (requested === "vi" || requested === "en") return requested;
  const preferred = c.req.header("Accept-Language")?.split(",")[0]?.trim().toLowerCase() ?? "";
  return preferred.startsWith("vi") ? "vi" : "en";
}
