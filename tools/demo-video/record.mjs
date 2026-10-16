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
      intro: "<h1><b>7</b>key</h1><p>Mật khẩu · 2FA · Secret của team</p>",
      c1: ["Vault", "Mọi tài khoản.<br><b>Một nơi.</b>"],
      c2: ["2FA", "Mã 2FA <b>có sẵn.</b>"],
      c3: ["Chia sẻ", "Gửi tài khoản.<br><b>Tự hết hạn.</b>"],
      c4: ["Team", "Thấy ngay <b>chỗ còn thiếu.</b>"],
      c5: ["Secret", "Mọi môi trường.<br><b>Một lần.</b>"],
      c6: ["Thành viên", "Mời team.<br><b>Khoá theo domain.</b>"],
      c7: ["Nhật ký", "Mọi lần đọc<br><b>đều được ghi.</b>"],
      ci: '<p class="big">CI <b>không copy-paste.</b></p><pre>- uses: <i>Linhv14/7key-action@v1</i>\n  with:\n    key: ${{ secrets.SEVENKEY_KEY }}</pre>',
      ai: '<p class="big">Sắp có: <b>AI agent</b><br>dùng key mà không thấy.</p><div class="row"><div class="tile"><strong>Claude Code</strong><span>Proxy chèn key khi gọi API</span></div><div class="tile"><strong>Codex</strong><span>Chỉ thấy placeholder</span></div><div class="tile"><strong>Nhật ký</strong><span>Mọi lần dùng được ghi lại</span></div></div>',
      e2e: '<p class="big">Mã hoá <b>ngay trên máy bạn.</b></p><p>Server chỉ giữ bản mã. Không ai đọc được, kể cả chúng tôi.</p>',
      outro:
        '<h1><b>7</b>key</h1><p>Miễn phí cho cá nhân · 7key.online</p><span class="cta">Cài cho Chrome</span>',
      secret: "ANTHROPIC_API_KEY",
      invite: "emma@northwind.dev",
    }
  : {
      intro: "<h1><b>7</b>key</h1><p>Passwords · 2FA · Team secrets</p>",
      c1: ["Vault", "Every login.<br><b>One place.</b>"],
      c2: ["2FA", "2FA codes, <b>built in.</b>"],
      c3: ["Share", "Share a login.<br><b>It expires.</b>"],
      c4: ["Teams", "See what's <b>missing.</b>"],
      c5: ["Secrets", "Every environment.<br><b>At once.</b>"],
      c6: ["Members", "Invite your team.<br><b>Lock it to your domain.</b>"],
      c7: ["Audit", "Every read,<br><b>logged.</b>"],
      ci: '<p class="big">CI, <b>without copy-paste.</b></p><pre>- uses: <i>Linhv14/7key-action@v1</i>\n  with:\n    key: ${{ secrets.SEVENKEY_KEY }}</pre>',
      ai: '<p class="big">Coming: <b>AI agents</b><br>use keys they never see.</p><div class="row"><div class="tile"><strong>Claude Code</strong><span>A proxy adds the key on the way out</span></div><div class="tile"><strong>Codex</strong><span>Only ever sees a placeholder</span></div><div class="tile"><strong>Audit</strong><span>Every use is logged</span></div></div>',
      e2e: '<p class="big">Encrypted <b>on your device.</b></p><p>The server stores ciphertext. Nobody can read it, including us.</p>',
      outro:
        '<h1><b>7</b>key</h1><p>Free for personal use · 7key.online</p><span class="cta">Add to Chrome</span>',
      secret: "OPENAI_API_KEY",
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
let recording = true;
let n = 0;
b.on((m) => {
  if (m.method !== "Page.screencastFrame" || !recording) return;
  const file = path.join(out, `f${String(n++).padStart(5, "0")}.jpg`);
  writeFileSync(file, Buffer.from(m.params.data, "base64"));
  frames.push({ file, t: m.params.metadata.timestamp });
  b.send("Page.screencastFrameAck", { sessionId: m.params.sessionId }).catch(() => {});
});
await b.send("Page.startScreencast", {
  format: "jpeg",
  quality: 88,
  maxWidth: 1920,
  maxHeight: 1080,
  everyNthFrame: 1,
});
const recorder = Promise.resolve();
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
const clickOn = async (sel, wait = 450) => {
  await st((s) => st.move(s), sel);
  await sleep(560);
  await st(() => st.click());
  await frame(`d.querySelector(${JSON.stringify(sel)})?.click();`);
  await sleep(wait);
};
const tidy = TIDY;
const watch = `const run = () => { ${TIDY} }; run(); if (!w.__tidy) { w.__tidy = new w.MutationObserver(() => run()); w.__tidy.observe(d.body, { subtree: true, childList: true, characterData: true }); }`;

try {
  await st((h) => st.card(h), T.intro);
  await sleep(1500);
  await st((h) => st.card(h), SC.model);
  await sleep(4600);
  await st(() => st.nocard());
  await sleep(300);

  await st((l) => st.device(`/popup.html?locale=${l}`, 600, 430, 1.2), locale);
  await sleep(1800);
  await frame(watch);
  await st(() => st.show(true));
  await st(([k, h]) => st.cap(k, h), T.c1);
  await sleep(900);
  await clickOn("#search", 200);
  await type("#search", "goo", 90);
  await sleep(300);
  await mark(
    "google",
    `return [...d.querySelectorAll(".row")].find((r) => r.innerText.includes("Google"));`,
  );
  await clickOn(cam("google"), 700);
  await mark(
    "otp",
    `const all = [...d.querySelectorAll("#detail *")].filter((e) => /2FA/.test(e.innerText || "") && e.getBoundingClientRect().height > 30 && e.getBoundingClientRect().height < 90); return all[all.length - 1];`,
  );
  await st(() => st.hideCursor());
  await st(([k, h]) => st.cap(k, h), T.c2);
  await st(() => {
    st.zoom('[data-cam="otp"]', 1.9, 0, -40);
  });
  await sleep(800);
  await st(() => st.spot('[data-cam="otp"]'));
  await sleep(2000);
  await st(() => {
    st.spot(null);
    st.zoom(null);
  });
  await sleep(700);
  await st(() => st.nocap());
  await st(() => st.show(false));
  await sleep(500);
  await st((h) => st.card(h), SC.team);
  await sleep(3800);
  await st(() => st.nocard());
  await sleep(300);

  await st((o, p) => st.device(`/app/#/${o}/projects/${p}`, 1240, 700, 0.8), ORG, PROJECT);
  await sleep(1200);
  await frame(
    `const set = (n, v) => { const el = d.querySelector("input[name=" + n + "]"); el.value = v; el.dispatchEvent(new w.Event("input", { bubbles: true })); }; set("email", ${JSON.stringify(ACCOUNTS.owner.email)}); set("password", ${JSON.stringify(ACCOUNTS.owner.password)}); d.querySelector("form").requestSubmit(); for (let i = 0; i < 120 && !d.querySelector("main table"); i++) await new Promise((r) => setTimeout(r, 100));`,
  );
  await sleep(700);
  await frame(watch);
  await st(() => st.show(true));
  await st(([k, h]) => st.cap(k, h), T.c4);
  await sleep(700);
  await mark("matrix", `return d.querySelector("main table");`);
  await mark(
    "missrow",
    `return [...d.querySelectorAll("main tbody tr")].find((r) => r.querySelector(".cell-missing"));`,
  );
  await mark("miss", `return d.querySelector(".cell-missing");`);
  await st(() => st.zoom('[data-cam="missrow"]', 1.5, 0, -10));
  await sleep(900);
  await st(() => st.spot('[data-cam="miss"]', 40));
  await st(
    (txt) => st.callout('[data-cam="miss"]', txt),
    vi ? "Thiếu ở Staging" : "Missing in Staging",
  );
  await sleep(2300);
  await st(() => st.callout(null));
  await st(() => {
    st.spot(null);
    st.zoom(null);
  });
  await sleep(600);

  await st(([k, h]) => st.cap(k, h), T.c5);
  await mark(
    "add",
    `return [...d.querySelectorAll("main button")].find((x) => x.className.includes("primary"));`,
  );
  await clickOn(cam("add"), 500);
  await st(() => st.hideCursor());
  await mark("dlg", `return d.querySelector("dialog[open]");`);
  await st(() => st.zoom('[data-cam="dlg"]', 1.35, 40, 0));
  await sleep(500);
  const secretName = await frame(
    `const have = new Set([...d.querySelectorAll("main td")].map((c) => c.textContent.trim())); return ${JSON.stringify(["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GITHUB_TOKEN", "SLACK_WEBHOOK_URL", "TWILIO_AUTH_TOKEN", "MAILGUN_API_KEY", "ALGOLIA_API_KEY", "MAPBOX_TOKEN"])}.find((x) => !have.has(x));`,
  );
  await type("dialog[open] input:not([type=radio]):not([type=checkbox])", secretName, 40);
  for (const [i, v] of ["sk-dev-4f2c91", "sk-stg-9a1e07", "sk-prod-7d3b55"].entries()) {
    await frame(
      `const a = d.querySelectorAll("dialog[open] textarea")[${i}]; if (a) { Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, "value").set.call(a, ${JSON.stringify(v)}); a.dispatchEvent(new w.Event("input", { bubbles: true })); }`,
    );
    await sleep(320);
  }
  await sleep(1300);
  await frame(`d.querySelector("dialog[open] button[type=submit]")?.click();`);
  await sleep(500);
  await st(() => st.zoom(null));
  await sleep(1600);
  await frame(tidy);

  await frame(
    `w.location.hash = "#/${ORG}/members"; for (let i = 0; i < 40 && !/members/.test(w.location.hash + d.querySelector("main h1")?.textContent); i++) await new Promise((r) => setTimeout(r, 50));`,
  );
  await sleep(1100);
  await frame(tidy);
  await st(([k, h]) => st.cap(k, h), T.c6);
  await mark(
    "invite",
    `return [...d.querySelectorAll("main button")].find((x) => x.className.includes("primary"));`,
  );
  await clickOn(cam("invite"), 120);
  await frame(tidy);
  await sleep(350);
  await st(() => st.hideCursor());
  await frame(tidy);
  await mark("idlg", `return d.querySelector("dialog[open]");`);
  await st(() => st.zoom('[data-cam="idlg"]', 1.4, 40, 0));
  await sleep(400);
  await type("dialog[open] input[name=email]", T.invite, 45);
  await frame(tidy);
  await mark("hint", `return d.querySelector("dialog[open] .field-hint");`);
  await st(() => st.spot('[data-cam="hint"]', 70));
  await sleep(1700);
  await st(() => {
    st.spot(null);
    st.zoom(null);
  });
  await frame(`d.querySelector("dialog[open] .btn:not([type=submit])")?.click();`);
  await sleep(500);

  await st(() => {
    st.show(false);
    st.nocap();
  });
  await sleep(500);
  await st((h) => st.card(h), SC.ci);
  await sleep(4600);
  await st((h) => st.card(h), SC.agent);
  await sleep(7200);
  await st((h) => st.card(h), T.outro);
  await sleep(2600);
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
console.log(`${frames.length} frames, ${frames.reduce((s, f) => s + f.duration, 0).toFixed(1)}s`);
