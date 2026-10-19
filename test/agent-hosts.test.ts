import { describe, expect, it } from "vitest";
import { suggestHosts } from "../src/core/agent-hosts.js";
import { parseHosts } from "../src/core/projects.js";

describe("agent host suggestions", () => {
  it("come from the key's prefix before its name", () => {
    expect(suggestHosts("PAYMENTS_KEY", "sk_live_abc")).toEqual(["api.stripe.com"]);
    expect(suggestHosts("LLM_KEY", "sk-ant-api03-x")).toEqual(["api.anthropic.com"]);
    expect(suggestHosts("OPENAI_API_KEY", "")).toEqual(["api.openai.com"]);
    expect(suggestHosts("SHOPIFY_ADMIN_TOKEN")).toEqual(["*.myshopify.com"]);
    expect(suggestHosts("GITHUB_TOKEN", "ghp_x")).toEqual(["api.github.com", "uploads.github.com"]);
  });

  it("stay empty for names and values they do not know", () => {
    expect(suggestHosts("DATABASE_URL", "postgres://x")).toEqual([]);
    expect(suggestHosts("SESSION_SECRET", "abcdef")).toEqual([]);
  });

  it("are all hosts the console accepts", () => {
    const names = [
      "STRIPE",
      "ANTHROPIC",
      "OPENAI",
      "GEMINI",
      "GROQ",
      "MISTRAL",
      "OPENROUTER",
      "HF_TOKEN",
      "GITHUB",
      "GITLAB",
      "SHOPIFY",
      "SLACK",
      "SENDGRID",
      "RESEND",
      "POSTMARK",
      "MAILGUN",
      "TWILIO",
      "CLOUDFLARE",
      "VERCEL",
      "NETLIFY",
      "DIGITALOCEAN",
      "NOTION",
      "LINEAR",
      "AIRTABLE",
      "SUPABASE",
      "PINECONE",
      "SENTRY",
      "PAYPAL",
      "FACEBOOK",
      "TELEGRAM",
      "DISCORD",
      "HUBSPOT",
      "INTERCOM",
      "ALGOLIA",
      "REPLICATE",
      "ELEVENLABS",
      "DEEPSEEK",
      "XAI",
    ];
    for (const name of names) {
      const hosts = suggestHosts(`${name}_KEY`);
      expect(hosts.length, name).toBeGreaterThan(0);
      expect(parseHosts(hosts.join("\n")), name).toEqual(hosts);
    }
  });
});
