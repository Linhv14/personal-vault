import { useState } from "preact/hooks";
import { APP_NAME } from "../../../src/core/brand.js";
import { logoSvg } from "../../../src/ui/logo.js";

let logoCount = 0;

export function Logo({ size }: { size: number }) {
  const [id] = useState(() => `onepw-logo-${++logoCount}`);
  return (
    <span
      className="logo"
      style={{ width: `${size}px`, height: `${size}px` }}
      dangerouslySetInnerHTML={{ __html: logoSvg(id) }}
    />
  );
}

export function Wordmark() {
  return (
    <span className="wordmark">
      <span className="wordmark-accent">{APP_NAME.slice(0, 1)}</span>
      {APP_NAME.slice(1)}
    </span>
  );
}
