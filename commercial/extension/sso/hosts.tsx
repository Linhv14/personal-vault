import { useEffect } from "preact/hooks";
import { setLocal } from "#ext/lib/storage.js";
import {
  LINK_CHANNEL,
  readLinkOutcome,
  readOutcome,
  webReturnTarget,
} from "#commercial/core/sso-model.js";
import { SsoSignIn, type SsoHost } from "./SsoSignIn.js";

type OpenVault = SsoHost["openVault"];

const TAB_PARAM = "sso";
const SERVER_PARAM = "server";
const VERIFIER_KEY = "7key-sso-verifier";

export function ssoTabRequest(): { lookup: string; server: string } | null {
  const params = new URLSearchParams(location.search);
  const lookup = params.get(TAB_PARAM);
  const server = params.get(SERVER_PARAM);
  return lookup !== null && server ? { lookup, server } : null;
}

function openInTab(apiUrl: string, lookup: string): void {
  const query = new URLSearchParams({ [TAB_PARAM]: lookup, [SERVER_PARAM]: apiUrl });
  void chrome.tabs
    .create({ url: chrome.runtime.getURL(`popup/popup.html?${query.toString()}`) })
    .then(() => window.close());
}

async function launchInBrowser(url: string): Promise<string | null> {
  return (await chrome.identity.launchWebAuthFlow({ url, interactive: true })) ?? null;
}

export interface LinkLauncher {
  returnTo: string;
  launch(url: string, signal: AbortSignal): Promise<string | null>;
}

function waitForPopup(url: string, signal: AbortSignal): Promise<string | null> {
  return new Promise((resolve) => {
    const channel = new BroadcastChannel(LINK_CHANNEL);
    const finish = (result: string | null) => {
      channel.close();
      resolve(result);
    };
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (typeof event.data === "string" && readLinkOutcome(event.data)) {
        finish(event.data);
      }
    };
    signal.addEventListener("abort", () => finish(null), { once: true });
    if (!window.open(url, LINK_CHANNEL, "popup,width=520,height=720")) {
      finish(null);
    }
  });
}

export function linkLauncher(): LinkLauncher {
  if (typeof chrome !== "undefined" && typeof chrome.identity?.getRedirectURL === "function") {
    return {
      returnTo: chrome.identity.getRedirectURL(),
      launch: (url) => launchInBrowser(url).catch(() => null),
    };
  }
  return { returnTo: webReturnTarget(location.origin), launch: waitForPopup };
}

export function relayLinkOutcome(): boolean {
  const url = location.href;
  if (!readLinkOutcome(url)) {
    return false;
  }
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  const channel = new BroadcastChannel(LINK_CHANNEL);
  channel.postMessage(url);
  channel.close();
  window.close();
  return true;
}

export function PopupSsoSignIn({
  apiUrl,
  initial = "",
  expectedEmail,
  openVault,
  onCancel,
}: {
  apiUrl: string;
  initial?: string;
  expectedEmail?: string;
  openVault: OpenVault;
  onCancel: () => void;
}) {
  const request = ssoTabRequest();
  const server = (request?.server ?? apiUrl).replace(/\/$/, "");
  useEffect(() => {
    if (request) {
      void setLocal({ apiUrl: server });
    }
  }, []);
  const host: SsoHost = {
    apiUrl: server,
    returnTo: chrome.identity?.getRedirectURL() ?? "",
    launch: launchInBrowser,
    openVault,
  };
  return (
    <SsoSignIn
      host={host}
      initial={request?.lookup ?? initial}
      autoStart={request !== null && request.lookup !== ""}
      expectedEmail={expectedEmail}
      delegate={request ? undefined : (lookup) => openInTab(server, lookup)}
      onCancel={onCancel}
    />
  );
}

function sessionStore(): Storage | null {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

export function takeWebSsoReturn(): { url: string; verifier: string } | null {
  const url = location.href;
  if (!readOutcome(url)) {
    return null;
  }
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  const store = sessionStore();
  const verifier = store?.getItem(VERIFIER_KEY) ?? "";
  store?.removeItem(VERIFIER_KEY);
  return { url, verifier };
}

export function WebSsoSignIn({
  resume,
  openVault,
  onCancel,
}: {
  resume: { url: string; verifier: string } | null;
  openVault: OpenVault;
  onCancel: () => void;
}) {
  const host: SsoHost = {
    apiUrl: location.origin,
    returnTo: webReturnTarget(location.origin),
    launch: async (url, verifier) => {
      sessionStore()?.setItem(VERIFIER_KEY, verifier);
      location.assign(url);
      return null;
    },
    openVault,
  };
  return <SsoSignIn host={host} resume={resume} variant="web" onCancel={onCancel} />;
}
