import { describe, expect, it } from "vitest";
import { InvalidField, readEditedFields } from "../extension/popup/edit-fields.js";

function form(entries: [string, string][]): FormData {
  const data = new FormData();
  for (const [key, value] of entries) {
    data.append(key, value);
  }
  return data;
}

describe("reading the item editor", () => {
  it("keeps secrets verbatim, trims text and dedupes tags", () => {
    const fields = readEditedFields(
      form([
        ["username", "  me@example.com "],
        ["password", " spaced secret "],
        ["url", "github.com"],
        ["urls", "gist.github.com"],
        ["urls", ""],
        ["tags", "work, travel, work, "],
      ]),
      "login",
      [],
    );
    expect(fields.username).toBe("me@example.com");
    expect(fields.password).toBe(" spaced secret ");
    expect(fields.urls).toEqual(["gist.github.com"]);
    expect(fields.tags).toEqual(["work", "travel"]);
  });

  it("pairs custom field labels and values with their hidden flags", () => {
    const fields = readEditedFields(
      form([
        ["customLabel", "PIN"],
        ["customValue", "4242"],
        ["customLabel", "Org"],
        ["customValue", "acme"],
      ]),
      "note",
      [true, false],
    );
    expect(fields.fields).toEqual([
      { label: "PIN", value: "4242", hidden: true },
      { label: "Org", value: "acme" },
    ]);
  });

  it("normalizes card numbers and rejects an unreadable expiry", () => {
    expect(
      readEditedFields(form([["cardNumber", "4242 4242 4242 4242"]]), "card", []).cardNumber,
    ).toBe("4242424242424242");
    expect(() => readEditedFields(form([["cardExpiry", "13/27"]]), "card", [])).toThrow(
      InvalidField,
    );
  });

  it("splits pasted recovery codes", () => {
    const fields = readEditedFields(form([["codes", "1111-2222 3333-4444"]]), "recovery", []);
    expect(fields.codes?.length).toBeGreaterThan(0);
  });
});
