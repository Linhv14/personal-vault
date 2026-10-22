import { now } from "#worker/clock.js";
import type { DecryptionOption } from "#commercial/core/sso-model.js";

export interface SsoConfig {
  orgId: string;
  identifier: string | null;
  issuer: string | null;
  clientId: string | null;
  clientSecret: string | null;
  enabled: boolean;
  decryption: DecryptionOption;
  requireSso: boolean;
  singleOrg: boolean;
}

export interface SsoDomain {
  domain: string;
  token: string;
  createdAt: number;
  checkedAt: number | null;
  verifiedAt: number | null;
}

export interface SsoState {
  orgId: string;
  codeVerifier: string;
  nonce: string;
  clientChallenge: string;
  returnTo: string;
  linkAccountId: string | null;
}

export interface SsoLink {
  issuer: string;
  subject: string;
  linkedAt: number;
}

export interface SsoGrant {
  orgId: string;
  email: string;
  clientChallenge: string | null;
}

interface ConfigRow {
  org_id: string;
  identifier: string | null;
  issuer: string | null;
  client_id: string | null;
  client_secret: string | null;
  enabled: number;
  decryption: string;
  require_sso: number;
  single_org: number;
}

const CONFIG_COLUMNS =
  "org_id, identifier, issuer, client_id, client_secret, enabled, decryption, require_sso, single_org";

function toConfig(row: ConfigRow): SsoConfig {
  return {
    orgId: row.org_id,
    identifier: row.identifier,
    issuer: row.issuer,
    clientId: row.client_id,
    clientSecret: row.client_secret,
    enabled: row.enabled === 1,
    decryption: "master_password",
    requireSso: row.require_sso === 1,
    singleOrg: row.single_org === 1,
  };
}

export class SsoStore {
  constructor(private readonly db: D1Database) {}

  async config(orgId: string): Promise<SsoConfig | null> {
    const row = await this.db
      .prepare(`SELECT ${CONFIG_COLUMNS} FROM sso_configs WHERE org_id = ?`)
      .bind(orgId)
      .first<ConfigRow>();
    return row ? toConfig(row) : null;
  }

  async configByIdentifier(identifier: string): Promise<SsoConfig | null> {
    const row = await this.db
      .prepare(`SELECT ${CONFIG_COLUMNS} FROM sso_configs WHERE identifier = ?`)
      .bind(identifier)
      .first<ConfigRow>();
    return row ? toConfig(row) : null;
  }

  async orgOfVerifiedDomain(domain: string): Promise<string | null> {
    const row = await this.db
      .prepare("SELECT org_id FROM sso_domains WHERE domain = ? AND verified_at IS NOT NULL")
      .bind(domain)
      .first<{ org_id: string }>();
    return row?.org_id ?? null;
  }

  private async ensureConfig(orgId: string): Promise<void> {
    await this.db
      .prepare(
        "INSERT INTO sso_configs (org_id, updated_at) VALUES (?, ?) ON CONFLICT(org_id) DO NOTHING",
      )
      .bind(orgId, now())
      .run();
  }

  async setIdentifier(orgId: string, identifier: string): Promise<"ok" | "taken"> {
    await this.ensureConfig(orgId);
    try {
      await this.db
        .prepare("UPDATE sso_configs SET identifier = ?, updated_at = ? WHERE org_id = ?")
        .bind(identifier, now(), orgId)
        .run();
      return "ok";
    } catch (error) {
      if (String(error).includes("UNIQUE")) {
        return "taken";
      }
      throw error;
    }
  }

  async setProvider(
    orgId: string,
    provider: {
      issuer: string;
      clientId: string;
      clientSecret: string | null;
      enabled: boolean;
      decryption: DecryptionOption;
    },
  ): Promise<void> {
    await this.ensureConfig(orgId);
    await this.db
      .prepare(
        `UPDATE sso_configs SET issuer = ?, client_id = ?, client_secret = COALESCE(?, client_secret),
           enabled = ?, decryption = ?, require_sso = CASE WHEN ? = 1 THEN require_sso ELSE 0 END,
           updated_at = ?
         WHERE org_id = ?`,
      )
      .bind(
        provider.issuer,
        provider.clientId,
        provider.clientSecret,
        provider.enabled ? 1 : 0,
        provider.decryption,
        provider.enabled ? 1 : 0,
        now(),
        orgId,
      )
      .run();
    await this.db
      .prepare("DELETE FROM sso_links WHERE org_id = ? AND issuer != ?")
      .bind(orgId, provider.issuer)
      .run();
  }

