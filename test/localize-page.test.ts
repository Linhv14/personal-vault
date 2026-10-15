import { describe, expect, it } from "vitest";
import { localizePage } from "../scripts/localize-page.ts";

const page = `<html lang="en">
<!-- lang:en --><title>Hello</title><!-- /lang -->
<!-- lang:vi --><title>Xin chào</title><!-- /lang -->
<p>shared</p>
</html>`;

describe("localizePage", () => {
  it("keeps the blocks of one language and the shared markup", () => {
    const vi = localizePage(page, "vi");
    expect(vi).toContain("<title>Xin chào</title>");
    expect(vi).not.toContain("Hello");
    expect(vi).toContain("<p>shared</p>");
    expect(vi).toContain('<html lang="vi">');
    expect(vi).not.toContain("lang:");
  });

  it("refuses a language the page does not define", () => {
    expect(() => localizePage(page, "fr")).toThrow(/fr/);
  });
});
