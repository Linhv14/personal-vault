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
  refersTo,
  openSecretWithOrigin,
  type Environment,
  type ProjectContent,
  type SecretAccess,
  type SecretContent,
} from "../../src/core/projects.js";

export class AgentError extends Error {}

export class Unreachable extends AgentError {}

export class ServerRefusal extends AgentError {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | undefined,
    readonly params: Record<string, unknown>,
  ) {
    super(message);
  }
}

interface LoginAnswer {
  token?: string;
  expiresAt?: number;
  wrappedVaultKey?: SealedData;
  twoFactor?: string;
  challenge?: string;
}

const CODE_ATTEMPTS = 3;

export interface Session {
  server: string;
  token: string;
  expiresAt?: number;
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
  if (init.body) {
    headers.set("Content-Type", "application/json");
  }
  if (init.token) {
    headers.set("Authorization", `Bearer ${init.token}`);
  }
  let response: Response;
  try {
    response = await request(`${server}${path}`, { ...init, headers });
  } catch {
    throw new Unreachable(`Cannot reach ${server}`);
  }
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    code?: string;
    params?: Record<string, unknown>;
  };
  if (response.status === 401 && init.token) {
    throw new AgentError("Your 7key session has expired. Run: 7key login");
  }
  if (!response.ok) {
    throw new ServerRefusal(
      `${server} refused ${path} (${response.status}): ${body.error ?? ""}`,
      response.status,
      body.code,
      body.params ?? {},
    );
  }
  return body;
}

