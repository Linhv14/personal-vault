interface Provider {
  hosts: string[];
  names: RegExp;
  prefixes: string[];
}

const PROVIDERS: Provider[] = [
  {
    hosts: ["api.stripe.com"],
    names: /STRIPE/,
    prefixes: ["sk_live_", "sk_test_", "rk_live_", "rk_test_"],
  },
  { hosts: ["api.anthropic.com"], names: /ANTHROPIC|CLAUDE/, prefixes: ["sk-ant-"] },
  { hosts: ["api.openai.com"], names: /OPENAI/, prefixes: ["sk-proj-", "sk-svcacct-"] },
  {
    hosts: ["generativelanguage.googleapis.com"],
    names: /GEMINI|GOOGLE_AI|GOOGLE_GENERATIVE/,
    prefixes: [],
  },
  { hosts: ["api.groq.com"], names: /GROQ/, prefixes: ["gsk_"] },
  { hosts: ["api.mistral.ai"], names: /MISTRAL/, prefixes: [] },
  { hosts: ["openrouter.ai"], names: /OPENROUTER/, prefixes: ["sk-or-"] },
  {
    hosts: ["huggingface.co", "api-inference.huggingface.co"],
    names: /HUGGING_?FACE|^HF_/,
    prefixes: ["hf_"],
  },
  {
    hosts: ["api.github.com", "uploads.github.com"],
    names: /GITHUB|^GH_/,
    prefixes: ["ghp_", "github_pat_", "gho_", "ghs_"],
  },
  { hosts: ["gitlab.com"], names: /GITLAB/, prefixes: ["glpat-"] },
  { hosts: ["*.myshopify.com"], names: /SHOPIFY/, prefixes: ["shpat_", "shpca_", "shppa_"] },
  { hosts: ["slack.com"], names: /SLACK/, prefixes: ["xoxb-", "xoxp-"] },
  { hosts: ["api.sendgrid.com"], names: /SENDGRID/, prefixes: ["SG."] },
  { hosts: ["api.resend.com"], names: /RESEND/, prefixes: ["re_"] },
  { hosts: ["api.postmarkapp.com"], names: /POSTMARK/, prefixes: [] },
  { hosts: ["api.mailgun.net", "api.eu.mailgun.net"], names: /MAILGUN/, prefixes: [] },
  { hosts: ["api.twilio.com"], names: /TWILIO/, prefixes: [] },
  { hosts: ["api.cloudflare.com"], names: /CLOUDFLARE|^CF_API/, prefixes: [] },
  { hosts: ["api.vercel.com"], names: /VERCEL/, prefixes: [] },
  { hosts: ["api.netlify.com"], names: /NETLIFY/, prefixes: [] },
  { hosts: ["api.digitalocean.com"], names: /DIGITALOCEAN|^DO_/, prefixes: ["dop_v1_"] },
  { hosts: ["api.notion.com"], names: /NOTION/, prefixes: ["ntn_"] },
  { hosts: ["api.linear.app"], names: /LINEAR/, prefixes: ["lin_api_"] },
  { hosts: ["api.airtable.com"], names: /AIRTABLE/, prefixes: [] },
  { hosts: ["*.supabase.co"], names: /SUPABASE/, prefixes: ["sbp_"] },
  { hosts: ["api.pinecone.io", "*.pinecone.io"], names: /PINECONE/, prefixes: ["pcsk_"] },
  { hosts: ["sentry.io"], names: /SENTRY/, prefixes: ["sntrys_"] },
  {
    hosts: ["api.paypal.com", "api-m.paypal.com", "api-m.sandbox.paypal.com"],
    names: /PAYPAL/,
    prefixes: [],
  },
  { hosts: ["graph.facebook.com"], names: /FACEBOOK|META_|WHATSAPP/, prefixes: [] },
  { hosts: ["api.telegram.org"], names: /TELEGRAM/, prefixes: [] },
  { hosts: ["discord.com"], names: /DISCORD/, prefixes: [] },
  { hosts: ["api.hubapi.com"], names: /HUBSPOT/, prefixes: ["pat-"] },
  { hosts: ["api.intercom.io"], names: /INTERCOM/, prefixes: [] },
  { hosts: ["api.algolia.com", "*.algolia.net"], names: /ALGOLIA/, prefixes: [] },
  { hosts: ["api.replicate.com"], names: /REPLICATE/, prefixes: ["r8_"] },
  { hosts: ["api.elevenlabs.io"], names: /ELEVEN_?LABS/, prefixes: [] },
  { hosts: ["api.deepseek.com"], names: /DEEPSEEK/, prefixes: [] },
  { hosts: ["api.x.ai"], names: /XAI|GROK/, prefixes: ["xai-"] },
];

export function suggestHosts(name: string, value = ""): string[] {
  const upper = name.toUpperCase();
  const byPrefix = PROVIDERS.find((provider) =>
    provider.prefixes.some((prefix) => prefix.length >= 4 && value.startsWith(prefix)),
  );
  const byName = PROVIDERS.find((provider) => provider.names.test(upper));
  return [...((byPrefix ?? byName)?.hosts ?? [])];
}
