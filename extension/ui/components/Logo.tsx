import { APP_NAME, WORDMARK } from "../../../src/core/brand.js";
import { logoSvg } from "../../../src/ui/logo.js";

export function Logo({
  size,
  animated = false,
  bare = false,
}: {
  size: number;
  animated?: boolean;
  bare?: boolean;
}) {
  return (
    <span
      className="logo"
      style={{ width: `${size}px`, height: `${size}px` }}
      dangerouslySetInnerHTML={{ __html: logoSvg("", animated, bare) }}
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
