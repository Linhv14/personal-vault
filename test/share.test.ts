import { describe, expect, it } from "vitest";
import {
  buildShareUrl,
  createShare,
  fragmentNeedsPassphrase,
  openShare,
  type SharePayload,
} from "../src/core/share.js";
import { fromBase64, fromBase64Url, toBase64 } from "../src/core/bytes.js";

const PAYLOAD: SharePayload = {
  title: "Netflix của nhà",
  username: "me@x.com",
  password: "p@ssw0rd rất dài",
  note: "Ghi chú có dấu: ưởng, ễ, ộ",
  totp: { secret: "JBSWY3DPEHPK3PXP", algorithm: "SHA-1", digits: 6, period: 30 },
};

describe("createShare / openShare", () => {
  it("round-trip giữ nguyên toàn bộ payload", async () => {
    const { sealed, fragment } = await createShare(PAYLOAD);
    expect(await openShare(fragment, sealed)).toEqual(PAYLOAD);
  });

  it("khoá dài 32 byte và mỗi lần share một khoá khác", async () => {
    const a = await createShare(PAYLOAD);
    const b = await createShare(PAYLOAD);
    expect(fromBase64Url(a.fragment)).toHaveLength(32);
    expect(a.fragment).not.toBe(b.fragment);
    expect(a.sealed.ciphertext).not.toBe(b.sealed.ciphertext);
  });

  it("fragment là base64url, không chứa ký tự bị URL mã hoá lại", async () => {
    // `+` và `/` của base64 thường sẽ bị biến dạng khi qua URL, làm khoá sai.
    for (let i = 0; i < 50; i++) {
      const { fragment } = await createShare(PAYLOAD);
      expect(fragment).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("ciphertext không chứa dấu vết của plaintext", async () => {
    const { sealed } = await createShare(PAYLOAD);
    const raw = new TextDecoder("latin1").decode(fromBase64(sealed.ciphertext));
    expect(raw).not.toContain("Netflix");
    expect(raw).not.toContain("JBSWY3DPEHPK3PXP");
  });

  it("khoá khác không mở được", async () => {
    const { sealed } = await createShare(PAYLOAD);
    const other = await createShare(PAYLOAD);
    await expect(openShare(other.fragment, sealed)).rejects.toThrow(/Không giải mã được/);
  });

  it("từ chối khoá sai độ dài hoặc rác", async () => {
    const { sealed } = await createShare(PAYLOAD);
    await expect(openShare(toBase64(new Uint8Array(16)), sealed)).rejects.toThrow(/không hợp lệ/);
    await expect(openShare("!!!không-phải-base64!!!", sealed)).rejects.toThrow(/không hợp lệ/);
  });

  it("chấp nhận fragment có cả dấu # ở đầu, như location.hash trả về", async () => {
    // `location.hash` trong browser luôn kèm dấu #; quên bỏ nó là một lỗi im lặng
    // làm mọi link đều báo giải mã thất bại.
    const { sealed, fragment } = await createShare(PAYLOAD);
    expect(await openShare(`#${fragment}`, sealed)).toEqual(PAYLOAD);
  });
});

describe("mật khẩu phụ", () => {
  it("cần đúng cả link và mật khẩu phụ mới mở được", async () => {
    const { sealed, fragment } = await createShare(PAYLOAD, "cà phê sữa");
    expect(await openShare(fragment, sealed, "cà phê sữa")).toEqual(PAYLOAD);
  });

  it("có link mà sai mật khẩu phụ thì không mở được", async () => {
    const { sealed, fragment } = await createShare(PAYLOAD, "cà phê sữa");
    await expect(openShare(fragment, sealed, "cà phê đen")).rejects.toThrow(/không đúng/);
  });

  it("báo trước là cần mật khẩu phụ, thay vì để người nhận đoán", async () => {
    const withPass = await createShare(PAYLOAD, "bí mật");
    const without = await createShare(PAYLOAD);
    expect(fragmentNeedsPassphrase(withPass.fragment)).toBe(true);
    expect(fragmentNeedsPassphrase(`#${withPass.fragment}`)).toBe(true);
    expect(fragmentNeedsPassphrase(without.fragment)).toBe(false);
    await expect(openShare(withPass.fragment, withPass.sealed)).rejects.toThrow(/cần mật khẩu phụ/);
  });

  it("link không đặt mật khẩu phụ thì mật khẩu truyền vào bị bỏ qua", async () => {
    const { sealed, fragment } = await createShare(PAYLOAD);
    expect(await openShare(fragment, sealed, "nhập bừa")).toEqual(PAYLOAD);
  });
});

describe("buildShareUrl", () => {
  it("ghép đúng dạng /s/<id>#<fragment>", () => {
    expect(buildShareUrl("https://vault.example.com", "abc123", "KEY")).toBe(
      "https://vault.example.com/s/abc123#KEY",
    );
  });

  it("không tạo dấu gạch chéo đôi khi origin có sẵn dấu /", () => {
    expect(buildShareUrl("https://vault.example.com/", "abc", "K")).toBe(
      "https://vault.example.com/s/abc#K",
    );
  });
});
