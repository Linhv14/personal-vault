export type CborValue = number | string | Uint8Array | CborValue[] | Map<CborValue, CborValue>;

function head(major: number, length: number): number[] {
  if (length < 24) return [(major << 5) | length];
  if (length < 0x100) return [(major << 5) | 24, length];
  if (length < 0x10000) return [(major << 5) | 25, length >> 8, length & 0xff];
  return [
    (major << 5) | 26,
    (length >>> 24) & 0xff,
    (length >> 16) & 0xff,
    (length >> 8) & 0xff,
    length & 0xff,
  ];
}

function encodeInto(value: CborValue, out: number[]): void {
  if (typeof value === "number") {
    if (!Number.isInteger(value)) throw new TypeError("Only integers are supported");
    if (value >= 0) out.push(...head(0, value));
    else out.push(...head(1, -1 - value));
  } else if (typeof value === "string") {
    const bytes = new TextEncoder().encode(value);
    out.push(...head(3, bytes.length), ...bytes);
  } else if (value instanceof Uint8Array) {
    out.push(...head(2, value.length), ...value);
  } else if (Array.isArray(value)) {
    out.push(...head(4, value.length));
    for (const item of value) encodeInto(item, out);
  } else {
    out.push(...head(5, value.size));
    for (const [key, item] of value) {
      encodeInto(key, out);
      encodeInto(item, out);
    }
  }
}

export function encodeCbor(value: CborValue): Uint8Array {
  const out: number[] = [];
  encodeInto(value, out);
  return new Uint8Array(out);
}
