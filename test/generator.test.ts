import { describe, expect, it } from "vitest";
import {
  buildAlphabet,
  generatePassphrase,
  generatePassword,
  generatePin,
  randomInt,
  rateStrength,
} from "../src/core/generator.js";
import { EFF_SHORT_WORDLIST } from "../src/core/wordlist.js";

describe("randomInt", () => {
  it("luôn nằm trong [0, max)", () => {
    for (const max of [2, 3, 10, 26, 95, 1296]) {
      for (let i = 0; i < 500; i++) {
        const n = randomInt(max);
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThan(max);
      }
    }
  });

  it("max = 1 luôn trả 0 mà không treo", () => {
    expect(randomInt(1)).toBe(0);
  });

  it("từ chối max không hợp lệ", () => {
    expect(() => randomInt(0)).toThrow(/nguyên dương/);
    expect(() => randomInt(-5)).toThrow();
    expect(() => randomInt(2.5)).toThrow();
  });

  it("phân phối không lệch rõ rệt với max không chia hết 2^32", () => {
    // max = 3 là trường hợp kinh điển của modulo bias. Với 30.000 mẫu, mỗi giá
    // trị nên chiếm ~33,3%; ngưỡng 2 điểm phần trăm rất rộng so với sai số
    // thống kê, nên test này không bị đỏ ngẫu nhiên nhưng vẫn bắt được bias thật.
    const counts = [0, 0, 0];
    const samples = 30_000;
    for (let i = 0; i < samples; i++) counts[randomInt(3)]! += 1;
    for (const count of counts) {
      expect(Math.abs(count / samples - 1 / 3)).toBeLessThan(0.02);
    }
  });
});

