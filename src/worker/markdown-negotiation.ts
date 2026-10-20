export const MARKDOWN_PAGES: Record<string, string> = {
  "/": "/index.md",
  "/vi": "/vi.md",
  "/privacy": "/privacy.md",
  "/security": "/security.md",
};

export const CONTENT_SIGNAL = "search=yes, ai-input=yes, ai-train=no";

export function wantsMarkdown(accept: string | undefined): boolean {
  return (accept ?? "")
    .split(",")
    .map((part) => part.trim().split(";")[0]?.toLowerCase())
    .some((type) => type === "text/markdown");
}
