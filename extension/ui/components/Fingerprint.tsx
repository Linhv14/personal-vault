import { useEffect, useState } from "preact/hooks";
import { fingerprint } from "#core/identity.js";

export function Fingerprint({
  publicKey,
  large = false,
}: {
  publicKey: string | null;
  large?: boolean;
}) {
  const [print, setPrint] = useState("");
  useEffect(() => {
    if (publicKey) {
      void fingerprint(publicKey).then(setPrint);
    }
  }, [publicKey]);
  if (!large) {
    return <code className="fingerprint">{publicKey ? print : "—"}</code>;
  }
  return (
    <code className="fingerprint large" aria-label={print}>
      {print.split(" ").map((group, index) => (
        <span key={index}>{group}</span>
      ))}
    </code>
  );
}
