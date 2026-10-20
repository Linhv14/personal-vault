import { beforeAll, describe, expect, it } from "vitest";
import { toBase64 } from "../src/core/bytes.js";
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
  deleteSecret,
  listProjects,
  listSecretVersions,
  listSecrets,
  saveSecret,
  setProjectReaders,
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
  if (init.body) headers.set("Content-Type", "application/json");
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  const response = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function person(label: string): Promise<Person> {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const { record } = await createAccount(email, `password for ${label}`, 100_000);
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
    session: memoryArea({ vaultKeyRaw: toBase64(randomKey()), token: who.token }),
    scheduleLock: async () => {},
  });
}

describe.skipIf(!enabled)("read-only project access against Worker + Durable Objects", () => {
  let owner: Person;
  let admin: Person;
  let reader: Person;
  let outsider: Person;
  let orgId: string;
  let teamId: string;
  const readersPath = (projectId: string) =>
    `/api/orgs/${orgId}/teams/${teamId}/projects/${projectId}/readers`;

  const projectAs = async (who: Person): Promise<Project> => {
    as(who);
    const team = (await getOrg(orgId)).teams.find((entry) => entry.id === teamId) as Team;
    return (await listProjects(orgId, team, who.identity))[0]!;
  };
  const development = (project: Project) => project.content.environments[0]!.id;

  beforeAll(async () => {
    [owner, admin, reader, outsider] = await Promise.all([
      person("r-owner"),
      person("r-admin"),
      person("r-reader"),
      person("r-outsider"),
    ]);
    orgId = (
      await api("/api/orgs", {
        method: "POST",
        token: owner.token,
        body: JSON.stringify({ name: "Readers Inc" }),
      })
    ).body.id;
    for (const [who, role] of [
      [admin, "admin"],
      [reader, "member"],
      [outsider, "member"],
    ] as const) {
      await api(`/api/orgs/${orgId}/invites`, {
        method: "POST",
        token: owner.token,
        body: JSON.stringify({ email: who.email, role }),
      });
      const invite = (await api("/api/invites", { token: who.token })).body.invites[0];
      await api(`/api/invites/${invite.id}/accept`, { method: "POST", token: who.token });
    }
    teamId = crypto.randomUUID();
    const key = randomKey();
    await api(`/api/orgs/${orgId}/teams`, {
      method: "POST",
      token: owner.token,
      body: JSON.stringify({
        id: teamId,
        name: "Platform",
        wrappedKey: await wrapForRecipient(
          owner.identity.publicKey,
          key,
          teamKeyContext(teamId, 0),
        ),
      }),
    });
    for (const who of [admin, reader]) {
      await api(`/api/orgs/${orgId}/teams/${teamId}/members/${who.accountId}`, {
        method: "PUT",
        token: owner.token,
        body: JSON.stringify({
          wrappedKey: await wrapForRecipient(
            who.identity.publicKey,
            key,
            teamKeyContext(teamId, 0),
          ),
          generation: 0,
        }),
      });
    }
    as(owner);
    const team = (await getOrg(orgId)).teams.find((entry) => entry.id === teamId) as Team;
    await createProject(orgId, team, owner.identity, "Payments API");
    const project = await projectAs(owner);
    await saveSecret(orgId, project, development(project), { name: "STRIPE_KEY", value: "v1" });
    const [secret] = await listSecrets(orgId, project, development(project));
    await saveSecret(orgId, project, development(project), {
      id: secret!.id,
      name: "STRIPE_KEY",
      value: "v2",
    });
  });

  it("lets an admin mark a team member read only", async () => {
    const project = await projectAs(owner);
    await setProjectReaders(orgId, project, [reader.accountId]);
    expect((await projectAs(reader)).readers).toEqual([reader.accountId]);
  });

  it("lets a reader read secrets and history but not change them", async () => {
    const project = await projectAs(reader);
    const [secret] = await listSecrets(orgId, project, development(project));
    expect(secret!.value).toBe("v2");
    const versions = await listSecretVersions(orgId, project, secret!);
    expect(versions.map((version) => version.value)).toEqual(["v1"]);
    await expect(
      saveSecret(orgId, project, development(project), {
        id: secret!.id,
        name: "STRIPE_KEY",
        value: "hacked",
      }),
    ).rejects.toMatchObject({ messageKey: "error.orgs.read_only" });
    await expect(
      saveSecret(orgId, project, development(project), { name: "NEW_KEY", value: "x" }),
    ).rejects.toMatchObject({ messageKey: "error.orgs.read_only" });
    await expect(deleteSecret(orgId, project, secret!.id)).rejects.toMatchObject({
      messageKey: "error.orgs.read_only",
    });
    as(owner);
    const [after] = await listSecrets(orgId, await projectAs(owner), development(project));
    expect(after!.value).toBe("v2");
  });

  it("refuses admins, people outside the team, and changes by non-admins", async () => {
    const project = await projectAs(owner);
    for (const readers of [[admin.accountId], [outsider.accountId], ["nobody"]]) {
      const refused = await api(readersPath(project.id), {
        method: "PUT",
        token: owner.token,
        body: JSON.stringify({ readers }),
      });
      expect(refused.status).toBe(400);
      expect(refused.body.code).toBe("orgs.invalid_reader");
    }
    const byReader = await api(readersPath(project.id), {
      method: "PUT",
      token: reader.token,
      body: JSON.stringify({ readers: [] }),
    });
    expect(byReader.status).toBe(403);
    expect((await projectAs(owner)).readers).toEqual([reader.accountId]);
  });

  it("gives write access back when the mark is cleared", async () => {
    await setProjectReaders(orgId, await projectAs(owner), []);
    const project = await projectAs(reader);
    expect(project.readers).toEqual([]);
    await saveSecret(orgId, project, development(project), { name: "NEW_KEY", value: "x" });
    const names = (await listSecrets(orgId, project, development(project))).map((s) => s.name);
    expect(names).toContain("NEW_KEY");
  });

  it("forgets the mark when the person leaves the team", async () => {
    await setProjectReaders(orgId, await projectAs(owner), [reader.accountId]);
    await api(`/api/orgs/${orgId}/teams/${teamId}/members/${reader.accountId}`, {
      method: "DELETE",
      token: owner.token,
    });
    expect((await projectAs(owner)).readers).toEqual([]);
  });
});
