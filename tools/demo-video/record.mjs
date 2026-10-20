import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { launch, sleep } from "./cdp.mjs";
import { scenes } from "./scenes.mjs";
import { TIDY } from "./tidy.mjs";
import { ACCOUNTS, DEMO, BASE } from "./config.mjs";

const locale = process.argv[2] ?? "en";
const out = process.argv[3];
mkdirSync(out, { recursive: true });
const ORG = DEMO.org;
const PROJECT = DEMO.project;
const vi = locale === "vi";
const T = vi
  ? {
      intro:
        "<h1><img class=lg src=logo.svg alt><b>7</b>KEY</h1><p>Mật khẩu · 2FA · Secret của nhóm</p>",
      c1: ["Kho", "Mọi tài khoản.<br><b>Một nơi.</b>"],
      c2: ["2FA", "Mã 2FA <b>có sẵn.</b>"],
      c3: ["Chia sẻ", "Gửi tài khoản.<br><b>Tự hết hạn.</b>"],
      c4: ["Nhóm", "Thấy ngay <b>chỗ còn thiếu.</b>"],
      c5: ["Secret", "Mọi môi trường.<br><b>Một lần.</b>"],
      hosts: ["AI agent", "Mỗi key một host.<br><b>Không gửi đi nơi khác.</b>"],
      protect: ["Bảo vệ", "Khoá Production.<br><b>Chỉ admin được sửa.</b>"],
      c6: ["Thành viên", "Mời cả nhóm.<br><b>Khoá theo domain.</b>"],
      c7: ["Nhật ký", "Mọi lần đọc<br><b>đều được ghi.</b>"],
      outro:
        '<h1><img class=lg src=logo.svg alt><b>7</b>KEY</h1><p>Bảy loại chìa khoá. Bạn chỉ cần nhớ một.</p><span class="cta">Cài cho Chrome</span>',
      missing: "Thiếu ở Staging",
      onlyHost: "Chỉ gửi tới host này",
      adminOnly: "Chỉ admin sửa được",
      invite: "emma@northwind.dev",
    }
  : {
      intro:
        "<h1><img class=lg src=logo.svg alt><b>7</b>KEY</h1><p>Passwords · 2FA · Team secrets</p>",
      c1: ["Vault", "Every login.<br><b>One place.</b>"],
      c2: ["2FA", "2FA codes, <b>built in.</b>"],
      c3: ["Share", "Share a login.<br><b>It expires.</b>"],
      c4: ["Teams", "See what's <b>missing.</b>"],
      c5: ["Secrets", "Every environment.<br><b>At once.</b>"],
      hosts: ["AI agents", "One host per key.<br><b>Never sent anywhere else.</b>"],
      protect: ["Protect", "Lock Production.<br><b>Only admins can edit.</b>"],
      c6: ["Members", "Invite your team.<br><b>Lock it to your domain.</b>"],
      c7: ["Audit", "Every read,<br><b>logged.</b>"],
      outro:
        '<h1><img class=lg src=logo.svg alt><b>7</b>KEY</h1><p>Seven kinds of keys. One you remember.</p><span class="cta">Add to Chrome</span>',
      missing: "Missing in Staging",
      onlyHost: "Only sent to this host",
      adminOnly: "Only admins can edit",
      invite: "emma@northwind.dev",
    };

const SC = scenes(vi);
const b = await launch(9339);
await b.viewport(1280, 720, 1.5);
const tag = vi ? "vi-VN" : "en-US";
await b.send("Page.addScriptToEvaluateOnNewDocument", {
  source: `Object.defineProperty(navigator,"language",{get:()=>"${tag}"});Object.defineProperty(navigator,"languages",{get:()=>["${tag}"]});`,
});
await b.goto(`${BASE}/stage2.html`, 300);

const frames = [];
const beats = [];
let recording = true;
let cut = 0;
let pausedAt = 0;
let n = 0;
b.on((m) => {
  if (m.method !== "Page.screencastFrame") return;
  b.send("Page.screencastFrameAck", { sessionId: m.params.sessionId }).catch(() => {});
  if (!recording) return;
  const file = path.join(out, `f${String(n++).padStart(5, "0")}.jpg`);
  writeFileSync(file, Buffer.from(m.params.data, "base64"));
  frames.push({ file, t: m.params.metadata.timestamp - cut });
});
await b.send("Page.startScreencast", {
  format: "jpeg",
  quality: 88,
  maxWidth: 1920,
  maxHeight: 1080,
  everyNthFrame: 1,
});
const now = () => Date.now() / 1000;
const pause = () => {
  recording = false;
  pausedAt = now();
};
const resume = () => {
  cut += now() - pausedAt;
  recording = true;
};
const beat = (name) => beats.push([now() - cut, name]);
const st = (fn, ...a) => b.eval(fn, ...a);
const frame = (body, ...args) =>
  b.eval(
    new Function(
      "...args",
      "return (async () => { const d = st.doc(), w = st.win(); " + body + " })()",
    ),
    ...args,
  );
