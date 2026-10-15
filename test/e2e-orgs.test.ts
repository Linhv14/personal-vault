import { beforeAll, describe, expect, it } from "vitest";
import { createAccount } from "../src/core/crypto.js";
import { utf8Encode } from "../src/core/bytes.js";
import {
  createIdentity,
  randomKey,
  unwrapForRecipient,
  wrapForRecipient,
  type Identity,
} from "../src/core/identity.js";

const BASE = process.env.VAULT_E2E_URL ?? "http://127.0.0.1:8787";
const REGISTRATION_TOKEN = process.env.VAULT_REGISTRATION_TOKEN ?? "token-dev-local";
const enabled = process.env.VAULT_E2E === "1";

async function api(path: string, init: RequestInit & { token?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  const response = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

interface Person {
  email: string;
  token: string;
  accountId: string;
  identity: Identity;
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

const teamContext = (teamId: string) => utf8Encode(`personal-vault/team-key/${teamId}`);

describe.skipIf(!enabled)("organizations and teams against Worker + D1 + Durable Objects", () => {
  let owner: Person;
  let admin: Person;
  let member: Person;
  let outsider: Person;
  let orgId: string;
  let teamId: string;
  const teamKey = randomKey();

  beforeAll(async () => {
    [owner, admin, member, outsider] = await Promise.all([
      person("owner"),
      person("admin"),
      person("member"),
      person("outsider"),
    ]);
  });

  it("creates an organization owned by its creator", async () => {
    const created = await api("/api/orgs", {
      method: "POST",
      token: owner.token,
      body: JSON.stringify({ name: "  Acme   Inc " }),
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "Acme Inc", role: "owner" });
    orgId = created.body.id;
    const mine = await api("/api/orgs", { token: owner.token });
    expect(mine.body.orgs).toEqual([{ id: orgId, name: "Acme Inc", plan: "free", role: "owner" }]);
  });

  it("invites by email and lets only that address accept", async () => {
    for (const [who, role] of [
      [admin, "admin"],
      [member, "member"],
    ] as const) {
      const invited = await api(`/api/orgs/${orgId}/invites`, {
        method: "POST",
        token: owner.token,
        body: JSON.stringify({ email: who.email, role }),
      });
      expect(invited.status).toBe(201);
    }
    const strangers = await api("/api/invites", { token: outsider.token });
    expect(strangers.body.invites).toEqual([]);

    for (const who of [admin, member]) {
      const pending = await api("/api/invites", { token: who.token });
      expect(pending.body.invites).toHaveLength(1);
      const invite = pending.body.invites[0];
      expect(invite).toMatchObject({ orgId, orgName: "Acme Inc" });
      const stolen = await api(`/api/invites/${invite.id}/accept`, {
        method: "POST",
        token: outsider.token,
      });
      expect(stolen.status).toBe(404);
      const accepted = await api(`/api/invites/${invite.id}/accept`, {
        method: "POST",
        token: who.token,
      });
      expect(accepted.body).toEqual({ orgId });
    }

    const view = await api(`/api/orgs/${orgId}`, { token: owner.token });
    expect(view.body.members.map((entry: { role: string }) => entry.role)).toEqual([
      "owner",
      "admin",
      "member",
    ]);
    expect(view.body.members[2].publicKey).toBe(member.identity.publicKey);
    expect(view.body.invites).toEqual([]);
  });

  it("keeps members out of admin actions and outsiders out entirely", async () => {
    const invite = await api(`/api/orgs/${orgId}/invites`, {
      method: "POST",
      token: member.token,
      body: JSON.stringify({ email: "x@example.com", role: "member" }),
    });
    expect(invite.status).toBe(403);
    const adminInvitesAdmin = await api(`/api/orgs/${orgId}/invites`, {
      method: "POST",
      token: admin.token,
      body: JSON.stringify({ email: "y@example.com", role: "admin" }),
    });
    expect(adminInvitesAdmin.status).toBe(403);
    expect((await api(`/api/orgs/${orgId}/audit`, { token: member.token })).status).toBe(403);
    expect((await api(`/api/orgs/${orgId}`, { token: outsider.token })).status).toBe(404);
    const removeOwner = await api(`/api/orgs/${orgId}/members/${owner.accountId}`, {
      method: "DELETE",
      token: admin.token,
    });
    expect(removeOwner.status).toBe(403);
  });

  it("shares a team key only with the members it was wrapped for", async () => {
    const created = await api(`/api/orgs/${orgId}/teams`, {
      method: "POST",
      token: owner.token,
      body: JSON.stringify({
        name: "Backend",
        wrappedKey: await wrapForRecipient(owner.identity.publicKey, teamKey, teamContext("new")),
      }),
    });
    expect(created.status).toBe(201);
    teamId = created.body.id;

    const added = await api(`/api/orgs/${orgId}/teams/${teamId}/members/${member.accountId}`, {
      method: "PUT",
      token: owner.token,
      body: JSON.stringify({
        wrappedKey: await wrapForRecipient(member.identity.publicKey, teamKey, teamContext(teamId)),
      }),
    });
    expect(added.status).toBe(200);

    const memberView = await api(`/api/orgs/${orgId}`, { token: member.token });
    const team = memberView.body.teams.find((entry: { id: string }) => entry.id === teamId);
    expect(await unwrapForRecipient(member.identity, team.wrappedKey, teamContext(teamId))).toEqual(
      teamKey,
    );

    const adminView = await api(`/api/orgs/${orgId}`, { token: admin.token });
    const seenByAdmin = adminView.body.teams.find((entry: { id: string }) => entry.id === teamId);
    expect(seenByAdmin.wrappedKey).toBeNull();
    const notInTeam = await api(`/api/orgs/${orgId}/teams/${teamId}/members/${admin.accountId}`, {
      method: "PUT",
      token: admin.token,
      body: JSON.stringify({
        wrappedKey: await wrapForRecipient(
          admin.identity.publicKey,
          randomKey(),
          teamContext(teamId),
        ),
      }),
    });
    expect(notInTeam.status).toBe(403);
    expect(notInTeam.body.code).toBe("orgs.not_in_team");
  });

  it("flags the team for re-keying when someone leaves and removes their access", async () => {
    const removed = await api(`/api/orgs/${orgId}/members/${member.accountId}`, {
      method: "DELETE",
      token: owner.token,
    });
    expect(removed.status).toBe(200);
    expect((await api(`/api/orgs/${orgId}`, { token: member.token })).status).toBe(404);
    const view = await api(`/api/orgs/${orgId}`, { token: owner.token });
    const team = view.body.teams.find((entry: { id: string }) => entry.id === teamId);
    expect(team.rekeyNeeded).toBe(true);
    expect(team.members).toEqual([owner.accountId]);
  });

  it("keeps a verifiable, hash-chained audit log", async () => {
    const audit = await api(`/api/orgs/${orgId}/audit`, { token: owner.token });
    expect(audit.status).toBe(200);
    expect(audit.body.verified).toBe(true);
    const actions = audit.body.events.map((event: { action: string }) => event.action).reverse();
    expect(actions).toEqual([
      "org.created",
      "member.invited",
      "member.invited",
      "member.joined",
      "member.joined",
      "team.created",
      "team.member_added",
      "member.removed",
    ]);
    expect(JSON.stringify(audit.body)).not.toContain(Buffer.from(teamKey).toString("base64"));
  });
});
