import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { utf8Encode } from "../src/core/bytes.js";
import { createAccount, seal } from "../src/core/crypto.js";
import { createIdentity, randomKey, wrapForRecipient } from "../src/core/identity.js";
import { teamKeyContext } from "../src/core/org-model.js";
import { memoryArea, usePlatform } from "../extension/lib/platform.js";
import { getOrg } from "../extension/lib/orgs.js";
import { createProject, listProjects, saveSecret } from "../extension/lib/projects.js";
import {
  dotenvLocal,
  link,
  listSecrets,
  login,
  logout,
  parseFlags,
  runLocal,
  whoami,
  type Context,
} from "../cli/account/commands.js";
import { loadLogin, pauseLogin, type Keyring } from "../cli/account/credentials.js";
import { LINK_FILE } from "../cli/account/link.js";

const BASE = process.env.VAULT_E2E_URL ?? "http://127.0.0.1:8787";
const REGISTRATION_TOKEN = process.env.VAULT_REGISTRATION_TOKEN ?? "token-dev-local";
const enabled = process.env.VAULT_E2E === "1";
const PASSWORD = "cli login test password";

async function api(route: string, init: RequestInit & { token?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.body) {
    headers.set("Content-Type", "application/json");
  }
  if (init.token) {
    headers.set("Authorization", `Bearer ${init.token}`);
  }
  const response = await fetch(`${BASE}${route}`, { ...init, headers });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function memoryKeyring(): Keyring {
  let stored: string | null = null;
  return {
    name: "memory",
    read: () => stored,
    write: (value) => void (stored = value),
    remove: () => void (stored = null),
  };
}

describe.skipIf(!enabled)("7key login, link and run against Worker + D1", () => {
  const email = `cli-${Date.now()}@example.com`;
  const keyring = memoryKeyring();
  const folder = mkdtempSync(path.join(tmpdir(), "7key-link-"));
  const config = mkdtempSync(path.join(tmpdir(), "7key-config-"));
  const printed: string[] = [];
  const context = (env: NodeJS.ProcessEnv = {}): Context => ({
    env: { PATH: process.env.PATH, XDG_CONFIG_HOME: config, SEVENKEY_SERVER: BASE, ...env },
    cwd: folder,
    keyring,
    request: fetch,
    log: () => {},
    out: (text) => void printed.push(text),
    ask: async () => email,
    askPassword: async () => PASSWORD,
    choose: async () => {
      throw new Error("should not need to ask");
    },
  });

  beforeAll(async () => {
    const { record, vaultKey } = await createAccount(email, PASSWORD, 600_000);
    const registered = await api("/api/auth/register", {
      method: "POST",
      headers: { "x-registration-token": REGISTRATION_TOKEN },
      body: JSON.stringify({ email, ...record }),
    });
    const token = registered.body.token;
    const identity = await createIdentity();
    await api("/api/account/identity", {
      method: "PUT",
      token,
      body: JSON.stringify({
        publicKey: identity.publicKey,
        wrappedPrivateKey: await seal(
          vaultKey,
          identity.privateKey,
          utf8Encode("personal-vault/account-private-key"),
        ),
      }),
    });
    const orgId = (
      await api("/api/orgs", { method: "POST", token, body: JSON.stringify({ name: "CLI Co" }) })
    ).body.id;
    const teamId = crypto.randomUUID();
    await api(`/api/orgs/${orgId}/teams`, {
      method: "POST",
      token,
      body: JSON.stringify({
        id: teamId,
        name: "Platform",
        wrappedKey: await wrapForRecipient(
          identity.publicKey,
          randomKey(),
          teamKeyContext(teamId, 0),
        ),
      }),
    });
    usePlatform({
      local: memoryArea({ apiUrl: BASE }),
      session: memoryArea({ vaultKeyRaw: "unused", token }),
      scheduleLock: async () => {},
    });
    const team = (await getOrg(orgId)).teams.find((entry) => entry.id === teamId)!;
    await createProject(orgId, team, identity, "Payments API");
    const [project] = await listProjects(orgId, team, identity);
    const [development, , production] = project!.content.environments;
    await saveSecret(orgId, project!, development!.id, { name: "STRIPE_KEY", value: "sk_test_1" });
    await saveSecret(orgId, project!, production!.id, { name: "STRIPE_KEY", value: "sk_live_9" });
  });

  afterAll(() => {
    rmSync(folder, { recursive: true, force: true });
    rmSync(config, { recursive: true, force: true });
  });

  it("logs in once and keeps the session in the keyring", async () => {
    expect(await login(parseFlags([]), context())).toBe(0);
    const stored = loadLogin(keyring)!;
    expect(stored.email).toBe(email);
    expect(stored.server).toBe(new URL(BASE).origin);
    expect(JSON.stringify(stored)).not.toContain(PASSWORD);
  });

  it("links the folder by name and writes no secret into the link file", async () => {
    await expect(
      link(parseFlags(["--project", "payments-api", "--env", "development"]), context()),
    ).resolves.toBe(0);
    const written = readFileSync(path.join(folder, LINK_FILE), "utf8");
    expect(JSON.parse(written)).toMatchObject({
      org: "CLI Co",
      project: "Payments API",
      environment: "Development",
    });
    expect(written).not.toContain("sk_test");
  });

  it("hands the linked values to dotenv and run, and switches environment with --env", async () => {
    printed.length = 0;
    await dotenvLocal(parseFlags([]), context());
    expect(printed.join("")).toContain("STRIPE_KEY=sk_test_1");

    printed.length = 0;
    await dotenvLocal(parseFlags(["--env", "Production"]), context());
    expect(printed.join("")).toContain("STRIPE_KEY=sk_live_9");

    const out = path.join(folder, "out.txt");
    const code = await runLocal(
      parseFlags(["--", "sh", "-c", `printf %s "$STRIPE_KEY" > ${out}`]),
      context(),
    );
    expect(code).toBe(0);
    expect(readFileSync(out, "utf8")).toBe("sk_test_1");

    printed.length = 0;
    await listSecrets(parseFlags([]), context());
    expect(printed.join("")).toContain("STRIPE_KEY");
    expect(printed.join("")).not.toContain("sk_test_1");
    await whoami(parseFlags([]), context());
  });

  it("gives nothing out from inside an agent, and sets the login aside while one runs", async () => {
    await expect(dotenvLocal(parseFlags([]), context({ SEVENKEY_AGENT: "1" }))).rejects.toThrow(
      "inside 7key agent",
    );
    const restore = pauseLogin(context().env, keyring);
    expect(keyring.read()).toBeNull();
    await expect(dotenvLocal(parseFlags([]), context())).rejects.toThrow("set aside");
    restore();
    expect(loadLogin(keyring)?.email).toBe(email);
  });

  it("logs out and revokes the session on the server", async () => {
    const { token } = loadLogin(keyring)!;
    await logout(parseFlags([]), context());
    expect(keyring.read()).toBeNull();
    expect((await api("/api/orgs", { token })).status).toBe(401);
    await expect(dotenvLocal(parseFlags([]), context())).rejects.toThrow("Not logged in");
  });
});
