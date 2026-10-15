import { fromBase64, randomBytes, toBase64, toBase64Url, utf8Encode, type Bytes } from "./bytes.js";
import { importVaultKey, openJson, sealJson, type SealedData } from "./crypto.js";

export const MAX_SECRETS_PER_PROJECT = 1000;
export const MAX_SECRET_BYTES = 32 * 1024;
export const MAX_PROJECT_BYTES = 8 * 1024;
export const MAX_ENVIRONMENTS = 10;

const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;
const ENVIRONMENT_ID = /^[A-Za-z0-9_-]{6,32}$/;

export interface Environment {
  id: string;
  name: string;
}

export interface ProjectContent {
  name: string;
  environments: Environment[];
  key: string;
}

export type SecretKind = "secret" | "variable";

export interface SecretContent {
  name: string;
  value: string;
  note?: string;
  kind?: SecretKind;
}

export const SECRET_ACCESS = ["revealed", "copied", "exported"] as const;
export type SecretAccess = (typeof SECRET_ACCESS)[number];

export function isVariable(secret: SecretContent): boolean {
  return secret.kind === "variable";
}

export interface SecretAddress {
  projectId: string;
  generation: number;
  environmentId: string;
  secretId: string;
}

export function isSecretName(value: string): boolean {
  return SECRET_NAME.test(value);
}

export function isEnvironmentId(value: unknown): value is string {
  return typeof value === "string" && ENVIRONMENT_ID.test(value);
}

export function newEnvironment(name: string): Environment {
  return { id: toBase64Url(randomBytes(9)), name };
}

export function defaultEnvironments(): Environment[] {
  return ["Development", "Staging", "Production"].map(newEnvironment);
}

export function newProject(name: string): ProjectContent {
  return { name, environments: defaultEnvironments(), key: toBase64(randomBytes(32)) };
}

function projectContext(projectId: string, generation: number): Bytes {
  return utf8Encode(`personal-vault/project/${projectId}/${generation}`);
}

function secretContext(address: SecretAddress): Bytes {
  const { projectId, generation, environmentId, secretId } = address;
  return utf8Encode(
    `personal-vault/secret/${projectId}/${generation}/${environmentId}/${secretId}`,
  );
}

export async function sealProject(
  teamKey: Bytes,
  projectId: string,
  generation: number,
  content: ProjectContent,
): Promise<SealedData> {
  return sealJson(await importVaultKey(teamKey), content, projectContext(projectId, generation));
}

export async function openProject(
  teamKey: Bytes,
  projectId: string,
  generation: number,
  sealed: SealedData,
): Promise<ProjectContent> {
  return openJson(await importVaultKey(teamKey), sealed, projectContext(projectId, generation));
}

export async function sealSecret(
  project: ProjectContent,
  address: SecretAddress,
  content: SecretContent,
): Promise<SealedData> {
  return sealJson(await importVaultKey(fromBase64(project.key)), content, secretContext(address));
}

export async function openSecret(
  project: ProjectContent,
  address: SecretAddress,
  sealed: SealedData,
): Promise<SecretContent> {
  return openJson(await importVaultKey(fromBase64(project.key)), sealed, secretContext(address));
}

export function parseDotenv(text: string): SecretContent[] {
  const entries = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([^=\s]+)\s*=\s*(.*)$/.exec(line);
    if (!match || !isSecretName(match[1]!)) continue;
    entries.set(match[1]!, unquote(match[2]!));
  }
  return [...entries].map(([name, value]) => ({ name, value }));
}

function unquote(value: string): string {
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) {
    const inner = value.slice(1, -1);
    return quote === '"' ? inner.replace(/\\n/g, "\n").replace(/\\(["\\])/g, "$1") : inner;
  }
  return value.replace(/\s+#.*$/, "");
}

export function formatDotenv(secrets: SecretContent[]): string {
  return secrets
    .map(({ name, value }) => {
      const plain = /^[A-Za-z0-9_./:@+-]*$/.test(value);
      const quoted = `"${value.replace(/(["\\])/g, "\\$1").replace(/\n/g, "\\n")}"`;
      return `${name}=${plain ? value : quoted}`;
    })
    .join("\n")
    .concat(secrets.length > 0 ? "\n" : "");
}
