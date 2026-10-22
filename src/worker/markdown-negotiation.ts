export const MARKDOWN_PAGES: Record<string, string> = {
  "/": "/index.md",
  "/security": "/security.md",
};

export const SITE_PAGES = ["/", "/vi", "/privacy", "/media/*"];

export const CONTENT_SIGNAL = "search=yes, ai-input=yes, ai-train=no";

export function wantsMarkdown(accept: string | undefined): boolean {
  return (accept ?? "")
    .split(",")
    .map((part) => part.trim().split(";")[0]?.toLowerCase())
    .some((type) => type === "text/markdown");
}
