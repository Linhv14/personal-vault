import { fromBase64 } from "#core/bytes.js";
import { generateTotp, parseTotpInput, type TotpConfig } from "#core/totp.js";
import type { Translate } from "#i18n/index.js";
import { nowMs } from "./state.js";
import { warn } from "../lib/log.js";

export type ScanHint = { text: string; failed: boolean } | null;

function pngFromDataUrl(dataUrl: string): Blob {
  return new Blob([fromBase64(dataUrl.slice(dataUrl.indexOf(",") + 1))], { type: "image/png" });
}

export async function scanTotpFromTab(
  t: Translate,
  setHint: (hint: ScanHint) => void,
): Promise<(TotpConfig & { raw: string }) | null> {
  if (!("BarcodeDetector" in self)) {
    setHint({ text: t("edit.scan_unsupported"), failed: true });
    return null;
  }
  setHint({ text: t("edit.scanning"), failed: false });
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab({ format: "png" });
    const bitmap = await createImageBitmap(pngFromDataUrl(dataUrl));
    const Detector = (
      self as unknown as {
        BarcodeDetector: new (options: { formats: string[] }) => {
          detect(source: ImageBitmapSource): Promise<{ rawValue: string }[]>;
        };
      }
    ).BarcodeDetector;
    const codes = await new Detector({ formats: ["qr_code"] }).detect(bitmap);
    const otpauth = codes.find((code) => code.rawValue.toLowerCase().startsWith("otpauth://"));
    if (!otpauth) {
      setHint({ text: t(codes.length ? "edit.scan_not_qr" : "edit.scan_none"), failed: true });
      return null;
    }
    const config = parseTotpInput(otpauth.rawValue);
    setHint({
      text: t("edit.scan_ok", {
        issuer: config.issuer ? t("edit.scan_ok_issuer", { issuer: config.issuer }) : "",
        code: await generateTotp(config, nowMs()),
      }),
      failed: false,
    });
    return { ...config, raw: otpauth.rawValue };
  } catch (error) {
    warn("QR scan failed:", error instanceof Error ? error.name : typeof error);
    setHint({ text: t("edit.scan_capture_failed"), failed: true });
    return null;
  }
}
