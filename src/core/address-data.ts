export interface Country {
  code: string;
  names: readonly string[];
}

export const COUNTRIES: readonly Country[] = [
  { code: "US", names: ["United States", "United States of America", "USA", "Hoa Kỳ", "Mỹ"] },
  { code: "VN", names: ["Vietnam", "Viet Nam", "Việt Nam"] },
  { code: "GB", names: ["United Kingdom", "UK", "Great Britain", "Vương quốc Anh", "Anh"] },
  { code: "CA", names: ["Canada"] },
  { code: "AU", names: ["Australia", "Úc"] },
  { code: "NZ", names: ["New Zealand"] },
  { code: "DE", names: ["Germany", "Deutschland", "Đức"] },
  { code: "FR", names: ["France", "Pháp"] },
  { code: "NL", names: ["Netherlands", "Hà Lan"] },
  { code: "IT", names: ["Italy", "Ý"] },
  { code: "ES", names: ["Spain", "Tây Ban Nha"] },
  { code: "SE", names: ["Sweden", "Thụy Điển"] },
  { code: "CH", names: ["Switzerland", "Thụy Sĩ"] },
  { code: "IE", names: ["Ireland"] },
  { code: "JP", names: ["Japan", "Nhật Bản"] },
  { code: "KR", names: ["South Korea", "Korea, Republic of", "Korea", "Hàn Quốc"] },
  { code: "CN", names: ["China", "Trung Quốc"] },
  { code: "TW", names: ["Taiwan", "Đài Loan"] },
  { code: "HK", names: ["Hong Kong", "Hồng Kông"] },
  { code: "SG", names: ["Singapore"] },
  { code: "TH", names: ["Thailand", "Thái Lan"] },
  { code: "MY", names: ["Malaysia"] },
  { code: "ID", names: ["Indonesia"] },
  { code: "PH", names: ["Philippines"] },
  { code: "IN", names: ["India", "Ấn Độ"] },
  { code: "LA", names: ["Laos", "Lào"] },
  { code: "KH", names: ["Cambodia", "Campuchia"] },
  { code: "BR", names: ["Brazil"] },
  { code: "MX", names: ["Mexico"] },
];

export const US_STATES: readonly (readonly [string, string])[] = [
  ["AL", "Alabama"],
  ["AK", "Alaska"],
  ["AZ", "Arizona"],
  ["AR", "Arkansas"],
  ["CA", "California"],
  ["CO", "Colorado"],
  ["CT", "Connecticut"],
  ["DE", "Delaware"],
  ["DC", "District of Columbia"],
  ["FL", "Florida"],
  ["GA", "Georgia"],
  ["HI", "Hawaii"],
  ["ID", "Idaho"],
  ["IL", "Illinois"],
  ["IN", "Indiana"],
  ["IA", "Iowa"],
  ["KS", "Kansas"],
  ["KY", "Kentucky"],
  ["LA", "Louisiana"],
  ["ME", "Maine"],
  ["MD", "Maryland"],
  ["MA", "Massachusetts"],
  ["MI", "Michigan"],
  ["MN", "Minnesota"],
  ["MS", "Mississippi"],
  ["MO", "Missouri"],
  ["MT", "Montana"],
  ["NE", "Nebraska"],
  ["NV", "Nevada"],
  ["NH", "New Hampshire"],
  ["NJ", "New Jersey"],
  ["NM", "New Mexico"],
  ["NY", "New York"],
  ["NC", "North Carolina"],
  ["ND", "North Dakota"],
  ["OH", "Ohio"],
  ["OK", "Oklahoma"],
  ["OR", "Oregon"],
  ["PA", "Pennsylvania"],
  ["RI", "Rhode Island"],
  ["SC", "South Carolina"],
  ["SD", "South Dakota"],
  ["TN", "Tennessee"],
  ["TX", "Texas"],
  ["UT", "Utah"],
  ["VT", "Vermont"],
  ["VA", "Virginia"],
  ["WA", "Washington"],
  ["WV", "West Virginia"],
  ["WI", "Wisconsin"],
  ["WY", "Wyoming"],
];

const REGION_PREFIX = /^(tinh|thanh pho|tp|quan|huyen|thi xa|phuong|xa|state of)\s+/;

export function foldText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function countryOf(value: string | undefined): Country | undefined {
  const folded = foldText(value ?? "");
  if (!folded) return undefined;
  return COUNTRIES.find(
    (country) =>
      foldText(country.code) === folded || country.names.some((name) => foldText(name) === folded),
  );
}

export function regionNames(value: string | undefined): string[] {
  const folded = foldText(value ?? "");
  if (!folded) return [];
  const state = US_STATES.find(
    ([code, name]) => foldText(code) === folded || foldText(name) === folded,
  );
  const bare = folded.replace(REGION_PREFIX, "");
  const names = state ? [foldText(state[0]), foldText(state[1])] : [folded];
  if (bare !== folded) names.push(bare);
  if (bare === "ho chi minh") names.push("hcm", "tp hcm", "sai gon");
  return [...new Set(names)];
}

export function bareRegion(value: string): string {
  return foldText(value).replace(REGION_PREFIX, "");
}
