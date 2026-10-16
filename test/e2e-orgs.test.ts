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

const teamContext = (teamId: string, generation = 0) =>
  utf8Encode(`personal-vault/team-key/${teamId}${generation ? `/${generation}` : ""}`);

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
      expect(invited.body).toMatchObject({ emailed: false });
      expect(invited.body.link).toBe(`${BASE}/app/#/invite/${invited.body.id}`);
      const preview = await api(`/api/invites/${invited.body.id}/preview`);
      expect(preview.status).toBe(200);
      expect(preview.body).toMatchObject({
        orgName: "Acme Inc",
        inviter: owner.email,
        email: who.email,
        role,
        hasAccount: true,
      });
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
      expect((await api(`/api/invites/${invite.id}/preview`)).status).toBe(404);
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
    teamId = crypto.randomUUID();
    const body = JSON.stringify({
      id: teamId,
      name: "Backend",
      wrappedKey: await wrapForRecipient(owner.identity.publicKey, teamKey, teamContext(teamId)),
    });
    const created = await api(`/api/orgs/${orgId}/teams`, {
      method: "POST",
      token: owner.token,
      body,
    });
    expect(created.status).toBe(201);
    const again = await api(`/api/orgs/${orgId}/teams`, {
      method: "POST",
      token: owner.token,
      body,
    });
    expect(again.status).toBe(409);

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

  it("replaces a team key only for exactly its current members, one generation at a time", async () => {
    const put = (who: Person, body: unknown) =>
      api(`/api/orgs/${orgId}/teams/${teamId}/key`, {
        method: "PUT",
        token: who.token,
        body: JSON.stringify(body),
      });
    const nextKey = randomKey();
    const forOwner = await wrapForRecipient(
      owner.identity.publicKey,
      nextKey,
      teamContext(teamId, 1),
    );
    const forAdmin = await wrapForRecipient(
      admin.identity.publicKey,
      nextKey,
      teamContext(teamId, 1),
    );

    const stale = await put(owner, { generation: 0, wrappedKeys: { [owner.accountId]: forOwner } });
    expect(stale.body.code).toBe("orgs.stale_team_key");
    const extra = await put(owner, {
      generation: 1,
      wrappedKeys: { [owner.accountId]: forOwner, [admin.accountId]: forAdmin },
    });
    expect(extra.body.code).toBe("orgs.team_changed");
    const outside = await put(admin, {
      generation: 1,
      wrappedKeys: { [admin.accountId]: forAdmin },
    });
    expect(outside.body.code).toBe("orgs.not_in_team");

    const rekeyed = await put(owner, {
      generation: 1,
      wrappedKeys: { [owner.accountId]: forOwner },
    });
    expect(rekeyed.status).toBe(200);
    const view = await api(`/api/orgs/${orgId}`, { token: owner.token });
    const team = view.body.teams.find((entry: { id: string }) => entry.id === teamId);
    expect(team).toMatchObject({ generation: 1, rekeyNeeded: false });
    expect(
      await unwrapForRecipient(owner.identity, team.wrappedKey, teamContext(teamId, 1)),
    ).toEqual(nextKey);
    await expect(
      unwrapForRecipient(owner.identity, team.wrappedKey, teamContext(teamId, 0)),
    ).rejects.toThrow();

    const withOldKey = await api(`/api/orgs/${orgId}/teams/${teamId}/members/${admin.accountId}`, {
      method: "PUT",
      token: owner.token,
      body: JSON.stringify({
        wrappedKey: await wrapForRecipient(admin.identity.publicKey, teamKey, teamContext(teamId)),
      }),
    });
    expect(withOldKey.body.code).toBe("orgs.stale_team_key");
    const added = await api(`/api/orgs/${orgId}/teams/${teamId}/members/${admin.accountId}`, {
      method: "PUT",
      token: owner.token,
      body: JSON.stringify({ wrappedKey: forAdmin, generation: 1 }),
    });
    expect(added.status).toBe(200);
  });

  it("lets an invited address create its account from the invitation and join at once", async () => {
    const email = `newcomer-${Date.now()}@example.com`;
    const invited = await api(`/api/orgs/${orgId}/invites`, {
      method: "POST",
      token: owner.token,
      body: JSON.stringify({ email, role: "member" }),
    });
    const preview = await api(`/api/invites/${invited.body.id}/preview`);
    expect(preview.body).toMatchObject({ email, hasAccount: false });

    const register = async (as: string, inviteId: string) =>
      api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email: as,
          ...(await createAccount(as, "newcomer password", 100_000)).record,
          inviteId,
        }),
      });
    const stranger = await register(`stranger-${Date.now()}@example.com`, invited.body.id);
    expect(stranger.status).toBe(403);
    expect(stranger.body.code).toBe("auth.bad_registration_token");

    const created = await register(email, invited.body.id);
    expect(created.status).toBe(201);
    expect(created.body.orgId).toBe(orgId);
    const mine = await api("/api/orgs", { token: created.body.token });
    expect(mine.body.orgs).toEqual([expect.objectContaining({ id: orgId, role: "member" })]);
    expect((await api(`/api/invites/${invited.body.id}/preview`)).status).toBe(404);

    const removed = await api(`/api/orgs/${orgId}/members/${created.body.accountId}`, {
      method: "DELETE",
      token: owner.token,
    });
    expect(removed.status).toBe(200);
  });

  it("counts members and pending invitations against the plan's seats", async () => {
    const invite = (email: string) =>
      api(`/api/orgs/${orgId}/invites`, {
        method: "POST",
        token: owner.token,
        body: JSON.stringify({ email, role: "member" }),
      });
    const stamp = Date.now();
    const first = await invite(`seat1-${stamp}@example.com`);
    expect(first.status).toBe(201);
    for (const n of [2, 3]) {
      expect((await invite(`seat${n}-${stamp}@example.com`)).status).toBe(201);
    }
    const resent = await invite(`seat1-${stamp}@example.com`);
    expect(resent.status).toBe(201);
    expect(resent.body.id).toBe(first.body.id);
    expect(resent.body.link).toBe(first.body.link);
    const full = await invite(`seat4-${stamp}@example.com`);
    expect(full.status).toBe(409);
    expect(full.body).toMatchObject({ code: "orgs.seat_limit", params: { limit: 5 } });
  });

  it("caps the number of teams by plan", async () => {
    const create = async () => {
      const id = crypto.randomUUID();
      return api(`/api/orgs/${orgId}/teams`, {
        method: "POST",
        token: owner.token,
        body: JSON.stringify({
          id,
          name: "Extra",
          wrappedKey: await wrapForRecipient(
            owner.identity.publicKey,
            randomKey(),
            teamContext(id),
          ),
        }),
      });
    };
    expect((await create()).status).toBe(201);
    expect((await create()).status).toBe(201);
    const over = await create();
    expect(over.status).toBe(409);
    expect(over.body).toMatchObject({ code: "orgs.team_limit", params: { limit: 3 } });
  });

  it("hands ownership to another member, and only the owner can", async () => {
    const transfer = (who: Person, accountId: string) =>
      api(`/api/orgs/${orgId}/owner`, {
        method: "POST",
        token: who.token,
        body: JSON.stringify({ accountId }),
      });
    expect((await transfer(admin, admin.accountId)).status).toBe(403);
    expect((await transfer(owner, outsider.accountId)).status).toBe(404);
    expect((await transfer(owner, admin.accountId)).status).toBe(200);

    const view = await api(`/api/orgs/${orgId}`, { token: admin.token });
    expect(view.body.org.role).toBe("owner");
    const roles = Object.fromEntries(
      view.body.members.map((entry: { accountId: string; role: string }) => [
        entry.accountId,
        entry.role,
      ]),
    );
    expect(roles).toMatchObject({ [admin.accountId]: "owner", [owner.accountId]: "admin" });
    expect((await transfer(owner, admin.accountId)).status).toBe(403);
    const demote = await api(`/api/orgs/${orgId}/members/${admin.accountId}`, {
      method: "PATCH",
      token: owner.token,
      body: JSON.stringify({ role: "member" }),
    });
    expect(demote.status).toBe(403);

    const audit = await api(`/api/orgs/${orgId}/audit`, { token: admin.token });
    expect(audit.body.verified).toBe(true);
    expect(audit.body.events.map((event: { action: string }) => event.action)).toContain(
      "team.rekeyed",
    );
    expect(audit.body.events[0]).toMatchObject({
      action: "org.owner_transferred",
      actor: owner.accountId,
      target: admin.accountId,
    });
  });

  it("lets the extension send every method the organization API uses", async () => {
    const response = await fetch(`${BASE}/api/orgs/${orgId}/members/${admin.accountId}`, {
      method: "OPTIONS",
      headers: {
        Origin: "chrome-extension://eepgmbamigmadeddhcoldncaolikeagm",
        "Access-Control-Request-Method": "PATCH",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });
    const allowed = response.headers.get("access-control-allow-methods") ?? "";
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      expect(allowed).toContain(method);
    }
  });
});
