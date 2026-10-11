/**
 * Sinh mật khẩu. Toàn bộ tính ngẫu nhiên lấy từ `crypto.getRandomValues()`.
 *
 * KHÔNG BAO GIỜ dùng `Math.random()` ở đây: nó không phải CSPRNG, trạng thái nội
 * bộ của nó khôi phục được từ vài giá trị đầu ra, nên mật khẩu sinh ra dự đoán
 * được nếu kẻ tấn công thấy một mẫu bất kỳ do cùng tab tạo ra.
 */

import { EFF_SHORT_WORDLIST } from "./wordlist.js";

const LOWERCASE = "abcdefghijklmnopqrstuvwxyz";
const UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
const SYMBOLS = "!@#$%^&*()-_=+[]{};:,.?";

/**
 * Ký tự dễ đọc lẫn nhau khi phải đọc mật khẩu qua điện thoại hoặc gõ lại từ màn
 * hình khác. Không tăng an toàn, chỉ giảm nhầm lẫn.
 */
const AMBIGUOUS = new Set([..."0OoIl1|`'\"{}[]()"]);

export interface PasswordOptions {
  length?: number;
  lowercase?: boolean;
  uppercase?: boolean;
  digits?: boolean;
  symbols?: boolean;
  excludeAmbiguous?: boolean;
}

export interface GeneratedSecret {
  value: string;
  /** Entropy tính bằng bit — thước đo duy nhất đáng tin về độ mạnh. */
  entropyBits: number;
}

/**
 * Trả về số nguyên ngẫu nhiên đều trong [0, max).
 *
 * Cách làm sai phổ biến là `randomValue % max`: nếu `max` không chia hết 2^32 thì
 * các giá trị đầu dải xuất hiện nhiều hơn — gọi là modulo bias, và nó làm giảm
 * entropy thật của mật khẩu. Ở đây ta loại bỏ (rejection sampling) những giá trị
 * nằm trong phần dư để phân phối còn lại đều tuyệt đối.
 */
export function randomInt(max: number): number {
  if (!Number.isInteger(max) || max <= 0) throw new Error("max phải là số nguyên dương");
  if (max === 1) return 0;

  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buffer = new Uint32Array(1);
  let value: number;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0]!;
  } while (value >= limit);
  return value % max;
}

function pick<T>(items: readonly T[]): T {
  return items[randomInt(items.length)]!;
}

/** Fisher-Yates dùng randomInt, để kết quả trộn cũng không lệch. */
function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

export function buildAlphabet(options: PasswordOptions = {}): string {
  const {
    lowercase = true,
    uppercase = true,
    digits = true,
    symbols = true,
    excludeAmbiguous = false,
  } = options;

  let alphabet = "";
  if (lowercase) alphabet += LOWERCASE;
  if (uppercase) alphabet += UPPERCASE;
  if (digits) alphabet += DIGITS;
  if (symbols) alphabet += SYMBOLS;

  if (excludeAmbiguous) {
    alphabet = [...alphabet].filter((c) => !AMBIGUOUS.has(c)).join("");
  }
  if (alphabet.length === 0) {
    throw new Error("Phải chọn ít nhất một nhóm ký tự");
  }
  return alphabet;
}

/**
 * Sinh mật khẩu ngẫu nhiên, đảm bảo có ít nhất một ký tự từ mỗi nhóm đã chọn.
 *
 * Nhiều site bắt buộc "phải có chữ hoa, số và ký tự đặc biệt", nên nếu không đảm
 * bảo điều này thì cứ vài lần lại phải bấm sinh lại. Cách làm: sinh một ký tự
 * bắt buộc cho mỗi nhóm, điền phần còn lại từ bảng chữ cái đầy đủ, rồi trộn —
 * giữ được tính ngẫu nhiên đều ở từng vị trí.
 */
