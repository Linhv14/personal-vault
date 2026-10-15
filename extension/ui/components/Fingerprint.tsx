import { useEffect, useState } from "preact/hooks";
import { fingerprint } from "../../../src/core/identity.js";

export function Fingerprint({ publicKey }: { publicKey: string | null }) {
  const [print, setPrint] = useState("");
  useEffect(() => {
    if (publicKey) void fingerprint(publicKey).then(setPrint);
  }, [publicKey]);
  return <code className="fingerprint">{publicKey ? print : "—"}</code>;
}
