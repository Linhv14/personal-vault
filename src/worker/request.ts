import type { Context } from "hono";
import type { AppBindings } from "./types.js";

export function clientIp(c: Context<AppBindings>): string {
  return c.req.header("CF-Connecting-IP") ?? "unknown";
}

export function isOpenRegistration(env: AppBindings["Bindings"]): boolean {
  return env.REGISTRATION_MODE === "open";
}
