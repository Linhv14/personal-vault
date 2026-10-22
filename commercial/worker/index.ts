import type { Hono } from "hono";
import { installAuthExtensions } from "#worker/auth-extensions.js";
import type { AppBindings } from "#worker/types.js";
import admin from "./sso/admin.js";
import { ssoAuthExtensions } from "./sso/membership.js";
import routes from "./sso/routes.js";

export function mountCommercial(app: Hono<AppBindings>): void {
  installAuthExtensions(ssoAuthExtensions);
  app.route("/api/sso", routes);
  app.route("/api/orgs/:orgId/sso", admin);
}