export function generatePassword(options: PasswordOptions = {}): GeneratedSecret {
  const { length = 20 } = options;
  const alphabet = buildAlphabet(options);

  const requiredSets = activeSets(options);
  if (length < requiredSets.length) {
    throw new Error(`Độ dài tối thiểu là ${requiredSets.length} để đủ mỗi nhóm một ký tự`);
  }
  if (length > 256) throw new Error("Độ dài tối đa là 256");

  const chars = requiredSets.map((set) => pick([...set]));
  while (chars.length < length) chars.push(pick([...alphabet]));

  return {
    value: shuffle(chars).join(""),
    // Đây là chặn trên: ràng buộc "mỗi nhóm ít nhất một ký tự" làm hẹp không
    // gian một chút. Với độ dài >= 16 thì chênh lệch dưới 1 bit, không đáng kể.
    entropyBits: round(length * Math.log2(alphabet.length)),
  };
}

function activeSets(options: PasswordOptions): string[] {
  const {
    lowercase = true,
    uppercase = true,
    digits = true,
    symbols = true,
    excludeAmbiguous = false,
  } = options;

  const filter = (set: string) =>
    excludeAmbiguous ? [...set].filter((c) => !AMBIGUOUS.has(c)).join("") : set;

  const sets: string[] = [];
  if (lowercase) sets.push(filter(LOWERCASE));
  if (uppercase) sets.push(filter(UPPERCASE));
  if (digits) sets.push(filter(DIGITS));
  if (symbols) sets.push(filter(SYMBOLS));
  return sets.filter((s) => s.length > 0);
}

export interface PassphraseOptions {
  words?: number;
  separator?: string;
  capitalize?: boolean;
  appendDigit?: boolean;
  wordlist?: readonly string[];
}

/**
 * Passphrase kiểu "acid-zone-tulip-cargo". Dài hơn nhưng gõ lại bằng tay dễ hơn
 * nhiều — hữu ích cho mật khẩu phải nhập trên TV, máy chơi game, hay đọc qua
 * điện thoại cho người khác.
 *
 * Mặc định 8 từ, không phải 5. Wordlist ngắn chỉ cho 10,34 bit mỗi từ, nên 5 từ
 * ra 51,7 bit — `rateStrength` xếp "yếu", nằm trong tầm brute-force offline. 8 từ
 * cho 82,7 bit, ngang một mật khẩu ngẫu nhiên 13 ký tự.
 */
export function generatePassphrase(options: PassphraseOptions = {}): GeneratedSecret {
  const {
    words = 8,
    separator = "-",
    capitalize = false,
    appendDigit = false,
    wordlist = EFF_SHORT_WORDLIST,
  } = options;

  if (words < 2) throw new Error("Passphrase cần ít nhất 2 từ");
  if (words > 32) throw new Error("Tối đa 32 từ");
  if (wordlist.length < 2) throw new Error("Wordlist quá ngắn");

  const chosen = Array.from({ length: words }, () => {
    const word = pick(wordlist);
    return capitalize ? word[0]!.toUpperCase() + word.slice(1) : word;
  });

  let value = chosen.join(separator);
  // Entropy tính từ chính độ dài wordlist, nên đổi wordlist không làm sai số liệu.
  let entropyBits = words * Math.log2(wordlist.length);

  if (appendDigit) {
    value += separator + randomInt(10);
    entropyBits += Math.log2(10);
  }

  return { value, entropyBits: round(entropyBits) };
}

/** PIN số — cho khoá màn hình, thẻ ATM, két. */
export function generatePin(length = 6): GeneratedSecret {
  if (length < 3 || length > 32) throw new Error("Độ dài PIN phải từ 3 đến 32");
  const value = Array.from({ length }, () => randomInt(10)).join("");
  return { value, entropyBits: round(length * Math.log2(10)) };
}

export type Strength = "rất yếu" | "yếu" | "khá" | "mạnh" | "rất mạnh";

/**
 * Xếp hạng theo entropy, không theo luật "có chữ hoa và số" như nhiều site.
 * Mốc 75 bit trở lên nằm ngoài tầm với của brute-force offline hiện nay.
 */
export function rateStrength(entropyBits: number): Strength {
  if (entropyBits < 40) return "rất yếu";
  if (entropyBits < 60) return "yếu";
  if (entropyBits < 75) return "khá";
  if (entropyBits < 100) return "mạnh";
  return "rất mạnh";
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
