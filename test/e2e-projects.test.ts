import { beforeAll, describe, expect, it } from "vitest";
import { utf8Encode } from "../src/core/bytes.js";
import { createAccount } from "../src/core/crypto.js";
import {
  createIdentity,
  randomKey,
  wrapForRecipient,
  type Identity,
} from "../src/core/identity.js";
import { memoryArea, usePlatform } from "../extension/lib/platform.js";
import { getOrg, type Team } from "../extension/lib/orgs.js";
import {
  createProject,
  deleteProject,
  importSecrets,
  listProjects,
  openProjects,
  listSecrets,
  flushAccess,
  noteAccess,
  rekeyTeam,
  deleteSecrets,
  saveSecret,
  saveSecrets,
  type Project,
} from "../extension/lib/projects.js";

const BASE = process.env.VAULT_E2E_URL ?? "http://127.0.0.1:8787";
const REGISTRATION_TOKEN = process.env.VAULT_REGISTRATION_TOKEN ?? "token-dev-local";
const enabled = process.env.VAULT_E2E === "1";

interface Person {
  email: string;
  token: string;
  accountId: string;
  identity: Identity;
}

async function api(path: string, init: RequestInit & { token?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.body) {
    headers.set("Content-Type", "application/json");
  }
  if (init.token) {
    headers.set("Authorization", `Bearer ${init.token}`);
  }
  const response = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, text };
}

async function person(label: string): Promise<Person> {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const { record } = await createAccount(email, `password for ${label}`, 600_000);
  const registered = await api("/api/auth/register", {
    method: "POST",
    headers: { "x-registration-token": REGISTRATION_TOKEN },
    body: JSON.stringify({ email, ...record }),
  });
  const identity = await createIdentity();
  await api("/api/account/identity", {
    method: "PUT",
    token: registered.body.token,
    body: JSON.stringify({
      publicKey: identity.publicKey,
      wrappedPrivateKey: { ciphertext: "AAAA", nonce: "AAAAAAAAAAAAAAAA" },
    }),
  });
  return { email, token: registered.body.token, accountId: registered.body.accountId, identity };
}

function as(who: Person): void {
  usePlatform({
    local: memoryArea({ apiUrl: BASE }),
    session: memoryArea({ vaultKeyRaw: "unused", token: who.token }),
    scheduleLock: async () => {},
  });
}

const teamContext = (teamId: string) => utf8Encode(`personal-vault/team-key/${teamId}`);

