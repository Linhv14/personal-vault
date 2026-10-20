import { Window } from "happy-dom";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  chooseOption,
  classifyField,
  detectFields,
  fillAddress,
  fillCard,
  formatExpiry,
  formKindOf,
  setFieldValue,
  splitExpiry,
  splitName,
  type FormField,
} from "../extension/content/forms.js";
import type { AddressData, CardData } from "../extension/lib/autofill-protocol.js";
import { cardBrand } from "../extension/lib/item-types.js";

const page = new Window({ url: "https://shop.example/checkout" });
const DOM_GLOBALS = {
  document: page.document,
  HTMLElement: page.HTMLElement,
  HTMLInputElement: page.HTMLInputElement,
  HTMLSelectElement: page.HTMLSelectElement,
  HTMLTextAreaElement: page.HTMLTextAreaElement,
  HTMLLabelElement: page.HTMLLabelElement,
  Event: page.Event,
  getComputedStyle: page.getComputedStyle.bind(page),
};
for (const [name, value] of Object.entries(DOM_GLOBALS)) vi.stubGlobal(name, value);
Object.defineProperty(page.HTMLElement.prototype, "getBoundingClientRect", {
  value(this: HTMLElement) {
    const shown = this.isConnected && !this.closest("[hidden]");
    return new page.DOMRect(0, 0, shown ? 200 : 0, shown ? 32 : 0);
  },
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await page.happyDOM.close();
});

function field(html: string): FormField {
  document.body.innerHTML = html;
  return document.querySelector<FormField>("input, select, textarea")!;
}

function kindOf(html: string, cardContext = false) {
  return classifyField(field(html), cardContext);
}

const CARD: CardData = {
  cardholder: "Jane Q Doe",
  number: "4242424242424242",
  expiry: "08/29",
  cvv: "123",
  brand: "visa",
};

const HOME: AddressData = {
  fullName: "Nguyễn Văn An",
  email: "an@example.com",
  phone: "090 123 4567",
  address: "12 Nguyễn Huệ\nTầng 3",
  ward: "Phường Bến Nghé",
  city: "Quận 1",
  region: "TP. Hồ Chí Minh",
  postalCode: "700000",
  country: "Việt Nam",
};

function recorder() {
  const events: string[] = [];
  const set = (element: FormField, value: string) => {
    element.addEventListener("input", () => events.push(`input:${element.id}`), { once: true });
    element.addEventListener("change", () => events.push(`change:${element.id}`), { once: true });
    setFieldValue(element, value);
  };
  return { events, set };
}

