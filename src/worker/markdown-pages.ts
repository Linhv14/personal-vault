import type { Context } from "hono";
import { CONTENT_SIGNAL, MARKDOWN_PAGES, wantsMarkdown } from "./markdown-negotiation.js";
import type { AppBindings } from "./types.js";

function withVary(response: Response): Response {
  const result = new Response(response.body, response);
  const vary = result.headers.get("Vary");
  if (!vary?.toLowerCase().includes("accept")) {
    result.headers.set("Vary", vary ? `${vary}, Accept` : "Accept");
  }
  return result;
}

export async function servePage(c: Context<AppBindings>): Promise<Response> {
  const source = MARKDOWN_PAGES[c.req.path];
  if (!source || !wantsMarkdown(c.req.header("Accept"))) {
    return withVary(await c.env.ASSETS.fetch(c.req.raw));
  }
  const asset = await c.env.ASSETS.fetch(new URL(source, c.req.url));
  if (!asset.ok) return withVary(await c.env.ASSETS.fetch(c.req.raw));
  const text = await asset.text();
  return new Response(c.req.method === "HEAD" ? null : text, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Content-Signal": CONTENT_SIGNAL,
      Vary: "Accept",
      "X-Content-Type-Options": "nosniff",
      "X-Markdown-Tokens": String(Math.ceil(text.length / 4)),
    },
  });
}
