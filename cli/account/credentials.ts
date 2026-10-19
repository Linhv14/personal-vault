import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fromBase64, toBase64 } from "../../src/core/bytes.js";
import type { Session } from "../agent/session.js";

const SERVICE = "7key-cli";
const ACCOUNT = "session";

export interface StoredLogin {
  server: string;
  email: string;
  token: string;
  expiresAt: number;
  publicKey: string;
  privateKey: string;
}

export interface Keyring {
  name: string;
  read(): string | null;
  write(value: string): void;
  remove(): void;
}

export function configDirectory(env: NodeJS.ProcessEnv): string {
  return path.join(env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config"), "7key");
}

function run(command: string, args: string[], input?: string) {
  return spawnSync(command, args, { input, encoding: "utf8" });
}

function macKeychain(): Keyring {
  return {
    name: "the macOS Keychain",
    read() {
      const result = run("security", ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"]);
      return result.status === 0 ? result.stdout.trim() : null;
    },
    write(value) {
      const result = run(
        "security",
        ["-i"],
        `add-generic-password -U -s ${SERVICE} -a ${ACCOUNT} -l 7key -w ${value}\n`,
      );
      if (result.status !== 0) throw new Error(`Keychain refused the session: ${result.stderr}`);
    },
    remove() {
      run("security", ["delete-generic-password", "-s", SERVICE, "-a", ACCOUNT]);
    },
  };
}

function secretService(): Keyring {
  const attributes = ["service", SERVICE, "account", ACCOUNT];
  return {
    name: "the system keyring",
    read() {
      const result = run("secret-tool", ["lookup", ...attributes]);
      return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : null;
    },
    write(value) {
      const result = run("secret-tool", ["store", "--label=7key", ...attributes], value);
      if (result.status !== 0) throw new Error(`The keyring refused the session: ${result.stderr}`);
    },
    remove() {
      run("secret-tool", ["clear", ...attributes]);
    },
  };
}

function fileKeyring(env: NodeJS.ProcessEnv): Keyring {
  const file = path.join(configDirectory(env), "session");
  return {
    name: `${file} (readable only by you)`,
    read: () => (existsSync(file) ? readFileSync(file, "utf8").trim() : null),
    write(value) {
      mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      writeFileSync(file, `${value}\n`, { mode: 0o600 });
    },
    remove: () => rmSync(file, { force: true }),
  };
}

function available(command: string): boolean {
  return run("which", [command]).status === 0;
}

export function systemKeyring(env: NodeJS.ProcessEnv): Keyring {
  if (env.SEVENKEY_KEYRING === "file") return fileKeyring(env);
  if (process.platform === "darwin" && available("security")) return macKeychain();
  if (process.platform === "linux" && available("secret-tool")) return secretService();
  return fileKeyring(env);
}

export function saveLogin(keyring: Keyring, login: StoredLogin): void {
  keyring.write(Buffer.from(JSON.stringify(login)).toString("base64"));
}

export function loadLogin(keyring: Keyring, now = Date.now() / 1000): StoredLogin | null {
  const raw = keyring.read();
  if (!raw) return null;
  try {
    const login = JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as StoredLogin;
    return login.token && login.expiresAt > now ? login : null;
  } catch {
    return null;
  }
}

export function sessionOf(login: StoredLogin, request: typeof fetch = fetch): Session {
  return {
    server: login.server,
    token: login.token,
    request,
    identity: { publicKey: login.publicKey, privateKey: fromBase64(login.privateKey) },
  };
}

export function loginOf(session: Session, email: string): StoredLogin {
  return {
    server: session.server,
    email,
    token: session.token,
    expiresAt: session.expiresAt ?? Math.floor(Date.now() / 1000) + 86_400,
    publicKey: session.identity.publicKey,
    privateKey: toBase64(session.identity.privateKey),
  };
}

function pauseFile(env: NodeJS.ProcessEnv): string {
  return path.join(configDirectory(env), "paused-by-agent");
}

export function pausedBy(env: NodeJS.ProcessEnv): number | null {
  const file = pauseFile(env);
  if (!existsSync(file)) return null;
  const pid = Number(readFileSync(file, "utf8"));
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

export function pauseLogin(env: NodeJS.ProcessEnv, keyring: Keyring): () => void {
  const raw = keyring.read();
  if (!raw) return () => {};
  const file = pauseFile(env);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, String(process.pid), { mode: 0o600 });
  keyring.remove();
  return () => {
    if (!keyring.read()) keyring.write(raw);
    rmSync(file, { force: true });
  };
}
