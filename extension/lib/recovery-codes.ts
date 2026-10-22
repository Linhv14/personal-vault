const LIST_MARKER = /^(?:#?\d{1,3}[.):]|[-*•·])\s*/;
const CHUNK_SEPARATOR = /\t|\s{2,}|[,;|]/;
const DIGIT_GROUPS = /^\d{3,8}(?: \d{3,8}){1,3}$/;
const TOKEN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const DATE = /^(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})$/;
const MAX_CODE_LENGTH = 64;
const MIN_NUMERIC_CODE = 6;

const FILE_NAME_NOISE = new Set([
  "2fa",
  "account",
  "backup",
  "code",
  "codes",
  "emergency",
  "factor",
  "kit",
  "mfa",
  "otp",
  "recovery",
  "two",
  "verification",
]);

function looksLikeCode(token: string): boolean {
  if (token.length < 4 || token.length > MAX_CODE_LENGTH || DATE.test(token)) {
    return false;
  }
  if (!TOKEN.test(token)) {
    return false;
  }
  if (/^\d+$/.test(token)) {
    return token.length >= MIN_NUMERIC_CODE;
  }
  return /\d/.test(token) || /[A-Za-z0-9]-[A-Za-z0-9]/.test(token);
}

function stripMarkers(chunk: string): string {
  let rest = chunk.trim();
  while (LIST_MARKER.test(rest)) {
    rest = rest.replace(LIST_MARKER, "");
  }
  return rest.replace(/^["']|["'.]$/g, "").trim();
}

export function parseRecoveryCodes(input: string): string[] {
  const codes: string[] = [];
  for (const line of input.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    for (const chunk of line.split(CHUNK_SEPARATOR).map(stripMarkers)) {
      if (!chunk) {
        continue;
      }
      const candidates = DIGIT_GROUPS.test(chunk) ? [chunk] : chunk.split(" ").map(stripMarkers);
      for (const candidate of candidates) {
        if (
          (DIGIT_GROUPS.test(candidate) || looksLikeCode(candidate)) &&
          !codes.includes(candidate)
        ) {
          codes.push(candidate);
        }
      }
    }
  }
  return codes;
}

export function titleFromFileName(fileName: string): string {
  const words = fileName
    .replace(/\.[^.]+$/, "")
    .split(/[\s._-]+/)
    .filter((word) => word && !FILE_NAME_NOISE.has(word.toLowerCase()) && !/^\d+$/.test(word));
  return words.map((word) => word[0]?.toUpperCase() + word.slice(1)).join(" ");
}
