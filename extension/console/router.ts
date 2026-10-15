import { signal } from "@preact/signals";

export type Route =
  | { page: "projects" }
  | { page: "project"; projectId: string; environmentId: string | null }
  | { page: "teams" }
  | { page: "team"; teamId: string }
  | { page: "members" }
  | { page: "activity" }
  | { page: "settings" };

export interface Location {
  orgId: string | null;
  route: Route;
}

export function parseHash(hash: string): Location {
  const [orgId = "", page = "", id, sub] = hash.replace(/^#\/?/, "").split("/");
  const org = orgId || null;
  if (page === "projects" && id) {
    return { orgId: org, route: { page: "project", projectId: id, environmentId: sub ?? null } };
  }
  if (page === "teams" && id) return { orgId: org, route: { page: "team", teamId: id } };
  if (page === "teams" || page === "members" || page === "activity" || page === "settings") {
    return { orgId: org, route: { page } };
  }
  return { orgId: org, route: { page: "projects" } };
}

export function href(orgId: string, route: Route): string {
  switch (route.page) {
    case "project":
      return `#/${orgId}/projects/${route.projectId}${route.environmentId ? `/${route.environmentId}` : ""}`;
    case "team":
      return `#/${orgId}/teams/${route.teamId}`;
    default:
      return `#/${orgId}/${route.page}`;
  }
}

export const location$ = signal<Location>(parseHash(location.hash));

export function navigate(orgId: string, route: Route): void {
  const next = href(orgId, route);
  if (location.hash !== next) location.hash = next;
  else location$.value = parseHash(next);
}

export function watchHash(): () => void {
  const update = () => (location$.value = parseHash(location.hash));
  update();
  addEventListener("hashchange", update);
  return () => removeEventListener("hashchange", update);
}
