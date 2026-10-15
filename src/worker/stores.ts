import type { Env } from "./types.js";

export function userStore(env: Env, accountId: string) {
  return env.USER_STORE.get(env.USER_STORE.idFromName(`user:${accountId}`));
}

export function orgStore(env: Env, orgId: string) {
  return env.ORG_STORE.get(env.ORG_STORE.idFromName(`org:${orgId}`));
}