export async function signIn(
  server: string,
  email: string,
  password: string,
  request: typeof fetch = fetch,
  askCode?: (question: string) => Promise<string>,
): Promise<Session> {
  const origin = new URL(server).origin;
  const { kdf } = await call<{ kdf: KdfParams }>(request, origin, "/api/auth/prelogin", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  const masterKey = await deriveMasterKey(email, password, kdf);
  const authKey = toBase64(await deriveAuthKey(masterKey));
  let login = await call<LoginAnswer>(request, origin, "/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, authKey }),
  }).catch((error: unknown) => {
    throw error instanceof AgentError
      ? signInError(error, "Wrong email or master password")
      : error;
  });
  if (login.twoFactor === "required" && login.challenge) {
    if (!askCode) {
      throw new AgentError("This account uses two-factor authentication. Run 7key login first");
    }
    login = await secondFactor(request, origin, login.challenge, askCode);
  }
  if (!login.token || !login.wrappedVaultKey) {
    throw new AgentError(
      "The server asked for a sign-in step this 7key does not know. Update 7key",
    );
  }
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
    expiresAt: login.expiresAt,
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

function signInError(error: AgentError, fallback: string): AgentError {
  if (error instanceof ServerRefusal && error.status === 429) {
    return new AgentError(
      `Too many attempts. Try again in ${String(error.params.seconds)} seconds`,
    );
  }
  if (error instanceof ServerRefusal && error.code === "auth.two_factor_expired") {
    return new AgentError("The sign-in timed out. Run 7key login again");
  }
  return error instanceof ServerRefusal ? new AgentError(fallback) : error;
}

async function secondFactor(
  request: typeof fetch,
  origin: string,
  challenge: string,
  askCode: (question: string) => Promise<string>,
): Promise<LoginAnswer> {
  for (let attempt = 1; ; attempt++) {
    const question = attempt === 1 ? "2FA code (or backup code): " : "Wrong code. 2FA code: ";
    const code = (await askCode(question)).trim();
    try {
      return await call<LoginAnswer>(request, origin, "/api/auth/login/2fa", {
        method: "POST",
        body: JSON.stringify({ challenge, code }),
      });
    } catch (error) {
      const wrong = error instanceof ServerRefusal && error.code === "auth.invalid_2fa";
      if (!wrong || attempt >= CODE_ATTEMPTS) {
        throw error instanceof AgentError ? signInError(error, "Wrong 2FA code") : error;
      }
    }
  }
}

export async function signOut(session: Session): Promise<void> {
  await call(session.request, session.server, "/api/auth/logout", {
    method: "POST",
    token: session.token,
  }).catch(() => {});
}

export interface ProjectChoice {
  orgId: string;
  orgName: string;
  teamId: string;
  teamName: string;
  projectId: string;
  content: ProjectContent;
  generation: number;
}

export interface EnvironmentRef {
  orgId: string;
  teamId: string;
  projectId: string;
  environmentId: string;
}

export function findEnvironment(
  content: ProjectContent,
  wanted: { id?: string; name?: string },
): Environment {
  const environment = content.environments.find((entry) =>
    wanted.name ? refersTo(wanted.name, entry) : entry.id === wanted.id,
  );
  if (environment) {
    return environment;
  }
  const names = content.environments.map((entry) => entry.name).join(", ");
  throw new AgentError(
    wanted.name
      ? `No environment "${wanted.name}" in ${content.name} (${names})`
      : "The linked environment is gone; run 7key link",
  );
}

function getter(session: Session) {
  return <T>(path: string) =>
    call<T>(session.request, session.server, path, { token: session.token });
}

export async function listOrgs(session: Session): Promise<{ id: string; name: string }[]> {
  const { orgs } = await getter(session)<{ orgs: { id: string; name: string }[] }>("/api/orgs");
  return orgs;
}

export async function listProjects(
  session: Session,
  org: { id: string; name: string },
): Promise<ProjectChoice[]> {
  const detail = await getter(session)<{
    teams: TeamView[];
    projects: Record<
      string,
      { generation: number; projects: { id: string; sealed: SealedData }[] }
    >;
  }>(`/api/orgs/${org.id}`);
  const choices: ProjectChoice[] = [];
  for (const team of detail.teams) {
    const listed = detail.projects[team.id];
    if (!team.wrappedKey || !listed) {
      continue;
    }
    const teamKey = new Uint8Array(
      await unwrapForRecipient(
        session.identity,
        team.wrappedKey,
        teamKeyContext(team.id, listed.generation),
      ),
    );
    for (const record of listed.projects) {
      choices.push({
        orgId: org.id,
        orgName: org.name,
        teamId: team.id,
        teamName: team.name,
        projectId: record.id,
        content: await openProject(teamKey, record.id, listed.generation, record.sealed),
        generation: listed.generation,
      });
    }
  }
  return choices;
}

async function openEnvironment(
  session: Session,
  choice: ProjectChoice,
  environment: Environment,
): Promise<Selected> {
  const { secrets } = await getter(session)<{ secrets: { id: string; sealed: SealedData }[] }>(
    `/api/orgs/${choice.orgId}/teams/${choice.teamId}/projects/${choice.projectId}/environments/${environment.id}/secrets`,
  );
  const opened = await Promise.all(
    secrets.map(
      async (record) =>
        (
          await openSecretWithOrigin(
            choice.content,
            {
              projectId: choice.projectId,
              generation: choice.generation,
              environmentId: environment.id,
              secretId: record.id,
            },
            record.sealed,
          )
        ).content,
    ),
  );
  return {
    orgId: choice.orgId,
    teamId: choice.teamId,
    projectId: choice.projectId,
    projectName: choice.content.name,
    environment,
    secrets: opened.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function loadEnvironment(
  session: Session,
  ref: EnvironmentRef,
  environmentName?: string,
): Promise<Selected> {
  const org = (await listOrgs(session)).find((entry) => entry.id === ref.orgId);
  if (!org) {
    throw new AgentError("The linked organization is gone or you left it; run 7key link");
  }
  const choice = (await listProjects(session, org)).find(
    (entry) => entry.projectId === ref.projectId && entry.teamId === ref.teamId,
  );
  if (!choice) {
    throw new AgentError("The linked project is gone or out of reach; run 7key link");
  }
  const environment = findEnvironment(choice.content, {
    id: ref.environmentId,
    name: environmentName,
  });
  return openEnvironment(session, choice, environment);
}

export async function selectEnvironment(
  session: Session,
  projectName: string,
  environmentName: string,
  orgName?: string,
): Promise<Selected> {
  const matches: ProjectChoice[] = [];
  for (const org of (await listOrgs(session)).filter(
    (entry) => !orgName || refersTo(orgName, entry),
  )) {
    for (const choice of await listProjects(session, org)) {
      if (refersTo(projectName, { id: choice.projectId, name: choice.content.name })) {
        matches.push(choice);
      }
    }
  }
  if (matches.length === 0) {
    const scope = orgName ? ` of ${orgName}` : "";
    throw new AgentError(`No project "${projectName}" in your teams${scope}`);
  }
  if (matches.length > 1) {
    const places = matches.map((entry) => `${entry.orgName} / ${entry.teamName}`).join(", ");
    throw new AgentError(`"${projectName}" is in ${places}; pass --org, or the project id`);
  }
  const choice = matches[0]!;
  const environment = findEnvironment(choice.content, { name: environmentName });
  return openEnvironment(session, choice, environment);
}

const ACCESS_RETRY_DELAYS_MS = [500, 2000];

function worthRetrying(error: unknown): boolean {
  return error instanceof Unreachable || (error instanceof ServerRefusal && error.status >= 500);
}

export async function noteAccess(
  session: Session,
  selected: Selected,
  access: SecretAccess,
  pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
): Promise<void> {
  const path = `/api/orgs/${selected.orgId}/teams/${selected.teamId}/projects/${selected.projectId}/access`;
  const body = JSON.stringify({ events: [{ environmentId: selected.environment.id, access }] });
  for (let attempt = 0; ; attempt++) {
    try {
      await call(session.request, session.server, path, {
        method: "POST",
        token: session.token,
        body,
      });
      return;
    } catch (error) {
      const delay = ACCESS_RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !worthRetrying(error)) {
        const reason = error instanceof Error ? error.message : String(error);
        process.stderr.write(
          `7key: could not record this access in the activity log (${reason})\n`,
        );
        return;
      }
      await pause(delay);
    }
  }
}
