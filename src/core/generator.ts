import { VaultError } from "./errors.js";
import { EFF_SHORT_WORDLIST } from "./wordlist.js";

const LOWERCASE = "abcdefghijklmnopqrstuvwxyz";
const UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
const SYMBOLS = "!@#$%^&*()-_=+[]{};:,.?";

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
  entropyBits: number;
}

export function randomInt(max: number): number {
  if (!Number.isInteger(max) || max <= 0) {
    throw new VaultError("generator.invalid_max", {}, `max must be a positive integer, got ${max}`);
  }
  if (max === 1) {
    return 0;
  }

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
  if (lowercase) {
    alphabet += LOWERCASE;
  }
  if (uppercase) {
    alphabet += UPPERCASE;
  }
  if (digits) {
    alphabet += DIGITS;
  }
  if (symbols) {
    alphabet += SYMBOLS;
  }

  if (excludeAmbiguous) {
    alphabet = [...alphabet].filter((c) => !AMBIGUOUS.has(c)).join("");
  }
  if (alphabet.length === 0) {
    throw new VaultError("generator.no_character_set", {}, "No character set selected");
  }
  return alphabet;
}

export function generatePassword(options: PasswordOptions = {}): GeneratedSecret {
  const { length = 20 } = options;
  const alphabet = buildAlphabet(options);

  const requiredSets = activeSets(options);
  if (length < requiredSets.length) {
    throw new VaultError(
      "generator.length_too_short",
      { min: requiredSets.length },
      `Length ${length} is below the ${requiredSets.length} required sets`,
    );
  }
  if (length > 256) {
    throw new VaultError("generator.length_too_long", { max: 256 }, "Length above 256");
  }

  const chars = requiredSets.map((set) => pick([...set]));
  while (chars.length < length) {
    chars.push(pick([...alphabet]));
  }

  return {
    value: shuffle(chars).join(""),
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
  if (lowercase) {
    sets.push(filter(LOWERCASE));
  }
  if (uppercase) {
    sets.push(filter(UPPERCASE));
  }
  if (digits) {
    sets.push(filter(DIGITS));
  }
  if (symbols) {
    sets.push(filter(SYMBOLS));
  }
  return sets.filter((s) => s.length > 0);
}

export interface PassphraseOptions {
  words?: number;
  separator?: string;
  capitalize?: boolean;
  appendDigit?: boolean;
  wordlist?: readonly string[];
}

export function generatePassphrase(options: PassphraseOptions = {}): GeneratedSecret {
  const {
    words = 8,
    separator = "-",
    capitalize = false,
    appendDigit = false,
    wordlist = EFF_SHORT_WORDLIST,
  } = options;

  if (words < 2) {
    throw new VaultError("generator.too_few_words", { min: 2 }, `Too few words: ${words}`);
  }
  if (words > 32) {
    throw new VaultError("generator.too_many_words", { max: 32 }, `Too many words: ${words}`);
  }
  if (wordlist.length < 2) {
    throw new VaultError("generator.wordlist_too_small", {}, "Word list has fewer than 2 entries");
  }

  const chosen = Array.from({ length: words }, () => {
    const word = pick(wordlist);
    return capitalize ? word[0]!.toUpperCase() + word.slice(1) : word;
  });

  let value = chosen.join(separator);
  let entropyBits = words * Math.log2(wordlist.length);

  if (appendDigit) {
    value += separator + randomInt(10);
    entropyBits += Math.log2(10);
  }

  return { value, entropyBits: round(entropyBits) };
}

export function generatePin(length = 6): GeneratedSecret {
  if (length < 3 || length > 32) {
    throw new VaultError(
      "generator.pin_length_out_of_range",
      { min: 3, max: 32 },
      `PIN length out of range: ${length}`,
    );
  }
  const value = Array.from({ length }, () => randomInt(10)).join("");
  return { value, entropyBits: round(length * Math.log2(10)) };
}

export type Strength = "very_weak" | "weak" | "fair" | "strong" | "very_strong";

export function rateStrength(entropyBits: number): Strength {
  if (entropyBits < 40) {
    return "very_weak";
  }
  if (entropyBits < 60) {
    return "weak";
  }
  if (entropyBits < 75) {
    return "fair";
  }
  if (entropyBits < 100) {
    return "strong";
  }
  return "very_strong";
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
