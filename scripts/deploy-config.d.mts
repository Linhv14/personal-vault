export interface DeployOptions {
  registrationMode: "token" | "open";
  customDomain: string | null;
  emailFrom: string | null;
  emailProvider: "resend" | "cloudflare";
}

export const DEFAULT_DEPLOY_OPTIONS: Readonly<DeployOptions>;

export function parseDeployFlags(argv: readonly string[]): Partial<DeployOptions>;

export function resolveDeployOptions(
  saved?: Record<string, unknown>,
  flags?: Partial<DeployOptions>,
): DeployOptions;

export function requiredSecrets(options: DeployOptions): string[];

export function renderConfig(
  template: string,
  input: { accountId: string; databaseId: string; options: DeployOptions },
): string;
