import { Hono } from "hono";
import { isEnvironmentId, SECRET_ACCESS, type SecretAccess } from "../../core/projects.js";
import { apiError } from "../errors.js";
import { readJson, respond } from "../http.js";
import { clientIp } from "../request.js";
import { orgStore } from "../stores.js";
import type { AppBindings } from "../types.js";
import { isSealedProject, isSealedSecret, isUuid } from "../validate.js";
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
    const { environmentId, access } = await readJson(c);
    if (!isEnvironmentId(environmentId) || !SECRET_ACCESS.includes(access as SecretAccess)) {
      return invalidSecret(c);
    }
    return respond(
      c,
      await orgStore(c.env, orgId).noteSecretAccess(
        member,
        team(c),
        project(c),
        environmentId,
        access as SecretAccess,
        clientIp(c),
      ),
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
  "/vault",
  asMember(async (c, member, orgId) =>
    respond(c, await orgStore(c.env, orgId).teamVault(member, team(c), clientIp(c))),
  ),
);

export default projects;