describe("buildAlphabet", () => {
  it("mặc định gồm cả bốn nhóm", () => {
    const alphabet = buildAlphabet();
    expect(alphabet).toMatch(/[a-z]/);
    expect(alphabet).toMatch(/[A-Z]/);
    expect(alphabet).toMatch(/[0-9]/);
    expect(alphabet).toMatch(/[!@#]/);
  });

  it("bỏ ký tự dễ đọc lẫn khi excludeAmbiguous", () => {
    const alphabet = buildAlphabet({ excludeAmbiguous: true });
    for (const char of ["0", "O", "o", "I", "l", "1"]) {
      expect(alphabet).not.toContain(char);
    }
  });

  it("báo lỗi khi không chọn nhóm nào", () => {
    expect(() =>
      buildAlphabet({ lowercase: false, uppercase: false, digits: false, symbols: false }),
    ).toThrow(/ít nhất một nhóm/);
  });
});

describe("generatePassword", () => {
  it("đúng độ dài yêu cầu", () => {
    for (const length of [8, 16, 20, 64, 256]) {
      expect(generatePassword({ length }).value).toHaveLength(length);
    }
  });

  it("có ít nhất một ký tự từ mỗi nhóm đã chọn", () => {
    // Chạy nhiều lần vì đây là ràng buộc xác suất; một lần may mắn không chứng
    // minh được gì.
    for (let i = 0; i < 200; i++) {
      const { value } = generatePassword({ length: 12 });
      expect(value).toMatch(/[a-z]/);
      expect(value).toMatch(/[A-Z]/);
      expect(value).toMatch(/[0-9]/);
      expect(value).toMatch(/[!@#$%^&*()\-_=+\[\]{};:,.?]/);
    }
  });

  it("chỉ dùng nhóm được bật", () => {
    for (let i = 0; i < 100; i++) {
      const { value } = generatePassword({ length: 24, uppercase: false, symbols: false });
      expect(value).toMatch(/^[a-z0-9]+$/);
    }
  });

  it("ký tự bắt buộc không bị dồn về đầu chuỗi", () => {
    // Nếu quên trộn (shuffle), ký tự của các nhóm bắt buộc luôn nằm ở 4 vị trí
    // đầu theo đúng thứ tự lowercase/uppercase/digit/symbol — một lỗi im lặng
    // làm giảm entropy thật đi nhiều.
    let digitInFirstFour = 0;
    const runs = 400;
    for (let i = 0; i < runs; i++) {
      if (/[0-9]/.test(generatePassword({ length: 20 }).value.slice(0, 4))) digitInFirstFour += 1;
    }
    expect(digitInFirstFour).toBeLessThan(runs * 0.9);
  });

  it("mỗi lần sinh một mật khẩu khác nhau", () => {
    const values = new Set(Array.from({ length: 200 }, () => generatePassword().value));
    expect(values.size).toBe(200);
  });

  it("entropy khớp công thức length * log2(alphabet)", () => {
    const alphabet = buildAlphabet();
    const { entropyBits } = generatePassword({ length: 20 });
    expect(entropyBits).toBeCloseTo(20 * Math.log2(alphabet.length), 1);
  });

  it("từ chối độ dài không đủ cho các nhóm bắt buộc, và độ dài quá lớn", () => {
    expect(() => generatePassword({ length: 3 })).toThrow(/tối thiểu/);
    expect(() => generatePassword({ length: 257 })).toThrow(/tối đa/);
  });
});

describe("generatePassphrase", () => {
  it("mặc định 8 từ nối bằng gạch ngang, từ nào cũng có trong wordlist", () => {
    // 8 từ chứ không phải 5: wordlist ngắn chỉ cho 10,34 bit/từ, nên 5 từ ra
    // 51,7 bit — chưa đủ chống brute-force offline.
    const { value } = generatePassphrase();
    const words = value.split("-");
    expect(words).toHaveLength(8);
    for (const word of words) expect(EFF_SHORT_WORDLIST).toContain(word);
  });

  it("entropy tính từ độ dài wordlist thật", () => {
    const { entropyBits } = generatePassphrase({ words: 6 });
    expect(entropyBits).toBeCloseTo(6 * Math.log2(1296), 1);
  });

  it("wordlist EFF có đúng 1296 từ, không trùng lặp", () => {
    // Trùng lặp sẽ làm entropy hiển thị cao hơn thực tế.
    expect(EFF_SHORT_WORDLIST).toHaveLength(1296);
    expect(new Set(EFF_SHORT_WORDLIST).size).toBe(1296);
  });

  it("capitalize và appendDigit hoạt động", () => {
    const { value, entropyBits } = generatePassphrase({
      words: 4,
      capitalize: true,
      appendDigit: true,
      separator: ".",
    });
    const parts = value.split(".");
    expect(parts).toHaveLength(5);
    for (const word of parts.slice(0, 4)) expect(word[0]).toMatch(/[A-Z]/);
    expect(parts[4]).toMatch(/^[0-9]$/);
    expect(entropyBits).toBeCloseTo(4 * Math.log2(1296) + Math.log2(10), 1);
  });

  it("dùng được wordlist tuỳ chọn", () => {
    const { value, entropyBits } = generatePassphrase({ words: 3, wordlist: ["mèo", "chó"] });
    expect(value.split("-").every((w) => ["mèo", "chó"].includes(w))).toBe(true);
    expect(entropyBits).toBe(3);
  });

  it("từ chối tham số vô lý", () => {
    expect(() => generatePassphrase({ words: 1 })).toThrow(/ít nhất 2 từ/);
    expect(() => generatePassphrase({ words: 33 })).toThrow(/32 từ/);
    expect(() => generatePassphrase({ wordlist: ["chỉ-một"] })).toThrow(/quá ngắn/);
  });
});

describe("generatePin", () => {
  it("chỉ gồm chữ số, đúng độ dài", () => {
    const { value, entropyBits } = generatePin(6);
    expect(value).toMatch(/^\d{6}$/);
    expect(entropyBits).toBeCloseTo(6 * Math.log2(10), 1);
  });

  it("từ chối độ dài ngoài khoảng cho phép", () => {
    expect(() => generatePin(2)).toThrow(/từ 3 đến 32/);
    expect(() => generatePin(33)).toThrow();
  });
});

describe("rateStrength", () => {
  it("xếp hạng theo mốc entropy", () => {
    expect(rateStrength(30)).toBe("rất yếu");
    expect(rateStrength(50)).toBe("yếu");
    expect(rateStrength(70)).toBe("khá");
    expect(rateStrength(90)).toBe("mạnh");
    expect(rateStrength(130)).toBe("rất mạnh");
  });

  it("mặc định của cả ba chế độ đều đạt mức mạnh trở lên", () => {
    expect(rateStrength(generatePassword().entropyBits)).toMatch(/mạnh/);
    expect(rateStrength(generatePassphrase().entropyBits)).toMatch(/mạnh/);
  });
});
