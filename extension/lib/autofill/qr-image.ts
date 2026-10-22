const MAX_QR_IMAGE_BYTES = 512 * 1024;

export async function fetchQrImage(url: string): Promise<string | null> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return null;
  }
  if (target.protocol !== "https:") {
    return null;
  }
  try {
    const response = await fetch(target, { credentials: "omit", redirect: "error" });
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !/^image\/(png|gif|jpeg|webp|svg\+xml)\b/.test(type)) {
      return null;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > MAX_QR_IMAGE_BYTES) {
      return null;
    }
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return `data:${type.split(";")[0]};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}
