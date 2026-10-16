import { useState } from "preact/hooks";
import { APP_NAME, WORDMARK } from "../../../src/core/brand.js";
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
    <span className="wordmark" aria-label={APP_NAME}>
      <span className="wordmark-accent">{WORDMARK.accent}</span>
      {WORDMARK.rest}
    </span>
  );
}
