import type { Env } from "./types.js";

export interface ExternalRegistration {
  email: string;
  join(accountId: string, ip: string): Promise<string | null>;
}

export interface RequestScope {
  env: Env;
  url: string;
}

export interface AuthExtensions {
  passwordSignInBlock(
    scope: RequestScope,
    accountId: string,
  ): Promise<{ identifier: string } | null>;
  orgJoinBlocked(scope: RequestScope, accountId: string, orgId: string): Promise<boolean>;
  externalRegistration(scope: RequestScope, grant: string): Promise<ExternalRegistration | null>;
}

const NONE: AuthExtensions = {
  passwordSignInBlock: async () => null,
  orgJoinBlocked: async () => false,
  externalRegistration: async () => null,
};

let installed: AuthExtensions = NONE;

export function installAuthExtensions(extensions: AuthExtensions): void {
  installed = extensions;
}

export function authExtensions(): AuthExtensions {
  return installed;
}
