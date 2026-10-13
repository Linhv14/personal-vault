import { describe, expect, it } from "vitest";
import {
  formatCardNumber,
  itemType,
  lastFour,
  normalizeExpiry,
  searchableText,
} from "../extension/lib/item-types.js";
import { matchingItems, searchItems, type VaultItem } from "../extension/lib/vault.js";

describe("item types", () => {
  it("treats items saved before types existed as logins", () => {
    expect(itemType({})).toBe("login");
    expect(itemType({ type: "card" })).toBe("card");
    expect(itemType({ url: "github.com", note: "work" })).toBe("login");
  });

  it("treats an untyped item holding only a note as a note", () => {
    expect(itemType({ note: "Wi-Fi at the office" })).toBe("note");
    expect(itemType({ note: "x", type: "login" })).toBe("login");
  });

  it.each([
    ["4/27", "04/27"],
    ["04/2027", "04/27"],
    ["12-30", "12/30"],
    [" 1 / 29 ", "01/29"],
  ])("normalizes the expiry %s to %s", (input, expected) => {
    expect(normalizeExpiry(input)).toBe(expected);
  });

  it.each(["13/27", "0/27", "2027-04", "04", "april"])("rejects the expiry %s", (input) => {
    expect(normalizeExpiry(input)).toBeNull();
  });

  it("formats card numbers in groups of four and keeps the last four digits", () => {
    expect(formatCardNumber("4242-4242 42424242")).toBe("4242 4242 4242 4242");
    expect(formatCardNumber("378282246310005")).toBe("3782 8224 6310 005");
    expect(lastFour("4242 4242 4242 1234")).toBe("1234");
    expect(lastFour(undefined)).toBe("");
  });

  it("searches the fields that identify each type, never secrets", () => {
    const card: VaultItem = {
      id: "c",
      createdAt: 0,
      updatedAt: 0,
      type: "card",
      title: "Visa",
      cardholder: "Jane Doe",
      cardNumber: "4242424242421234",
      cardCvv: "999",
    };
    expect(searchableText(card)).toEqual(["Visa", "Jane Doe", "1234"]);
    expect(searchItems([card], "999")).toEqual([]);
    expect(searchItems([card], "jane")).toEqual([card]);
  });

  it("offers only logins for the current site", () => {
    const saved = { createdAt: 0, updatedAt: 0, title: "Bank", url: "bank.com" };
    const login: VaultItem = { ...saved, id: "l" };
    const note: VaultItem = { ...saved, id: "n", type: "note" };
    expect(matchingItems([login, note], "https://bank.com/login")).toEqual([login]);
  });
});

describe("item extras", () => {
  it("keeps the replaced password, newest first, up to the limit", async () => {
    const { withPasswordHistory, PASSWORD_HISTORY_LIMIT } =
      await import("../extension/lib/item-types.js");
    expect(withPasswordHistory(null, "new", 10)).toBeUndefined();
    expect(withPasswordHistory({ password: "same" }, "same", 10)).toBeUndefined();
    const once = withPasswordHistory({ password: "old" }, "new", 10);
    expect(once).toEqual([{ password: "old", changedAt: 10 }]);
    expect(withPasswordHistory({ password: "new", passwordHistory: once }, "newer", 20)).toEqual([
      { password: "new", changedAt: 20 },
      { password: "old", changedAt: 10 },
    ]);
    const full = Array.from({ length: PASSWORD_HISTORY_LIMIT }, (_, index) => ({
      password: `p${index}`,
      changedAt: index,
    }));
    expect(withPasswordHistory({ password: "x", passwordHistory: full }, "y", 99)).toHaveLength(
      PASSWORD_HISTORY_LIMIT,
    );
  });

  it("drops empty custom fields and websites", async () => {
    const { cleanCustomFields, cleanUrls } = await import("../extension/lib/item-types.js");
    expect(
      cleanCustomFields([
        { label: " PIN ", value: "1234", hidden: true },
        { label: "", value: "" },
        { label: "Note", value: "x", hidden: false },
      ]),
    ).toEqual([
      { label: "PIN", value: "1234", hidden: true },
      { label: "Note", value: "x" },
    ]);
    expect(cleanCustomFields([{ label: "", value: "" }])).toBeUndefined();
    expect(cleanUrls([" a.com ", "", "a.com", "b.com"])).toEqual(["a.com", "b.com"]);
  });

  it("searches custom field names and visible values, not hidden ones", () => {
    const item: VaultItem = {
      id: "x",
      createdAt: 0,
      updatedAt: 0,
      title: "Router",
      fields: [
        { label: "Serial", value: "SN-123" },
        { label: "Admin PIN", value: "9999", hidden: true },
      ],
    };
    expect(searchItems([item], "sn-123")).toEqual([item]);
    expect(searchItems([item], "admin")).toEqual([item]);
    expect(searchItems([item], "9999")).toEqual([]);
  });

  it("matches a login on its extra websites, or only its host when asked", () => {
    const base = { id: "1", createdAt: 0, updatedAt: 0, title: "Git" };
    const multi: VaultItem = { ...base, url: "github.com", urls: ["gitlab.com"] };
    expect(matchingItems([multi], "https://gitlab.com/login")).toEqual([multi]);
    const hostOnly: VaultItem = { ...base, url: "gist.github.com", urlMatch: "host" };
    expect(matchingItems([hostOnly], "https://github.com")).toEqual([]);
    expect(matchingItems([hostOnly], "https://gist.github.com/x")).toEqual([hostOnly]);
  });
});
