import { saveSecrets, type Project, type Secret } from "#ext/lib/projects.js";
import { hostSuggestions, uniqueByName, withHosts } from "./helpers.js";
import type { Mutate } from "./useProjectSecrets.js";

export function useHostSuggestions({
  orgId,
  project,
  all,
  writable,
  mutate,
}: {
  orgId: string;
  project: Project;
  all: Secret[];
  writable: (envId: string) => boolean;
  mutate: Mutate;
}) {
  const suggested = hostSuggestions(all, writable);
  const suggestedNames = uniqueByName(suggested);
  const applySuggestions = () =>
    void mutate(
      () =>
        saveSecrets(
          orgId,
          project,
          suggested.map((entry) => withHosts(entry.secret, entry.hosts)),
        ),
      "console.agent_hosts_applied",
      suggested.map((entry) => entry.secret.id),
    );
  return { suggestedNames, applySuggestions };
}
