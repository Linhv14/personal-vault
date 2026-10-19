import { randomBytes } from "node:crypto";
import { hostAllowed } from "../../src/core/projects.js";

export interface Injectable {
  name: string;
  value: string;
  hosts: string[];
  placeholder: string;
}

export const MIN_SECRET_LENGTH = 8;

export function newPlaceholder(): string {
  return `7key-ph-${randomBytes(12).toString("hex")}`;
}

function replaceAll(text: string, from: string, to: string): string {
  return from ? text.split(from).join(to) : text;
}

const binary = (value: string) => Buffer.from(value, "utf8").toString("latin1");

export function substitute(
  text: string,
  injectables: readonly Injectable[],
  host: string,
): { text: string; used: Injectable[] } {
  const used: Injectable[] = [];
  let result = text;
  for (const entry of injectables) {
    if (!result.includes(entry.placeholder) || !hostAllowed(entry.hosts, host)) continue;
    result = replaceAll(result, entry.placeholder, binary(entry.value));
    used.push(entry);
  }
  return { text: result, used };
}

export function substituteHeader(
  name: string,
  value: string,
  injectables: readonly Injectable[],
  host: string,
): { value: string; used: Injectable[] } {
  const basic = name.toLowerCase().endsWith("authorization") && /^basic\s+/i.exec(value);
  if (basic) {
    const decoded = Buffer.from(value.slice(basic[0].length), "base64").toString("latin1");
    const replaced = substitute(decoded, injectables, host);
    if (replaced.used.length > 0) {
      return {
        value: `${basic[0]}${Buffer.from(replaced.text, "latin1").toString("base64")}`,
        used: replaced.used,
      };
    }
  }
  const replaced = substitute(value, injectables, host);
  return { value: replaced.text, used: replaced.used };
}

const jsonEscaped = (value: string) => JSON.stringify(value).slice(1, -1);
const asciiEscaped = (value: string) =>
  jsonEscaped(value).replace(
    /[\u007f-￿]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );

export function encodings(value: string): string[] {
  const forms = [
    binary(value),
    binary(jsonEscaped(value)),
    asciiEscaped(value),
    asciiEscaped(binary(value)),
    binary(jsonEscaped(value).replaceAll("/", "\\/")),
    asciiEscaped(value).replaceAll("/", "\\/"),
    encodeURIComponent(value),
    Buffer.from(value, "utf8").toString("base64"),
    Buffer.from(value, "utf8").toString("base64url"),
  ];
  return [...new Set(forms)];
}

export class Scrubber {
  private readonly forms: { form: string; placeholder: string }[];

  constructor(injectables: readonly Injectable[]) {
    this.forms = injectables
      .flatMap((entry) =>
        encodings(entry.value).map((form) => ({ form, placeholder: entry.placeholder })),
      )
      .sort((a, b) => b.form.length - a.form.length);
  }

  scrub(text: string): string {
    let result = text;
    for (const { form, placeholder } of this.forms) result = replaceAll(result, form, placeholder);
    return result;
  }

  split(text: string): { ready: string; pending: string } {
    const scrubbed = this.scrub(text);
    const longest = this.forms[0]?.form.length ?? 0;
    for (let index = Math.max(0, scrubbed.length - longest + 1); index < scrubbed.length; index++) {
      const tail = scrubbed.slice(index);
      if (this.forms.some(({ form }) => form.startsWith(tail))) {
        return { ready: scrubbed.slice(0, index), pending: scrubbed.slice(index) };
      }
    }
    return { ready: scrubbed, pending: "" };
  }
}

export function scrub(text: string, injectables: readonly Injectable[]): string {
  return new Scrubber(injectables).scrub(text);
}
