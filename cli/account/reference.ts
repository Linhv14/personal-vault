import type { SecretContent } from "#core/projects.js";
import { AgentError } from "../agent/session.js";

export interface SecretReference {
  text: string;
  project?: string;
  environment?: string;
  name: string;
}

export interface Scope {
  project?: string;
  environment?: string;
}

const SCHEME = "7key://";
const SHORTHAND = "7key:";
const TEMPLATE = /\{\{\s*(7key:\/\/[^\s{}]+|7key:[^\s{}/]+)\s*\}\}/g;

export function parseReference(text: string): SecretReference {
  const value = text.trim();
  if (value.startsWith(SCHEME)) {
    const parts = value.slice(SCHEME.length).split("/");
    if (parts.length !== 3 || parts.some((part) => part.trim() === "")) {
      throw new AgentError(`Invalid reference "${value}": use 7key://<project>/<env>/<NAME>`);
    }
    const [project, environment, name] = parts.map((part) => part.trim()) as [
      string,
      string,
      string,
    ];
    return { text: value, project, environment, name };
  }
  const name = value.startsWith(SHORTHAND) ? value.slice(SHORTHAND.length) : value;
  if (!name || /[\s/]/.test(name)) {
    throw new AgentError(
      `Invalid reference "${value}": use a NAME or 7key://<project>/<env>/<NAME>`,
    );
  }
  return { text: value, name };
}

export function scopeKey(scope: Scope): string {
  return scope.project ? `${scope.project}\n${scope.environment ?? ""}` : "";
}

export function templateReferences(template: string): SecretReference[] {
  return [...template.matchAll(TEMPLATE)].map((match) => parseReference(match[1]!));
}

export interface Injected<T> {
  text: string;
  count: number;
  missing: string[];
  loaded: T[];
}

export async function injectTemplate<T extends { secrets: SecretContent[] }>(
  template: string,
  load: (scope: Scope) => Promise<T>,
): Promise<Injected<T>> {
  const references = templateReferences(template);
  const scopes = new Map<string, Promise<T | Error>>();
  for (const reference of references) {
    const key = scopeKey(reference);
    if (!scopes.has(key)) {
      const scope = { project: reference.project, environment: reference.environment };
      scopes.set(
        key,
        load(scope).catch((error: unknown) => {
          if (error instanceof AgentError) {
            return error;
          }
          throw error;
        }),
      );
    }
  }
  const results = new Map<string, T | Error>();
  for (const [key, pending] of scopes) {
    results.set(key, await pending);
  }

  const missing = new Set<string>();
  const values = new Map<string, string>();
  for (const reference of references) {
    const result = results.get(scopeKey(reference))!;
    if (result instanceof Error) {
      missing.add(`${reference.text} (${result.message})`);
      continue;
    }
    const secret = result.secrets.find((entry) => entry.name === reference.name);
    if (secret) {
      values.set(reference.text, secret.value);
    } else {
      missing.add(reference.text);
    }
  }

  let count = 0;
  const text = missing.size
    ? template
    : template.replace(TEMPLATE, (_match, raw: string) => {
        count++;
        return values.get(parseReference(raw).text)!;
      });
  const loaded = [...results.values()].filter((result): result is T => !(result instanceof Error));
  return { text, count, missing: [...missing], loaded };
}
