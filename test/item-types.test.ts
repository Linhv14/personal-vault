import { describe, expect, it } from "vitest";
import {
  formatCardNumber,
  itemType,
  lastFour,
  normalizeExpiry,
  parseCodes,
  searchableText,
} from "../extension/lib/item-types.js";
import { matchingItems, searchItems, type VaultItem } from "../extension/lib/vault.js";

describe("item types", () => {
  it("treats items saved before types existed as logins", () => {
    expect(itemType({})).toBe("login");
    expect(itemType({ type: "card" })).toBe("card");
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

  it("splits recovery codes by line, dropping blanks", () => {
    expect(parseCodes(" abcd-1234 \r\n\n efgh-5678\n")).toEqual(["abcd-1234", "efgh-5678"]);
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
