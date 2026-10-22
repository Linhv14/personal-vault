import { Hono } from "hono";
import { apiError } from "../errors.js";
import { fetchLogo, logoDomain } from "../logo.js";
import type { AppBindings } from "../types.js";

const logos = new Hono<AppBindings>();

logos.get("/", async (c) => {
  const domain = logoDomain(c.req.query("domain"));
  if (!domain) {
    return c.json(apiError("server.not_found"), 404);
  }
  const logo = await fetchLogo(domain);
  if (!logo) {
    return c.json(apiError("server.not_found"), 404);
  }
  const response = new Response(logo.body, logo);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
});

export default logos;
