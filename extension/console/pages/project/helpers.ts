import { suggestHosts } from "#core/agent-hosts.js";
import { handleOf, isVariable, type Environment } from "#core/projects.js";
import type { Project, Secret } from "#ext/lib/projects.js";

export const CI_TAB = "ci";

export type Modal =
  | { kind: "add" }
  | { kind: "import" }
  | { kind: "rename" }
  | { kind: "add-env" }
  | { kind: "rename-env" }
  | { kind: "delete-env" }
  | { kind: "delete-project" }
  | { kind: "delete-secret"; secret: Secret }
  | { kind: "history"; secret: Secret }
  | { kind: "remove-duplicates" }
  | null;

export type SecretsByEnvironment = Record<string, Secret[]>;

export function withHosts(secret: Secret, hosts: string[]) {
  return {
    id: secret.id,
    environmentId: secret.environmentId,
    name: secret.name,
    value: secret.value,
    kind: secret.kind,
    note: secret.note,
    hosts,
  };
}

export function findDuplicates(
  secrets: SecretsByEnvironment | null,
  writable: (envId: string) => boolean,
): Secret[] {
  return Object.values(secrets ?? {}).flatMap((list) =>
    [...list]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .filter((secret, index, sorted) => sorted.findIndex((x) => x.name === secret.name) !== index)
      .filter((secret) => writable(secret.environmentId)),
  );
}

export interface HostSuggestion {
  secret: Secret;
  hosts: string[];
}

export function hostSuggestions(
  all: Secret[],
  writable: (envId: string) => boolean,
): HostSuggestion[] {
  return all
    .filter(
      (secret) =>
        writable(secret.environmentId) &&
        !isVariable(secret) &&
        !secret.hosts?.length &&
        secret.value,
    )
    .map((secret) => ({ secret, hosts: suggestHosts(secret.name, secret.value) }))
    .filter((entry) => entry.hosts.length > 0);
}

export function uniqueByName(suggested: HostSuggestion[]): HostSuggestion[] {
  return [...new Map(suggested.map((entry) => [entry.secret.name, entry])).values()];
}

export function secretNames(all: Secret[]): string[] {
  return [...new Set(all.map((secret) => secret.name))].sort();
}

export function missingCounts(
  environments: Environment[],
  names: string[],
  secrets: SecretsByEnvironment | null,
): { env: Environment; count: number }[] {
  return environments.map((env) => ({
    env,
    count: names.filter((name) => !secrets?.[env.id]?.some((secret) => secret.name === name))
      .length,
  }));
}

export function cliCommand(project: Project, environment: Environment | undefined): string {
  return `7key run --project ${handleOf(project.content.name)} --env ${handleOf(
    environment?.name ?? "development",
  )} -- `;
}

export function matchingNames(names: string[], query: string): string[] {
  return names.filter((name) => name.toLowerCase().includes(query.trim().toLowerCase()));
}