const mark = (name, body) =>
  frame(
    `const el = (() => { ${body} })(); if (el) el.setAttribute("data-cam", ${JSON.stringify(name)}); return !!el;`,
  );
const cam = (name) => `[data-cam="${name}"]`;
const type = async (sel, text, ms = 45) => {
  for (let i = 1; i <= text.length; i++) {
    await frame(
      `const el = d.querySelector(${JSON.stringify(sel)}); if (!el) return; const set = Object.getOwnPropertyDescriptor(w[el.tagName === "TEXTAREA" ? "HTMLTextAreaElement" : "HTMLInputElement"].prototype, "value").set; set.call(el, ${JSON.stringify(text)}.slice(0, ${i})); el.dispatchEvent(new w.Event("input", { bubbles: true }));`,
    );
    await sleep(ms);
  }
};
const clickOn = async (sel, wait = 350) => {
  await st((s) => st.move(s), sel);
  await sleep(520);
  await st(() => st.click());
  await frame(`d.querySelector(${JSON.stringify(sel)})?.click();`);
  await sleep(wait);
};
const reveal = async (sel) => {
  const moved = await st((s) => st.reveal(s), sel);
  if (moved) await sleep(550);
};
const focus = async (
  sel,
  { on, k = 1.5, ox = 0, oy = 0, pad = 8, radius = 10, call, place } = {},
) => {
  await reveal(on ?? sel);
  if (k) await st((s, kk, x, y) => st.zoom(s, kk, x, y), on ?? sel, k, ox, oy);
  await sleep(250);
  await st((s, p, r) => st.spot(s, p, r), sel, pad, radius);
  if (call) await st((s, c, pl) => st.callout(s, c, pl), sel, call, place ?? "top");
};
const unfocus = () =>
  st(() => {
    st.callout(null);
    st.spot(null);
    st.zoom(null);
  });
const toTop = () => frame(`w.scrollTo({ top: 0, behavior: "smooth" });`);
const tidy = TIDY;
const watch = `const run = () => { ${TIDY} }; run(); if (!w.__tidy) { w.__tidy = new w.MutationObserver(() => run()); w.__tidy.observe(d.body, { subtree: true, childList: true, characterData: true }); }`;
const go = async (hash, ready) => {
  await frame(
    `w.location.hash = ${JSON.stringify(hash)}; for (let i = 0; i < 60 && !(${ready}); i++) await new Promise((r) => setTimeout(r, 50));`,
  );
  await frame(tidy);
};
const untilRollover = () => frame(`return 30 - ((w.Date.now() / 1000) % 30);`);
const rollIn = (seconds) =>
  frame(
    `const real = w.__realNow || (w.__realNow = w.Date.now.bind(w.Date)); const left = 30 - ((real() / 1000) % 30); const shift = (left - ${seconds} + 30) % 30; w.Date.now = () => real() + shift * 1000;`,
  );

