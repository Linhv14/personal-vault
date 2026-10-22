import { useMemo } from "preact/hooks";
import { encodeQr, qrPath } from "#core/qr.js";

const MARGIN = 4;

export function QrCode({ value, label }: { value: string; label: string }) {
  const code = useMemo(() => encodeQr(value, { level: "M" }), [value]);
  const extent = code.size + MARGIN * 2;
  return (
    <svg
      className="qr-code"
      viewBox={`0 0 ${extent} ${extent}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={extent} height={extent} fill="#fff" />
      <path d={qrPath(code, MARGIN)} fill="#000" />
    </svg>
  );
}