describe("classifying fields", () => {
  it("trusts autocomplete tokens first, including section and billing prefixes", () => {
    expect(kindOf('<input autocomplete="cc-number" name="email">')).toBe("cc-number");
    expect(kindOf('<input autocomplete="section-pay billing cc-exp-month">')).toBe("cc-exp-month");
    expect(kindOf('<input autocomplete="shipping cc-csc">')).toBe("cc-csc");
    expect(kindOf('<select autocomplete="cc-type"><option>Visa</option></select>')).toBe("cc-type");
    expect(kindOf('<input autocomplete="shipping address-line2">')).toBe("address-line2");
    expect(kindOf('<input autocomplete="tel-national">')).toBe("tel");
    expect(kindOf('<input autocomplete="country">')).toBe("country");
    expect(kindOf('<input autocomplete="organization">')).toBe("organization");
  });

  it("recognises English card fields by name, label and placeholder", () => {
    expect(kindOf('<label for="n">Card number</label><input id="n">')).toBe("cc-number");
    expect(kindOf('<input name="cardNumber" autocomplete="off">')).toBe("cc-number");
    expect(kindOf('<input placeholder="CVV">')).toBe("cc-csc");
    expect(kindOf('<input name="cvc2">')).toBe("cc-csc");
    expect(kindOf('<input placeholder="MM/YY">')).toBe("cc-exp");
    expect(kindOf('<input name="expiry_date">')).toBe("cc-exp");
    expect(kindOf('<input name="expMonth">')).toBe("cc-exp-month");
    expect(kindOf('<input name="exp-year">')).toBe("cc-exp-year");
    expect(kindOf('<input aria-label="Name on card">')).toBe("cc-name");
    expect(kindOf('<input name="cardholder">')).toBe("cc-name");
  });

  it("recognises Vietnamese card fields", () => {
    expect(kindOf("<label>Số thẻ <input></label>")).toBe("cc-number");
    expect(kindOf('<input placeholder="Tên chủ thẻ">')).toBe("cc-name");
    expect(kindOf('<input placeholder="Ngày hết hạn (MM/YY)">')).toBe("cc-exp");
    expect(kindOf('<label for="c">Mã bảo mật CVV</label><input id="c">')).toBe("cc-csc");
    expect(kindOf('<input placeholder="Tháng hết hạn">')).toBe("cc-exp-month");
  });

  it("reads month and year selects next to a card number", () => {
    document.body.innerHTML = `<form>
      <input name="ccnum"><select name="m"><option value="">--</option>${Array.from(
        { length: 12 },
        (_, i) => `<option>${i + 1}</option>`,
      ).join("")}</select>
      <select name="y"><option>2026</option><option>2027</option><option>2028</option></select>
    </form>`;
    expect(detectFields(document.forms[0]!).map((found) => found.kind)).toEqual([
      "cc-number",
      "cc-exp-month",
      "cc-exp-year",
    ]);
  });

  it("recognises English address fields", () => {
    expect(kindOf('<input name="first_name">')).toBe("given-name");
    expect(kindOf('<input name="lastName">')).toBe("family-name");
    expect(kindOf('<input name="fullName">')).toBe("name");
    expect(kindOf('<input type="email" name="contact">')).toBe("email");
    expect(kindOf('<input name="phone">')).toBe("tel");
    expect(kindOf('<input name="address1">')).toBe("address-line1");
    expect(kindOf('<input name="address2">')).toBe("address-line2");
    expect(kindOf('<textarea name="address"></textarea>')).toBe("street-address");
    expect(kindOf('<input name="city">')).toBe("address-level2");
    expect(kindOf('<select name="state"><option>CA</option></select>')).toBe("address-level1");
    expect(kindOf('<input name="zip">')).toBe("postal-code");
    expect(kindOf('<select name="country"><option>US</option></select>')).toBe("country-name");
    expect(kindOf('<input name="company">')).toBe("organization");
  });

  it("recognises Vietnamese address fields", () => {
    expect(kindOf('<input placeholder="Họ và tên">')).toBe("name");
    expect(kindOf('<input placeholder="Số điện thoại">')).toBe("tel");
    expect(kindOf('<input placeholder="Địa chỉ">')).toBe("address-line1");
    expect(kindOf("<label>Tỉnh/Thành phố <select><option>Hà Nội</option></select></label>")).toBe(
      "address-level1",
    );
    expect(kindOf("<label>Quận/Huyện <select><option>Quận 1</option></select></label>")).toBe(
      "address-level2",
    );
    expect(kindOf("<label>Phường/Xã <input></label>")).toBe("address-level3");
    expect(kindOf('<input placeholder="Mã bưu chính">')).toBe("postal-code");
  });

  it("leaves login, search and coupon fields alone", () => {
    expect(kindOf('<input name="username">')).toBeNull();
    expect(kindOf('<input type="search" name="city">')).toBeNull();
    expect(kindOf('<input name="coupon_code">')).toBeNull();
    expect(kindOf('<input type="password" name="cvv">')).toBeNull();
    expect(kindOf('<input type="hidden" name="cardnumber">')).toBeNull();
    expect(kindOf('<input name="month">')).toBeNull();
    expect(kindOf('<input name="month">', true)).toBe("cc-exp-month");
  });
});

describe("what kind of form it is", () => {
  it("calls a form with a card number a card form", () => {
    document.body.innerHTML =
      '<form><input id="n" name="cardnumber"><input id="c" name="cvc"></form>';
    const fields = detectFields(document.forms[0]!);
    expect(formKindOf(document.querySelector("#c")!, fields)).toBe("card");
  });

  it("needs a card number before calling a lone security code a card field", () => {
    document.body.innerHTML = '<form><input id="c" name="security_code"></form>';
    const fields = detectFields(document.forms[0]!);
    expect(formKindOf(document.querySelector("#c")!, fields)).toBeNull();
  });

  it("needs a place for an address form, and a name or phone for a profile form", () => {
    document.body.innerHTML =
      '<form><input id="e" type="email" name="email"><input name="phone"></form>';
    expect(formKindOf(document.querySelector("#e")!, detectFields(document.forms[0]!))).toBe(
      "profile",
    );
    document.body.innerHTML = '<form><input id="e" type="email" name="email"></form>';
    expect(formKindOf(document.querySelector("#e")!, detectFields(document.forms[0]!))).toBeNull();
    document.body.innerHTML =
      '<form><input id="e" type="email" name="email"><input name="phone"><input name="city"></form>';
    expect(formKindOf(document.querySelector("#e")!, detectFields(document.forms[0]!))).toBe(
      "address",
    );
  });
});

