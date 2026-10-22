import type { Context } from "hono";
import { CONTENT_SIGNAL, MARKDOWN_PAGES, wantsMarkdown } from "./markdown-negotiation.js";
import { HOME_LINKS } from "./discovery.js";
import { configuredPrivacyUrl, fillPrivacyLink } from "./privacy-link.js";
import { PUBLIC_PAGE_CSP, STRICT_TRANSPORT_SECURITY } from "./security-headers.js";
import type { AppBindings } from "./types.js";

function withVary(response: Response): Response {
  const result = new Response(response.body, response);
  if (result.headers.get("Content-Type")?.includes("text/html")) {
    result.headers.set("Content-Security-Policy", PUBLIC_PAGE_CSP);
  }
  const vary = result.headers.get("Vary");
  if (!vary?.toLowerCase().includes("accept")) {
    result.headers.set("Vary", vary ? `${vary}, Accept` : "Accept");
  }
  return result;
}

const HOME_PAGES = new Set(["/", "/vi"]);

function withHomeLinks(c: Context<AppBindings>, response: Response): Response {
  if (HOME_PAGES.has(c.req.path)) {
    response.headers.set("Link", HOME_LINKS);
  }
  return response;
}

export async function servePage(c: Context<AppBindings>): Promise<Response> {
  return withHomeLinks(c, await negotiate(c));
}

export async function serveFromSite(c: Context<AppBindings>, site: Fetcher): Promise<Response> {
  const upstream = await site.fetch(c.req.raw);
  const response = c.req.path.startsWith("/media/")
    ? new Response(upstream.body, upstream)
    : withVary(upstream);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "no-referrer");
  if (new URL(c.req.url).protocol === "https:") {
    response.headers.set("Strict-Transport-Security", STRICT_TRANSPORT_SECURITY);
  }
  return withHomeLinks(c, response);
}

async function htmlPage(c: Context<AppBindings>): Promise<Response> {
  const asset = await c.env.ASSETS.fetch(c.req.raw);
  if (asset.status !== 200 || !asset.headers.get("Content-Type")?.includes("text/html")) {
    return withVary(asset);
  }
  const html = fillPrivacyLink(await asset.text(), configuredPrivacyUrl(c.env));
  const response = new Response(c.req.method === "HEAD" ? null : html, asset);
  response.headers.delete("Content-Length");
  response.headers.delete("ETag");
  return withVary(response);
}

async function negotiate(c: Context<AppBindings>): Promise<Response> {
  const source = MARKDOWN_PAGES[c.req.path];
  if (!source || !wantsMarkdown(c.req.header("Accept"))) {
    return htmlPage(c);
  }
  const asset = await c.env.ASSETS.fetch(new URL(source, c.req.url));
  if (!asset.ok) {
    return htmlPage(c);
  }
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