  async setPolicies(
    orgId: string,
    policies: { requireSso: boolean; singleOrg: boolean },
  ): Promise<void> {
    await this.ensureConfig(orgId);
    await this.db
      .prepare(
        "UPDATE sso_configs SET require_sso = ?, single_org = ?, updated_at = ? WHERE org_id = ?",
      )
      .bind(policies.requireSso ? 1 : 0, policies.singleOrg ? 1 : 0, now(), orgId)
      .run();
  }

  async domains(orgId: string): Promise<SsoDomain[]> {
    const { results } = await this.db
      .prepare(
        `SELECT domain, token, created_at AS createdAt, checked_at AS checkedAt,
                verified_at AS verifiedAt
           FROM sso_domains WHERE org_id = ? ORDER BY domain`,
      )
      .bind(orgId)
      .all<SsoDomain>();
    return results;
  }

  async addDomain(orgId: string, domain: string, token: string): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO sso_domains (org_id, domain, token, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(org_id, domain) DO NOTHING`,
      )
      .bind(orgId, domain, token, now())
      .run();
  }

  async markChecked(orgId: string, domain: string, verified: boolean): Promise<"ok" | "taken"> {
    const at = now();
    try {
      await this.db
        .prepare(
          `UPDATE sso_domains SET checked_at = ?1,
             verified_at = CASE WHEN ?2 = 1 THEN COALESCE(verified_at, ?1) ELSE verified_at END
           WHERE org_id = ?3 AND domain = ?4`,
        )
        .bind(at, verified ? 1 : 0, orgId, domain)
        .run();
      return "ok";
    } catch (error) {
      if (String(error).includes("UNIQUE")) {
        return "taken";
      }
      throw error;
    }
  }

  async removeDomain(orgId: string, domain: string): Promise<boolean> {
    const result = await this.db
      .prepare("DELETE FROM sso_domains WHERE org_id = ? AND domain = ?")
      .bind(orgId, domain)
      .run();
    return result.meta.changes > 0;
  }

  async verifiedDomainOf(orgId: string, domain: string): Promise<boolean> {
    const row = await this.db
      .prepare(
        "SELECT 1 AS found FROM sso_domains WHERE org_id = ? AND domain = ? AND verified_at IS NOT NULL",
      )
      .bind(orgId, domain)
      .first<{ found: number }>();
    return row !== null;
  }

  async pendingInvite(orgId: string, email: string): Promise<string | null> {
    const row = await this.db
      .prepare("SELECT id FROM org_invites WHERE org_id = ? AND email = ? AND expires_at > ?")
      .bind(orgId, email, now())
      .first<{ id: string }>();
    return row?.id ?? null;
  }

  async putState(stateHash: string, state: SsoState, ttlSeconds: number): Promise<void> {
    const at = now();
    await this.db.batch([
      this.db.prepare("DELETE FROM sso_states WHERE expires_at <= ?").bind(at),
      this.db.prepare("DELETE FROM sso_grants WHERE expires_at <= ?").bind(at),
      this.db
        .prepare(
          `INSERT INTO sso_states
             (state_hash, org_id, code_verifier, nonce, client_challenge, return_to,
              link_account_id, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          stateHash,
          state.orgId,
          state.codeVerifier,
          state.nonce,
          state.clientChallenge,
          state.returnTo,
          state.linkAccountId,
          at + ttlSeconds,
        ),
    ]);
  }

  async takeState(stateHash: string): Promise<SsoState | null> {
    const row = await this.db
      .prepare(
        `DELETE FROM sso_states WHERE state_hash = ? AND expires_at > ?
         RETURNING org_id, code_verifier, nonce, client_challenge, return_to, link_account_id`,
      )
      .bind(stateHash, now())
      .first<{
        org_id: string;
        code_verifier: string;
        nonce: string;
        client_challenge: string;
        return_to: string;
        link_account_id: string | null;
      }>();
    return row
      ? {
          orgId: row.org_id,
          codeVerifier: row.code_verifier,
          nonce: row.nonce,
          clientChallenge: row.client_challenge,
          returnTo: row.return_to,
          linkAccountId: row.link_account_id,
        }
      : null;
  }

  async putGrant(
    grantHash: string,
    purpose: "session" | "register",
    grant: SsoGrant,
    ttlSeconds: number,
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO sso_grants (grant_hash, purpose, org_id, email, client_challenge, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(grantHash, purpose, grant.orgId, grant.email, grant.clientChallenge, now() + ttlSeconds)
      .run();
  }

  async takeGrant(grantHash: string, purpose: "session" | "register"): Promise<SsoGrant | null> {
    const row = await this.db
      .prepare(
        `DELETE FROM sso_grants WHERE grant_hash = ? AND purpose = ? AND expires_at > ?
         RETURNING org_id, email, client_challenge`,
      )
      .bind(grantHash, purpose, now())
      .first<{ org_id: string; email: string; client_challenge: string | null }>();
    return row
      ? { orgId: row.org_id, email: row.email, clientChallenge: row.client_challenge }
      : null;
  }

  async orgPlan(orgId: string): Promise<{ name: string; plan: string } | null> {
    return this.db
      .prepare("SELECT name, plan FROM orgs WHERE id = ?")
      .bind(orgId)
      .first<{ name: string; plan: string }>();
  }

  async requiredSsoFor(accountId: string): Promise<{ orgId: string; identifier: string | null }[]> {
    const { results } = await this.db
      .prepare(
        `SELECT c.org_id AS orgId, c.identifier
           FROM org_members m
           JOIN sso_configs c ON c.org_id = m.org_id
           JOIN accounts a ON a.id = m.account_id
          WHERE m.account_id = ? AND m.role = 'member' AND c.require_sso = 1 AND c.enabled = 1
            AND (EXISTS (SELECT 1 FROM sso_domains d
                          WHERE d.org_id = c.org_id AND d.verified_at IS NOT NULL
                            AND d.domain = lower(substr(a.email, instr(a.email, '@') + 1)))
                 OR EXISTS (SELECT 1 FROM sso_links l
                             WHERE l.org_id = c.org_id AND l.account_id = m.account_id
                               AND l.issuer = c.issuer))`,
      )
      .bind(accountId)
      .all<{ orgId: string; identifier: string | null }>();
    return results;
  }

  async memberships(
    accountId: string,
  ): Promise<{ orgId: string; role: string; singleOrg: boolean }[]> {
    const { results } = await this.db
      .prepare(
        `SELECT m.org_id AS orgId, m.role, COALESCE(c.single_org, 0) AS singleOrg
           FROM org_members m LEFT JOIN sso_configs c ON c.org_id = m.org_id
          WHERE m.account_id = ?`,
      )
      .bind(accountId)
      .all<{ orgId: string; role: string; singleOrg: number }>();
    return results.map((row) => ({ ...row, singleOrg: row.singleOrg === 1 }));
  }

  async link(orgId: string, accountId: string): Promise<SsoLink | null> {
    return this.db
      .prepare(
        `SELECT issuer, subject, linked_at AS linkedAt FROM sso_links
          WHERE org_id = ? AND account_id = ?`,
      )
      .bind(orgId, accountId)
      .first<SsoLink>();
  }

  async linkedEmail(orgId: string, issuer: string, subject: string): Promise<string | null> {
    const row = await this.db
      .prepare(
        `SELECT a.email FROM sso_links l JOIN accounts a ON a.id = l.account_id
          WHERE l.org_id = ? AND l.issuer = ? AND l.subject = ?`,
      )
      .bind(orgId, issuer, subject)
      .first<{ email: string }>();
    return row?.email ?? null;
  }

  async hasLinkForEmail(orgId: string, issuer: string, email: string): Promise<boolean> {
    const row = await this.db
      .prepare(
        `SELECT 1 AS found FROM sso_links l JOIN accounts a ON a.id = l.account_id
          WHERE l.org_id = ? AND l.issuer = ? AND a.email = ?`,
      )
      .bind(orgId, issuer, email)
      .first<{ found: number }>();
    return row !== null;
  }

  async saveLink(
    orgId: string,
    accountId: string,
    identity: { issuer: string; subject: string },
  ): Promise<"ok" | "taken"> {
    try {
      await this.db
        .prepare(
          `INSERT INTO sso_links (org_id, account_id, issuer, subject, linked_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(org_id, account_id)
           DO UPDATE SET issuer = excluded.issuer, subject = excluded.subject,
                         linked_at = excluded.linked_at`,
        )
        .bind(orgId, accountId, identity.issuer, identity.subject, now())
        .run();
      return "ok";
    } catch (error) {
      if (String(error).includes("UNIQUE")) {
        return "taken";
      }
      throw error;
    }
  }

  async removeLink(orgId: string, accountId: string): Promise<boolean> {
    const result = await this.db
      .prepare("DELETE FROM sso_links WHERE org_id = ? AND account_id = ?")
      .bind(orgId, accountId)
      .run();
    return result.meta.changes > 0;
  }
}
