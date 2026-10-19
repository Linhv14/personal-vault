// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { BRAND_INK, BRAND_ORANGE, LOGO_SVG, logo, wordmark } from "../src/ui/logo.js";
import { APP_NAME } from "../src/core/brand.js";

describe("logo", () => {
  it("draws the seven-segment dial in the brand colours, without ids that copies could clash on", () => {
    const mark = logo(24);
    const dial = mark.querySelector("g path")!;
    expect(dial.getAttribute("fill")).toBe(BRAND_ORANGE);
    expect(dial.getAttribute("d")!.match(/Z/g)).toHaveLength(7);
    expect(mark.querySelector("rect")!.getAttribute("fill")).toBe(BRAND_INK);
    expect(mark.querySelector("[id]")).toBeNull();
  });

  it("turns the dial only when asked", () => {
    expect(logo(24).querySelector(".logo-dial")).toBeNull();
    expect(logo(44, true).querySelector(".logo-dial")).not.toBeNull();
    expect(LOGO_SVG).not.toContain("logo-dial");
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
