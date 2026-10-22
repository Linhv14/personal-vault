const CODE_HINT =
  /one.?time|otp|totp|2fa|mfa|two.?factor|verification.?code|verify.?code|auth(entication|enticator)?.?code|security.?code|passcode|token|mã.?(xác|bảo|otp)/i;
const SETUP_CONTEXT =
  /authenticator|two.?factor|2fa|mfa|totp|one.?time|qr.?code|setup key|secret key|xác thực|mã qr/i;
const BASE32_RUN = /\b(?:[A-Z2-7]{4}[ -]?){4,16}[A-Z2-7]{0,4}\b/g;
const OTPAUTH = /otpauth:\/\/totp\/[^\s"'<>]+/i;
const MAX_QR_CANDIDATES = 6;

type Detector = { detect(source: ImageBitmapSource): Promise<{ rawValue: string }[]> };

function visible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== "hidden";
}

function describe(input: HTMLInputElement): string {
  const label = input.labels?.[0]?.textContent ?? "";
  return [
    input.name,
    input.id,
    input.placeholder,
    input.getAttribute("aria-label") ?? "",
    label,
  ].join(" ");
}

export function isOneTimeCodeField(input: HTMLInputElement): boolean {
  if (input.type === "password" || input.type === "hidden" || input.disabled) {
    return false;
  }
  if (input.autocomplete.split(/\s+/).includes("one-time-code")) {
    return true;
  }
  if (!["text", "tel", "number", ""].includes(input.type)) {
    return false;
  }
  const short = input.maxLength > 0 && input.maxLength <= 10;
  const numeric = input.inputMode === "numeric" || /\\d|\[0-9\]/.test(input.pattern);
  return CODE_HINT.test(describe(input)) && (short || numeric || input.type === "tel");
}

export function codeBoxes(input: HTMLInputElement): HTMLInputElement[] {
  if (input.maxLength !== 1) {
    return [input];
  }
  let group: Element | null = input.parentElement;
  for (let depth = 0; group && depth < 4; depth++, group = group.parentElement) {
    const boxes = [...group.querySelectorAll<HTMLInputElement>("input")].filter(
      (box) => box.maxLength === 1 && visible(box),
    );
    if (boxes.length >= 4) {
      return boxes;
    }
  }
  return [input];
}

export function findOneTimeCodeField(root: ParentNode = document): HTMLInputElement | null {
  return (
    [...root.querySelectorAll<HTMLInputElement>("input")].find(
      (input) => visible(input) && isOneTimeCodeField(input),
    ) ?? null
  );
}

export function mentionsSetup(text: string): boolean {
  return SETUP_CONTEXT.test(text);
}

export function findSetupText(root: ParentNode = document): string | null {
  for (const link of root.querySelectorAll<HTMLAnchorElement>('a[href^="otpauth://"]')) {
    return link.href;
  }
  for (const input of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    "input, textarea",
  )) {
    const match = OTPAUTH.exec(input.value);
    if (match) {
      return match[0];
    }
  }
  const element = "body" in root ? (root as Document).body : (root as HTMLElement);
  const text = element?.innerText || element?.textContent || "";
  const uri = OTPAUTH.exec(text);
  if (uri) {
    return uri[0];
  }
  if (!mentionsSetup(text)) {
    return null;
  }
  const candidates = [
    ...[...root.querySelectorAll<HTMLInputElement>("input[readonly]")].map((input) => input.value),
    ...(text.match(BASE32_RUN) ?? []),
  ]
    .map((value) => value.replace(/[\s-]/g, "").toUpperCase())
    .filter((value) => /^[A-Z2-7]{16,64}$/.test(value) && /[2-7]/.test(value));
  return candidates[0] ?? null;
}

function qrCandidates(root: ParentNode): Element[] {
  return [...root.querySelectorAll("img, canvas, svg")]
    .filter((element) => {
      if (!visible(element)) {
        return false;
      }
      const { width, height } = element.getBoundingClientRect();
      return (
        width >= 80 && height >= 80 && Math.abs(width - height) / Math.max(width, height) < 0.2
      );
    })
    .slice(0, MAX_QR_CANDIDATES);
}

async function bitmapOf(element: Element): Promise<ImageBitmapSource | null> {
  if (element instanceof HTMLImageElement || element instanceof HTMLCanvasElement) {
    return element;
  }
  const markup = new XMLSerializer().serializeToString(element);
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function decode(detector: Detector, source: ImageBitmapSource): Promise<string | null> {
  const found = (await detector.detect(source)).find((code) =>
    code.rawValue.toLowerCase().startsWith("otpauth://totp/"),
  );
  return found?.rawValue ?? null;
}

export async function findSetupQr(
  root: ParentNode = document,
  fetchImage: (url: string) => Promise<Blob | null> = async () => null,
): Promise<string | null> {
  const Barcode = (globalThis as { BarcodeDetector?: new (options: object) => Detector })
    .BarcodeDetector;
  if (!Barcode) {
    return null;
  }
  const detector = new Barcode({ formats: ["qr_code"] });
  for (const element of qrCandidates(root)) {
    const local = await bitmapOf(element)
      .then((source) => (source ? decode(detector, source) : null))
      .catch(() => null);
    if (local) {
      return local;
    }
    const src = element instanceof HTMLImageElement ? element.currentSrc : "";
    if (!src.startsWith("https://") || new URL(src).origin === location.origin) {
      continue;
    }
    try {
      const blob = await fetchImage(src);
      const found = blob ? await decode(detector, await createImageBitmap(blob)) : null;
      if (found) {
        return found;
      }
    } catch {
      continue;
    }
  }
  return null;
}

export function fillCode(
  input: HTMLInputElement,
  code: string,
  set: (box: HTMLInputElement, value: string) => void,
) {
  const boxes = codeBoxes(input);
  if (boxes.length === code.length && boxes.length > 1) {
    boxes.forEach((box, index) => set(box, code[index]!));
    return;
  }
  set(input, code);
}
