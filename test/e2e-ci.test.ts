import { readFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { main } from "../cli/main.js";
import { beforeAll, describe, expect, it } from "vitest";
import { toBase64Url, utf8Encode } from "../src/core/bytes.js";
import { openCiResponse, parseLinkReference, type CiResponse } from "../src/core/ci.js";
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
  createLink,
  createProject,
  deleteLink,
  listLinks,
  listProjects,
  rekeyTeam,
  saveSecrets,
  type Project,
} from "../extension/lib/projects.js";

const BASE = process.env.VAULT_E2E_URL ?? "http://127.0.0.1:8787";
const REGISTRATION_TOKEN = process.env.VAULT_REGISTRATION_TOKEN ?? "token-dev-local";
const ISSUER = "https://ci-test.invalid";
const enabled = process.env.VAULT_E2E === "1";
const testKey = JSON.parse(
  readFileSync(new URL("./fixtures/ci-test-key.json", import.meta.url), "utf8"),
) as JsonWebKey & { kid: string };

async function api(path: string, init: RequestInit & { token?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  const response = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, text };
}

async function githubToken(claims: Record<string, unknown>): Promise<string> {
  const key = await crypto.subtle.importKey(
    "jwk",
    testKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => toBase64Url(utf8Encode(JSON.stringify(value)));
  const header = encode({ alg: "RS256", kid: testKey.kid, typ: "JWT" });
  const payload = encode({
    iss: ISSUER,
    aud: BASE,
    iat: now,
    nbf: now,
    exp: now + 300,
    event_name: "push",
    ...claims,
  });
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    utf8Encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

describe.skipIf(!enabled)("GitHub Actions reading linked secrets", () => {
  let token: string;
  let accountId: string;
  let identity: Identity;
  let orgId: string;
  let team: Team;
  let project: Project;
  let reference: string;
  let repoKey: string;
  const production = () => project.content.environments[2]!.id;
  const development = () => project.content.environments[0]!.id;

  const ciRead = async (claims: Record<string, unknown>, link = reference) =>
    api("/api/ci/secrets", {
      method: "POST",
      token: await githubToken(claims),
      body: JSON.stringify({ link }),
    });

  beforeAll(async () => {
    const email = `ci-${Date.now()}@example.com`;
    const { record } = await createAccount(email, "ci password", 100_000);
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
      await api("/api/orgs", { method: "POST", token, body: JSON.stringify({ name: "CI" }) })
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
    team = (await getOrg(orgId)).teams.find((entry) => entry.id === teamId)!;
    await createProject(orgId, team, identity, "Api");
    project = (await listProjects(orgId, team, identity))[0]!;
    await saveSecrets(orgId, project, [
      { environmentId: production(), name: "DATABASE_URL", value: "postgres://prod" },
      { environmentId: production(), name: "API_KEY", value: "prod-key", kind: "secret" },
      { environmentId: development(), name: "DATABASE_URL", value: "postgres://dev" },
    ]);
  });

  it("links a repository and hands it a key it must keep itself", async () => {
    ({ reference, repoKey } = await createLink(orgId, project, {
      environmentId: production(),
      repository: "acme/api",
      branch: "main",
      githubEnvironment: null,
    }));
    expect(repoKey.startsWith("1pw1.")).toBe(true);
    const links = await listLinks(orgId, project);
    expect(links).toMatchObject([{ repository: "acme/api", branch: "main", lastUsedAt: null }]);
    expect(JSON.stringify(links)).not.toContain(repoKey.split(".")[2]);
  });

  it("returns only ciphertext, which the repository key opens", async () => {
    const response = await ciRead({ repository: "acme/api", ref: "refs/heads/main" });
    expect(response.status).toBe(200);
    expect(response.text).not.toContain("postgres://prod");
    const { linkId } = parseLinkReference(reference)!;
    const secrets = await openCiResponse(repoKey, linkId, response.body as CiResponse);
    expect(secrets.map(({ name, value }) => [name, value])).toEqual([
      ["API_KEY", "prod-key"],
      ["DATABASE_URL", "postgres://prod"],
    ]);
  });

  it("runs a command and fills GITHUB_ENV through the CLI, masking secret values", async () => {
    const oidc = createServer(async (_, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          value: await githubToken({ repository: "acme/api", ref: "refs/heads/main" }),
        }),
      );
    });
    await new Promise<void>((resolve) => oidc.listen(0, "127.0.0.1", resolve));
    const { port } = oidc.address() as AddressInfo;
    const folder = await mkdtemp(path.join(tmpdir(), "1pw-ci-"));
    const githubEnv = path.join(folder, "env");
    await writeFile(githubEnv, "");
    const env = {
      ...process.env,
      ACTIONS_ID_TOKEN_REQUEST_URL: `http://127.0.0.1:${port}/token?api-version=2.0`,
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "runner-token",
      SEVENKEY_KEY: repoKey,
      SEVENKEY_LINK: reference,
      SEVENKEY_SERVER: BASE,
      GITHUB_ENV: githubEnv,
    };
    const logged: string[] = [];
    const log = console.log;
    console.log = (line: string) => void logged.push(line);
    try {
      expect(await main(["env"], env)).toBe(0);
    } finally {
      console.log = log;
    }
    expect(await readFile(githubEnv, "utf8")).toMatch(
      /API_KEY<<SEVENKEY_\w+\nprod-key\nSEVENKEY_\w+/,
    );
    expect(logged).toContain("::add-mask::prod-key");

    const output = path.join(folder, "out");
    const code = await main(
      [
        "run",
        "--",
        process.execPath,
        "-e",
        `require("fs").writeFileSync(${JSON.stringify(output)}, process.env.API_KEY + "|" + (process.env.SEVENKEY_KEY ?? "gone"))`,
      ],
      env,
    );
    oidc.close();
    expect(code).toBe(0);
    expect(await readFile(output, "utf8")).toBe("prod-key|gone");
  });

  it("refuses other branches, repositories, missing tokens and forged issuers", async () => {
    expect((await ciRead({ repository: "acme/api", ref: "refs/heads/dev" })).status).toBe(403);
    expect((await ciRead({ repository: "evil/api", ref: "refs/heads/main" })).status).toBe(403);
    expect(
      (
        await ciRead({
          repository: "acme/api",
          ref: "refs/heads/main",
          event_name: "pull_request_target",
        })
      ).status,
    ).toBe(403);
    expect(
      (await ciRead({ repository: "acme/api", ref: "refs/heads/main", iss: "https://evil" }))
        .status,
    ).toBe(401);
    const anonymous = await api("/api/ci/secrets", {
      method: "POST",
      body: JSON.stringify({ link: reference }),
    });
    expect(anonymous.status).toBe(401);
  });

  it("keeps working for the repository after the team key is replaced", async () => {
    const detail = await getOrg(orgId);
    await rekeyTeam(orgId, team, detail.members, identity);
    const response = await ciRead({ repository: "acme/api", ref: "refs/heads/main" });
    expect(response.status).toBe(200);
    expect(response.body.generation).toBe(1);
    const { linkId } = parseLinkReference(reference)!;
    const secrets = await openCiResponse(repoKey, linkId, response.body as CiResponse);
    expect(secrets).toHaveLength(2);
  });

  it("logs every read under the repository and stops after the link is removed", async () => {
    const audit = await api(`/api/orgs/${orgId}/audit`, { token });
    const reads = audit.body.events.filter(
      (event: { action: string }) => event.action === "ci.read",
    );
    expect(reads.length).toBeGreaterThanOrEqual(2);
    expect(reads[0].actor).toBe("github:acme/api@refs/heads/main");

    team = (await getOrg(orgId)).teams.find((entry) => entry.id === team.id)!;
    project = (await listProjects(orgId, team, identity))[0]!;
    await deleteLink(orgId, project, parseLinkReference(reference)!.linkId);
    expect((await ciRead({ repository: "acme/api", ref: "refs/heads/main" })).status).toBe(403);
    expect(accountId).toBeTruthy();
  });
});
