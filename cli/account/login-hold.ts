import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isPlainObject } from "#core/json.js";
import { configDirectory, type Keyring } from "./credentials.js";

export type Holder = "7key agent" | "7key mcp";

export interface LoginHold {
  pid: number;
  holder: Holder;
  alive: boolean;
}

function holdFile(env: NodeJS.ProcessEnv): string {
  return path.join(configDirectory(env), "paused-by-agent");
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function parseHold(text: string): { pid: number; holder: Holder } | null {
  const trimmed = text.trim();
  if (/^\d+$/.test(trimmed)) {
    return { pid: Number(trimmed), holder: "7key agent" };
  }
  try {
    const value: unknown = JSON.parse(trimmed);
    if (
      isPlainObject(value) &&
      typeof value.pid === "number" &&
      (value.holder === "7key agent" || value.holder === "7key mcp")
    ) {
      return { pid: value.pid, holder: value.holder };
    }
  } catch {
    return null;
  }
  return null;
}

export function loginHold(env: NodeJS.ProcessEnv): LoginHold | null {
  const file = holdFile(env);
  if (!existsSync(file)) {
    return null;
  }
  const hold = parseHold(readFileSync(file, "utf8"));
  if (!hold) {
    rmSync(file, { force: true });
    return null;
  }
  return { ...hold, alive: running(hold.pid) };
}

export function forgetDeadHold(env: NodeJS.ProcessEnv): void {
  const hold = loginHold(env);
  if (hold && !hold.alive) {
    rmSync(holdFile(env), { force: true });
  }
}

export function heldLoginMessage(hold: LoginHold): string {
  return hold.alive
    ? `Your login is in use by ${hold.holder} (pid ${hold.pid}); it comes back when that process stops. Only one 7key agent or 7key mcp can hold it at a time.`
    : `${hold.holder} (pid ${hold.pid}) stopped without giving your login back, so it is gone from this computer. Run: 7key login`;
}

export function holdLogin(env: NodeJS.ProcessEnv, keyring: Keyring, holder: Holder): () => void {
  const raw = keyring.read();
  if (!raw) {
    return () => {};
  }
  const file = holdFile(env);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify({ pid: process.pid, holder }), { mode: 0o600 });
  keyring.remove();
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    if (!keyring.read()) {
      keyring.write(raw);
    }
    const current = loginHold(env);
    if (!current || current.pid === process.pid) {
      rmSync(file, { force: true });
    }
  };
}
