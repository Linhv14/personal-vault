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