describe("expiry dates", () => {
  it("splits stored expiry dates", () => {
    expect(splitExpiry("08/29")).toEqual({ month: 8, year: 2029 });
    expect(splitExpiry("8-2031")).toEqual({ month: 8, year: 2031 });
    expect(splitExpiry("13/29")).toBeNull();
    expect(splitExpiry(undefined)).toBeNull();
  });

  it("formats a combined field the way it asks", () => {
    expect(formatExpiry(field('<input placeholder="MM/YY">'), 8, 2029)).toBe("08/29");
    expect(formatExpiry(field('<input placeholder="MM / YY">'), 8, 2029)).toBe("08 / 29");
    expect(formatExpiry(field('<input placeholder="MM/YYYY">'), 8, 2029)).toBe("08/2029");
    expect(formatExpiry(field('<input placeholder="MM-YY">'), 8, 2029)).toBe("08-29");
    expect(formatExpiry(field('<input name="exp" maxlength="4">'), 8, 2029)).toBe("0829");
    expect(formatExpiry(field('<input placeholder="MM / YY" maxlength="5">'), 8, 2029)).toBe(
      "08/29",
    );
    expect(formatExpiry(field('<input name="exp" maxlength="7">'), 8, 2029)).toBe("08/2029");
  });
});

describe("matching select options", () => {
  it("finds countries by code or name, in either language", () => {
    const select = field(
      '<select><option value="">Choose</option><option value="US">United States</option><option value="VN">Vietnam</option></select>',
    ) as HTMLSelectElement;
    expect(chooseOption(select, ["VN", "Vietnam", "Việt Nam"])).toBe("VN");
    const vi = field(
      '<select><option value="1">Hoa Kỳ</option><option value="84">Việt Nam</option></select>',
    ) as HTMLSelectElement;
    expect(chooseOption(vi, ["VN", "Vietnam", "Viet Nam", "Việt Nam"])).toBe("84");
  });

  it("finds states by code or name and provinces with or without their prefix", () => {
    const states = field(
      '<select><option value="AZ">Arizona</option><option value="CA">California</option></select>',
    ) as HTMLSelectElement;
    expect(chooseOption(states, ["ca", "california"])).toBe("CA");
    const provinces = field(
      '<select><option value="1">Thành phố Hà Nội</option><option value="79">Thành phố Hồ Chí Minh</option></select>',
    ) as HTMLSelectElement;
    expect(chooseOption(provinces, ["tp ho chi minh", "ho chi minh"])).toBe("79");
  });

  it("returns nothing rather than guessing", () => {
    const select = field(
      '<select><option value="FR">France</option></select>',
    ) as HTMLSelectElement;
    expect(chooseOption(select, ["Vietnam"])).toBeNull();
  });
});

describe("filling a card", () => {
  it("fills split month and year selects with a 4-digit year", () => {
    document.body.innerHTML = `<form>
      <input id="name" autocomplete="cc-name">
      <input id="number" autocomplete="cc-number">
      <select id="month" autocomplete="cc-exp-month"><option value="">MM</option>${Array.from(
        { length: 12 },
        (_, i) => `<option value="${String(i + 1).padStart(2, "0")}">${i + 1}</option>`,
      ).join("")}</select>
      <select id="year" autocomplete="cc-exp-year"><option>2028</option><option>2029</option></select>
      <input id="cvc" autocomplete="cc-csc">
      <select id="type" autocomplete="cc-type"><option value="mc">Mastercard</option><option value="vi">Visa</option></select>
    </form>`;
    const { events, set } = recorder();
    expect(fillCard(detectFields(document.forms[0]!), CARD, set)).toBe(6);
    const value = (id: string) => document.querySelector<FormField>(`#${id}`)!.value;
    expect(value("name")).toBe("Jane Q Doe");
    expect(value("number")).toBe("4242424242424242");
    expect(value("month")).toBe("08");
    expect(value("year")).toBe("2029");
    expect(value("cvc")).toBe("123");
    expect(value("type")).toBe("vi");
    expect(events).toContain("input:month");
    expect(events).toContain("change:month");
    expect(events).toContain("input:number");
  });

  it("fills 2-digit year inputs and a combined MM/YY field", () => {
    document.body.innerHTML = `<form>
      <input id="number" placeholder="Card number">
      <input id="mm" name="exp_month" maxlength="2">
      <input id="yy" name="exp_year" placeholder="YY">
    </form>`;
    fillCard(detectFields(document.forms[0]!), CARD, setFieldValue);
    expect(document.querySelector<HTMLInputElement>("#mm")!.value).toBe("08");
    expect(document.querySelector<HTMLInputElement>("#yy")!.value).toBe("29");

    document.body.innerHTML = `<form>
      <label>Số thẻ <input id="number"></label>
      <input id="exp" placeholder="MM/YY">
      <input id="cvv" placeholder="CVV">
    </form>`;
    fillCard(detectFields(document.forms[0]!), CARD, setFieldValue);
    expect(document.querySelector<HTMLInputElement>("#exp")!.value).toBe("08/29");
    expect(document.querySelector<HTMLInputElement>("#cvv")!.value).toBe("123");
  });

  it("names the brand from the number", () => {
    expect(cardBrand("4242 4242 4242 4242")).toBe("visa");
    expect(cardBrand("5555555555554444")).toBe("mastercard");
    expect(cardBrand("2223003122003222")).toBe("mastercard");
    expect(cardBrand("378282246310005")).toBe("amex");
    expect(cardBrand("6011111111111117")).toBe("discover");
    expect(cardBrand("3566002020360505")).toBe("jcb");
    expect(cardBrand("6200000000000005")).toBe("unionpay");
    expect(cardBrand("9999")).toBe("card");
  });
});

