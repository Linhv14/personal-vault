import type { MessageKey } from "../../src/i18n/index.js";
import type { OrgRole } from "../lib/orgs.js";

export const ROLE_LABEL: Record<OrgRole, MessageKey> = {
  owner: "orgs.role_owner",
  admin: "orgs.role_admin",
  member: "orgs.role_member",
};

export const ACTION_LABEL: Record<string, MessageKey> = {
  "org.created": "orgs.audit_org_created",
  "member.invited": "orgs.audit_member_invited",
  "member.joined": "orgs.audit_member_joined",
  "member.removed": "orgs.audit_member_removed",
  "member.role_changed": "orgs.audit_member_role_changed",
  "team.created": "orgs.audit_team_created",
  "team.member_added": "orgs.audit_team_member_added",
  "team.member_removed": "orgs.audit_team_member_removed",
  "team.deleted": "orgs.audit_team_deleted",
  "team.rekeyed": "orgs.audit_team_rekeyed",
  "org.owner_transferred": "orgs.audit_owner_transferred",
  "project.created": "orgs.audit_project_created",
  "project.updated": "orgs.audit_project_updated",
  "project.deleted": "orgs.audit_project_deleted",
  "secret.written": "orgs.audit_secret_written",
  "secret.deleted": "orgs.audit_secret_deleted",
  "secrets.read": "orgs.audit_secrets_read",
  "team.vault_read": "orgs.audit_team_vault_read",
};