describe.skipIf(!enabled)("projects and secrets against Worker + Durable Objects", () => {
  let owner: Person;
  let admin: Person;
  let member: Person;
  let outsider: Person;
  let orgId: string;
  let team: Team;
  let project: Project;
  const production = () => project.content.environments[2]!.id;
  const development = () => project.content.environments[0]!.id;

  async function teamAs(who: Person): Promise<Team> {
    as(who);
    const detail = await getOrg(orgId);
    return detail.teams.find((entry) => entry.id === team.id)!;
  }

  beforeAll(async () => {
    [owner, admin, member, outsider] = await Promise.all([
      person("p-owner"),
      person("p-admin"),
      person("p-member"),
      person("p-outsider"),
    ]);
    orgId = (
      await api("/api/orgs", {
        method: "POST",
        token: owner.token,
        body: JSON.stringify({ name: "Projects Inc" }),
      })
    ).body.id;
    for (const [who, role] of [
      [admin, "admin"],
      [member, "member"],
    ] as const) {
      await api(`/api/orgs/${orgId}/invites`, {
        method: "POST",
        token: owner.token,
        body: JSON.stringify({ email: who.email, role }),
      });
      const invite = (await api("/api/invites", { token: who.token })).body.invites[0];
      await api(`/api/invites/${invite.id}/accept`, { method: "POST", token: who.token });
    }
    const teamId = crypto.randomUUID();
    const key = randomKey();
    await api(`/api/orgs/${orgId}/teams`, {
      method: "POST",
      token: owner.token,
      body: JSON.stringify({
        id: teamId,
        name: "Platform",
        wrappedKey: await wrapForRecipient(owner.identity.publicKey, key, teamContext(teamId)),
      }),
    });
    await api(`/api/orgs/${orgId}/teams/${teamId}/members/${member.accountId}`, {
      method: "PUT",
      token: owner.token,
      body: JSON.stringify({
        wrappedKey: await wrapForRecipient(member.identity.publicKey, key, teamContext(teamId)),
        generation: 0,
      }),
    });
    team = { id: teamId } as Team;
    team = await teamAs(owner);
  });

  it("creates a project only team members can open", async () => {
    as(owner);
    await createProject(orgId, team, owner.identity, "Payments API");
    const memberTeam = await teamAs(member);
    project = (await listProjects(orgId, memberTeam, member.identity))[0]!;
    expect(project.content.name).toBe("Payments API");
    expect(project.content.environments.map((env) => env.name)).toEqual([
      "Development",
      "Staging",
      "Production",
    ]);

    const path = `/api/orgs/${orgId}/teams/${team.id}/projects`;
    const raw = await api(path, { token: owner.token });
    expect(raw.text).not.toContain("Payments");
    expect((await api(path, { token: admin.token })).body.code).toBe("orgs.not_in_team");
    expect((await api(path, { token: outsider.token })).status).toBe(404);

    const overview = await api(`/api/orgs/${orgId}`, { token: member.token });
    const listed = overview.body.projects[team.id];
    expect(listed.projects.map((entry: { id: string }) => entry.id)).toEqual([project.id]);
    const opened = await openProjects(memberTeam, listed, member.identity);
    expect(opened[0]!.content.name).toBe("Payments API");
    const adminView = await api(`/api/orgs/${orgId}`, { token: admin.token });
    expect(adminView.body.projects).toEqual({});
  });

  it("stores secrets per environment that only the team can read", async () => {
    as(member);
    await saveSecret(orgId, project, production(), {
      name: "STRIPE_KEY",
      value: "sk_live_123",
    });
    await saveSecret(orgId, project, development(), { name: "STRIPE_KEY", value: "sk_test_1" });
    const prod = await listSecrets(orgId, project, production());
    expect(prod.map(({ name, value }) => ({ name, value }))).toEqual([
      { name: "STRIPE_KEY", value: "sk_live_123" },
    ]);
    expect((await listSecrets(orgId, project, development()))[0]!.value).toBe("sk_test_1");

    const raw = await api(
      `/api/orgs/${orgId}/teams/${team.id}/projects/${project.id}/environments/${production()}/secrets`,
      { token: owner.token },
    );
    expect(raw.text).not.toContain("sk_live");
    expect(raw.text).not.toContain("STRIPE");
  });

  it("refuses to move a secret to another environment or write with a stale key", async () => {
    as(member);
    const [secret] = await listSecrets(orgId, project, production());
    const path = `/api/orgs/${orgId}/teams/${team.id}/projects/${project.id}/secrets/${secret!.id}`;
    const moved = await api(path, {
      method: "PUT",
      token: member.token,
      body: JSON.stringify({
        environmentId: development(),
        sealed: { ciphertext: "AAAA", nonce: "AAAAAAAAAAAAAAAA" },
        generation: 0,
      }),
    });
    expect(moved.body.code).toBe("orgs.invalid_secret");
    const stale = await api(path, {
      method: "PUT",
      token: member.token,
      body: JSON.stringify({
        environmentId: production(),
        sealed: { ciphertext: "AAAA", nonce: "AAAAAAAAAAAAAAAA" },
        generation: 7,
      }),
    });
    expect(stale.body.code).toBe("orgs.stale_team_key");
  });

  it("imports a .env file, replacing names that already exist", async () => {
    as(member);
    const existing = await listSecrets(orgId, project, production());
    await importSecrets(orgId, project, production(), existing, [
      { name: "STRIPE_KEY", value: "sk_live_456" },
      { name: "DATABASE_URL", value: "postgres://prod" },
    ]);
    const after = await listSecrets(orgId, project, production());
    expect(after.map(({ name, value }) => [name, value])).toEqual([
      ["DATABASE_URL", "postgres://prod"],
      ["STRIPE_KEY", "sk_live_456"],
    ]);
  });

  it("writes and deletes many secrets in one request each", async () => {
    as(member);
    const before = await listSecrets(orgId, project, development());
    const fetches: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      fetches.push(`${init?.method ?? "GET"} ${new URL(String(input)).pathname}`);
      return original(input, init);
    };
    try {
      await saveSecrets(
        orgId,
        project,
        Array.from({ length: 30 }, (_, n) => ({
          environmentId: development(),
          name: `BULK_${n}`,
          value: `v${n}`,
        })),
      );
      const bulk = (await listSecrets(orgId, project, development())).filter((secret) =>
        secret.name.startsWith("BULK_"),
      );
      expect(bulk).toHaveLength(30);
      await deleteSecrets(
        orgId,
        project,
        bulk.map((secret) => secret.id),
      );
    } finally {
      globalThis.fetch = original;
    }
    expect(fetches.filter((call) => call.startsWith("POST"))).toHaveLength(2);
    expect(await listSecrets(orgId, project, development())).toHaveLength(before.length);
  });

  it("keeps a variable's type and logs every reveal of a secret", async () => {
    as(member);
    await saveSecret(orgId, project, development(), {
      name: "PUBLIC_URL",
      value: "https://example.com",
      kind: "variable",
    });
    const stored = (await listSecrets(orgId, project, development())).find(
      (secret) => secret.name === "PUBLIC_URL",
    );
    expect(stored?.kind).toBe("variable");

    const posts: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      if (init?.method === "POST") {
        posts.push(new URL(String(input)).pathname);
      }
      return original(input, init);
    };
    try {
      noteAccess(orgId, project, development(), "revealed", stored!.id);
      noteAccess(orgId, project, development(), "revealed", stored!.id);
      noteAccess(orgId, project, development(), "exported");
      await flushAccess();
    } finally {
      globalThis.fetch = original;
    }
    expect(posts).toHaveLength(1);
    const audit = await api(`/api/orgs/${orgId}/audit`, { token: owner.token });
    const actions = audit.body.events.map((event: { action: string }) => event.action);
    expect(actions.slice(0, 2)).toEqual(["secrets.exported", "secret.revealed"]);
    expect(audit.body.events[0].target).toBe(`${project.id}:${development()}`);

    const refused = await api(`/api/orgs/${orgId}/teams/${team.id}/projects/${project.id}/access`, {
      method: "POST",
      token: outsider.token,
      body: JSON.stringify({ environmentId: development(), access: "revealed" }),
    });
    expect(refused.status).toBe(404);
  });

  it("lets members write secrets but not manage projects", async () => {
    const path = `/api/orgs/${orgId}/teams/${team.id}/projects/${project.id}`;
    expect((await api(path, { method: "DELETE", token: member.token })).status).toBe(403);
  });

  it("re-encrypts every secret under new keys when someone leaves the team", async () => {
    const vaultPath = `/api/orgs/${orgId}/teams/${team.id}/vault`;
    const before = (await api(vaultPath, { token: owner.token })).body;
    await api(`/api/orgs/${orgId}/teams/${team.id}/members/${member.accountId}`, {
      method: "DELETE",
      token: owner.token,
    });
    const flagged = await teamAs(owner);
    expect(flagged.rekeyNeeded).toBe(true);
    as(owner);
    await expect(
      saveSecret(orgId, project, production(), { name: "LATE", value: "x" }),
    ).rejects.toMatchObject({ messageKey: "error.orgs.rekey_required" });

    const partial = await api(`/api/orgs/${orgId}/teams/${team.id}/key`, {
      method: "PUT",
      token: owner.token,
      body: JSON.stringify({
        generation: 1,
        wrappedKeys: {
          [owner.accountId]: await wrapForRecipient(
            owner.identity.publicKey,
            randomKey(),
            utf8Encode(`personal-vault/team-key/${team.id}/1`),
          ),
        },
      }),
    });
    expect(partial.body.code).toBe("orgs.team_changed");

    as(owner);
    const detail = await getOrg(orgId);
    await rekeyTeam(orgId, flagged, detail.members, owner.identity);
    const rekeyed = await teamAs(owner);
    expect(rekeyed).toMatchObject({ generation: 1, rekeyNeeded: false });

    const after = (await api(vaultPath, { token: owner.token })).body;
    expect(after.generation).toBe(1);
    for (const secret of after.secrets) {
      const old = before.secrets.find((entry: { id: string }) => entry.id === secret.id);
      expect(secret.sealed.ciphertext).not.toBe(old.sealed.ciphertext);
    }
    const [reopened] = await listProjects(orgId, rekeyed, owner.identity);
    expect(reopened!.content.key).not.toBe(project.content.key);
    const prod = await listSecrets(orgId, reopened!, production());
    expect(prod.map(({ name, value }) => [name, value])).toEqual([
      ["DATABASE_URL", "postgres://prod"],
      ["STRIPE_KEY", "sk_live_456"],
    ]);
    project = reopened!;
  });

  it("lets the free plan keep adding projects", async () => {
    as(owner);
    const current = await teamAs(owner);
    for (let n = 0; n < 5; n++) {
      await createProject(orgId, current, owner.identity, `P${n}`);
    }
  });

  it("deletes a project with its secrets and logs every step without names or values", async () => {
    as(owner);
    await deleteProject(orgId, project);
    const vault = (await api(`/api/orgs/${orgId}/teams/${team.id}/vault`, { token: owner.token }))
      .body;
    expect(vault.secrets).toEqual([]);

    const audit = await api(`/api/orgs/${orgId}/audit`, { token: owner.token });
    expect(audit.body.verified).toBe(true);
    const actions = new Set(audit.body.events.map((event: { action: string }) => event.action));
    for (const action of [
      "project.created",
      "secret.written",
      "secrets.read",
      "team.vault_read",
      "team.rekeyed",
      "project.deleted",
    ]) {
      expect(actions).toContain(action);
    }
    expect(audit.text).not.toMatch(/STRIPE|sk_live|Payments/);
  });
});
