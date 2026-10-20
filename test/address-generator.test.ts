import { afterEach, describe, expect, it, vi } from "vitest";
import { countryOf, regionNames } from "../src/core/address-data.js";
import { emailDomainOf, generateAddress } from "../src/core/address-generator.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("random addresses", () => {
  it("formats a US address with a 2-letter state, a 5-digit ZIP and a 555 number", () => {
    for (let i = 0; i < 50; i++) {
      const address = generateAddress({ country: "US" });
      expect(address.fullName).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
      expect(address.address).toMatch(/^\d{3,4} [A-Z][A-Za-z ]+( ?\nApt \d{1,2}[ABC]?)?$/);
      expect(address.region).toMatch(/^[A-Z]{2}$/);
      expect(address.postalCode).toMatch(/^\d{5}$/);
      expect(address.phone).toMatch(/^\(555\) \d{3}-\d{4}$/);
      expect(address.country).toBe("United States");
      expect(address.ward).toBeUndefined();
      expect(address.email).toBeUndefined();
    }
  });

  it("formats a Vietnamese address with ward, district, province and a 09x phone", () => {
    for (let i = 0; i < 50; i++) {
      const address = generateAddress({ country: "VN" });
      expect(address.fullName.split(" ")).toHaveLength(3);
      expect(address.address).toMatch(/^\d{1,3}(\/\d{1,2})? \p{Lu}/u);
      expect(address.ward).toMatch(/^(Phường|Xã) /);
      expect(address.city).toMatch(/^(Quận|Thành phố) /);
      expect(address.region.length).toBeGreaterThan(2);
      expect(address.postalCode).toMatch(/^\d{6}$/);
      expect(address.phone).toMatch(/^09\d \d{3} \d{4}$/);
      expect(countryOf(address.country)?.code).toBe("VN");
    }
  });

  it("adds an email at example.com or at the domain the user picked", () => {
    expect(generateAddress({ country: "US", email: true }).email).toMatch(
      /^[a-z]+\.[a-z]+\d{4}@example\.com$/,
    );
    expect(
      generateAddress({ country: "VN", email: true, emailDomain: "@Mail.Test.dev" }).email,
    ).toMatch(/^[a-z]+\.[a-z]+\d{4}@mail\.test\.dev$/);
    expect(emailDomainOf("not a domain")).toBe("example.com");
    expect(emailDomainOf("")).toBe("example.com");
  });

  it("draws from crypto.getRandomValues, never Math.random", () => {
    const crypto = vi.spyOn(globalThis.crypto, "getRandomValues");
    const math = vi.spyOn(Math, "random");
    generateAddress({ country: "VN", email: true });
    expect(crypto).toHaveBeenCalled();
    expect(math).not.toHaveBeenCalled();
  });

  it("varies from one draw to the next", () => {
    const names = new Set(
      Array.from({ length: 30 }, () => generateAddress({ country: "US" }).phone),
    );
    expect(names.size).toBeGreaterThan(25);
  });
});

describe("country and region names", () => {
  it("knows countries by code and by English or Vietnamese name", () => {
    expect(countryOf("vn")?.code).toBe("VN");
    expect(countryOf("Viet Nam")?.code).toBe("VN");
    expect(countryOf("Hoa Kỳ")?.code).toBe("US");
    expect(countryOf("Atlantis")).toBeUndefined();
  });

  it("expands states and provinces into the names a form may use", () => {
    expect(regionNames("CA")).toEqual(["ca", "california"]);
    expect(regionNames("TP. Hồ Chí Minh")).toContain("ho chi minh");
    expect(regionNames("Tỉnh Khánh Hòa")).toContain("khanh hoa");
  });
});
