import { launch } from "./cdp.mjs";
import { BASE } from "./config.mjs";
const b = await launch(9335);
try {
  for (const l of ["en", "vi"]) {
    await b.viewport(1200, 630, 1);
    await b.goto(`${BASE}/og.html?${l}`, 800);
    await b.shot(`${process.argv[2]}/og-${l}.png`);
  }
} finally {
  b.close();
}