describe("filling an address", () => {
  it("fills a Vietnamese form with province, district and ward selects", () => {
    document.body.innerHTML = `<form>
      <input id="name" placeholder="Họ và tên">
      <input id="phone" placeholder="Số điện thoại">
      <label>Tỉnh/Thành phố <select id="province"><option value="">Chọn</option><option value="01">Thành phố Hà Nội</option><option value="79">Thành phố Hồ Chí Minh</option></select></label>
      <label>Quận/Huyện <select id="district"><option value="">Chọn</option><option value="760">Quận 1</option><option value="770">Quận 3</option></select></label>
      <label>Phường/Xã <select id="ward"><option value="26734">Phường Bến Nghé</option></select></label>
      <input id="street" placeholder="Địa chỉ">
    </form>`;
    const { events, set } = recorder();
    fillAddress(detectFields(document.forms[0]!), HOME, set);
    const value = (id: string) => document.querySelector<FormField>(`#${id}`)!.value;
    expect(value("name")).toBe("Nguyễn Văn An");
    expect(value("phone")).toBe("090 123 4567");
    expect(value("province")).toBe("79");
    expect(value("district")).toBe("760");
    expect(value("ward")).toBe("26734");
    expect(value("street")).toBe("12 Nguyễn Huệ, Tầng 3");
    expect(events).toContain("change:province");
  });

  it("fills a US form with split names, address lines, a state select and a country code", () => {
    document.body.innerHTML = `<form>
      <input id="given" autocomplete="given-name">
      <input id="family" autocomplete="family-name">
      <input id="line1" autocomplete="address-line1">
      <input id="line2" autocomplete="address-line2">
      <input id="city" autocomplete="address-level2">
      <select id="state" autocomplete="address-level1"><option value="">State</option><option value="CA">California</option><option value="OR">Oregon</option></select>
      <input id="zip" autocomplete="postal-code">
      <input id="country" autocomplete="country">
      <input id="email" type="email" autocomplete="email">
    </form>`;
    fillAddress(
      detectFields(document.forms[0]!),
      {
        fullName: "Mary Ann Smith",
        address: "1234 Maple Street\nApt 5B",
        city: "Portland",
        region: "OR",
        postalCode: "97201",
        country: "United States",
        email: "mary@example.com",
      },
      setFieldValue,
    );
    const value = (id: string) => document.querySelector<FormField>(`#${id}`)!.value;
    expect(value("given")).toBe("Mary Ann");
    expect(value("family")).toBe("Smith");
    expect(value("line1")).toBe("1234 Maple Street");
    expect(value("line2")).toBe("Apt 5B");
    expect(value("state")).toBe("OR");
    expect(value("zip")).toBe("97201");
    expect(value("country")).toBe("US");
    expect(value("email")).toBe("mary@example.com");
  });

  it("folds the ward into the street when the form has no field for it", () => {
    document.body.innerHTML = `<form>
      <textarea id="street" autocomplete="street-address"></textarea>
      <input id="city" name="city"><input id="zip" name="zip">
    </form>`;
    fillAddress(detectFields(document.forms[0]!), HOME, setFieldValue);
    expect(document.querySelector<HTMLTextAreaElement>("#street")!.value).toBe(
      "12 Nguyễn Huệ\nTầng 3\nPhường Bến Nghé",
    );
  });

  it("splits Vietnamese names family first", () => {
    expect(splitName("Nguyễn Văn An", "Việt Nam")).toEqual({ given: "Văn An", family: "Nguyễn" });
    expect(splitName("Mary Ann Smith", "US")).toEqual({ given: "Mary Ann", family: "Smith" });
    expect(splitName("Cher")).toEqual({ given: "Cher", family: "" });
  });
});
