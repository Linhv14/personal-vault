import { Window } from "happy-dom";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  fillState,
  isSubmitLike,
  readAddress,
  readCard,
  type FilledFields,
} from "../extension/content/form-capture.js";
import { detectFields, type FormField } from "../extension/content/forms.js";
import {
  addressPreview,
  addressWorthSaving,
  boundToSite,
  cleanAddress,
  cleanCard,
  cleanExpiry,
  luhnValid,
  matchCard,
  matchIdentity,
  mergeCards,
  withAddress,
} from "../extension/lib/form-capture.js";
import type { VaultItem } from "../extension/lib/vault/types.js";

const page = new Window({ url: "https://shop.example/checkout" });
const DOM_GLOBALS = {
  document: page.document,
  Element: page.Element,
  HTMLElement: page.HTMLElement,
  HTMLInputElement: page.HTMLInputElement,
  HTMLSelectElement: page.HTMLSelectElement,
  HTMLTextAreaElement: page.HTMLTextAreaElement,
  HTMLLabelElement: page.HTMLLabelElement,
  HTMLButtonElement: page.HTMLButtonElement,
  getComputedStyle: page.getComputedStyle.bind(page),
};
for (const [name, value] of Object.entries(DOM_GLOBALS)) {
  vi.stubGlobal(name, value);
}
Object.defineProperty(page.HTMLElement.prototype, "getBoundingClientRect", {
  value: () => ({ width: 200, height: 32, top: 0, left: 0, right: 200, bottom: 32 }),
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await page.happyDOM.close();
});

const SAVED_CARD: VaultItem = {
  id: "card-1",
  type: "card",
  title: "Visa •••• 4242",
  cardNumber: "4242424242424242",
  cardExpiry: "08/29",
  cardholder: "Jane Doe",
  createdAt: 1,
  updatedAt: 1,
};

const HOME: VaultItem = {
  id: "home-1",
  type: "identity",
  title: "Home",
  fullName: "Nguyễn Văn An",
  email: "an@example.com",
  phone: "+84 901 234 567",
  address: "12 Lê Lợi",
  city: "Quận 1",
  country: "Việt Nam",
  createdAt: 1,
  updatedAt: 1,
};

describe("card values", () => {
  it("checks the Luhn digit and length", () => {
    expect(luhnValid("4242424242424242")).toBe(true);
    expect(luhnValid("4242424242424241")).toBe(false);
    expect(luhnValid("42424242")).toBe(false);
    expect(luhnValid("4242 4242 4242 4242")).toBe(false);
  });

  it("normalizes typed expiry formats", () => {
    expect(cleanExpiry("08/29")).toBe("08/29");
    expect(cleanExpiry("8 / 2029")).toBe("08/29");
    expect(cleanExpiry("0829")).toBe("08/29");
    expect(cleanExpiry("082029")).toBe("08/29");
    expect(cleanExpiry("13/29")).toBeUndefined();
    expect(cleanExpiry("")).toBeUndefined();
  });

  it("keeps only a valid card with tidy fields", () => {
    expect(
      cleanCard({
        number: "4242 4242 4242 4242",
        expiry: "0829",
        cardholder: "  Jane   Doe ",
        cvv: "123",
      }),
    ).toEqual({ number: "4242424242424242", expiry: "08/29", cardholder: "Jane Doe", cvv: "123" });
    expect(cleanCard({ number: "1234 5678 9012 3456" })).toBeNull();
    expect(cleanCard({ number: "4242424242424242", cvv: "12" })).toEqual({
      number: "4242424242424242",
    });
  });

  it("merges parts typed in separate payment frames", () => {
    expect(
      mergeCards([{ number: "4242424242424242" }, { expiry: "08/29" }, undefined, { cvv: "123" }]),
    ).toEqual({ number: "4242424242424242", expiry: "08/29", cvv: "123" });
    expect(mergeCards([{ cardholder: "A" }, { cardholder: " " }])).toEqual({ cardholder: "A" });
  });

  it("finds a saved card by number and says whether anything changed", () => {
    const items = [SAVED_CARD];
    expect(matchCard(items, { number: "4111111111111111" })).toEqual({ status: "new" });
    expect(matchCard(items, { number: "4242424242424242", expiry: "08/29" })).toEqual({
      status: "same",
    });
    expect(
      matchCard(items, { number: "4242424242424242", cardholder: "JANE DOE", cvv: "999" }),
    ).toEqual({ status: "same" });
    expect(matchCard(items, { number: "4242424242424242", expiry: "09/31" })).toEqual({
      status: "changed",
      item: SAVED_CARD,
    });
  });

  it("never treats a login with the same digits in its note as a card", () => {
    const login = { ...SAVED_CARD, type: "login" as const };
    expect(matchCard([login], { number: "4242424242424242" })).toEqual({ status: "new" });
  });
});

