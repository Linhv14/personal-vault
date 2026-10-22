import { registrableDomain } from "../../../src/core/site.js";

const IP_ADDRESS = /^[\d.]+$|:/;

export function resolveRpId(origin: string, requested: string | undefined): string | null {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const rpId = (requested ?? host).toLowerCase();
  if (!rpId) {
    return null;
  }
  if (IP_ADDRESS.test(host)) {
    return rpId === host ? rpId : null;
  }
  if (rpId !== host && !host.endsWith(`.${rpId}`)) {
    return null;
  }
  const site = registrableDomain(url.href);
  if (!site || !(rpId === site || rpId.endsWith(`.${site}`))) {
    return null;
  }
  return rpId;
}
