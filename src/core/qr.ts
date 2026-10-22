import { utf8Encode } from "./bytes.js";

export type QrErrorLevel = "L" | "M" | "Q" | "H";

export interface QrCode {
  version: number;
  size: number;
  mask: number;
  modules: boolean[][];
}

const FORMAT_BITS: Record<QrErrorLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };

const ECC_CODEWORDS_PER_BLOCK: Record<QrErrorLevel, number[]> = {
  L: [
    -1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30,
    30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  M: [
    -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28,
    28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
  ],
  Q: [
    -1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30,
    30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  H: [
    -1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30,
    30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
};

const ERROR_CORRECTION_BLOCKS: Record<QrErrorLevel, number[]> = {
  L: [
    -1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14,
    15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25,
  ],
  M: [
    -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23,
    25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
  ],
  Q: [
    -1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34,
    34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68,
  ],
  H: [
    -1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35,
    37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81,
  ],
};

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

function bit(value: number, index: number): boolean {
  return ((value >>> index) & 1) !== 0;
}

function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const alignments = Math.floor(version / 7) + 2;
    result -= (25 * alignments - 10) * alignments - 55;
    if (version >= 7) {
      result -= 36;
    }
  }
  return result;
}

function dataCodewords(version: number, level: QrErrorLevel): number {
  return (
    Math.floor(rawDataModules(version) / 8) -
    ECC_CODEWORDS_PER_BLOCK[level][version]! * ERROR_CORRECTION_BLOCKS[level][version]!
  );
}

function countBits(version: number): number {
  return version <= 9 ? 8 : 16;
}

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

export function reedSolomonDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j]!, root);
      if (j + 1 < result.length) {
        result[j]! ^= result[j + 1]!;
      }
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

export function reedSolomonRemainder(
  data: readonly number[],
  divisor: readonly number[],
): number[] {
  const result = divisor.map(() => 0);
  for (const byte of data) {
    const factor = byte ^ result.shift()!;
    result.push(0);
    divisor.forEach((coefficient, index) => {
      result[index]! ^= gfMultiply(coefficient, factor);
    });
  }
  return result;
}

function interleave(data: number[], version: number, level: QrErrorLevel): number[] {
  const blocks = ERROR_CORRECTION_BLOCKS[level][version]!;
  const eccLength = ECC_CODEWORDS_PER_BLOCK[level][version]!;
  const rawCodewords = Math.floor(rawDataModules(version) / 8);
  const shortBlocks = blocks - (rawCodewords % blocks);
  const shortLength = Math.floor(rawCodewords / blocks);
  const divisor = reedSolomonDivisor(eccLength);
  const all: number[][] = [];
  for (let index = 0, offset = 0; index < blocks; index++) {
    const length = shortLength - eccLength + (index < shortBlocks ? 0 : 1);
    const chunk = data.slice(offset, offset + length);
    offset += length;
    const ecc = reedSolomonRemainder(chunk, divisor);
    if (index < shortBlocks) {
      chunk.push(0);
    }
    all.push(chunk.concat(ecc));
  }
  const result: number[] = [];
  for (let i = 0; i < all[0]!.length; i++) {
    all.forEach((block, j) => {
      if (i !== shortLength - eccLength || j >= shortBlocks) {
        result.push(block[i]!);
      }
    });
  }
  return result;
}

function encodeData(bytes: Uint8Array, version: number, level: QrErrorLevel): number[] {
  const bits: number[] = [];
  const append = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) {
      bits.push((value >>> i) & 1);
    }
  };
  append(0b0100, 4);
  append(bytes.length, countBits(version));
  for (const byte of bytes) {
    append(byte, 8);
  }
  const capacity = dataCodewords(version, level) * 8;
  append(0, Math.min(4, capacity - bits.length));
  append(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) {
    append(pad, 8);
  }
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((byte, value) => (byte << 1) | value, 0));
  }
  return codewords;
}

function alignmentPositions(version: number, size: number): number[] {
  if (version === 1) {
    return [];
  }
  const count = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
  const result = [6];
  for (let position = size - 7; result.length < count; position -= step) {
    result.splice(1, 0, position);
  }
  return result;
}

class Matrix {
  readonly modules: boolean[][];
  readonly reserved: boolean[][];

  constructor(readonly size: number) {
    this.modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    this.reserved = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  }

  fixed(x: number, y: number, dark: boolean): void {
    this.modules[y]![x] = dark;
    this.reserved[y]![x] = true;
  }
}

function drawFunctionPatterns(matrix: Matrix, version: number): void {
  const { size } = matrix;
  for (let i = 0; i < size; i++) {
    matrix.fixed(6, i, i % 2 === 0);
    matrix.fixed(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) {
          matrix.fixed(x, y, distance !== 2 && distance !== 4);
        }
      }
    }
  }
  const positions = alignmentPositions(version, size);
  const last = positions.length - 1;
  positions.forEach((cx, i) => {
    positions.forEach((cy, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) {
        return;
      }
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          matrix.fixed(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    });
  });
  drawFormatBits(matrix, "L", 0);
  if (version >= 7) {
    let remainder = version;
    for (let i = 0; i < 12; i++) {
      remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    }
    const bits = (version << 12) | remainder;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      matrix.fixed(a, b, bit(bits, i));
      matrix.fixed(b, a, bit(bits, i));
    }
  }
}

