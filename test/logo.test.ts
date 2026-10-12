// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { LOGO_SVG, logo, wordmark } from "../src/ui/logo.js";
import { APP_NAME } from "../src/core/brand.js";

describe("logo", () => {
  it("gives every instance its own gradient, so a hidden copy cannot blank the others", () => {
    const ids = [logo(16), logo(56)].map((mark) => mark.querySelector("linearGradient")!.id);
    expect(new Set(ids).size).toBe(2);
    for (const [index, mark] of [logo(24), logo(24)].entries()) {
      const id = mark.querySelector("linearGradient")!.id;
      expect(mark.querySelector("rect")!.getAttribute("fill"), `instance ${index}`).toBe(
        `url(#${id})`,
      );
    }
  });

  it("ships a standalone SVG for the favicon", () => {
    expect(LOGO_SVG.startsWith("<svg")).toBe(true);
    expect(LOGO_SVG).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it("renders the wordmark from the app name with an accented first character", () => {
    const mark = wordmark();
    expect(mark.textContent).toBe(APP_NAME);
    expect(mark.querySelector(".wordmark-accent")!.textContent).toBe(APP_NAME[0]);
  });
});
