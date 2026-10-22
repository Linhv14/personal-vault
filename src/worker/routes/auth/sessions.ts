import { Hono } from "hono";
import { deviceKind } from "#worker/device-label.js";
import { apiError } from "#worker/errors.js";
import { now } from "#worker/http.js";
import {
  listSessions,
  revokeOtherSessions,
  revokeSession,
  revokeSessionById,
  sessionResumeKey,
} from "#worker/session.js";
import type { AppBindings } from "#worker/types.js";

const routes = new Hono<AppBindings>();

routes.get("/resume-key", async (c) => {
  const resumeKey = await sessionResumeKey(c.env, c.get("session").tokenHash);
  if (!resumeKey) {
    return c.json(apiError("auth.unauthorized"), 401);
  }
  c.header("Cache-Control", "no-store");
  return c.json({ resumeKey });
});

routes.post("/logout", async (c) => {
  await revokeSession(c.env, c.get("session").tokenHash);
  return c.json({ ok: true });
});

routes.get("/sessions", async (c) => {
  const { accountId, tokenHash } = c.get("session");
  const sessions = await listSessions(c.env, accountId, tokenHash, now());
  return c.json({
    sessions: sessions.map((session) => ({ ...session, kind: deviceKind(session.label) })),
  });
});

routes.post("/sessions/revoke-others", async (c) => {
  const { accountId, tokenHash } = c.get("session");
  const revoked = await revokeOtherSessions(c.env, accountId, tokenHash);
  return c.json({ ok: true, revoked });
});

routes.delete("/sessions/:id", async (c) => {
  const { accountId } = c.get("session");
  const revoked = await revokeSessionById(c.env, accountId, c.req.param("id"));
  if (!revoked) {
    return c.json(apiError("auth.session_not_found"), 404);
  }
  return c.json({ ok: true });
});

export default routes;
