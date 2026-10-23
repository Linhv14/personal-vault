import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fromBase64, toBase64 } from "#core/bytes.js";
import { isPlainObject, parseJsonAs } from "#core/json.js";
import { AgentError, type Session } from "../agent/session.js";

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

function isStoredLogin(value: unknown): value is StoredLogin {
  return (
    isPlainObject(value) &&
    typeof value.server === "string" &&
    typeof value.email === "string" &&
    typeof value.token === "string" &&
    typeof value.expiresAt === "number" &&
    typeof value.publicKey === "string" &&
    typeof value.privateKey === "string"
  );
}

export interface Keyring {
  name: string;
  warning?: string;
  unavailable?: string;
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
      if (result.status !== 0) {
        throw new Error(`Keychain refused the session: ${result.stderr}`);
      }
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
      if (result.status !== 0) {
        throw new Error(`The keyring refused the session: ${result.stderr}`);
      }
    },
    remove() {
      run("secret-tool", ["clear", ...attributes]);
    },
  };
}

export const INSECURE_FILE_STORE_FLAG = "--insecure-file-store";
export const INSECURE_FILE_STORE_ENV = "SEVENKEY_INSECURE_FILE_STORE";

export const NO_KEYRING_MESSAGE = `No system keyring found, so 7key will not keep your session and private key in a plain file.
Install libsecret and secret-tool (Debian/Ubuntu: sudo apt install libsecret-tools, Fedora: sudo dnf install libsecret) and log in again.
To store them unencrypted anyway, pass ${INSECURE_FILE_STORE_FLAG} or set ${INSECURE_FILE_STORE_ENV}=1.`;

function sessionFile(env: NodeJS.ProcessEnv): string {
  return path.join(configDirectory(env), "session");
}

export function fileKeyring(env: NodeJS.ProcessEnv): Keyring {
  const file = sessionFile(env);
  return {
    name: `${file} (readable only by you)`,
    warning: `Warning: your session and private key are stored unencrypted in ${file}. Anyone who can read your files as you can use them.`,
    read: () => (existsSync(file) ? readFileSync(file, "utf8").trim() : null),
    write(value) {
      mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      writeFileSync(file, `${value}\n`, { mode: 0o600 });
      chmodSync(file, 0o600);
    },
    remove: () => rmSync(file, { force: true }),
  };
}

function refusingKeyring(env: NodeJS.ProcessEnv): Keyring {
  const legacy = fileKeyring(env);
  return {
    name: "no keyring",
    unavailable: NO_KEYRING_MESSAGE,
    read: (...args) => legacy.read(...args),
    write() {
      throw new AgentError(NO_KEYRING_MESSAGE);
    },
    remove: (...args) => legacy.remove(...args),
  };
}

export function insecureFileStoreAllowed(
  env: NodeJS.ProcessEnv,
  options: { insecureFileStore?: boolean } = {},
): boolean {
  return (
    options.insecureFileStore === true ||
    env[INSECURE_FILE_STORE_ENV] === "1" ||
    env.SEVENKEY_KEYRING === "file"
  );
}

function available(command: string): boolean {
  return run("which", [command]).status === 0;
}

export function systemKeyring(
  env: NodeJS.ProcessEnv,
  options: {
    insecureFileStore?: boolean;
    platform?: NodeJS.Platform;
    has?: (command: string) => boolean;
  } = {},
): Keyring {
  const platform = options.platform ?? process.platform;
  const has = options.has ?? available;
  const insecure = insecureFileStoreAllowed(env, options);
  if (env.SEVENKEY_KEYRING === "file") {
    return fileKeyring(env);
  }
  if (platform === "darwin" && has("security")) {
    return macKeychain();
  }
  if (platform === "linux" && has("secret-tool")) {
    return secretService();
  }
  return insecure ? fileKeyring(env) : refusingKeyring(env);
}

export function saveLogin(keyring: Keyring, login: StoredLogin): void {
  keyring.write(Buffer.from(JSON.stringify(login)).toString("base64"));
}

export function loadLogin(keyring: Keyring, now = Date.now() / 1000): StoredLogin | null {
  const raw = keyring.read();
  if (!raw) {
    return null;
  }
  try {
    const login = parseJsonAs(Buffer.from(raw, "base64").toString("utf8"), isStoredLogin);
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
