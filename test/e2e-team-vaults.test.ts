import { beforeAll, describe, expect, it } from "vitest";
import { toBase64, utf8Encode } from "../src/core/bytes.js";
import { createAccount, importVaultKey, seal } from "../src/core/crypto.js";
import {
  createIdentity,
  randomKey,
  wrapForRecipient,
  type Identity,
} from "../src/core/identity.js";
import { memoryArea, usePlatform } from "../extension/lib/platform.js";
import { getOrg, type Team } from "../extension/lib/orgs.js";
import { rekeyTeam } from "../extension/lib/projects.js";
import { sharedVaultId } from "../extension/lib/shared-vaults.js";
import {
  decryptEverything,
  newItemId,
  removeItem,
  saveItem,
  sync,
  type VaultItem,
} from "../extension/lib/vault.js";

const BASE = process.env.VAULT_E2E_URL ?? "http://127.0.0.1:8787";
const REGISTRATION_TOKEN = process.env.VAULT_REGISTRATION_TOKEN ?? "token-dev-local";
const enabled = process.env.VAULT_E2E === "1";

interface Person {
  email: string;
  token: string;
  accountId: string;
  identity: Identity;
  raw: Uint8Array;
  key: CryptoKey;
}

async function api(path: string, init: RequestInit & { token?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  const response = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, text };
}

async function person(label: string): Promise<Person> {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const { record } = await createAccount(email, `password for ${label}`, 100_000);
  const registered = await api("/api/auth/register", {
    method: "POST",
    headers: { "x-registration-token": REGISTRATION_TOKEN },
    body: JSON.stringify({ email, ...record }),
  });
  const raw = randomKey();
  const key = await importVaultKey(raw);
  const identity = await createIdentity();
  await api("/api/account/identity", {
    method: "PUT",
    token: registered.body.token,
    body: JSON.stringify({
      publicKey: identity.publicKey,
      wrappedPrivateKey: await seal(
        key,
        identity.privateKey,
        utf8Encode("personal-vault/account-private-key"),
      ),
    }),
  });
  return {
    email,
    token: registered.body.token,
    accountId: registered.body.accountId,
    identity,
    raw,
    key,
  };
}

function as(who: Person): void {
  usePlatform({
    local: memoryArea({ apiUrl: BASE }),
    session: memoryArea({ vaultKeyRaw: toBase64(who.raw), token: who.token }),
    scheduleLock: async () => {},
  });
}

async function view(who: Person): Promise<{ items: VaultItem[]; vaults: string[] }> {
  as(who);
  await sync();
  const { items, shared } = await decryptEverything(who.key, "en", false, true);
  return { items, vaults: shared.map((vault) => vault.id) };
}

const teamContext = (teamId: string) => utf8Encode(`personal-vault/team-key/${teamId}`);

describe.skipIf(!enabled)("team vaults against Worker + Durable Objects", () => {
  let owner: Person;
  let admin: Person;
  let member: Person;
  let outsider: Person;
  let orgId: string;
  let teamId: string;
  let vaultId: string;

  beforeAll(async () => {
    [owner, admin, member, outsider] = await Promise.all([
      person("v-owner"),
      person("v-admin"),
      person("v-member"),
      person("v-outsider"),
    ]);
    orgId = (
      await api("/api/orgs", {
        method: "POST",
        token: owner.token,
        body: JSON.stringify({ name: "Vaults Inc" }),
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
    teamId = crypto.randomUUID();
    const key = randomKey();
    await api(`/api/orgs/${orgId}/teams`, {
      method: "POST",
      token: owner.token,
      body: JSON.stringify({
        id: teamId,
        name: "Family",
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
    vaultId = sharedVaultId(orgId, teamId);
  });

  it("shows the team vault only to people in the team", async () => {
    expect((await view(owner)).vaults).toEqual([vaultId]);
    expect((await view(member)).vaults).toEqual([vaultId]);
    expect((await view(admin)).vaults).toEqual([]);
    expect((await view(outsider)).vaults).toEqual([]);
  });

  it("shares an item with the team without the server seeing it", async () => {
    as(member);
    await sync();
    const id = newItemId();
    await saveItem(member.key, {
      id,
      title: "Netflix",
      url: "https://netflix.com",
      username: "family@example.com",
      password: "shared-secret-123",
      vault: vaultId,
    });
    const listed = await api("/api/vaults", { token: owner.token });
    expect(listed.text).not.toContain("shared-secret-123");
    expect(listed.text).not.toContain("Netflix");

    const seen = await view(owner);
    expect(seen.items.find((item) => item.id === id)).toMatchObject({
      title: "Netflix",
      password: "shared-secret-123",
      vault: vaultId,
    });
  });

  it("refuses writes from people outside the team", async () => {
    const path = `/api/orgs/${orgId}/teams/${teamId}/items/${crypto.randomUUID()}`;
    const body = JSON.stringify({
      sealed: { ciphertext: "AAAA", nonce: "AAAAAAAAAAAAAAAA" },
      generation: 0,
    });
    expect((await api(path, { method: "PUT", token: admin.token, body })).status).toBe(403);
    expect((await api(path, { method: "PUT", token: outsider.token, body })).status).toBe(404);
  });

  it("moves an item between the personal vault and the team vault", async () => {
    as(owner);
    await sync();
    const id = newItemId();
    const personal = await saveItem(owner.key, {
      id,
      title: "Router",
      username: "admin",
      password: "router-pass",
    });
    const { createdAt: _createdAt, updatedAt: _updatedAt, ...draft } = personal;
    await saveItem(owner.key, { ...draft, vault: vaultId });

    const shared = await view(member);
    expect(shared.items.find((item) => item.id === id)?.vault).toBe(vaultId);
    const mine = await view(owner);
    expect(mine.items.filter((item) => item.id === id)).toHaveLength(1);
    expect(mine.items.find((item) => item.id === id)?.vault).toBe(vaultId);

    as(owner);
    await sync();
    await saveItem(owner.key, { ...draft, vault: undefined });
    expect((await view(member)).items.some((item) => item.id === id)).toBe(false);
    expect((await view(owner)).items.find((item) => item.id === id)?.vault).toBeUndefined();
  });

  it("deletes a shared item for everyone", async () => {
    as(member);
    await sync();
    const id = newItemId();
    await saveItem(member.key, { id, title: "Temp", password: "x", vault: vaultId });
    expect((await view(owner)).items.some((item) => item.id === id)).toBe(true);
    as(owner);
    await sync();
    await removeItem(id);
    expect((await view(member)).items.some((item) => item.id === id)).toBe(false);
  });

  it("re-encrypts the vault when someone leaves, and they lose it", async () => {
    await api(`/api/orgs/${orgId}/teams/${teamId}/members/${member.accountId}`, {
      method: "DELETE",
      token: owner.token,
    });
    as(owner);
    await sync();
    await expect(
      saveItem(owner.key, { id: newItemId(), title: "Late", vault: vaultId }),
    ).rejects.toMatchObject({ messageKey: "error.orgs.rekey_required" });

    const detail = await getOrg(orgId);
    const team = detail.teams.find((entry) => entry.id === teamId) as Team;
    await rekeyTeam(orgId, team, detail.members, owner.identity);

    const after = await view(owner);
    expect(after.items.find((item) => item.title === "Netflix")?.password).toBe(
      "shared-secret-123",
    );
    expect((await view(member)).vaults).toEqual([]);
    as(owner);
    await sync();
    await saveItem(owner.key, { id: newItemId(), title: "After", vault: vaultId });
    expect((await view(owner)).items.some((item) => item.title === "After")).toBe(true);
  });
});
