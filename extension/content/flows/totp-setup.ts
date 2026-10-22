import { fromBase64 } from "#core/bytes.js";
import { send } from "../send.js";
import { state } from "../state.js";
import { findSetupQr, findSetupText, mentionsSetup } from "../two-factor.js";
import { banner } from "../ui/root.js";
import { showTotpBanner } from "../ui/totp-banner.js";

const MAX_SETUP_SCANS = 20;

async function scanForSetup(): Promise<void> {
  if (state.setupScans >= MAX_SETUP_SCANS || !banner.hidden) {
    return;
  }
  if (!mentionsSetup(document.body?.textContent ?? "")) {
    return;
  }
  state.setupScans++;
  const found =
    findSetupText() ??
    (await findSetupQr(document, async (url) => {
      const response = await send({ type: "autofill:qr-image", url });
      if (!response.ok || !("image" in response) || !response.image) {
        return null;
      }
      const [header = "", data = ""] = response.image.split(",");
      return new Blob([fromBase64(data)], { type: header.slice(5).split(";")[0] });
    }));
  if (!found || found === state.totpSeen) {
    return;
  }
  state.totpSeen = found;
  const response = await send({ type: "autofill:totp-found", text: found });
  if (response.ok && "totp" in response && response.totp) {
    showTotpBanner(response.totp);
  }
}

export function scheduleSetupScan(): void {
  clearTimeout(state.setupTimer);
  state.setupTimer = setTimeout(() => void scanForSetup(), 800);
}
