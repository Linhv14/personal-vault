import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { login, parseFlags, type Context } from "../cli/account/commands.js";
import { NO_KEYRING_MESSAGE, systemKeyring } from "../cli/account/credentials.js";

let home: string;
let env: NodeJS.ProcessEnv;
const sessionFile = () => path.join(home, "7key", "session");
const none = () => false;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "7key-credentials-"));
  env = { XDG_CONFIG_HOME: home };
});

afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("CLI credential store without a system keyring", () => {
  it("refuses to write the session to a plain file by default", () => {
    const keyring = systemKeyring(env, { platform: "linux", has: none });
    expect(keyring.unavailable).toBe(NO_KEYRING_MESSAGE);
    expect(() => keyring.write("secret")).toThrow("secret-tool");
    expect(existsSync(sessionFile())).toBe(false);
  });

  it("names the package to install and the opt-in", () => {
    expect(NO_KEYRING_MESSAGE).toContain("libsecret");
    expect(NO_KEYRING_MESSAGE).toContain("--insecure-file-store");
    expect(NO_KEYRING_MESSAGE).toContain("SEVENKEY_INSECURE_FILE_STORE=1");
  });

  it("stops login before asking for the master password", async () => {
    const askPassword = vi.fn(async () => "never asked");
    const context = {
      env,
      cwd: home,
      keyring: systemKeyring(env, { platform: "linux", has: none }),
      request: vi.fn(),
      log: vi.fn(),
      out: vi.fn(),
      ask: vi.fn(async () => "me@example.com"),
      askPassword,
      choose: vi.fn(),
    } as unknown as Context;
    await expect(login({ command: [], email: "me@example.com" }, context)).rejects.toThrow(
      "No system keyring",
    );
    expect(askPassword).not.toHaveBeenCalled();
  });

  it.each([
    ["the flag", {}, { insecureFileStore: true }],
    ["the environment", { SEVENKEY_INSECURE_FILE_STORE: "1" }, {}],
  ])("stores a 0600 file with a warning when opted in through %s", (_, extra, options) => {
    const keyring = systemKeyring(
      { ...env, ...extra },
      { platform: "linux", has: none, ...options },
    );
    expect(keyring.unavailable).toBeUndefined();
    expect(keyring.warning).toMatch(/unencrypted/);
    keyring.write("secret");
    expect(readFileSync(sessionFile(), "utf8").trim()).toBe("secret");
    expect(statSync(sessionFile()).mode & 0o777).toBe(0o600);
  });

  it("tightens a session file that was left readable by others", () => {
    const keyring = systemKeyring(env, { platform: "linux", has: none, insecureFileStore: true });
    keyring.write("first");
    writeFileSync(sessionFile(), "loose\n", { mode: 0o644 });
    keyring.write("second");
    expect(statSync(sessionFile()).mode & 0o777).toBe(0o600);
  });

  it("still reads and removes a session file written before the change", () => {
    systemKeyring(env, { platform: "linux", has: none, insecureFileStore: true }).write("old");
    const keyring = systemKeyring(env, { platform: "linux", has: none });
    expect(keyring.read()).toBe("old");
    keyring.remove();
    expect(existsSync(sessionFile())).toBe(false);
  });

  it("uses the system keyring whenever one is present", () => {
    expect(systemKeyring(env, { platform: "linux", has: () => true }).name).toBe(
      "the system keyring",
    );
    expect(systemKeyring(env, { platform: "darwin", has: () => true }).name).toBe(
      "the macOS Keychain",
    );
  });

  it("parses the opt-in flag", () => {
    expect(parseFlags(["--insecure-file-store"]).insecureFileStore).toBe(true);
  });
});
