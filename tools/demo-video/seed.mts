import { writeFileSync } from "node:fs";
import path from "node:path";
import { deriveMasterKey, deriveAuthKey } from "../../src/core/crypto.js";
import { toBase64 } from "../../src/core/bytes.js";
import { ACCOUNTS, BASE as SITE_BASE } from "./config.mjs";
import { launch, sleep } from "./cdp.mjs";

const B = "http://127.0.0.1:8787";
const call = async (m: string, p: string, body?: unknown, token?: string) => {
  const r = await fetch(B + p, {
    method: m,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
};
const login = async (email: string, pw: string) => {
  const { kdf } = await call("POST", "/api/auth/prelogin", { email });
  const authKey = toBase64(await deriveAuthKey(await deriveMasterKey(email, pw, kdf)));
  return (await call("POST", "/api/auth/login", { email, authKey })).token as string;
};
const OWNER = ACCOUNTS.owner.email,
  BINH = ACCOUNTS.admin.email,
  AN = ACCOUNTS.member.email;
const owner = await login(OWNER, ACCOUNTS.owner.password);
const { orgs } = await call("GET", "/api/orgs", undefined, owner);
let org = orgs.find((o: any) => o.name === "Northwind");
if (!org) org = await call("POST", "/api/orgs", { name: "Northwind" }, owner);
const ORG = org.id;
for (const [email, pw, role] of [
  [BINH, ACCOUNTS.admin.password, "admin"],
  [AN, ACCOUNTS.member.password, "member"],
] as const) {
  const t = await login(email, pw);
  const inv = await call("POST", `/api/orgs/${ORG}/invites`, { email, role }, owner);
  if (inv.id) await call("POST", `/api/invites/${inv.id}/accept`, undefined, t);
}
console.log("org", ORG);
const demo: Record<string, string> = { org: ORG };

const b = await launch(9340);
const ev = (fn: string) => b.eval(new Function(`return (async () => { ${fn} })()`) as any);
const setVal = `const setv = (el, v) => { const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement : HTMLInputElement; Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };`;
const waitFor = (sel: string) =>
  `for (let i = 0; i < 100 && !document.querySelector(${JSON.stringify(sel)}); i++) await new Promise((r) => setTimeout(r, 100));`;
const clickText = (text: string, scope = "document") =>
  `[...${scope}.querySelectorAll("button, a")].find((x) => x.textContent.trim() === ${JSON.stringify(text)})?.click();`;
try {
  await b.viewport(1280, 800, 1);
  await b.send("Page.addScriptToEvaluateOnNewDocument", {
    source:
      'Object.defineProperty(navigator,"language",{get:()=>"en-US"});Object.defineProperty(navigator,"languages",{get:()=>["en-US"]});',
  });
  await b.goto(`${SITE_BASE}/app/#/${ORG}/teams`, 1200);
  await ev(
    `${waitFor("input[name=email]")} ${setVal} setv(document.querySelector("input[name=email]"), ${JSON.stringify(OWNER)}); setv(document.querySelector("input[name=password]"), ${JSON.stringify(ACCOUNTS.owner.password)}); document.querySelector("form").requestSubmit(); ${waitFor("main h1")} await new Promise((r) => setTimeout(r, 800));`,
  );
  const hasTeam = await ev(`return document.querySelector("main").innerText.includes("Platform");`);
  if (!hasTeam) {
    await ev(
      `${clickText("Create team")} ${waitFor("dialog[open] input")} ${setVal} setv(document.querySelector("dialog[open] input"), "Platform"); document.querySelector("dialog[open] form").requestSubmit(); await new Promise((r) => setTimeout(r, 2500));`,
    );
  }
  for (const who of [BINH, AN]) {
    await ev(
      `location.hash = "#/${ORG}/teams"; await new Promise((r) => setTimeout(r, 1200)); [...document.querySelectorAll("main tbody tr")].find((r) => r.innerText.includes("Platform"))?.click(); await new Promise((r) => setTimeout(r, 1200));`,
    );
    const inTeam = await ev(
      `return document.querySelector("main").innerText.includes(${JSON.stringify(who)});`,
    );
    if (inTeam) continue;
    await ev(
      `[...document.querySelectorAll("main button")].find((x) => x.className.includes("primary"))?.click(); ${waitFor("dialog[open] select")} const sel = document.querySelector("dialog[open] select"); const opt = [...sel.options].find((o) => o.text.startsWith(${JSON.stringify(who)})); if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event("change", { bubbles: true })); } await new Promise((r) => setTimeout(r, 400)); document.querySelector("dialog[open] form").requestSubmit(); await new Promise((r) => setTimeout(r, 2500));`,
    );
  }
  const projects = [
    {
      name: "Payments API",
      secrets: [
        [
          "DATABASE_URL",
          "secret",
          [
            "postgres://payments:dev@db.dev.northwind.dev/payments",
            "postgres://payments@db.stg.northwind.dev/payments",
            "postgres://payments@db.northwind.dev/payments",
          ],
        ],
        [
          "REDIS_URL",
          "secret",
          [
            "redis://cache.dev.northwind.dev:6379",
            "redis://cache.stg.northwind.dev:6379",
            "redis://cache.northwind.dev:6379",
          ],
        ],
        [
          "STRIPE_SECRET_KEY",
          "secret",
          ["sk_test_51Nw…dev", "sk_test_51Nw…stg", "sk_live_51Nw…prod"],
        ],
        ["STRIPE_WEBHOOK_SECRET", "secret", ["whsec_dev_8f2…", null, "whsec_live_3a9…"]],
        [
          "SENTRY_DSN",
          "secret",
          [
            "https://a1b2@o1.ingest.sentry.io/1",
            "https://a1b2@o1.ingest.sentry.io/2",
            "https://a1b2@o1.ingest.sentry.io/3",
          ],
        ],
        ["OPENAI_API_KEY", "secret", ["sk-proj-dev…", "sk-proj-stg…", "sk-proj-prod…"]],
        [
          "API_BASE_URL",
          "variable",
          [
            "https://api.dev.northwind.dev",
            "https://api.stg.northwind.dev",
            "https://api.northwind.dev",
          ],
        ],
        ["LOG_LEVEL", "variable", ["debug", "info", "warn"]],
      ],
    },
    {
      name: "Web App",
      secrets: [
        [
          "NEXT_PUBLIC_API_URL",
          "variable",
          [
            "https://api.dev.northwind.dev",
            "https://api.stg.northwind.dev",
            "https://api.northwind.dev",
          ],
        ],
        ["NEXTAUTH_SECRET", "secret", ["dev-3f9a…", "stg-7c21…", "prod-b84e…"]],
        ["POSTHOG_KEY", "secret", ["phc_dev…", "phc_stg…", "phc_prod…"]],
      ],
    },
    {
      name: "Mobile",
      secrets: [
        [
          "EXPO_PUBLIC_API_URL",
          "variable",
          [
            "https://api.dev.northwind.dev",
            "https://api.stg.northwind.dev",
            "https://api.northwind.dev",
          ],
        ],
        ["REVENUECAT_KEY", "secret", ["rc_dev…", "rc_stg…", "rc_prod…"]],
      ],
    },
  ] as const;
  for (const p of projects) {
    await ev(`location.hash = "#/${ORG}/projects"; await new Promise((r) => setTimeout(r, 1500));`);
    const exists = await ev(
      `const row = [...document.querySelectorAll("main tbody tr")].find((r) => r.innerText.includes(${JSON.stringify(p.name)})); if (row) { row.click(); return true; } return false;`,
    );
    if (!exists) {
      await ev(
        `[...document.querySelectorAll("main button")].find((x) => x.className.includes("primary"))?.click(); ${waitFor("dialog[open] input[name=name]")} ${setVal} setv(document.querySelector("dialog[open] input[name=name]"), ${JSON.stringify(p.name)}); document.querySelector("dialog[open] form").requestSubmit();`,
      );
    }
    await sleep(2500);
    for (const [name, kind, values] of p.secrets) {
      const have = await ev(
        `return [...document.querySelectorAll("main td")].some((c) => c.textContent.trim() === ${JSON.stringify(name)});`,
      );
      if (have) continue;
      await ev(`[...document.querySelectorAll("main button")].find((x) => x.className.includes("primary") && /secret/i.test(x.textContent))?.click(); ${waitFor("dialog[open] input[name=name]")}
        ${kind === "variable" ? `[...document.querySelectorAll("dialog[open] button, dialog[open] label")].find((x) => /^Variable$/.test(x.textContent.trim()))?.click(); await new Promise((r) => setTimeout(r, 200));` : ""}
        ${setVal} setv(document.querySelector("dialog[open] input[name=name]"), ${JSON.stringify(name)});
        const rows = [...document.querySelectorAll("dialog[open] .env-value")]; const vals = ${JSON.stringify(values)};
        for (let i = 0; i < rows.length; i++) { if (vals[i] === null) { rows[i].querySelector("input[type=checkbox]").click(); await new Promise((r) => setTimeout(r, 100)); } }
        await new Promise((r) => setTimeout(r, 150));
        const rows2 = [...document.querySelectorAll("dialog[open] .env-value")];
        for (let i = 0; i < rows2.length; i++) if (vals[i] !== null) setv(rows2[i].querySelector("textarea"), vals[i]);
        document.querySelector("dialog[open] form").requestSubmit(); await new Promise((r) => setTimeout(r, 2200));`);
    }
    const hash = await ev(`return location.hash;`);
    console.log("project", p.name, hash);
    if (p.name === "Payments API") demo.project = String(hash).split("/")[3];
  }
} finally {
  b.close();
}
await call("PUT", `/api/orgs/${ORG}/domains`, { domains: ["northwind.dev"] }, owner);
writeFileSync(path.join(import.meta.dirname, "demo.local.json"), JSON.stringify(demo, null, 2));
console.log("done");
