import { Hono } from "hono";
import { isEnvironmentId, SECRET_ACCESS, type SecretAccess } from "../../core/projects.js";
import { apiError } from "../errors.js";
import { readJson, respond } from "../http.js";
import { clientIp } from "../request.js";
import { orgStore } from "../stores.js";
import type { AppBindings } from "../types.js";
import { isBranch, isGithubEnvironment, isRepository } from "../../core/ci.js";
import { isPublicKey } from "../../core/identity.js";
import {
  isSealedProject,
  isSealedSecret,
  isSealedTeamItem,
  isUuid,
  isWrappedKey,
} from "../validate.js";
import type { SealedData } from "../../core/crypto.js";
import type { Principal } from "../../core/org-model.js";
import { asMember, isGeneration, limitsOf, param, type Ctx } from "./org-access.js";

const projects = new Hono<AppBindings>();

const team = (c: Ctx) => param(c, "teamId");
const project = (c: Ctx) => param(c, "projectId");
const invalidProject = (c: Ctx) => c.json(apiError("orgs.invalid_project"), 400);
const invalidSecret = (c: Ctx) => c.json(apiError("orgs.invalid_secret"), 400);

projects.get(
  "/projects",
  asMember(async (c, member, orgId) =>
    respond(c, await orgStore(c.env, orgId).listProjects(member, team(c))),
  ),
);

projects.post(
  "/projects",
  asMember(async (c, member, orgId) => {
    const { id, sealed, generation } = await readJson(c);
    if (!isUuid(id) || !isSealedProject(sealed) || !isGeneration(generation)) {
      return invalidProject(c);
    }
    const { projects: limit } = await limitsOf(c, orgId);
    return respond(
      c,
      await orgStore(c.env, orgId).createProject(
        member,
        team(c),
        { id, sealed, generation },
        limit,
        clientIp(c),
      ),
      201,
    );
  }),
);

projects.put(
  "/projects/:projectId",
  asMember(async (c, member, orgId) => {
    const { sealed, generation } = await readJson(c);
    if (!isSealedProject(sealed) || !isGeneration(generation)) return invalidProject(c);
    return respond(
      c,
      await orgStore(c.env, orgId).updateProject(
        member,
        team(c),
        project(c),
        { sealed, generation },
        clientIp(c),
      ),
    );
  }),
);

projects.delete(
  "/projects/:projectId",
  asMember(async (c, member, orgId) =>
    respond(
      c,
      await orgStore(c.env, orgId).deleteProject(member, team(c), project(c), clientIp(c)),
    ),
  ),
);

const MAX_READERS = 500;

projects.put(
  "/projects/:projectId/readers",
  asMember(async (c, member, orgId) => {
    const { readers } = await readJson(c);
    if (
      !Array.isArray(readers) ||
      readers.length > MAX_READERS ||
      !readers.every((id) => typeof id === "string" && id.length > 0 && id.length <= 64)
    ) {
      return c.json(apiError("orgs.invalid_reader"), 400);
    }
    return respond(
      c,
      await orgStore(c.env, orgId).setProjectReaders(
        member,
        team(c),
        project(c),
        readers,
        clientIp(c),
      ),
    );
  }),
);

projects.get(
  "/projects/:projectId/environments/:environmentId/secrets",
  asMember(async (c, member, orgId) => {
    const environmentId = param(c, "environmentId");
    if (!isEnvironmentId(environmentId)) return invalidSecret(c);
    return respond(
      c,
      await orgStore(c.env, orgId).readSecrets(
        member,
        team(c),
        project(c),
        environmentId,
        clientIp(c),
      ),
    );
  }),
);

const MAX_BATCH = 500;
const MAX_ACCESS_EVENTS = 100;

function secretEntry(
  value: unknown,
): { id: string; environmentId: string; sealed: SealedData } | null {
  if (typeof value !== "object" || value === null) return null;
  const { id, environmentId, sealed } = value as Record<string, unknown>;
  return isUuid(id) && isEnvironmentId(environmentId) && isSealedSecret(sealed)
    ? { id, environmentId, sealed }
    : null;
}

const write = (
  c: Ctx,
  member: Principal,
  orgId: string,
  generation: number,
  secrets: ReturnType<typeof secretEntry>[],
) =>
  orgStore(c.env, orgId).writeSecrets(
    member,
    team(c),
    project(c),
    { generation, secrets: secrets.filter((entry) => entry !== null) },
    clientIp(c),
  );

projects.post(
  "/projects/:projectId/secrets",
  asMember(async (c, member, orgId) => {
    const { generation, secrets } = await readJson(c);
    const entries = Array.isArray(secrets) ? secrets.map(secretEntry) : [];
    if (
      !isGeneration(generation) ||
      entries.length === 0 ||
      entries.length > MAX_BATCH ||
      entries.some((entry) => entry === null)
    ) {
      return invalidSecret(c);
    }
    return respond(c, await write(c, member, orgId, generation, entries));
  }),
);

