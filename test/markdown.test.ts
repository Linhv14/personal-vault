import { describe, expect, it } from "vitest";
// @ts-expect-error The build script is plain JavaScript.
import { renderMarkdown } from "../scripts/markdown.mjs";

const render = renderMarkdown as (markdown: string) => string;

describe("renderMarkdown", () => {
  it("escapes HTML everywhere, including inside code and tables", () => {
    const html = render(
      "# <b>Title</b>\n\nText with <script>x</script> and `<i>`\n\n| A | <img> |\n| - | - |\n| 1 | 2 |",
    );
    expect(html).not.toMatch(/<(b|script|img|i)>/);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<code>&lt;i&gt;</code>");
  });

  it("renders headings, lists with continuation lines, tables and fenced code", () => {
    const html = render(
      "## Assets\n\n1. **One**, first\n   continued.\n2. Two\n\n- a\n- b\n\n| X | Y |\n| - | - |\n| 1 | 2 |\n\n```bash\nnpm test\n```",
    );
    expect(html).toContain("<h2>Assets</h2>");
    expect(html).toContain("<ol><li><strong>One</strong>, first continued.</li><li>Two</li></ol>");
    expect(html).toContain("<ul><li>a</li><li>b</li></ul>");
    expect(html).toContain("<th>X</th><th>Y</th>");
    expect(html).toContain("<td>1</td><td>2</td>");
    expect(html).toContain("<pre><code>npm test</code></pre>");
  });

  it("keeps absolute links and turns links into the private repo into plain text", () => {
    const html = render(
      "See [Cryptography](cryptography.md) and [HIBP](https://haveibeenpwned.com).",
    );
    expect(html).toContain("See Cryptography and");
    expect(html).toContain('<a href="https://haveibeenpwned.com">HIBP</a>');
  });
});
