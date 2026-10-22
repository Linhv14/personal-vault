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
import { getOrg, setTeamAccess, type Team } from "../extension/lib/orgs.js";
import {
  createProject,
  deleteSecret,
  listProjects,
  listSecretVersions,
  listSecrets,
  protectEnvironment,
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
  return { status: response.status, body: text ? JSON.parse(text) : null };
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
    session: memoryArea({ vaultKeyRaw: toBase64(randomKey()), token: who.token }),
    scheduleLock: async () => {},
  });
}

const readOnly = { messageKey: "error.orgs.read_only" };
const guarded = { messageKey: "error.orgs.protected_environment" };

describe.skipIf(!enabled)("team access and protected environments", () => {
  let owner: Person;
  let editor: Person;
  let viewer: Person;
  let orgId: string;
  let teamId: string;
  let key: ReturnType<typeof randomKey>;

  const teamAs = async (who: Person): Promise<Team> => {
    as(who);
    return (await getOrg(orgId)).teams.find((entry) => entry.id === teamId) as Team;
  };
  const projectAs = async (who: Person): Promise<Project> =>
    (await listProjects(orgId, await teamAs(who), who.identity))[0]!;
  const env = (project: Project, name: string) =>
    project.content.environments.find((entry) => entry.name === name)!.id;
  const join = async (who: Person, access?: "edit" | "view") =>
    api(`/api/orgs/${orgId}/teams/${teamId}/members/${who.accountId}`, {
      method: "PUT",
      token: owner.token,
      body: JSON.stringify({
        wrappedKey: await wrapForRecipient(who.identity.publicKey, key, teamKeyContext(teamId, 0)),
        generation: 0,
        ...(access ? { access } : {}),
      }),
    });

  beforeAll(async () => {
    [owner, editor, viewer] = await Promise.all([
      person("a-owner"),
      person("a-editor"),
      person("a-viewer"),
    ]);
    orgId = (
      await api("/api/orgs", {
        method: "POST",
        token: owner.token,
        body: JSON.stringify({ name: "Access Inc" }),
      })
    ).body.id;
    for (const who of [editor, viewer]) {
      await api(`/api/orgs/${orgId}/invites`, {
        method: "POST",
        token: owner.token,
        body: JSON.stringify({ email: who.email, role: "member" }),
      });
      const invite = (await api("/api/invites", { token: who.token })).body.invites[0];
      await api(`/api/invites/${invite.id}/accept`, { method: "POST", token: who.token });
    }
    teamId = crypto.randomUUID();
    key = randomKey();
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
    await join(editor);
    await join(viewer, "view");
    const team = await teamAs(owner);
    await createProject(orgId, team, owner.identity, "Payments API");
    const project = await projectAs(owner);
    await saveSecret(orgId, project, env(project, "Production"), { name: "DB", value: "p1" });
    const [secret] = await listSecrets(orgId, project, env(project, "Production"));
    await saveSecret(orgId, project, env(project, "Production"), {
      id: secret!.id,
      name: "DB",
      value: "p2",
    });
  });

  it("lists who can only view", async () => {
    expect((await teamAs(owner)).viewers).toEqual([viewer.accountId]);
  });

  it("lets a viewer read secrets and history but not change them", async () => {
    const project = await projectAs(viewer);
    const production = env(project, "Production");
    const [secret] = await listSecrets(orgId, project, production);
    expect(secret!.value).toBe("p2");
    expect((await listSecretVersions(orgId, project, secret!)).map((v) => v.value)).toEqual(["p1"]);
    await expect(
      saveSecret(orgId, project, env(project, "Development"), { name: "X", value: "1" }),
    ).rejects.toMatchObject(readOnly);
    await expect(deleteSecret(orgId, project, secret!.id)).rejects.toMatchObject(readOnly);
  });

  it("keeps the viewer out of the team vault's writes and tells the extension", async () => {
    const item = await api(`/api/orgs/${orgId}/teams/${teamId}/items/${crypto.randomUUID()}`, {
      method: "PUT",
      token: viewer.token,
      body: JSON.stringify({
        sealed: { ciphertext: "AAAA", nonce: "AAAAAAAAAAAAAAAA" },
        generation: 0,
      }),
    });
    expect(item.status).toBe(403);
    expect(item.body.code).toBe("orgs.read_only");
    const vaults = (await api("/api/vaults", { token: viewer.token })).body.vaults;
    expect(vaults[0].viewOnly).toBe(true);
    const mine = (await api("/api/vaults", { token: editor.token })).body.vaults;
    expect(mine[0].viewOnly).toBe(false);
  });

  it("keeps the access when the key is wrapped again, and admins can change it", async () => {
    await join(viewer);
    expect((await teamAs(owner)).viewers).toEqual([viewer.accountId]);
    expect(
      (
        await api(`/api/orgs/${orgId}/teams/${teamId}/members/${viewer.accountId}/access`, {
          method: "PUT",
          token: editor.token,
          body: JSON.stringify({ access: "edit" }),
        })
      ).status,
    ).toBe(403);
    as(owner);
    await setTeamAccess(orgId, teamId, viewer.accountId, "edit");
    expect((await teamAs(owner)).viewers).toEqual([]);
    const project = await projectAs(viewer);
    await saveSecret(orgId, project, env(project, "Development"), { name: "X", value: "1" });
  });

  it("lets only admins change a protected environment", async () => {
    let project = await projectAs(owner);
    const production = env(project, "Production");
    const development = env(project, "Development");
    expect(
      (
        await api(
          `/api/orgs/${orgId}/teams/${teamId}/projects/${project.id}/environments/${production}/protection`,
          { method: "PUT", token: editor.token, body: JSON.stringify({ protected: true }) },
        )
      ).status,
    ).toBe(403);
    await protectEnvironment(orgId, project, production, true);
    project = await projectAs(editor);
    expect(project.protectedEnvironments).toEqual([production]);
    const [secret] = await listSecrets(orgId, project, production);
    expect(secret!.value).toBe("p2");
    await expect(
      saveSecret(orgId, project, production, { id: secret!.id, name: "DB", value: "bad" }),
    ).rejects.toMatchObject(guarded);
    await expect(deleteSecret(orgId, project, secret!.id)).rejects.toMatchObject(guarded);
    await expect(
      saveSecrets(orgId, project, [
        { environmentId: development, name: "Y", value: "1" },
        { environmentId: production, name: "Y", value: "1" },
      ]),
    ).rejects.toMatchObject(guarded);
    await saveSecret(orgId, project, development, { name: "Z", value: "1" });
    const admin = await projectAs(owner);
    await saveSecret(orgId, admin, production, { id: secret!.id, name: "DB", value: "p3" });
    await protectEnvironment(orgId, admin, production, false);
    const open = await projectAs(editor);
    expect(open.protectedEnvironments).toEqual([]);
    await saveSecret(orgId, open, production, { id: secret!.id, name: "DB", value: "p4" });
  });
});
