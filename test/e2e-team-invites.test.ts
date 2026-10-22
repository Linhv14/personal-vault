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
import { addTeamMember, getOrg, inviteMember, type Team } from "../extension/lib/orgs.js";

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

describe.skipIf(!enabled)("inviting people straight into teams", () => {
  let owner: Person;
  let newcomer: Person;
  let orgId: string;
  let teamId: string;

  const teamAs = async (who: Person): Promise<Team> => {
    as(who);
    return (await getOrg(orgId)).teams.find((entry) => entry.id === teamId) as Team;
  };

  beforeAll(async () => {
    [owner, newcomer] = await Promise.all([person("i-owner"), person("i-new")]);
    orgId = (
      await api("/api/orgs", {
        method: "POST",
        token: owner.token,
        body: JSON.stringify({ name: "Invites Inc" }),
      })
    ).body.id;
    teamId = crypto.randomUUID();
    await api(`/api/orgs/${orgId}/teams`, {
      method: "POST",
      token: owner.token,
      body: JSON.stringify({
        id: teamId,
        name: "Platform",
        wrappedKey: await wrapForRecipient(
          owner.identity.publicKey,
          randomKey(),
          teamKeyContext(teamId, 0),
        ),
      }),
    });
  });

  it("refuses teams that do not exist", async () => {
    const refused = await api(`/api/orgs/${orgId}/invites`, {
      method: "POST",
      token: owner.token,
      body: JSON.stringify({
        email: "someone@example.com",
        role: "member",
        teams: [{ teamId: crypto.randomUUID(), access: "edit" }],
      }),
    });
    expect(refused.status).toBe(400);
  });

  it("shows the invitation on the team, then the person waiting for the key", async () => {
    as(owner);
    await inviteMember(orgId, newcomer.email, "member", "en", [{ teamId, access: "view" }]);
    expect((await teamAs(owner)).invited).toEqual([{ email: newcomer.email, access: "view" }]);
    const invite = (await api("/api/invites", { token: newcomer.token })).body.invites[0];
    await api(`/api/invites/${invite.id}/accept`, { method: "POST", token: newcomer.token });
    const team = await teamAs(owner);
    expect(team.invited).toEqual([]);
    expect(team.pending).toEqual([{ accountId: newcomer.accountId, access: "view" }]);
    expect(await teamAs(newcomer)).toBeUndefined();
  });

  it("grants the key with the planned access and clears the wait", async () => {
    const team = await teamAs(owner);
    const member = (await getOrg(orgId)).members.find((m) => m.accountId === newcomer.accountId)!;
    await addTeamMember(orgId, team, member, owner.identity, "view");
    const after = await teamAs(owner);
    expect(after.pending).toEqual([]);
    expect(after.members).toContain(newcomer.accountId);
    expect(after.viewers).toEqual([newcomer.accountId]);
  });

  it("forgets the planned teams when the invitation is withdrawn", async () => {
    as(owner);
    const sent = await inviteMember(orgId, "later@example.com", "member", "en", [
      { teamId, access: "edit" },
    ]);
    expect((await teamAs(owner)).invited).toHaveLength(1);
    await api(`/api/orgs/${orgId}/invites/${sent.id}`, { method: "DELETE", token: owner.token });
    expect((await teamAs(owner)).invited).toEqual([]);
  });
});