projects.put(
  "/projects/:projectId/secrets/:secretId",
  asMember(async (c, member, orgId) => {
    const { environmentId, sealed, generation } = await readJson(c);
    const entry = secretEntry({ id: param(c, "secretId"), environmentId, sealed });
    if (!entry || !isGeneration(generation)) return invalidSecret(c);
    return respond(c, await write(c, member, orgId, generation, [entry]));
  }),
);

projects.post(
  "/projects/:projectId/access",
  asMember(async (c, member, orgId) => {
    const { events } = await readJson(c);
    const valid =
      Array.isArray(events) &&
      events.length > 0 &&
      events.length <= MAX_ACCESS_EVENTS &&
      events.every(
        (event) =>
          typeof event === "object" &&
          event !== null &&
          isEnvironmentId(event.environmentId) &&
          SECRET_ACCESS.includes(event.access),
      );
    if (!valid) return invalidSecret(c);
    const list = (events as { environmentId: string; access: SecretAccess }[]).map(
      ({ environmentId, access }) => ({ environmentId, access }),
    );
    return respond(
      c,
      await orgStore(c.env, orgId).noteSecretAccess(member, team(c), project(c), list, clientIp(c)),
    );
  }),
);

projects.post(
  "/projects/:projectId/secrets/delete",
  asMember(async (c, member, orgId) => {
    const { ids } = await readJson(c);
    if (
      !Array.isArray(ids) ||
      ids.length === 0 ||
      ids.length > MAX_BATCH * 2 ||
      !ids.every(isUuid)
    ) {
      return invalidSecret(c);
    }
    return respond(
      c,
      await orgStore(c.env, orgId).deleteSecrets(member, team(c), project(c), ids, clientIp(c)),
    );
  }),
);

projects.delete(
  "/projects/:projectId/secrets/:secretId",
  asMember(async (c, member, orgId) =>
    respond(
      c,
      await orgStore(c.env, orgId).deleteSecrets(
        member,
        team(c),
        project(c),
        [param(c, "secretId")],
        clientIp(c),
      ),
    ),
  ),
);

projects.get(
  "/projects/:projectId/secrets/:secretId/versions",
  asMember(async (c, member, orgId) => {
    const secretId = param(c, "secretId");
    if (!isUuid(secretId)) return invalidSecret(c);
    return respond(
      c,
      await orgStore(c.env, orgId).secretVersions(
        member,
        team(c),
        project(c),
        secretId,
        clientIp(c),
      ),
    );
  }),
);

projects.get(
  "/projects/:projectId/links",
  asMember(async (c, member, orgId) =>
    respond(c, await orgStore(c.env, orgId).listLinks(member, team(c), project(c))),
  ),
);

projects.post(
  "/projects/:projectId/links",
  asMember(async (c, member, orgId) => {
    const body = await readJson(c);
    const branch = body.branch ?? null;
    const githubEnvironment = body.githubEnvironment ?? null;
    if (
      !isUuid(body.id) ||
      !isEnvironmentId(body.environmentId) ||
      !isRepository(body.repository) ||
      (branch !== null && !isBranch(branch)) ||
      (githubEnvironment !== null && !isGithubEnvironment(githubEnvironment)) ||
      (branch === null && githubEnvironment === null) ||
      !isPublicKey(body.publicKey) ||
      !isWrappedKey(body.wrappedKey) ||
      !isGeneration(body.generation)
    ) {
      return c.json(apiError("orgs.invalid_link"), 400);
    }
    const link = {
      id: body.id,
      environmentId: body.environmentId,
      repository: body.repository,
      branch,
      githubEnvironment,
      publicKey: body.publicKey,
      wrappedKey: body.wrappedKey,
      generation: body.generation,
    };
    return respond(
      c,
      await orgStore(c.env, orgId).createLink(member, team(c), project(c), link, clientIp(c)),
      201,
    );
  }),
);

projects.delete(
  "/projects/:projectId/links/:linkId",
  asMember(async (c, member, orgId) =>
    respond(
      c,
      await orgStore(c.env, orgId).deleteLink(
        member,
        team(c),
        project(c),
        param(c, "linkId"),
        clientIp(c),
      ),
    ),
  ),
);

projects.get(
  "/vault",
  asMember(async (c, member, orgId) =>
    respond(c, await orgStore(c.env, orgId).teamVault(member, team(c), clientIp(c))),
  ),
);

projects.put(
  "/items/:itemId",
  asMember(async (c, member, orgId) => {
    const itemId = param(c, "itemId");
    const { sealed, generation } = await readJson(c);
    if (!isUuid(itemId) || !isSealedTeamItem(sealed) || !isGeneration(generation)) {
      return c.json(apiError("orgs.invalid_item"), 400);
    }
    return respond(
      c,
      await orgStore(c.env, orgId).putTeamItem(
        member,
        team(c),
        { id: itemId, sealed, generation },
        clientIp(c),
      ),
    );
  }),
);

projects.delete(
  "/items/:itemId",
  asMember(async (c, member, orgId) =>
    respond(
      c,
      await orgStore(c.env, orgId).deleteTeamItem(member, team(c), param(c, "itemId"), clientIp(c)),
    ),
  ),
);

export default projects;
