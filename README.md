# Personal Vault

Password manager cá nhân: browser extension + Cloudflare Workers + D1.
**Bạn tự deploy một bản trên account Cloudflare của chính bạn.**

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

## Tại sao phải tự deploy

Không có server chung, và đó là điểm chính chứ không phải sự bất tiện.

Một password manager mà dữ liệu nằm trên hạ tầng của tác giả thì bạn phải tin
tác giả — tin rằng họ không đổi code để gửi khoá về, tin rằng họ không bị hack,
tin rằng họ còn duy trì dịch vụ sang năm. Tự deploy thì **tác giả không có quyền
truy cập nào vào dữ liệu của bạn**, kể cả muốn cũng không.

Chi phí: nằm gọn trong bậc miễn phí của Cloudflare (Workers 100k request/ngày,
D1 5GB). Dùng tên miền `*.workers.dev` thì không tốn đồng nào.

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

Cần Node 20+ và một account Cloudflare (bậc miễn phí là đủ).

```bash
git clone <repo> personal-vault
cd personal-vault
npm install
npm run deploy          # hoặc: npx cf deploy
```

Lệnh đó làm mọi thứ, và chạy lại nhiều lần được:

1. Mở browser cho bạn đăng nhập Cloudflare nếu chưa đăng nhập.
2. Hỏi deploy vào account nào, nếu bạn có nhiều account.
3. Tạo D1 database `vault` — hoặc dùng lại nếu đã có.
4. Chạy migration.
5. Sinh `REGISTRATION_TOKEN` và `EMAIL_PROBE_SECRET`, ghi token đăng ký vào
   `.secrets.local.txt` (đã gitignore) thay vì in ra terminal.
6. Build rồi deploy, in ra URL Worker của bạn.

Sau đó cài extension:

```bash
npm run build
```

Mở `chrome://extensions` → bật **Developer mode** → **Load unpacked** → chọn thư
mục `dist/extension`.

Lần đầu mở popup, nhập: URL Worker ở bước trên, email của bạn, token đăng ký
trong `.secrets.local.txt`, và master password.

> `REGISTRATION_TOKEN` là thứ chặn người lạ tạo account trên Worker của bạn.
> Không có nó, URL Worker là một trang đăng ký công khai.

### Lệnh khác

```bash
npm run deploy    # deploy (chạy lại được, không tạo trùng tài nguyên)
npm run dev       # Worker local + D1 local tại http://127.0.0.1:8787
npm run status    # đang deploy ở account nào, dùng tài nguyên nào
npm run logs      # log realtime của Worker
```

### Ghi chú về cấu hình

`wrangler.toml` trong repo **cố tình không chứa `account_id` hay `database_id`** —
đó là giá trị của riêng từng người. `cf deploy` điền chúng vào
`.wrangler.local.toml` (đã gitignore) rồi chạy wrangler với file đó. Vì vậy chạy
thẳng `npx wrangler deploy` sẽ không hoạt động; dùng `npm run deploy`.

Cloudflare có nút ["Deploy to Cloudflare"](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
tự provision tài nguyên cho người bấm, nhưng **tôi chưa kiểm chứng nó với
placeholder `database_id` của repo này**, nên chưa đưa vào đây. Đường `cf deploy`
đã chạy thật và được test.

## Phát triển

```bash
npm test              # 109 test: vector chuẩn RFC, crypto, generator, popup
npm run typecheck     # hai project: browser và worker
npm run build:dev     # build kèm sourcemap
npm run dev           # Worker local
```

Test e2e chạy thật qua Worker + D1 local (mặc định bị bỏ qua):

```bash
npm run dev           # cửa sổ khác; tự tạo .dev.vars với token "token-dev-local"
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
scripts/cf.mjs CLI deploy.
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
- `cf.mjs` gọi thẳng `node node_modules/wrangler/bin/wrangler.js`, không qua
  `npx` và không qua shell: trên Windows, `spawn` với `shell: true` vỡ khi đường
  dẫn Node có dấu cách.

## Giấy phép

MIT. Không có bảo hành — đây là công cụ cá nhân, chưa qua kiểm toán bảo mật độc
lập. Nếu bạn cần một password manager đã được kiểm toán, hãy dùng Bitwarden hoặc
1Password.
