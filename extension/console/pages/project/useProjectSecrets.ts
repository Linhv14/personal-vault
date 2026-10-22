import { useEffect, useState } from "preact/hooks";
import { describeError, type MessageKey } from "#i18n/index.js";
import { listSecrets, upgradeLegacySecrets, type Project } from "#ext/lib/projects.js";
import type { Team } from "#ext/lib/orgs.js";
import { useT } from "#ext/ui/i18n.js";
import { attempt, toast } from "#ext/console/data.js";
import type { SecretsByEnvironment } from "./helpers.js";

export type Mutate = (
  work: () => Promise<unknown>,
  done: MessageKey,
  ids?: string[],
) => Promise<boolean>;

export function useProjectSecrets({
  orgId,
  project,
  team,
  reload,
}: {
  orgId: string;
  project: Project | undefined;
  team: (teamId: string) => Team | undefined;
  reload: () => Promise<void>;
}) {
  const t = useT();
  const [secrets, setSecrets] = useState<SecretsByEnvironment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());

  const load = async () => {
    if (!project) {
      return;
    }
    try {
      const lists = await Promise.all(
        project.content.environments.map(async (env) => [
          env.id,
          await listSecrets(orgId, project, env.id),
        ]),
      );
      const byEnvironment = Object.fromEntries(lists) as SecretsByEnvironment;
      setSecrets(byEnvironment);
      const owner = team(project.teamId);
      if (owner && !owner.rekeyNeeded) {
        const upgraded = await upgradeLegacySecrets(
          orgId,
          project,
          Object.values(byEnvironment).flat(),
        );
        if (upgraded > 0) {
          await load();
        }
      }
    } catch (failure) {
      setError(describeError(failure, t));
    }
  };

  useEffect(() => {
    void load();
  }, [project?.id, project?.generation, project?.content.environments.map((env) => env.id).join()]);

  const mutate: Mutate = async (work, done, ids = []) => {
    setError(null);
    const mark = (on: boolean) =>
      setBusyIds((current) => {
        const next = new Set(current);
        for (const id of ids) {
          if (on) {
            next.add(id);
          } else {
            next.delete(id);
          }
        }
        return next;
      });
    mark(true);
    const succeeded = await attempt(
      async () => {
        await work();
        toast(t(done));
        await load();
      },
      (failure) => describeError(failure, t),
    );
    if (!succeeded) {
      await load();
    }
    mark(false);
    void reload();
    return succeeded;
  };

  return { secrets, setSecrets, error, busyIds, mutate };
}
