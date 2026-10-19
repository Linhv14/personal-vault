import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export interface Remembered {
  email?: string;
  server?: string;
}

function configFile(env: NodeJS.ProcessEnv): string {
  const base = env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config");
  return path.join(base, "7key", "config.json");
}

export function remembered(env: NodeJS.ProcessEnv): Remembered {
  const file = configFile(env);
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Remembered;
  } catch {
    return {};
  }
}

export function remember(env: NodeJS.ProcessEnv, value: Remembered): void {
  const file = configFile(env);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}
