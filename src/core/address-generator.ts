import { foldText } from "./address-data.js";
import { randomInt } from "./generator.js";

export type AddressCountry = "US" | "VN";

export interface RandomAddress {
  code: AddressCountry;
  fullName: string;
  email?: string;
  phone: string;
  address: string;
  ward?: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

export interface AddressOptions {
  country: AddressCountry;
  email?: boolean;
  emailDomain?: string;
}

export const DEFAULT_EMAIL_DOMAIN = "example.com";

const US_GIVEN = [
  "James",
  "Mary",
  "Robert",
  "Patricia",
  "John",
  "Jennifer",
  "Michael",
  "Linda",
  "David",
  "Elizabeth",
  "Daniel",
  "Sarah",
  "Emily",
  "Chris",
  "Olivia",
  "Noah",
];

const US_FAMILY = [
  "Smith",
  "Johnson",
  "Williams",
  "Brown",
  "Jones",
  "Garcia",
  "Miller",
  "Davis",
  "Wilson",
  "Anderson",
  "Taylor",
  "Thomas",
  "Moore",
  "Martin",
  "Lee",
  "Clark",
];

const US_STREETS = [
  "Maple Street",
  "Oak Avenue",
  "Pine Road",
  "Cedar Lane",
  "Elm Street",
  "Washington Avenue",
  "Lakeview Drive",
  "Park Place",
  "Hillcrest Road",
  "Sunset Boulevard",
  "Main Street",
  "Willow Way",
];

const US_CITIES: readonly (readonly [string, string, string, string])[] = [
  ["Springfield", "IL", "627", "217"],
  ["Portland", "OR", "972", "503"],
  ["Austin", "TX", "787", "512"],
  ["Denver", "CO", "802", "303"],
  ["Columbus", "OH", "432", "614"],
  ["Madison", "WI", "537", "608"],
  ["Raleigh", "NC", "276", "919"],
  ["Boise", "ID", "837", "208"],
  ["Sacramento", "CA", "958", "916"],
  ["Albany", "NY", "122", "518"],
  ["Richmond", "VA", "232", "804"],
  ["Nashville", "TN", "372", "615"],
  ["Phoenix", "AZ", "850", "602"],
  ["Seattle", "WA", "981", "206"],
  ["Boston", "MA", "021", "617"],
];

const VN_FAMILY = [
  "Nguyễn",
  "Trần",
  "Lê",
  "Phạm",
  "Hoàng",
  "Huỳnh",
  "Phan",
  "Vũ",
  "Võ",
  "Đặng",
  "Bùi",
  "Đỗ",
];

const VN_MIDDLE = ["Văn", "Thị", "Minh", "Đức", "Ngọc", "Thanh", "Quang", "Thu", "Hữu", "Gia"];

const VN_GIVEN = [
  "An",
  "Bình",
  "Châu",
  "Dũng",
  "Giang",
  "Hà",
  "Hải",
  "Hương",
  "Khoa",
  "Lan",
  "Long",
  "Mai",
  "Nam",
  "Phúc",
  "Quân",
  "Thảo",
  "Trang",
  "Tuấn",
  "Vy",
];

const VN_STREETS = [
  "Nguyễn Huệ",
  "Lê Lợi",
  "Trần Hưng Đạo",
  "Hai Bà Trưng",
  "Lý Thường Kiệt",
  "Điện Biên Phủ",
  "Nguyễn Thị Minh Khai",
  "Phan Đình Phùng",
  "Lê Duẩn",
  "Võ Văn Tần",
  "Pasteur",
  "Hùng Vương",
];

interface VnProvince {
  name: string;
  postal: string;
  districts: readonly (readonly [string, readonly string[]])[];
}

const VN_PROVINCES: readonly VnProvince[] = [
  {
    name: "TP. Hồ Chí Minh",
    postal: "70",
    districts: [
      ["Quận 1", ["Phường Bến Nghé", "Phường Bến Thành", "Phường Đa Kao"]],
      ["Quận 3", ["Phường Võ Thị Sáu", "Phường 9", "Phường 14"]],
      ["Quận Bình Thạnh", ["Phường 22", "Phường 25"]],
      ["Thành phố Thủ Đức", ["Phường Thảo Điền", "Phường An Phú"]],
    ],
  },
  {
    name: "Hà Nội",
    postal: "10",
    districts: [
      ["Quận Hoàn Kiếm", ["Phường Hàng Bạc", "Phường Tràng Tiền"]],
      ["Quận Ba Đình", ["Phường Kim Mã", "Phường Điện Biên"]],
      ["Quận Cầu Giấy", ["Phường Dịch Vọng", "Phường Nghĩa Đô"]],
    ],
  },
  {
    name: "Đà Nẵng",
    postal: "55",
    districts: [
      ["Quận Hải Châu", ["Phường Thạch Thang", "Phường Hải Châu I"]],
      ["Quận Sơn Trà", ["Phường An Hải Bắc", "Phường Phước Mỹ"]],
    ],
  },
  {
    name: "Hải Phòng",
    postal: "18",
    districts: [
      ["Quận Lê Chân", ["Phường An Biên", "Phường Cát Dài"]],
      ["Quận Ngô Quyền", ["Phường Máy Tơ", "Phường Lạch Tray"]],
    ],
  },
  {
    name: "Cần Thơ",
    postal: "90",
    districts: [["Quận Ninh Kiều", ["Phường Tân An", "Phường An Hòa", "Phường Xuân Khánh"]]],
  },
  {
    name: "Khánh Hòa",
    postal: "65",
    districts: [["Thành phố Nha Trang", ["Phường Lộc Thọ", "Phường Vĩnh Hải", "Xã Vĩnh Lương"]]],
  },
];

function pick<T>(items: readonly T[]): T {
  return items[randomInt(items.length)]!;
}

function digits(count: number): string {
  return Array.from({ length: count }, () => randomInt(10)).join("");
}

export function emailDomainOf(input: string | undefined): string {
  const domain = (input ?? "").trim().replace(/^@+/, "").toLowerCase();
  return /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)
    ? domain
    : DEFAULT_EMAIL_DOMAIN;
}

