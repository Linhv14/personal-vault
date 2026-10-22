import { fetchJson, type Fetcher } from "./fetcher.js";

const RESOLVER = "https://cloudflare-dns.com/dns-query";
const TXT = 16;

function textOf(data: string): string {
  const quoted = [...data.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1] ?? "");
  return (quoted.length > 0 ? quoted.join("") : data).replace(/\\(.)/g, "$1");
}

export async function txtRecords(fetcher: Fetcher, domain: string): Promise<string[] | null> {
  const query = new URLSearchParams({ name: domain, type: "TXT" });
  const body = await fetchJson(fetcher, `${RESOLVER}?${query.toString()}`, {
    headers: { Accept: "application/dns-json" },
  });
  if (!body || body.Status !== 0) {
    return body?.Status === 3 ? [] : null;
  }
  const answers = Array.isArray(body.Answer) ? body.Answer : [];
  return answers.flatMap((answer: unknown) => {
    if (typeof answer !== "object" || answer === null) {
      return [];
    }
    const { type, data } = answer as Record<string, unknown>;
    return type === TXT && typeof data === "string" ? [textOf(data)] : [];
  });
}
