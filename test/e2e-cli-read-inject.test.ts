import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
  inject,
  link,
  login,
  parseFlags,
  readSecret,
  type Context,
} from "../cli/account/commands.js";
import type { Keyring } from "../cli/account/credentials.js";

const BASE = process.env.VAULT_E2E_URL ?? "http://127.0.0.1:8787";
const REGISTRATION_TOKEN = process.env.VAULT_REGISTRATION_TOKEN ?? "token-dev-local";
const enabled = process.env.VAULT_E2E === "1";
const PASSWORD = "cli read inject password";

async function api(route: string, init: RequestInit & { token?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
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

describe.skipIf(!enabled)("7key read and inject against Worker + D1", () => {
  const email = `cli-read-${Date.now()}@example.com`;
  const keyring = memoryKeyring();
  const folder = mkdtempSync(path.join(tmpdir(), "7key-inject-"));
  const config = mkdtempSync(path.join(tmpdir(), "7key-config-"));
  const printed: string[] = [];
  const logged: string[] = [];
  let projectId = "";
  const context = (
    options: { env?: NodeJS.ProcessEnv; isTTY?: boolean; input?: string } = {},
  ): Context => ({
    env: { PATH: process.env.PATH, XDG_CONFIG_HOME: config, SEVENKEY_SERVER: BASE, ...options.env },
    cwd: folder,
    keyring,
    request: fetch,
    log: (line) => void logged.push(line),
    out: (text) => void printed.push(text),
    ask: async () => email,
    askPassword: async () => PASSWORD,
    choose: async () => {
      throw new Error("should not need to ask");
    },
    isTTY: options.isTTY ?? false,
    readInput: async () => options.input ?? "",
  });
  const read = async (args: string[], options: { isTTY?: boolean } = {}) => {
    printed.length = 0;
    await readSecret(parseFlags(args, { positional: true }), context(options));
    return printed.join("");
  };

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
      await api("/api/orgs", { method: "POST", token, body: JSON.stringify({ name: "Inject Co" }) })
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
    projectId = project!.id;
    const [development, , production] = project!.content.environments;
    await saveSecret(orgId, project!, development!.id, { name: "STRIPE_KEY", value: "sk_test_1" });
    await saveSecret(orgId, project!, development!.id, {
      name: "PEM",
      value: "-----BEGIN-----\nabc}}\n-----END-----",
    });
    await saveSecret(orgId, project!, production!.id, { name: "STRIPE_KEY", value: "sk_live_9" });

    expect(await login(parseFlags([]), context())).toBe(0);
    expect(
      await link(parseFlags(["--project", "payments-api", "--env", "development"]), context()),
    ).toBe(0);
  });

  afterAll(() => {
    rmSync(folder, { recursive: true, force: true });
    rmSync(config, { recursive: true, force: true });
  });

  it("reads one value, raw when piped and with a newline on a terminal", async () => {
    expect(await read(["STRIPE_KEY"])).toBe("sk_test_1");
    expect(await read(["STRIPE_KEY"], { isTTY: true })).toBe("sk_test_1\n");
    expect(await read(["STRIPE_KEY", "--env", "production"])).toBe("sk_live_9");
    expect(await read(["7key://payments-api/production/STRIPE_KEY"])).toBe("sk_live_9");
    expect(await read([`7key://${projectId}/Development/PEM`])).toBe(
      "-----BEGIN-----\nabc}}\n-----END-----",
    );
  });

  it("explains unknown names, projects and environments", async () => {
    await expect(read(["MISSING"])).rejects.toThrow('No secret "MISSING" in Payments API');
    await expect(read(["7key://ghost/production/STRIPE_KEY"])).rejects.toThrow(
      'No project "ghost"',
    );
    await expect(read(["7key://payments-api/qa/STRIPE_KEY"])).rejects.toThrow(
      'No environment "qa"',
    );
    await expect(read(["7key://payments-api/STRIPE_KEY"])).rejects.toThrow("Invalid reference");
  });

  it("injects a template from stdin to stdout", async () => {
    printed.length = 0;
    logged.length = 0;
    const input =
      "TEST={{ 7key:STRIPE_KEY }}\nLIVE={{7key://payments-api/production/STRIPE_KEY}}\nPEM={{ 7key:PEM }}\n";
    expect(await inject(parseFlags([]), context({ input }))).toBe(0);
    expect(printed.join("")).toBe(
      "TEST=sk_test_1\nLIVE=sk_live_9\nPEM=-----BEGIN-----\nabc}}\n-----END-----\n",
    );
    expect(logged.at(-1)).toBe("7key: injected 3 references");
  });

  it("writes a private file, and refuses to overwrite it without --force", async () => {
    writeFileSync(path.join(folder, "app.env.tpl"), "KEY={{ 7key:STRIPE_KEY }}\n");
    const output = path.join(folder, "app.env");
    expect(await inject(parseFlags(["-i", "app.env.tpl", "-o", "app.env"]), context())).toBe(0);
    expect(readFileSync(output, "utf8")).toBe("KEY=sk_test_1\n");
    expect(statSync(output).mode & 0o777).toBe(0o600);

    await expect(
      inject(parseFlags(["-i", "app.env.tpl", "-o", "app.env", "--env", "production"]), context()),
    ).rejects.toThrow("already exists");
    expect(
      await inject(
        parseFlags(["-i", "app.env.tpl", "-o", "app.env", "--env", "production", "--force"]),
        context(),
      ),
    ).toBe(0);
    expect(readFileSync(output, "utf8")).toBe("KEY=sk_live_9\n");
    expect(statSync(output).mode & 0o777).toBe(0o600);
  });

  it("lists every missing reference and writes nothing", async () => {
    const input = "{{ 7key:STRIPE_KEY }} {{ 7key:NOPE }} {{ 7key://ghost/prod/X }}";
    const error = await inject(parseFlags(["-o", "partial.env"]), context({ input })).catch(
      (caught: Error) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("2 references not found");
    expect((error as Error).message).toContain("7key:NOPE");
    expect((error as Error).message).toContain("7key://ghost/prod/X");
    expect(existsSync(path.join(folder, "partial.env"))).toBe(false);
  });

  it("gives nothing out from inside an agent", async () => {
    const agent = { env: { SEVENKEY_AGENT: "1" }, input: "{{ 7key:STRIPE_KEY }}" };
    await expect(
      readSecret(parseFlags(["STRIPE_KEY"], { positional: true }), context(agent)),
    ).rejects.toThrow("inside 7key agent");
    await expect(inject(parseFlags([]), context(agent))).rejects.toThrow("inside 7key agent");
  });
});