describe("address values", () => {
  it("trims, collapses and drops empty fields", () => {
    expect(
      cleanAddress({ fullName: "  An  ", address: " 12 Lê Lợi \n\n Tầng 3 ", city: " " }),
    ).toEqual({ fullName: "An", address: "12 Lê Lợi\nTầng 3" });
  });

  it("only asks for addresses with enough to be useful", () => {
    expect(addressWorthSaving({ address: "12 Lê Lợi", city: "Quận 1" })).toBe(true);
    expect(addressWorthSaving({ fullName: "An", email: "an@example.com" })).toBe(true);
    expect(addressWorthSaving({ email: "an@example.com" })).toBe(false);
    expect(addressWorthSaving({ address: "12 Lê Lợi" })).toBe(false);
    expect(addressWorthSaving({ email: "a@b.c", phone: "1" }, true)).toBe(true);
    expect(addressWorthSaving({ email: "a@b.c" }, true)).toBe(false);
  });

  it("matches on name and street, ignoring case and accents", () => {
    expect(
      matchIdentity([HOME], { fullName: "nguyen van an", address: "12 le loi", city: "Quận 1" }),
    ).toEqual({ status: "same" });
  });

  it("matches on email and phone, ignoring formatting", () => {
    expect(
      matchIdentity([HOME], { email: "AN@example.com", phone: "0901 234 567", fullName: "An" }),
    ).toEqual({ status: "changed", item: HOME });
  });

  it("offers an update when the street changes for the same email and phone", () => {
    expect(
      matchIdentity([HOME], {
        email: "an@example.com",
        phone: "0901234567",
        address: "99 Hai Bà Trưng",
      }),
    ).toEqual({ status: "changed", item: HOME });
  });

  it("does not merge different people at the same address", () => {
    expect(matchIdentity([HOME], { fullName: "Trần Thị Bình", address: "12 Lê Lợi" })).toEqual({
      status: "new",
    });
  });

  it("matches a profile without an address by email alone", () => {
    expect(matchIdentity([HOME], { fullName: "Nguyễn Văn An", email: "an@example.com" })).toEqual({
      status: "same",
    });
    expect(matchIdentity([HOME], { fullName: "Other", email: "other@example.com" })).toEqual({
      status: "new",
    });
  });

  it("treats a country name and its code as the same country", () => {
    expect(
      matchIdentity([HOME], { fullName: "Nguyễn Văn An", address: "12 Lê Lợi", country: "VN" }),
    ).toEqual({ status: "same" });
  });

  it("overwrites only the captured fields on update", () => {
    const next = withAddress(HOME, { address: "99 Hai Bà Trưng" });
    expect(next).toMatchObject({ address: "99 Hai Bà Trưng", city: "Quận 1", title: "Home" });
  });

  it("previews an address on one line", () => {
    expect(addressPreview({ fullName: "An", address: "12 Lê Lợi\nTầng 3", city: "Quận 1" })).toBe(
      "An · 12 Lê Lợi · Quận 1",
    );
    expect(addressPreview({ fullName: "An", email: "an@example.com" })).toBe("An · an@example.com");
  });

  it("knows which items belong to a site", () => {
    expect(boundToSite({ url: "shop.com" }, "shop.com")).toBe(true);
    expect(boundToSite({ urls: ["https://www.shop.com/checkout"] }, "shop.com")).toBe(true);
    expect(boundToSite({ url: "othershop.com" }, "shop.com")).toBe(false);
    expect(boundToSite({}, "shop.com")).toBe(false);
  });
});

describe("reading forms", () => {
  it("reads a typed card form including split expiry selects", () => {
    document.body.innerHTML = `
      <form>
        <input autocomplete="cc-name" value="Jane Doe" />
        <input autocomplete="cc-number" value="4242 4242 4242 4242" />
        <select autocomplete="cc-exp-month"><option value="">MM</option><option value="8" selected>08</option></select>
        <select autocomplete="cc-exp-year"><option value="2029" selected>2029</option></select>
        <input autocomplete="cc-csc" value="123" />
      </form>`;
    expect(readCard(detectFields(document))).toEqual({
      cardholder: "Jane Doe",
      number: "4242424242424242",
      expiry: "08/29",
      cvv: "123",
    });
  });

  it("reads an address form, joining Vietnamese names family first", () => {
    document.body.innerHTML = `
      <form>
        <input autocomplete="family-name" value="Nguyễn" />
        <input autocomplete="given-name" value="Văn An" />
        <input autocomplete="address-line1" value="12 Lê Lợi" />
        <input autocomplete="address-line2" value="Tầng 3" />
        <input autocomplete="address-level2" value="Quận 1" />
        <select autocomplete="country"><option value="">Choose</option><option value="VN" selected>Việt Nam</option></select>
        <input autocomplete="tel" value="" />
      </form>`;
    expect(readAddress(detectFields(document))).toEqual({
      fullName: "Nguyễn Văn An",
      address: "12 Lê Lợi\nTầng 3",
      city: "Quận 1",
      country: "Việt Nam",
    });
  });

  it("tells typed values from ones 7key filled or made up", () => {
    document.body.innerHTML = `<input id="a" autocomplete="name" /><input id="b" autocomplete="email" />`;
    const a = document.querySelector<HTMLInputElement>("#a")!;
    const b = document.querySelector<HTMLInputElement>("#b")!;
    const fields = detectFields(document);
    const filled: FilledFields = new WeakMap<FormField, { value: string; random: boolean }>();
    a.value = "An";
    filled.set(a, { value: "An", random: false });
    expect(fillState(fields, filled)).toEqual({ typed: false, random: false });
    b.value = "x@example.com";
    filled.set(b, { value: "x@example.com", random: true });
    expect(fillState(fields, filled)).toEqual({ typed: false, random: true });
    a.value = "Bình";
    expect(fillState(fields, filled)).toEqual({ typed: true, random: true });
  });

  it("recognizes submit-like buttons and skips coupon or back buttons", () => {
    document.body.innerHTML = `
      <form>
        <button id="pay">Pay now</button>
        <button id="coupon">Apply coupon</button>
        <button id="plain" type="button">Toggle</button>
      </form>
      <div role="button" id="vi">Đặt hàng</div>
      <div role="button" id="back">Quay lại</div>
      <input type="submit" id="submit" value="Go" />`;
    const is = (id: string) => isSubmitLike(document.getElementById(id)!);
    expect(is("pay")).toBe(true);
    expect(is("coupon")).toBe(false);
    expect(is("plain")).toBe(false);
    expect(is("vi")).toBe(true);
    expect(is("back")).toBe(false);
    expect(is("submit")).toBe(true);
  });
});
