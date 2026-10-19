import { Hono } from "hono";
import { orgStore } from "../stores.js";
import type { AppBindings } from "../types.js";
import { directory } from "./org-access.js";

const vaults = new Hono<AppBindings>();

vaults.get("/", async (c) => {
  const accountId = c.get("session").accountId;
  const orgs = await directory(c).orgsOf(accountId);
  const shared = await Promise.all(
    orgs.map(async (org) => {
      const result = await orgStore(c.env, org.id)
        .sharedVaults({ accountId, role: org.role })
        .catch(() => null);
      return result?.ok
        ? result.value.map((vault) => ({ orgId: org.id, orgName: org.name, ...vault }))
        : [];
    }),
  );
  return c.json({ vaults: shared.flat() });
});

export default vaults;
