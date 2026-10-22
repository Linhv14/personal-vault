import { beforeAll, describe, expect, it } from "vitest";
import { createAccount } from "../src/core/crypto.js";
import {
  createIdentity,
  randomKey,
  wrapForRecipient,
  type Identity,
} from "../src/core/identity.js";
import { teamKeyContext } from "../src/core/org-model.js";
import { memoryArea, usePlatform } from "../extension/lib/platform.js";
import { getOrg, type Team } from "../extension/lib/orgs.js";
import {
  createProject,
  listProjects,
  listSecretVersions,
  listSecrets,
  rekeyTeam,
  saveSecret,
  type Project,
} from "../extension/lib/projects.js";

const BASE = process.env.VAULT_E2E_URL ?? "http://127.0.0.1:8787";
const REGISTRATION_TOKEN = process.env.VAULT_REGISTRATION_TOKEN ?? "token-dev-local";
const enabled = process.env.VAULT_E2E === "1";

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

describe.skipIf(!enabled)("secret history against Worker + Durable Objects", () => {
  let token: string;
  let accountId: string;
  let identity: Identity;
  let orgId: string;
  let team: Team;
  let project: Project;
  const development = () => project.content.environments[0]!.id;

  const refresh = async () => {
    team = (await getOrg(orgId)).teams.find((entry) => entry.id === team.id)!;
    project = (await listProjects(orgId, team, identity))[0]!;
  };

  beforeAll(async () => {
    const email = `history-${Date.now()}@example.com`;
    const { record } = await createAccount(email, "history test password", 600_000);
    const registered = await api("/api/auth/register", {
      method: "POST",
      headers: { "x-registration-token": REGISTRATION_TOKEN },
      body: JSON.stringify({ email, ...record }),
    });
    token = registered.body.token;
    accountId = registered.body.accountId;
    identity = await createIdentity();
    await api("/api/account/identity", {
      method: "PUT",
      token,
      body: JSON.stringify({
        publicKey: identity.publicKey,
        wrappedPrivateKey: { ciphertext: "AAAA", nonce: "AAAAAAAAAAAAAAAA" },
      }),
    });
    usePlatform({
      local: memoryArea({ apiUrl: BASE }),
      session: memoryArea({ vaultKeyRaw: "unused", token }),
      scheduleLock: async () => {},
    });
    orgId = (
      await api("/api/orgs", { method: "POST", token, body: JSON.stringify({ name: "History" }) })
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
    team = { id: teamId } as Team;
    await refresh();
    await createProject(orgId, team, identity, "Payments API");
    await refresh();
  });

  it("keeps earlier values, newest first, and only the last five", async () => {
    await saveSecret(orgId, project, development(), { name: "STRIPE_KEY", value: "v1" });
    const [secret] = await listSecrets(orgId, project, development());
    for (const value of ["v2", "v3", "v4", "v5", "v6", "v7"]) {
      await saveSecret(orgId, project, development(), {
        id: secret!.id,
        name: "STRIPE_KEY",
        value,
      });
    }
    const versions = await listSecretVersions(orgId, project, secret!);
    expect(versions.map((version) => version.value)).toEqual(["v6", "v5", "v4", "v3", "v2"]);
    expect(versions[0]!.updatedBy).toBe(accountId);
  });

  it("re-encrypts the history when the team is re-keyed", async () => {
    const [secret] = await listSecrets(orgId, project, development());
    const vaultPath = `/api/orgs/${orgId}/teams/${team.id}/vault`;
    const before = (await api(vaultPath, { token })).body;
    expect(before.versions).toHaveLength(5);
    const detail = await getOrg(orgId);
    await rekeyTeam(orgId, team, detail.members, identity);
    await refresh();
    expect(team.generation).toBe(1);
    const after = (await api(vaultPath, { token })).body;
    for (const version of after.versions) {
      const old = before.versions.find((entry: { id: string }) => entry.id === version.id);
      expect(version.sealed.ciphertext).not.toBe(old.sealed.ciphertext);
    }
    const versions = await listSecretVersions(orgId, project, secret!);
    expect(versions.map((version) => version.value)).toEqual(["v6", "v5", "v4", "v3", "v2"]);
  });

  it("drops the history when an older client re-keys without it, and refuses a partial one", async () => {
    const vault = (await api(`/api/orgs/${orgId}/teams/${team.id}/vault`, { token })).body;
    const body = {
      generation: 2,
      wrappedKeys: {
        [accountId]: await wrapForRecipient(
          identity.publicKey,
          randomKey(),
          teamKeyContext(team.id, 2),
        ),
      },
      projects: Object.fromEntries(
        vault.projects.map((p: { id: string; sealed: unknown }) => [p.id, p.sealed]),
      ),
      secrets: Object.fromEntries(
        vault.secrets.map((s: { id: string; sealed: unknown }) => [s.id, s.sealed]),
      ),
      links: {},
      items: {},
    };
    const partial = await api(`/api/orgs/${orgId}/teams/${team.id}/key`, {
      method: "PUT",
      token,
      body: JSON.stringify({ ...body, versions: {} }),
    });
    expect(partial.body.code).toBe("orgs.team_changed");
    const legacy = await api(`/api/orgs/${orgId}/teams/${team.id}/key`, {
      method: "PUT",
      token,
      body: JSON.stringify(body),
    });
    expect(legacy.status).toBe(200);
    const after = (await api(`/api/orgs/${orgId}/teams/${team.id}/vault`, { token })).body;
    expect(after.versions).toEqual([]);
  });

  it("refuses the history of a secret in another project", async () => {
    const response = await api(
      `/api/orgs/${orgId}/teams/${team.id}/projects/${project.id}/secrets/${crypto.randomUUID()}/versions`,
      { token },
    );
    expect(response.status).toBe(404);
  });
});
