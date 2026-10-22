import { describe, expect, it } from "vitest";
import { htmlToMarkdown, pageMarkdown } from "../scripts/html-markdown.js";
import { wantsMarkdown } from "../src/worker/markdown-negotiation.js";
import { startWorker } from "./worker-harness.js";

describe("html to markdown", () => {
  it("keeps headings, lists, links, tables and code, and drops decoration", () => {
    const html = `<html><head><title>7KEY · Test</title>
      <meta name="description" content="A vault." /></head><body><nav>menu</nav><main>
      <h1>One <span>vault.</span></h1>
      <div aria-hidden="true">mock row</div><svg><text>logo</text></svg>
      <p>Read the <a href="/security">threat model</a>.</p>
      <ul><li><strong>Fills</strong><span>Logins &amp; cards.</span></li></ul>
      <table><tr><th>Feature</th><th><b>7</b>KEY</th></tr><tr><td>2FA</td><td>✓</td></tr></table>
      <pre><code><span>$ </span>7key run
  -- npm start</code></pre>
      <p><a class="btn" href="#install">Add</a><a href="#product">See</a></p>
    </main></body></html>`;
    const md = pageMarkdown(html, "https://7key.online/");
    expect(md).toContain("# 7KEY · Test\n\nA vault.");
    expect(md).toContain("# One vault.");
    expect(md).not.toMatch(/mock row|logo|menu/);
    expect(md).toContain("Read the [threat model](https://7key.online/security).");
    expect(md).toContain("- **Fills** — Logins & cards.");
    expect(md).toContain("| Feature | **7**KEY |\n| --- | --- |\n| 2FA | ✓ |");
    expect(md).toContain("```\n$ 7key run\n  -- npm start\n```");
    expect(md).toContain("Add · See");
    expect(htmlToMarkdown("<p>a</p>")).toBe("a\n");
  });
});

