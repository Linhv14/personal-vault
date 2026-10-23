import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Keyring } from "../cli/account/credentials.js";
import {
  forgetDeadHold,
  heldLoginMessage,
  holdLogin,
  loginHold,
} from "../cli/account/login-hold.js";

function memoryKeyring(value: string | null): Keyring {
  let stored = value;
  return {
    name: "memory",
    read: () => stored,
    write: (next) => {
      stored = next;
    },
    remove: () => {
      stored = null;
    },
  };
}

function freshEnv(): NodeJS.ProcessEnv {
  return { XDG_CONFIG_HOME: mkdtempSync(path.join(tmpdir(), "7key-hold-")) };
}

function holdPath(env: NodeJS.ProcessEnv): string {
  return path.join(env.XDG_CONFIG_HOME!, "7key", "paused-by-agent");
}

function deadPid(): number {
  return Number(
    spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], {
      encoding: "utf8",
    }).stdout,
  );
}

describe("holding the login while an agent runs", () => {
  it("takes the login out of the keyring, names the holder and gives it back once", () => {
    const env = freshEnv();
    const keyring = memoryKeyring("login");
    const release = holdLogin(env, keyring, "7key mcp");
    expect(keyring.read()).toBeNull();
    expect(loginHold(env)).toEqual({ pid: process.pid, holder: "7key mcp", alive: true });
    expect(heldLoginMessage(loginHold(env)!)).toContain("in use by 7key mcp");
    release();
    release();
    expect(keyring.read()).toBe("login");
    expect(loginHold(env)).toBeNull();
  });

  it("keeps a newer login made while the agent ran", () => {
    const env = freshEnv();
    const keyring = memoryKeyring("old");
    const release = holdLogin(env, keyring, "7key agent");
    keyring.write("new");
    release();
    expect(keyring.read()).toBe("new");
  });

  it("says the login is gone when its holder died, and forgets that holder", () => {
    const env = freshEnv();
    mkdirSync(path.dirname(holdPath(env)), { recursive: true });
    writeFileSync(holdPath(env), JSON.stringify({ pid: deadPid(), holder: "7key mcp" }));
    const hold = loginHold(env)!;
    expect(hold.alive).toBe(false);
    expect(heldLoginMessage(hold)).toContain("Run: 7key login");
    forgetDeadHold(env);
    expect(existsSync(holdPath(env))).toBe(false);
  });

  it("reads the plain pid an older 7key agent wrote", () => {
    const env = freshEnv();
    mkdirSync(path.dirname(holdPath(env)), { recursive: true });
    writeFileSync(holdPath(env), String(process.pid));
    expect(loginHold(env)).toEqual({ pid: process.pid, holder: "7key agent", alive: true });
  });

  it("does nothing when there is no login to hold", () => {
    const env = freshEnv();
    const keyring = memoryKeyring(null);
    holdLogin(env, keyring, "7key mcp")();
    expect(loginHold(env)).toBeNull();
    expect(keyring.read()).toBeNull();
  });
});
