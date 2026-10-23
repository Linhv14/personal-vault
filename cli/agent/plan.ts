import { isVariable, type SecretContent } from "#core/projects.js";
import { MIN_SECRET_LENGTH, newPlaceholder, type Injectable } from "./substitute.js";

export interface Plan {
  injectables: Injectable[];
  variables: SecretContent[];
  skipped: string[];
  tooShort: string[];
}

export function plan(secrets: readonly SecretContent[]): Plan {
  const injectables: Injectable[] = [];
  const variables: SecretContent[] = [];
  const skipped: string[] = [];
  const tooShort: string[] = [];
  for (const secret of secrets) {
    if (isVariable(secret)) {
      variables.push(secret);
    } else if (!secret.hosts || secret.hosts.length === 0) {
      skipped.push(secret.name);
    } else if (secret.value.length < MIN_SECRET_LENGTH) {
      tooShort.push(secret.name);
    } else {
      injectables.push({
        name: secret.name,
        value: secret.value,
        hosts: secret.hosts,
        placeholder: newPlaceholder(),
      });
    }
  }
  return { injectables, variables, skipped, tooShort };
}

export function describe(selected: Plan): string[] {
  const width = Math.max(4, ...selected.injectables.map((entry) => entry.name.length));
  const lines = selected.injectables.map(
    (entry) => `  ${entry.name.padEnd(width)}  → ${entry.hosts.join(", ")}`,
  );
  if (selected.variables.length > 0) {
    lines.push(`  variables: ${selected.variables.map((entry) => entry.name).join(", ")}`);
  }
  if (selected.skipped.length > 0) {
    lines.push(
      `  not available (no allowed hosts, set them in the console): ${selected.skipped.join(", ")}`,
    );
  }
  if (selected.tooShort.length > 0) {
    lines.push(
      `  not available (shorter than ${MIN_SECRET_LENGTH} characters): ${selected.tooShort.join(", ")}`,
    );
  }
  return lines;
}
