import { DurableObject } from "cloudflare:workers";
import type { AuditEvent, Principal } from "#core/org-model.js";
import { fail, ok, type Result } from "../result.js";
import { dumpStore, restoreStore, type StoreDump } from "../migration.js";
import type { StoreEnv } from "../store-env.js";
import { AuditLog } from "./audit.js";
import { confirmedAdmin, type OrgContext } from "./context.js";
import { ItemTables } from "./item-tables.js";
import * as items from "./items.js";
import { LinkTables } from "./link-tables.js";
import * as links from "./links.js";
import * as members from "./members.js";
import { ProjectTables } from "./project-tables.js";
import * as projects from "./projects.js";
import { createOrgSchema } from "./schema.js";
import * as secrets from "./secrets.js";
import { TeamTables } from "./team-tables.js";
import * as teams from "./teams.js";

type Args<F> = F extends (org: OrgContext, ...args: infer A) => unknown ? A : never;

export class OrgStore extends DurableObject<StoreEnv> {
  private readonly org: OrgContext;

  constructor(ctx: DurableObjectState, env: StoreEnv) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    createOrgSchema(sql);
    this.org = {
      storage: ctx.storage,
      projects: new ProjectTables(sql),
      links: new LinkTables(sql),
      items: new ItemTables(sql),
      teams: new TeamTables(sql),
      audit: new AuditLog(sql),
    };
  }

  setMember(...args: Args<typeof members.setMember>) {
    return members.setMember(this.org, ...args);
  }

  removeMember(...args: Args<typeof members.removeMember>) {
    return members.removeMember(this.org, ...args);
  }

  async note(actor: string, action: string, target: string | null, ip: string | null) {
    await this.org.audit.record(actor, action, target, ip);
  }

  planInvite(...args: Args<typeof members.planInvite>) {
    return members.planInvite(this.org, ...args);
  }

  async forgetInvite(email: string): Promise<void> {
    this.org.teams.forgetInvites(email);
  }

  claimInvite(...args: Args<typeof members.claimInvite>) {
    return members.claimInvite(this.org, ...args);
  }

  transferOwnership(...args: Args<typeof members.transferOwnership>) {
    return members.transferOwnership(this.org, ...args);
  }

  listTeams(...args: Args<typeof teams.listTeams>) {
    return teams.listTeams(this.org, ...args);
  }

  overview(...args: Args<typeof projects.overview>) {
    return projects.overview(this.org, ...args);
  }

  createTeam(...args: Args<typeof teams.createTeam>) {
    return teams.createTeam(this.org, ...args);
  }

  addTeamMember(...args: Args<typeof teams.addTeamMember>) {
    return teams.addTeamMember(this.org, ...args);
  }

  removeTeamMember(...args: Args<typeof teams.removeTeamMember>) {
    return teams.removeTeamMember(this.org, ...args);
  }

  rekeyTeam(...args: Args<typeof teams.rekeyTeam>) {
    return teams.rekeyTeam(this.org, ...args);
  }

  setTeamAccess(...args: Args<typeof teams.setTeamAccess>) {
    return teams.setTeamAccess(this.org, ...args);
  }

  deleteTeam(...args: Args<typeof teams.deleteTeam>) {
    return teams.deleteTeam(this.org, ...args);
  }

  protectEnvironment(...args: Args<typeof projects.protectEnvironment>) {
    return projects.protectEnvironment(this.org, ...args);
  }

  listProjects(...args: Args<typeof projects.listProjects>) {
    return projects.listProjects(this.org, ...args);
  }

  createProject(...args: Args<typeof projects.createProject>) {
    return projects.createProject(this.org, ...args);
  }

  updateProject(...args: Args<typeof projects.updateProject>) {
    return projects.updateProject(this.org, ...args);
  }

  deleteProject(...args: Args<typeof projects.deleteProject>) {
    return projects.deleteProject(this.org, ...args);
  }

  noteSecretAccess(...args: Args<typeof secrets.noteSecretAccess>) {
    return secrets.noteSecretAccess(this.org, ...args);
  }

  readSecrets(...args: Args<typeof secrets.readSecrets>) {
    return secrets.readSecrets(this.org, ...args);
  }

  secretVersions(...args: Args<typeof secrets.secretVersions>) {
    return secrets.secretVersions(this.org, ...args);
  }

  writeSecrets(...args: Args<typeof secrets.writeSecrets>) {
    return secrets.writeSecrets(this.org, ...args);
  }

  deleteSecrets(...args: Args<typeof secrets.deleteSecrets>) {
    return secrets.deleteSecrets(this.org, ...args);
  }

  listLinks(...args: Args<typeof links.listLinks>) {
    return links.listLinks(this.org, ...args);
  }

  createLink(...args: Args<typeof links.createLink>) {
    return links.createLink(this.org, ...args);
  }

  deleteLink(...args: Args<typeof links.deleteLink>) {
    return links.deleteLink(this.org, ...args);
  }

  ciRead(...args: Args<typeof links.ciRead>) {
    return links.ciRead(this.org, ...args);
  }

  teamVault(...args: Args<typeof items.teamVault>) {
    return items.teamVault(this.org, ...args);
  }

  sharedVaults(...args: Args<typeof items.sharedVaults>) {
    return items.sharedVaults(this.org, ...args);
  }

  putTeamItem(...args: Args<typeof items.putTeamItem>) {
    return items.putTeamItem(this.org, ...args);
  }

  deleteTeamItem(...args: Args<typeof items.deleteTeamItem>) {
    return items.deleteTeamItem(this.org, ...args);
  }

  async audit(
    principal: Principal,
    before?: number,
  ): Promise<Result<{ events: AuditEvent[]; verified: boolean }>> {
    if (!confirmedAdmin(this.org, principal)) {
      return fail(403, "orgs.forbidden");
    }
    const events = this.org.audit.page(before);
    return ok({ events, verified: await this.org.audit.verify(events) });
  }

  async exportState(): Promise<StoreDump> {
    return dumpStore(this.ctx.storage.sql);
  }

  async importState(dump: StoreDump): Promise<number> {
    return restoreStore(this.ctx.storage, dump);
  }
}
