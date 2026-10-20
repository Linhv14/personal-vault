import { describe, expect, it } from "vitest";
import { aliasTag, emailAlias, emailAliases } from "../src/core/email-alias.js";

describe("email aliases", () => {
  it("tags the address with the site for providers that support plus addressing", () => {
    expect(aliasTag("shopify.com")).toBe("shopify");
    expect(emailAlias("Root@Gmail.com", "shopify")).toBe("Root+shopify@gmail.com");
    expect(emailAlias("me+old@icloud.com", "github")).toBe("me+github@icloud.com");
  });

  it("skips providers that may not deliver plus addresses and removes duplicates", () => {
    expect(emailAlias("ops@acme.dev", "shopify")).toBeNull();
    expect(emailAliases(["a@gmail.com", "a@gmail.com", "b@acme.dev"], "x")).toEqual([
      "a+x@gmail.com",
    ]);
  });
});