function emailFor(given: string, family: string, domain: string): string {
  const local = [given, family].map((part) => foldText(part).replace(/\s+/g, "")).join(".");
  return `${local}${1000 + randomInt(9000)}@${domain}`;
}

const VN_MOBILE = [
  "032",
  "033",
  "034",
  "035",
  "036",
  "037",
  "038",
  "039",
  "070",
  "076",
  "077",
  "078",
  "079",
  "081",
  "082",
  "083",
  "084",
  "085",
  "086",
  "088",
  "089",
  "090",
  "091",
  "093",
  "094",
  "096",
  "097",
  "098",
];

function usExchange(): string {
  for (;;) {
    const exchange = `${2 + randomInt(8)}${digits(2)}`;
    if (exchange !== "555" && !exchange.endsWith("11")) {
      return exchange;
    }
  }
}

function usAddress(): Omit<RandomAddress, "email"> & { given: string; family: string } {
  const given = pick(US_GIVEN);
  const family = pick(US_FAMILY);
  const [city, state, zip, area] = pick(US_CITIES);
  const street = `${100 + randomInt(9900)} ${pick(US_STREETS)}`;
  const unit = randomInt(3) === 0 ? `\nApt ${1 + randomInt(40)}${pick(["", "A", "B", "C"])}` : "";
  return {
    code: "US",
    given,
    family,
    fullName: `${given} ${family}`,
    phone: `+1 (${area}) ${usExchange()}-${digits(4)}`,
    address: street + unit,
    city,
    region: state,
    postalCode: zip + digits(2),
    country: "United States",
  };
}

function vnAddress(): Omit<RandomAddress, "email"> & { given: string; family: string } {
  const family = pick(VN_FAMILY);
  const given = pick(VN_GIVEN);
  const province = pick(VN_PROVINCES);
  const [district, wards] = pick(province.districts);
  const number =
    randomInt(4) === 0 ? `${1 + randomInt(200)}/${1 + randomInt(30)}` : `${1 + randomInt(300)}`;
  return {
    code: "VN",
    given,
    family,
    fullName: `${family} ${pick(VN_MIDDLE)} ${given}`,
    phone: `+84 ${pick(VN_MOBILE).slice(1)} ${digits(3)} ${digits(4)}`,
    address: `${number} ${pick(VN_STREETS)}`,
    ward: pick(wards),
    city: district,
    region: province.name,
    postalCode: province.postal + digits(4),
    country: "Việt Nam",
  };
}

export function generateAddress(options: AddressOptions): RandomAddress {
  const { given, family, ...address } = options.country === "VN" ? vnAddress() : usAddress();
  return options.email
    ? { ...address, email: emailFor(given, family, emailDomainOf(options.emailDomain)) }
    : address;
}
