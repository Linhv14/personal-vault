# Personal Vault

Password manager cá nhân: browser extension + Cloudflare Workers + D1.

Mục tiêu là bỏ hẳn việc phải mở app 2FA trên điện thoại mỗi lần đăng nhập — mã
TOTP hiện ngay trong extension và tự refresh mỗi 30 giây.

- **Mã hoá đầu-cuối.** Server chỉ lưu ciphertext và không có khoá để đọc.
- **TOTP tự refresh**, tính offline theo RFC 6238. Không có network nào tham gia.
- **Sinh mật khẩu** ngẫu nhiên / passphrase / PIN, kèm số bit entropy.
- **Link chia sẻ tạm thời**, có hạn dùng và giới hạn lượt xem, kèm mã 2FA tự
  refresh cho người nhận — họ không cần cài gì.
- **Dùng được offline** từ bản đã sync về máy.

Thiết kế đầy đủ, gồm lý do của từng quyết định:
[`docs/plans/2026-10-11-personal-vault-design.md`](docs/plans/2026-10-11-personal-vault-design.md).

## Mô hình tin cậy — đọc trước khi tin

```
master password + email
   └─ PBKDF2-SHA256 600k ─→ master key
         ├─ HKDF "auth" ─→ auth key          → gửi server (không giải mã được gì)
         └─ HKDF "enc"  ─→ wrapping key      → KHÔNG BAO GIỜ rời máy
                             └─ mở wrapped_vault_key → vault key → AES-256-GCM
```

Server **biết**: email, số lượng item, thời điểm sửa, thời điểm đăng nhập, IP.
Server **không biết**: tên site, username, mật khẩu, TOTP secret, ghi chú.

Hai giới hạn cần biết rõ:

1. **Quên master password là mất sạch.** Không có cơ chế khôi phục, và điều đó là
   cố ý — có backdoor khôi phục nghĩa là có đường vào cho người khác.
2. **Gửi link share qua Zalo/Messenger thì nền tảng đó đọc được cả link**, kể cả
   phần khoá sau dấu `#`, vì với họ link chỉ là text. Server của bạn thì mù.
   Dùng tuỳ chọn *mật khẩu phụ* và báo nó qua kênh khác để một kênh bị đọc vẫn
   không đủ để mở.

## Cài đặt

### 1. Triển khai Worker

```bash
npm install
npx wrangler login                      # account Cloudflare của bạn

npx wrangler d1 create vault            # chép database_id vào wrangler.toml
npm run db:migrate                      # chạy migration trên D1 thật

# Hai secret bắt buộc:
npx wrangler secret put REGISTRATION_TOKEN   # chuỗi bí mật, chỉ bạn biết
npx wrangler secret put EMAIL_PROBE_SECRET   # chuỗi ngẫu nhiên bất kỳ

npm run build
npm run deploy
```

`REGISTRATION_TOKEN` là thứ chặn người lạ tạo account trên Worker của bạn. Không
có nó, URL Worker là một trang đăng ký công khai.

### 2. Cài extension

```bash
npm run build
```

Mở `chrome://extensions` → bật **Developer mode** → **Load unpacked** → chọn thư
mục `dist/extension`.

Lần đầu mở popup, nhập: địa chỉ Worker, email, token đăng ký, master password.
Extension sẽ xin quyền truy cập đúng domain Worker của bạn.

## Phát triển

```bash
npm test              # 109 test: vector chuẩn RFC, crypto, generator, popup
npm run typecheck     # hai project: browser và worker
npm run build:dev     # build kèm sourcemap

npx wrangler d1 migrations apply vault --local
npm run dev           # Worker local tại http://127.0.0.1:8787
```

Test e2e chạy thật qua Worker + D1 local (mặc định bị bỏ qua):

```bash
# cần .dev.vars với REGISTRATION_TOKEN="token-dev-local"
VAULT_E2E=1 npx vitest run test/e2e.test.ts
```

Tạo một link share thật để xem trang `/s/:id` trong browser:

```bash
npx esbuild scripts/make-share-link.ts --bundle --platform=node --format=esm --outfile=dist/mk.mjs
node dist/mk.mjs
```

## Cấu trúc

```
src/core/      Mật mã, TOTP, generator, share. Chỉ dùng WebCrypto, không
               dependency — chạy được ở cả browser, Workers và Node.
src/worker/    Worker trên Hono: auth, sync item, share link.
extension/     Extension MV3. Popup chứa toàn bộ UI; service worker chỉ lo
               auto-lock, vì MV3 kill nó sau ~30 giây không hoạt động.
share/         Trang `/s/:id` cho người nhận link.
migrations/    Migration D1.
```

### Vài quyết định dễ bị sửa nhầm

- `src/core` **không có dependency nào**. Mọi thư viện thêm vào đây đều nằm trong
  đường đi của mật khẩu của bạn.
- Extension **không có content script**, nên nó không có quyền đọc/ghi DOM của
  mọi trang web. Đổi lại là không autofill — chỉ copy từ popup.
- `chrome.storage.local` nằm **trên đĩa**: chỉ chứa ciphertext và cấu hình.
  Vault key và session token chỉ ở `chrome.storage.session` (bộ nhớ).
- Item xoá bằng tombstone (`deleted_at`), không DELETE thật — nếu không, thiết bị
  đang offline sẽ sync item đã xoá trở lại.
- TOTP dùng HMAC-**SHA1** theo đúng RFC 6238. Đổi sang SHA-256 sẽ ra mã không
  khớp với site.

## Chi phí

Nằm gọn trong bậc miễn phí của Cloudflare (Workers 100k request/ngày, D1 5GB).
Chỉ tốn tiền domain, và dùng `*.workers.dev` thì không tốn gì.
