import { launch, sleep } from "./cdp.mjs";
import { ACCOUNTS, DEMO, BASE } from "./config.mjs";
const ORG = DEMO.org,
  PROJECT = DEMO.project;
const KEEP = [
  "DATABASE_URL",
  "REDIS_URL",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "SENTRY_DSN",
  "OPENAI_API_KEY",
  "API_BASE_URL",
  "LOG_LEVEL",
];
const b = await launch(9342);
const ev = (body) => b.eval(new Function(`return (async () => { ${body} })()`));
try {
  await b.viewport(1280, 900, 1);
  await b.send("Page.addScriptToEvaluateOnNewDocument", {
    source: 'Object.defineProperty(navigator,"language",{get:()=>"en-US"});',
  });
  await b.goto(`${BASE}/app/#/${ORG}/projects/${PROJECT}`, 1200);
  await ev(
    `const s = (n, v) => { const el = document.querySelector("input[name=" + n + "]"); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); }; for (let i = 0; i < 50 && !document.querySelector("input[name=email]"); i++) await new Promise((r) => setTimeout(r, 100)); s("email", ${JSON.stringify(ACCOUNTS.owner.email)}); s("password", ${JSON.stringify(ACCOUNTS.owner.password)}); document.querySelector("form").requestSubmit(); for (let i = 0; i < 100 && !document.querySelector("main table"); i++) await new Promise((r) => setTimeout(r, 100));`,
  );
  let removed = 0;
  for (let tab = 2; tab <= 4; tab++) {
    await ev(
      `document.querySelector('a[role=tab]:nth-child(${tab})').click(); await new Promise((r) => setTimeout(r, 1200));`,
    );
    for (let guard = 0; guard < 20; guard++) {
      const done = await ev(
        `const base = ${JSON.stringify(KEEP)}; const row = [...document.querySelectorAll("main tbody tr")].find((r) => { const n = r.querySelector("td code")?.textContent.trim(); return n && !base.includes(n); }); if (!row) return true; [...row.querySelectorAll('button')].find((x) => /^(Delete|Xoá)$/.test(x.getAttribute('aria-label') || ''))?.click(); await new Promise((r) => setTimeout(r, 400)); document.querySelector("dialog[open] button[type=submit]")?.click(); await new Promise((r) => setTimeout(r, 1500)); return false;`,
      );
      if (done) break;
      removed++;
    }
  }
  console.log("removed", removed);
} finally {
  b.close();
}
