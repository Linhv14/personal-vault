import { toBase64, utf8Encode } from "../../src/core/bytes.js";
import {
  deriveAuthKey,
  deriveMasterKey,
  deriveWrappingKey,
  importVaultKey,
  open,
  type KdfParams,
  type SealedData,
} from "../../src/core/crypto.js";
import { unwrapForRecipient, type Identity } from "../../src/core/identity.js";
import { teamKeyContext, type TeamView } from "../../src/core/org-model.js";
import {
  openProject,
  openSecretWithOrigin,
  type Environment,
  type ProjectContent,
  type SecretAccess,
  type SecretContent,
} from "../../src/core/projects.js";

export class AgentError extends Error {}

export interface Session {
  server: string;
  token: string;
  identity: Identity;
  request: typeof fetch;
}

export interface Selected {
  orgId: string;
  teamId: string;
  projectId: string;
  projectName: string;
  environment: Environment;
  secrets: SecretContent[];
}

async function call<T>(
  request: typeof fetch,
  server: string,
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  let response: Response;
  try {
    response = await request(`${server}${path}`, { ...init, headers });
  } catch {
    throw new AgentError(`Cannot reach ${server}`);
  }
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new AgentError(`${server} refused ${path} (${response.status}): ${body.error ?? ""}`);
  }
  return body;
}

export async function signIn(
  server: string,
  email: string,
  password: string,
  request: typeof fetch = fetch,
): Promise<Session> {
  const origin = new URL(server).origin;
  const { kdf } = await call<{ kdf: KdfParams }>(request, origin, "/api/auth/prelogin", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  const masterKey = await deriveMasterKey(email, password, kdf);
  const authKey = toBase64(await deriveAuthKey(masterKey));
  const login = await call<{ token: string; wrappedVaultKey: SealedData }>(
    request,
    origin,
    "/api/auth/login",
    { method: "POST", body: JSON.stringify({ email, authKey }) },
  ).catch((error: unknown) => {
    throw error instanceof AgentError ? new AgentError("Wrong email or master password") : error;
  });
  const vaultKey = await importVaultKey(
    await open(await deriveWrappingKey(masterKey), login.wrappedVaultKey),
  );
  const { identity } = await call<{
    identity: { publicKey: string; wrappedPrivateKey: SealedData } | null;
  }>(request, origin, "/api/account/identity", { token: login.token });
  if (!identity) {
    throw new AgentError("This account has no key pair yet. Open the 7key console once first.");
  }
  return {
    server: origin,
    token: login.token,
    request,
    identity: {
      publicKey: identity.publicKey,
      privateKey: await open(
        vaultKey,
        identity.wrappedPrivateKey,
        utf8Encode("personal-vault/account-private-key"),
      ),
    },
  };
}

export async function signOut(session: Session): Promise<void> {
  await call(session.request, session.server, "/api/auth/logout", {
    method: "POST",
    token: session.token,
  }).catch(() => {});
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export async function selectEnvironment(
  session: Session,
  projectName: string,
  environmentName: string,
  orgName?: string,
): Promise<Selected> {
  const get = <T>(path: string) =>
    call<T>(session.request, session.server, path, { token: session.token });
  const { orgs } = await get<{ orgs: { id: string; name: string }[] }>("/api/orgs");
  const matches: (Omit<Selected, "environment" | "secrets"> & { where: string })[] = [];
  const contents = new Map<string, { content: ProjectContent; generation: number }>();
  for (const org of orgs.filter((entry) => !orgName || same(entry.name, orgName))) {
    const detail = await get<{
      teams: TeamView[];
      projects: Record<
        string,
        { generation: number; projects: { id: string; sealed: SealedData }[] }
      >;
    }>(`/api/orgs/${org.id}`);
    for (const team of detail.teams) {
      const listed = detail.projects[team.id];
      if (!team.wrappedKey || !listed) continue;
      const teamKey = new Uint8Array(
        await unwrapForRecipient(
          session.identity,
          team.wrappedKey,
          teamKeyContext(team.id, listed.generation),
        ),
      );
      for (const record of listed.projects) {
        const content = await openProject(teamKey, record.id, listed.generation, record.sealed);
        if (!same(content.name, projectName)) continue;
        contents.set(record.id, { content, generation: listed.generation });
        matches.push({
          orgId: org.id,
          teamId: team.id,
          projectId: record.id,
          projectName: content.name,
          where: `${org.name} / ${team.name}`,
        });
      }
    }
  }
  if (matches.length === 0) {
    const scope = orgName ? ` of ${orgName}` : "";
    throw new AgentError(`No project named "${projectName}" in your teams${scope}`);
  }
  if (matches.length > 1) {
    const places = matches.map((entry) => entry.where).join(", ");
    throw new AgentError(`"${projectName}" is in ${places}; pass --org to pick one`);
  }
  const { where: _where, ...match } = matches[0]!;
  const { content, generation } = contents.get(match.projectId)!;
  const environment = content.environments.find((entry) => same(entry.name, environmentName));
  if (!environment) {
    const names = content.environments.map((entry) => entry.name).join(", ");
    throw new AgentError(`No environment "${environmentName}" in ${content.name} (${names})`);
  }
  const { secrets } = await get<{ secrets: { id: string; sealed: SealedData }[] }>(
    `/api/orgs/${match.orgId}/teams/${match.teamId}/projects/${match.projectId}/environments/${environment.id}/secrets`,
  );
  const opened = await Promise.all(
    secrets.map(
      async (record) =>
        (
          await openSecretWithOrigin(
            content,
            {
              projectId: match.projectId,
              generation,
              environmentId: environment.id,
              secretId: record.id,
            },
            record.sealed,
          )
        ).content,
    ),
  );
  return { ...match, environment, secrets: opened.sort((a, b) => a.name.localeCompare(b.name)) };
}

export async function noteAccess(
  session: Session,
  selected: Selected,
  access: SecretAccess,
): Promise<void> {
  await call(
    session.request,
    session.server,
    `/api/orgs/${selected.orgId}/teams/${selected.teamId}/projects/${selected.projectId}/access`,
    {
      method: "POST",
      token: session.token,
      body: JSON.stringify({ events: [{ environmentId: selected.environment.id, access }] }),
    },
  ).catch(() => {});
}
