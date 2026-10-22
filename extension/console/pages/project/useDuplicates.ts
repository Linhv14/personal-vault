import { deleteSecrets, type Project } from "../../../lib/projects.js";
import { findDuplicates, type SecretsByEnvironment } from "./helpers.js";
import type { Mutate } from "./useProjectSecrets.js";

export function useDuplicates({
  orgId,
  project,
  secrets,
  writable,
  mutate,
}: {
  orgId: string;
  project: Project;
  secrets: SecretsByEnvironment | null;
  writable: (envId: string) => boolean;
  mutate: Mutate;
}) {
  const duplicates = findDuplicates(secrets, writable);
  const removeDuplicates = () =>
    void mutate(async () => {
      await deleteSecrets(
        orgId,
        project,
        duplicates.map((secret) => secret.id),
      );
    }, "console.duplicates_removed");
  return { duplicates, removeDuplicates };
}
