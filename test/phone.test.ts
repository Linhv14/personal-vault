import { describe, expect, it } from "vitest";
import { nationalPhone } from "../src/core/phone.js";

describe("nationalPhone", () => {
  it("drops the dial code and restores the trunk prefix", () => {
    expect(nationalPhone("+84 90 123 4567")).toBe("090 123 4567");
    expect(nationalPhone("+1 (415) 555-0134")).toBe("(415) 555-0134");
  });

  it("leaves a number without a dial code alone", () => {
    expect(nationalPhone(" 090 123 4567 ")).toBe("090 123 4567");
  });
});
