import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { EnvironmentRef } from "../agent/session.js";

export const LINK_FILE = ".7key.json";

export interface ProjectLink extends EnvironmentRef {
  server: string;
  org: string;
  project: string;
  environment: string;
}

export function findLink(from: string): { file: string; link: ProjectLink } | null {
  let directory = path.resolve(from);
  for (;;) {
    const file = path.join(directory, LINK_FILE);
    if (existsSync(file)) {
      try {
        return { file, link: JSON.parse(readFileSync(file, "utf8")) as ProjectLink };
      } catch {
        throw new Error(`${file} is not valid JSON; run 7key link again`);
      }
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      return null;
    }
    directory = parent;
  }
}

export function writeLink(directory: string, link: ProjectLink): string {
  const file = path.join(directory, LINK_FILE);
  writeFileSync(file, `${JSON.stringify(link, null, 2)}\n`);
  return file;
}