try {
  beat("intro");
  await st((h) => st.card(h), T.intro);
  await sleep(1100);
  beat("zero-knowledge model");
  await st((h) => st.card(h), SC.model);
  await sleep(3000);
  await st(() => st.nocard());
  pause();
  await st((l) => st.device(`/popup.html?locale=${l}`, 600, 430, 1.2), locale);
  await sleep(1800);
  await frame(watch);
  resume();

  beat("vault search");
  await st(() => st.show(true));
  await st(([k, h]) => st.cap(k, h), T.c1);
  await sleep(800);
  await clickOn("#search", 100);
  await type("#search", "goo", 70);
  await sleep(250);
  await mark(
    "google",
    `return [...d.querySelectorAll(".row")].find((r) => r.innerText.includes("Google"));`,
  );
  await st((s) => st.move(s), cam("google"));
  await sleep(600);
  await rollIn(2.9);

  beat("2FA rollover");
  await st(() => st.click());
  await frame(`d.querySelector('[data-cam="google"]')?.click();`);
  await sleep(350);
  await mark(
    "otp",
    `return [...d.querySelectorAll("#detail .field-row")].find((e) => e.querySelector(".totp-code"));`,
  );
  await st(() => st.hideCursor());
  await st(([k, h]) => st.cap(k, h), T.c2);
  await focus(cam("otp"), { k: 2.1, oy: -20, pad: 6 });
  const left = await untilRollover();
  console.log(`zoomed on the code ${left.toFixed(2)}s before it rolls over`);
  await sleep(left * 1000 + 1200);
  await unfocus();
  await sleep(350);

  beat("share link");
  await st(([k, h]) => st.cap(k, h), T.c3);
  await mark(
    "share",
    `return [...d.querySelectorAll("#detail button")].find((x) => /^(Share|Chia sẻ)$/.test(x.getAttribute("aria-label") || ""));`,
  );
  await clickOn(cam("share"), 300);
  await mark("form", `return d.querySelector("#form-share");`);
  await st(() => st.zoom('[data-cam="form"]', 1.4, 0, 0));
  await sleep(250);
  await mark(
    "ttl",
    `return d.querySelector('#form-share input[name=ttl][value="604800"]')?.closest("label");`,
  );
  await clickOn(cam("ttl"), 0);
  await frame(`d.querySelector('#form-share input[name=ttl][value="604800"]')?.click();`);
  await sleep(300);
  await mark("make", `return d.querySelector("#form-share button[type=submit]");`);
  await clickOn(cam("make"), 500);
  await st(() => st.hideCursor());
  await frame(tidy);
  await mark("result", `return d.querySelector("#share-result");`);
  await mark("link", `return d.querySelector("#share-url");`);
  await focus(cam("link"), { on: cam("result"), k: 1.5, pad: 6, radius: 12, oy: 40 });
  await sleep(1300);
  await unfocus();
  await sleep(300);
  await st(() => {
    st.show(false);
    st.nocap();
  });
  await sleep(350);

  beat("team key diagram");
  await st((h) => st.card(h), SC.team);
  await sleep(3700);
  await st(() => st.nocard());
  pause();
  await st((o, p) => st.device(`/app/#/${o}/projects/${p}`, 1240, 700, 0.8), ORG, PROJECT);
  await sleep(1200);
  await frame(
    `const set = (n, v) => { const el = d.querySelector("input[name=" + n + "]"); el.value = v; el.dispatchEvent(new w.Event("input", { bubbles: true })); }; set("email", ${JSON.stringify(ACCOUNTS.owner.email)}); set("password", ${JSON.stringify(ACCOUNTS.owner.password)}); d.querySelector("form").requestSubmit(); for (let i = 0; i < 120 && !d.querySelector("main table"); i++) await new Promise((r) => setTimeout(r, 100));`,
  );
  await sleep(700);
  await frame(watch);
  resume();

  beat("missing secret");
  await st(() => st.show(true));
  await st(([k, h]) => st.cap(k, h), T.c4);
  await sleep(600);
  await mark("miss", `return d.querySelector("main .cell-missing");`);
  await mark("missrow", `return d.querySelector("main .cell-missing")?.closest("tr");`);
  await focus(cam("miss"), {
    on: cam("missrow"),
    k: 1.45,
    ox: 0,
    pad: 8,
    radius: 8,
    call: T.missing,
  });
  await sleep(1800);
  await unfocus();
  await toTop();
  await sleep(450);

  beat("add a secret to every environment");
  await st(([k, h]) => st.cap(k, h), T.c5);
  await mark(
    "add",
    `return [...d.querySelectorAll("main button")].find((x) => x.className.includes("primary") && /secret/i.test(x.textContent));`,
  );
  await clickOn(cam("add"), 350);
  await st(() => st.hideCursor());
  await mark("dlg", `return d.querySelector("dialog[open]");`);
  await st(() => st.zoom('[data-cam="dlg"]', 1.35, 40, -10));
  await sleep(350);
  const secretName = await frame(
    `const have = new Set([...d.querySelectorAll("main td")].map((c) => c.textContent.trim())); return ${JSON.stringify(["ANTHROPIC_API_KEY", "GITHUB_TOKEN", "SLACK_WEBHOOK_URL", "TWILIO_AUTH_TOKEN", "MAILGUN_API_KEY", "ALGOLIA_API_KEY", "MAPBOX_TOKEN"])}.find((x) => !have.has(x));`,
  );
  await type("dialog[open] input:not([type=radio]):not([type=checkbox])", secretName, 28);
  for (const [i, v] of ["sk-dev-4f2c91", "sk-stg-9a1e07", "sk-prod-7d3b55"].entries()) {
    await frame(
      `const a = d.querySelectorAll("dialog[open] textarea")[${i}]; if (a) { Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, "value").set.call(a, ${JSON.stringify(v)}); a.dispatchEvent(new w.Event("input", { bubbles: true })); }`,
    );
    await sleep(220);
  }
  await sleep(500);
  await frame(`d.querySelector("dialog[open] button[type=submit]")?.click();`);
  await sleep(400);
  await st(() => st.zoom(null));
  await sleep(800);
  await frame(tidy);

  beat("agent hosts");
  await st(([k, h]) => st.cap(k, h), T.hosts);
  await mark("prod", `return [...d.querySelectorAll("main a[role=tab]")][3];`);
  await clickOn(cam("prod"), 350);
  await mark(
    "apply",
    `return [...d.querySelectorAll("main .alert.suggest button")].find((x) => x.className.includes("primary"));`,
  );
  await clickOn(cam("apply"), 700);
  await st(() => st.hideCursor());
  await mark(
    "chip",
    `return [...d.querySelectorAll("main .host-chip:not(.suggested)")].find((c) => /openai/.test(c.textContent));`,
  );
  await focus(cam("chip"), { k: 1.7, ox: -40, oy: 20, pad: 6, radius: 8, call: T.onlyHost });
  await sleep(1500);
  await unfocus();
  await sleep(300);

  beat("protect production");
  await st(([k, h]) => st.cap(k, h), T.protect);
  await mark(
    "more",
    `return [...d.querySelectorAll("main button.icon-button")].find((x) => /^(More|Thêm)$/.test(x.getAttribute("aria-label") || ""));`,
  );
  await clickOn(cam("more"), 250);
  await mark(
    "lockitem",
    `return [...d.querySelectorAll("[role=menuitem]")].find((x) => /^(Protect|Bảo vệ)/.test(x.textContent.trim()));`,
  );
  await clickOn(cam("lockitem"), 650);
  await st(() => st.hideCursor());
  await mark("pill", `return d.querySelector("main .toolbar .lock-pill");`);
  await focus(cam("pill"), { k: 1.8, ox: -80, oy: 10, pad: 6, radius: 999, call: T.adminOnly });
  await sleep(1500);
  await unfocus();
  await sleep(300);

  beat("invite with domain lock");
  await go(`#/${ORG}/members`, `/members/.test(w.location.hash) && d.querySelector("main table")`);
  await st(([k, h]) => st.cap(k, h), T.c6);
  await sleep(300);
  await mark(
    "invite",
    `return [...d.querySelectorAll("main button")].find((x) => x.className.includes("primary"));`,
  );
  await clickOn(cam("invite"), 150);
  await frame(tidy);
  await st(() => st.hideCursor());
  await mark("idlg", `return d.querySelector("dialog[open]");`);
  await st(() => st.zoom('[data-cam="idlg"]', 1.45, 40, -10));
  await sleep(300);
  await type("dialog[open] input[name=email]", T.invite, 32);
  await frame(tidy);
  await mark("hint", `return d.querySelector("dialog[open] .field-hint");`);
  await st((s) => st.spot(s, 6, 8), cam("hint"));
  await sleep(1400);
  await unfocus();
  await sleep(300);
  await frame(`d.querySelector("dialog[open] .btn:not([type=submit])")?.click();`);
  await sleep(300);

  beat("audit log");
  await go(
    `#/${ORG}/activity`,
    `/activity/.test(w.location.hash) && d.querySelector("main table tbody tr")`,
  );
  await st(([k, h]) => st.cap(k, h), T.c7);
  await mark(
    "secrets",
    `return [...d.querySelectorAll("main .segmented button, main [role=tablist] button, main [role=tab]")].find((x) => /^Secrets?$/.test(x.textContent.trim()));`,
  );
  await clickOn(cam("secrets"), 400);
  await st(() => st.hideCursor());
  await mark(
    "chain",
    `return [...d.querySelectorAll("main .badge, main [class*=badge]")].find((x) => /intact|nguyên vẹn|verified/i.test(x.textContent));`,
  );
  await mark("first", `return d.querySelector("main table tbody tr");`);
  await focus(cam("chain"), { on: cam("first"), k: 1.3, oy: 40, pad: 6, radius: 999 });
  await sleep(1400);
  await unfocus();
  await st(() => {
    st.show(false);
    st.nocap();
  });
  await sleep(400);

  beat("CI");
  await st((h) => st.card(h), SC.ci);
  await sleep(2600);
  beat("AI agents");
  await st((h) => st.card(h), SC.agent);
  await sleep(4800);
  beat("outro");
  await st((h) => st.card(h), T.outro);
  await sleep(1900);
} finally {
  recording = false;
  await b.send("Page.stopScreencast").catch(() => {});
  b.close();
  for (let k = 0; k < frames.length; k++)
    frames[k].duration =
      k + 1 < frames.length ? Math.max(0.001, frames[k + 1].t - frames[k].t) : 0.5;
}
writeFileSync(
  path.join(out, "list.txt"),
  frames.map((f) => `file '${f.file}'\nduration ${f.duration.toFixed(3)}`).join("\n") +
    `\nfile '${frames.at(-1).file}'\n`,
);
const start = frames[0]?.t ?? 0;
const timeline = beats
  .map(([t, name]) => `${Math.max(0, t - start).toFixed(1)}s ${name}`)
  .join("\n");
writeFileSync(path.join(out, "beats.txt"), timeline + "\n");
console.log(timeline);
console.log(`${frames.length} frames, ${frames.reduce((s, f) => s + f.duration, 0).toFixed(1)}s`);
