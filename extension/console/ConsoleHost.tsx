import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { Identity } from "../../src/core/identity.js";
import { describeError } from "../../src/i18n/index.js";
import { ensureIdentity } from "../lib/identity.js";
import { useT } from "../ui/i18n.js";
import { ConsoleApp, type PersonalPage } from "./ConsoleApp.js";

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
    void ensureIdentity(vaultKey)
      .then(setIdentity)
      .catch((failure) => setError(describeError(failure, t)));
  }, [vaultKey]);

  if (!identity) {
    return (
      <div className="console loading">
        {error ? <p className="alert">{error}</p> : <span className="spinner" />}
      </div>
    );
  }
  return <ConsoleApp identity={identity} account={account} footer={footer} personal={personal} />;
}