describe("markdown negotiation", () => {
  it("reads the Accept header", () => {
    expect(wantsMarkdown("text/markdown")).toBe(true);
    expect(wantsMarkdown("text/html, text/markdown;q=0.9")).toBe(true);
    expect(wantsMarkdown("text/html,application/xhtml+xml,*/*;q=0.8")).toBe(false);
    expect(wantsMarkdown(undefined)).toBe(false);
  });

  it("serves markdown to agents and html to browsers on the public pages", async () => {
    const worker = await startWorker();
    const agent = await worker.fetch("/security", { headers: { Accept: "text/markdown" } });
    expect(agent.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(agent.headers.get("vary")).toContain("Accept");
    expect(agent.headers.get("content-signal")).toBe("search=yes, ai-input=yes, ai-train=no");
    expect(await agent.text()).toBe("# /security.md\n");
    const browser = await worker.fetch("/", { headers: { Accept: "text/html" } });
    expect(browser.headers.get("content-type")).toContain("text/html");
    expect(browser.headers.get("vary")).toContain("Accept");
    expect(browser.headers.get("content-security-policy")).toContain(
      "https://static.cloudflareinsights.com",
    );
    expect(browser.headers.get("link")).toContain('</.well-known/api-catalog>; rel="api-catalog"');
    expect(agent.headers.get("link")).toBeNull();
    const share = await worker.fetch("/s/abc");
    expect(share.headers.get("content-security-policy")).not.toContain("cloudflareinsights");
  });
});

describe("discovery", () => {
  it("publishes an RFC 9727 API catalog and a health check", async () => {
    const worker = await startWorker();
    const catalog = await worker.fetch("/.well-known/api-catalog");
    expect(catalog.status).toBe(200);
    expect(catalog.headers.get("content-type")).toBe("application/linkset+json");
    const body = (await catalog.json()) as { linkset: Record<string, { href: string }[]>[] };
    const entry = body.linkset[0]!;
    expect(entry.anchor).toBe("https://vault.test/api/");
    expect(entry["service-desc"]![0]!.href).toBe("https://vault.test/openapi.json");
    expect(entry["service-doc"]![0]!.href).toBe("https://vault.test/api-docs");
    expect(entry.status![0]!.href).toBe("https://vault.test/api/health");
    expect(await (await worker.fetch("/api/health")).json()).toEqual({ status: "ok" });
  });
});

describe("site binding", () => {
  const assets = {
    fetch: async (input: Request | URL | string) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/index.md") {
        return new Response("# 7key\n");
      }
      if (["/", "/security", "/share.html"].includes(url.pathname)) {
        return new Response("<!doctype html><title>7key</title><h1>7KEY</h1>", {
          headers: { "Content-Type": "text/html" },
        });
      }
      return new Response("Not found", { status: 404 });
    },
  };

  function fakeSite() {
    const seen: { path: string; accept: string | null; method: string }[] = [];
    const site = {
      fetch: async (input: Request | URL | string) => {
        const request = input instanceof Request ? input : new Request(input);
        const url = new URL(request.url);
        seen.push({
          path: url.pathname,
          accept: request.headers.get("Accept"),
          method: request.method,
        });
        if (url.pathname.startsWith("/media/")) {
          return new Response("video", { headers: { "Content-Type": "video/mp4" } });
        }
        if (request.headers.get("Accept") === "text/markdown") {
          return new Response(`# site ${url.pathname}\n`, {
            headers: { "Content-Type": "text/markdown; charset=utf-8", Vary: "Accept" },
          });
        }
        return new Response(`<!doctype html><title>site ${url.pathname}</title>`, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      },
    };
    return { site, seen };
  }

  it("proxies the home pages, privacy page and media to SITE", async () => {
    const { site, seen } = fakeSite();
    const worker = await startWorker({ vars: { ASSETS: assets, SITE: site } });
    for (const path of ["/", "/vi", "/privacy", "/media/demo-en.mp4"]) {
      const response = await worker.fetch(path, { headers: { Accept: "text/html" } });
      expect(response.status).toBe(200);
      expect(await response.text()).toContain(
        path.startsWith("/media/") ? "video" : `site ${path}`,
      );
    }
    expect(seen.map((request) => request.path)).toEqual([
      "/",
      "/vi",
      "/privacy",
      "/media/demo-en.mp4",
    ]);
    const home = await worker.fetch("/");
    expect(home.headers.get("link")).toContain('</.well-known/api-catalog>; rel="api-catalog"');
    expect(home.headers.get("vary")).toContain("Accept");
    expect(home.headers.get("content-security-policy")).toContain(
      "https://static.cloudflareinsights.com",
    );
    expect((await worker.fetch("/vi")).headers.get("link")).toContain("api-catalog");
    expect((await worker.fetch("/privacy")).headers.get("link")).toBeNull();
    const video = await worker.fetch("/media/demo-en.mp4");
    expect(video.headers.get("content-type")).toBe("video/mp4");
    expect(video.headers.get("content-security-policy")).toBeNull();
  });

  it("lets the site answer markdown requests", async () => {
    const { site, seen } = fakeSite();
    const worker = await startWorker({ vars: { ASSETS: assets, SITE: site } });
    const agent = await worker.fetch("/", { headers: { Accept: "text/markdown" } });
    expect(agent.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(await agent.text()).toBe("# site /\n");
    expect(agent.headers.get("link")).toContain("api-catalog");
    expect(seen[0]?.accept).toBe("text/markdown");
  });

  it("keeps the product routes on the product Worker", async () => {
    const { site, seen } = fakeSite();
    const worker = await startWorker({ vars: { ASSETS: assets, SITE: site } });
    expect(await (await worker.fetch("/api/health")).json()).toEqual({ status: "ok" });
    expect((await worker.fetch("/security")).status).toBe(200);
    expect((await worker.fetch("/s/abc")).status).toBe(200);
    expect(seen).toEqual([]);
  });

  it("serves the built-in home page and nothing else of the site without SITE", async () => {
    const worker = await startWorker({ vars: { ASSETS: assets } });
    const home = await worker.fetch("/", { headers: { Accept: "text/html" } });
    expect(home.status).toBe(200);
    expect(await home.text()).toContain("<h1>7KEY</h1>");
    expect(home.headers.get("link")).toContain("api-catalog");
    const agent = await worker.fetch("/", { headers: { Accept: "text/markdown" } });
    expect(await agent.text()).toBe("# 7key\n");
    for (const path of ["/vi", "/privacy", "/media/demo-en.mp4"]) {
      expect((await worker.fetch(path)).status).toBe(404);
    }
  });
});
