import { Hono } from "hono";
import { isEnvironmentId } from "../../core/projects.js";
import { apiError } from "../errors.js";
import { readJson, respond } from "../http.js";
import { clientIp } from "../request.js";
import { orgStore } from "../stores.js";
import type { AppBindings } from "../types.js";
import { isSealedProject, isSealedSecret, isUuid } from "../validate.js";
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

projects.put(
  "/projects/:projectId/secrets/:secretId",
  asMember(async (c, member, orgId) => {
    const id = param(c, "secretId");
    const { environmentId, sealed, generation } = await readJson(c);
    if (
      !isUuid(id) ||
      !isEnvironmentId(environmentId) ||
      !isSealedSecret(sealed) ||
      !isGeneration(generation)
    ) {
      return invalidSecret(c);
    }
    return respond(
      c,
      await orgStore(c.env, orgId).writeSecret(
        member,
        team(c),
        project(c),
        { id, environmentId, sealed, generation },
        clientIp(c),
      ),
    );
  }),
);

projects.delete(
  "/projects/:projectId/secrets/:secretId",
  asMember(async (c, member, orgId) =>
    respond(
      c,
      await orgStore(c.env, orgId).deleteSecret(
        member,
        team(c),
        project(c),
        param(c, "secretId"),
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
