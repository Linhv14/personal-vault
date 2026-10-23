import { useEffect, useState } from "preact/hooks";
import { localeSignal } from "#ext/ui/i18n.js";
import {
  LINK_CHANNEL,
  readLinkOutcome,
  readOutcome,
  webReturnTarget,
} from "#commercial/core/sso-model.js";
import {
  clearPending,
  readPending,
  startInBackground,
  watchPending,
  type SsoPending,
} from "./flow.js";
import { SsoSignIn, type SsoHost } from "./SsoSignIn.js";

type OpenVault = SsoHost["openVault"];

const VERIFIER_KEY = "7key-sso-verifier";

export function useSsoPending(): SsoPending | null {
  const [pending, setPending] = useState<SsoPending | null>(null);
  useEffect(() => {
    void readPending().then(setPending);
    return watchPending(setPending);
  }, []);
  return pending;
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
  pending,
  openVault,
  onCancel,
}: {
  apiUrl: string;
  initial?: string;
  expectedEmail?: string;
  pending: SsoPending | null;
  openVault: OpenVault;
  onCancel: () => void;
}) {
  const server = (pending?.server ?? apiUrl).replace(/\/$/, "");
  const host: SsoHost = {
    apiUrl: server,
    returnTo: chrome.identity?.getRedirectURL() ?? "",
    launch: async (authorizeUrl, verifier) => {
      startInBackground({
        server,
        authorizeUrl,
        verifier,
        expectedEmail: expectedEmail ?? null,
        locale: localeSignal.value,
      });
      return null;
    },
    openVault: async (...args) => {
      await openVault(...args);
      await clearPending();
    },
  };
  return (
    <SsoSignIn
      key={pending?.at ?? 0}
      host={host}
      initial={initial}
      resumed={pending}
      expectedEmail={expectedEmail}
      onCancel={() => {
        void clearPending();
        onCancel();
      }}
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
