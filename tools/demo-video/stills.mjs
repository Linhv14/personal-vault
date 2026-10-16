import { launch, sleep } from "./cdp.mjs";
import { TIDY } from "./tidy.mjs";
import { BASE, DEMO } from "./config.mjs";
const OUT = process.argv[2];
const ORG = DEMO.org;
const PROJECT = DEMO.project;
const b = await launch(9336);
try {
  for (const locale of ["en", "vi"]) {
    await b.viewport(600, 430, 2);
    await b.goto(`${BASE}/popup.html?locale=${locale}`, 2500);
    await b.eval(async () => {
      document.querySelectorAll(".promo").forEach((el) => el.remove());
      await new Promise((r) => setTimeout(r, 300));
      [...document.querySelectorAll(".row")].find((r) => r.innerText.includes("Google"))?.click();
      await new Promise((r) => setTimeout(r, 700));
    });
    await b.eval(new Function("const d = document; " + TIDY));
    await b.shot(`${OUT}/popup-${locale}.png`);
  }
} finally {
  b.close();
}
