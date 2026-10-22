import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { Identity } from "../../src/core/identity.js";
import { describeError } from "../../src/i18n/index.js";
import { ensureIdentity } from "../lib/identity.js";
import { useT } from "../ui/i18n.js";
import { ConsoleApp, type PersonalPage } from "./ConsoleApp.js";
import { ShellSkeleton } from "./components.js";
import { prefetchConsole } from "./data.js";

export function ConsoleHost({
  vaultKey,
  account,
  footer,
  personal,
}: {
  vaultKey: CryptoKey;
  account: string;
  footer?: ComponentChildren;
  personal?: PersonalPage[];
}) {
  const t = useT();
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIdentity(null);
    prefetchConsole();
    void ensureIdentity(vaultKey)
      .then(setIdentity)
      .catch((failure) => setError(describeError(failure, t)));
  }, [vaultKey]);

  if (error) {
    return (
      <div className="console loading">
        <p className="alert">{error}</p>
      </div>
    );
  }
  if (!identity) {
    return <ShellSkeleton />;
  }
  return <ConsoleApp identity={identity} account={account} footer={footer} personal={personal} />;
}
