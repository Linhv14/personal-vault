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
  hosts?: string[];
}

export const SECRET_ACCESS = ["revealed", "copied", "exported", "injected"] as const;
export type SecretAccess = (typeof SECRET_ACCESS)[number];

export function isVariable(secret: SecretContent): boolean {
  return secret.kind === "variable";
}

export const MAX_SECRET_HOSTS = 10;
const HOST_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

const SHARED_SUFFIXES = [
  "amazonaws.com",
  "appspot.com",
  "azurewebsites.net",
  "azurestaticapps.net",
  "blogspot.com",
  "cloudfront.net",
  "firebaseapp.com",
  "fly.dev",
  "github.io",
  "githubusercontent.com",
  "gitlab.io",
  "glitch.me",
  "herokuapp.com",
  "netlify.app",
  "ngrok-free.app",
  "ngrok.io",
  "onrender.com",
  "pages.dev",
  "repl.co",
  "surge.sh",
  "vercel.app",
  "web.app",
  "workers.dev",
];
const SECOND_LEVEL = new Set(["ac", "co", "com", "edu", "gov", "net", "org"]);

function sharedBase(base: string): boolean {
  const labels = base.split(".");
  if (labels.length === 2 && labels[1]!.length === 2 && SECOND_LEVEL.has(labels[0]!)) return true;
  return SHARED_SUFFIXES.some((suffix) => base === suffix || base.endsWith(`.${suffix}`));
}

export function normalizeHost(value: string): string | null {
  const host = value.trim().toLowerCase().replace(/\.$/, "");
  const wildcard = host.startsWith("*.");
  const base = wildcard ? host.slice(2) : host;
  const labels = base.split(".");
  if (labels.length < 2 || host.length > 253) return null;
  if (!labels.every((label) => HOST_LABEL.test(label))) return null;
  if (/^\d+$/.test(labels.at(-1) ?? "")) return null;
  if (wildcard && sharedBase(base)) return null;
  return host;
}

export function parseHosts(text: string): string[] | null {
  const entries = [...new Set(text.split(/[\s,]+/).filter(Boolean))];
  const hosts = entries.map(normalizeHost);
  if (hosts.length > MAX_SECRET_HOSTS || hosts.some((host) => host === null)) return null;
  return hosts as string[];
}

export function hostAllowed(hosts: readonly string[] | undefined, hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return (hosts ?? []).some((entry) =>
    entry.startsWith("*.")
      ? host.endsWith(entry.slice(1)) && host !== entry.slice(2)
      : host === entry,
  );
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

export async function environmentKey(
  project: ProjectContent,
  projectId: string,
  environmentId: string,
): Promise<Bytes> {
  const base = await crypto.subtle.importKey("raw", fromBase64(project.key), "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: utf8Encode(`personal-vault/environment-key/${projectId}/${environmentId}`),
    },
    base,
    256,
  );
  return new Uint8Array(bits);
}

export async function sealWithEnvironmentKey(
  key: Bytes,
  address: SecretAddress,
  content: SecretContent,
): Promise<SealedData> {
  return sealJson(await importVaultKey(key), content, secretContext(address));
}

export async function openWithEnvironmentKey(
  key: Bytes,
  address: SecretAddress,
  sealed: SealedData,
): Promise<SecretContent> {
  return openJson(await importVaultKey(key), sealed, secretContext(address));
}

export async function sealSecret(
  project: ProjectContent,
  address: SecretAddress,
  content: SecretContent,
): Promise<SealedData> {
  const key = await environmentKey(project, address.projectId, address.environmentId);
  return sealWithEnvironmentKey(key, address, content);
}

export async function openSecretWithOrigin(
  project: ProjectContent,
  address: SecretAddress,
  sealed: SealedData,
): Promise<{ content: SecretContent; legacy: boolean }> {
  const key = await environmentKey(project, address.projectId, address.environmentId);
  try {
    return { content: await openWithEnvironmentKey(key, address, sealed), legacy: false };
  } catch {
    const legacy = await importVaultKey(fromBase64(project.key));
    return { content: await openJson(legacy, sealed, secretContext(address)), legacy: true };
  }
}

export async function openSecret(
  project: ProjectContent,
  address: SecretAddress,
  sealed: SealedData,
): Promise<SecretContent> {
  return (await openSecretWithOrigin(project, address, sealed)).content;
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

export function handleOf(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function refersTo(wanted: string, entry: { id: string; name: string }): boolean {
  const value = wanted.trim();
  if (value === entry.id) return true;
  const handle = handleOf(value);
  return handle !== "" && handle === handleOf(entry.name);
}
