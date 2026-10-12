import { describe, expect, it } from "vitest";
import {
  addRecipients,
  MAX_SHARE_RECIPIENTS,
  singleViewAllowed,
} from "../extension/lib/recipients.js";

describe("addRecipients", () => {
  it("splits on commas, semicolons and whitespace, normalizing case", () => {
    expect(addRecipients([], "A@Example.com, b@example.com;c@example.com d@example.com")).toEqual({
      recipients: ["a@example.com", "b@example.com", "c@example.com", "d@example.com"],
      rejected: [],
      overflow: false,
    });
  });

  it("skips duplicates and returns invalid entries for correction", () => {
    expect(addRecipients(["a@example.com"], "A@example.com nope b@x")).toEqual({
      recipients: ["a@example.com"],
      rejected: ["nope", "b@x"],
      overflow: false,
    });
  });

  it("stops at the recipient limit and reports the overflow", () => {
    const full = Array.from({ length: MAX_SHARE_RECIPIENTS }, (_, i) => `u${i}@example.com`);
    const update = addRecipients(full, "extra@example.com");
    expect(update.recipients).toHaveLength(MAX_SHARE_RECIPIENTS);
    expect(update.overflow).toBe(true);
  });
});

describe("singleViewAllowed", () => {
  it("allows a one-time link for anyone or for a single recipient", () => {
    expect(singleViewAllowed(0)).toBe(true);
    expect(singleViewAllowed(1)).toBe(true);
  });

  it("refuses one view for several recipients, since the first would use it up", () => {
    expect(singleViewAllowed(2)).toBe(false);
  });
});