export function formatBits(level: QrErrorLevel, mask: number): number {
  const data = (FORMAT_BITS[level] << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i++) {
    remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  }
  return ((data << 10) | remainder) ^ 0x5412;
}

function drawFormatBits(matrix: Matrix, level: QrErrorLevel, mask: number): void {
  const { size } = matrix;
  const bits = formatBits(level, mask);
  for (let i = 0; i <= 5; i++) {
    matrix.fixed(8, i, bit(bits, i));
  }
  matrix.fixed(8, 7, bit(bits, 6));
  matrix.fixed(8, 8, bit(bits, 7));
  matrix.fixed(7, 8, bit(bits, 8));
  for (let i = 9; i < 15; i++) {
    matrix.fixed(14 - i, 8, bit(bits, i));
  }
  for (let i = 0; i < 8; i++) {
    matrix.fixed(size - 1 - i, 8, bit(bits, i));
  }
  for (let i = 8; i < 15; i++) {
    matrix.fixed(8, size - 15 + i, bit(bits, i));
  }
  matrix.fixed(8, size - 8, true);
}

function drawCodewords(matrix: Matrix, codewords: number[]): void {
  const { size, modules, reserved } = matrix;
  let index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) {
      right = 5;
    }
    for (let vertical = 0; vertical < size; vertical++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        if (!reserved[y]![x] && index < codewords.length * 8) {
          modules[y]![x] = bit(codewords[index >>> 3]!, 7 - (index & 7));
          index++;
        }
      }
    }
  }
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(matrix: Matrix, mask: number): void {
  const invert = MASKS[mask]!;
  for (let y = 0; y < matrix.size; y++) {
    for (let x = 0; x < matrix.size; x++) {
      if (!matrix.reserved[y]![x] && invert(x, y)) {
        matrix.modules[y]![x] = !matrix.modules[y]![x];
      }
    }
  }
}

function penalty(modules: boolean[][]): number {
  const size = modules.length;
  let result = 0;
  const addHistory = (length: number, history: number[]) => {
    if (history[0] === 0) {
      length += size;
    }
    history.pop();
    history.unshift(length);
  };
  const finderLike = (history: number[]) => {
    const n = history[1]!;
    const core =
      n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
    return (
      (core && history[0]! >= n * 4 && history[6]! >= n ? 1 : 0) +
      (core && history[6]! >= n * 4 && history[0]! >= n ? 1 : 0)
    );
  };
  const line = (get: (i: number) => boolean) => {
    let color = false;
    let run = 0;
    const history = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < size; i++) {
      if (get(i) === color) {
        run++;
        if (run === 5) {
          result += PENALTY_N1;
        } else if (run > 5) {
          result++;
        }
      } else {
        addHistory(run, history);
        if (!color) {
          result += finderLike(history) * PENALTY_N3;
        }
        color = get(i);
        run = 1;
      }
    }
    if (color) {
      addHistory(run, history);
      run = 0;
    }
    addHistory(run + size, history);
    result += finderLike(history) * PENALTY_N3;
  };
  for (let y = 0; y < size; y++) {
    line((x) => modules[y]![x]!);
  }
  for (let x = 0; x < size; x++) {
    line((y) => modules[y]![x]!);
  }
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const color = modules[y]![x];
      if (
        color === modules[y]![x + 1] &&
        color === modules[y + 1]![x] &&
        color === modules[y + 1]![x + 1]
      ) {
        result += PENALTY_N2;
      }
    }
  }
  const dark = modules.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  return result + k * PENALTY_N4;
}

export function encodeQr(
  text: string,
  options: { level?: QrErrorLevel; version?: number; mask?: number } = {},
): QrCode {
  const level = options.level ?? "M";
  const bytes = utf8Encode(text);
  let version = options.version ?? 1;
  while (4 + countBits(version) + bytes.length * 8 > dataCodewords(version, level) * 8) {
    if (options.version !== undefined || version >= 40) {
      throw new RangeError("Text too long for a QR code");
    }
    version++;
  }
  const size = version * 4 + 17;
  const codewords = interleave(encodeData(bytes, version, level), version, level);

  const build = (mask: number) => {
    const matrix = new Matrix(size);
    drawFunctionPatterns(matrix, version);
    drawCodewords(matrix, codewords);
    applyMask(matrix, mask);
    drawFormatBits(matrix, level, mask);
    return matrix;
  };

  let mask = options.mask ?? -1;
  if (mask < 0) {
    let best = Infinity;
    for (let candidate = 0; candidate < 8; candidate++) {
      const score = penalty(build(candidate).modules);
      if (score < best) {
        best = score;
        mask = candidate;
      }
    }
  }
  return { version, size, mask, modules: build(mask).modules };
}

export function qrPath(code: QrCode, margin = 4): string {
  let path = "";
  code.modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) {
        path += `M${x + margin} ${y + margin}h1v1h-1z`;
      }
    });
  });
  return path;
}
