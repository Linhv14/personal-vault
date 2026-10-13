import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  breachCounts,
  passwordEntropy,
  reusedGroups,
  WEAK_BELOW_BITS,
  weakItems,
} from "../extension/lib/health.js";
import type { VaultItem } from "../extension/lib/vault.js";

const item = (id: string, password: string, type?: VaultItem["type"]): VaultItem => ({
  id,
  title: id,
  password,
  type,
  createdAt: 0,
  updatedAt: 0,
});

describe("password health", () => {
  it.each(["123456", "password1", "Summer2024!", "aaaaaaaaaaaa", "abcdefghijkl", "qwertyuiop"])(
    "rates %s as weak",
    (password) => {
      expect(passwordEntropy(password)).toBeLessThan(WEAK_BELOW_BITS);
    },
  );

  it.each(["7Qp!vR2xKm#4zLd9Wn", "amber-cargo-tulip-zone-ridge", "tG5$wQ8nZr3%hJx1"])(
    "rates %s as strong enough",
    (password) => {
      expect(passwordEntropy(password)).toBeGreaterThanOrEqual(WEAK_BELOW_BITS);
    },
  );

  it("checks passwords of logins, Wi-Fi and API keys only", () => {
    const items = [item("a", "123456"), item("b", "123456", "card"), item("c", "123456", "wifi")];
    expect(weakItems(items).map((found) => found.id)).toEqual(["a", "c"]);
  });

  it("groups items that share a password", () => {
    const items = [
      item("a", "same-Password-1!x"),
      item("b", "other-Password-2!y"),
      item("c", "same-Password-1!x"),
    ];
    expect(reusedGroups(items).map((group) => group.map((found) => found.id))).toEqual([
      ["a", "c"],
    ]);
  });

  it("sends only the first five characters of each SHA-1 and counts matches", async () => {
    const sha1 = (text: string) => createHash("sha1").update(text).digest("hex").toUpperCase();
    const leaked = sha1("password1");
    const asked: string[] = [];
    const counts = await breachCounts(
      ["password1", "7Qp!vR2xKm#4zLd9Wn", "password1"],
      async (prefix) => {
        asked.push(prefix);
        return prefix === leaked.slice(0, 5)
          ? `0018A45C4D1DEF81644B54AB7F969B88D65:0\r\n${leaked.slice(5)}:2413945\r\n`
          : "0018A45C4D1DEF81644B54AB7F969B88D65:0\r\n";
      },
    );
    expect(asked).toHaveLength(2);
    expect(asked.every((prefix) => /^[0-9A-F]{5}$/.test(prefix))).toBe(true);
    expect([...counts]).toEqual([["password1", 2413945]]);
  });
});
