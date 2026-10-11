# Personal Vault — Thiết kế

Ngày: 2026-10-11
Trạng thái: đã xác nhận, đang triển khai
Mô hình triển khai: mỗi người tự deploy một bản trên account Cloudflare của
chính mình (`npm run deploy`). Không có server chung.

## 1. Mục tiêu

Một password manager cá nhân dạng browser extension, thay thế nhu cầu mở app 2FA
trên điện thoại mỗi lần đăng nhập. Deploy trên Cloudflare (Workers + D1).

Phạm vi v1:

- Lưu tài khoản (title, url, username, password, note) mã hoá đầu-cuối.
- Lưu TOTP secret và sinh mã 6 số, tự refresh mỗi 30 giây, ngay trong extension.
- Sinh mật khẩu mạnh (ngẫu nhiên / passphrase / PIN).
- Chia sẻ một item qua link tạm thời, có hạn dùng và giới hạn số lần xem, kèm mã
  TOTP tự refresh cho người nhận.
- Sync nhiều thiết bị qua cùng một master password.

Ngoài phạm vi v1 (quyết định YAGNI):

- Autofill vào form trên trang web (không có content script).
- Shared vault giữa nhiều user có account.
- Web vault quản lý đầy đủ — web chỉ có route `/s/:id` để xem link share.
- Realtime sync (Durable Object / WebSocket).

## 2. Mô hình tin cậy

Server không bao giờ nhận được khoá có thể giải mã dữ liệu. Toàn bộ mã hoá và giải
mã diễn ra ở client. Server lưu ciphertext và làm nhiệm vụ xác thực + đồng bộ.

Những gì server vẫn biết (metadata, chấp nhận đánh đổi cho vault cá nhân):

- Email của account.
- Số lượng item và thời điểm từng item được sửa.
- Thời điểm đăng nhập, IP.

Những gì server không biết: tên site, username, password, TOTP secret, note.

### Key hierarchy

```
master password + email (salt)
        |
        +-- PBKDF2-SHA256, 600_000 vòng --> master key (32B)
                    |
        +-----------+-----------+
        | HKDF info="auth"      | HKDF info="enc"
        v                       v
   auth key                vault wrapping key
   (gửi lên server)        (không bao giờ rời client)
        |                       |
        v                       v
 server lưu hash của      giải mã wrapped_vault_key
 auth key                 --> vault key (32B, ngẫu nhiên)
                                |
                                v
                     AES-256-GCM cho từng item
```

Lý do của từng lớp:

1. **Tách auth key và encryption key.** Server cần một thứ để xác thực bạn, nhưng
   thứ đó không được giải mã nổi vault. Dùng chung một khoá cho cả hai là lỗi phổ
   biến nhất khi tự viết password manager.
2. **Có `vault key` riêng được bọc lại.** Đổi master password chỉ cần bọc lại
   `vault key` bằng wrapping key mới — không phải mã hoá lại toàn bộ item.
3. **KDF params lưu trong record account** (`kdf_type`, `kdf_iterations`,
   `kdf_salt`) để nâng lên Argon2id sau này mà không phá dữ liệu cũ.

### Chọn PBKDF2 thay vì Argon2id cho v1

Argon2id mạnh hơn (memory-hard, kháng GPU tốt hơn) nhưng cần nhúng thư viện WASM
vào extension. Với một app giữ toàn bộ mật khẩu, mỗi dependency bên ngoài là một
chỗ có thể bị cài mã độc; rủi ro supply-chain đó lớn hơn phần lợi thu được.
PBKDF2-SHA256 600k vòng có sẵn trong WebCrypto, không dependency, và đúng mức
Bitwarden dùng làm mặc định. Có đường nâng cấp qua `kdf_type`.

## 3. Kiến trúc

```
+---------------------+          +------------------------------+
| Extension (MV3)     |          | Cloudflare Worker (Hono)     |
| - popup UI          |<-------->| /api/auth/*    đăng nhập     |
| - service worker    |  HTTPS   | /api/items     sync delta    |
|   giữ vault key     | (chỉ     | /api/shares    tạo/đọc link  |
| - TOTP, generator   | cipher   | /s/:id         trang share   |
| - cache ciphertext  |  text)   +-------------+----------------+
+---------------------+                        |
                                      +--------v-------+
                                      | D1 (SQLite)    |
                                      | chỉ ciphertext |
                                      +----------------+
```

`src/core/` là code dùng chung cho cả Worker, extension và trang share. Nó chỉ phụ
thuộc WebCrypto, nên chạy được ở cả ba môi trường không cần polyfill.

## 4. Schema D1

```sql
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  kdf_type TEXT NOT NULL,
  kdf_iterations INTEGER NOT NULL,
  kdf_salt TEXT NOT NULL,
  auth_key_hash TEXT NOT NULL,
  wrapped_vault_key TEXT NOT NULL,
  wrap_nonce TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE items (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  ciphertext TEXT NOT NULL,
  nonce TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX idx_items_sync ON items(account_id, updated_at);

CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  max_views INTEGER NOT NULL,
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  expires_at INTEGER NOT NULL
);
```

Ba quyết định schema đáng ghi lại:

- **Toàn bộ item nằm trong một blob mã hoá**, kể cả `url` và `title`. Việc tìm item
  khớp domain hiện tại làm ở client sau khi giải mã. Nếu lưu `url` dạng plaintext
  cho server query tiện, ta đã rò rỉ toàn bộ danh sách site có tài khoản.
- **`deleted_at` tombstone thay vì DELETE.** Xoá thật thì thiết bị đang offline
  không bao giờ biết item đã bị xoá và sẽ sync nó trở lại.
- **Ciphertext lưu base64 trong cột TEXT**, không dùng BLOB. D1 qua HTTP API
  serialize BLOB không thuận tiện, và base64 chỉ tốn thêm 33% dung lượng.

## 5. TOTP

Nhập secret theo ba đường, tất cả đổ về cùng một parser:

1. Dán chuỗi base32 thủ công (mọi site đều có link kiểu "không quét được QR?").
2. Quét QR từ ảnh chụp tab: `chrome.tabs.captureVisibleTab()` + decode ngay trong
   extension, không gửi ảnh đi đâu. Chỉ cần quyền `activeTab`.

   Khi triển khai đã đổi từ nhúng `jsQR` sang `BarcodeDetector` có sẵn của
   Chrome: thư viện decode nằm trong đường đi của TOTP secret — nó thấy secret
   trước cả người dùng — nên đây là chỗ không đáng thêm dependency. Máy nào
   không có API đó thì rơi về dán tay, đường luôn hoạt động.
3. Dán URI `otpauth://totp/...`.

Sinh mã theo RFC 6238, hoàn toàn offline:

```
counter = floor(unix_time / period)
hmac    = HMAC-SHA1(base32_decode(secret), counter as 8-byte big-endian)
offset  = hmac[19] & 0x0F
code    = (4 bytes tại offset, mask bit cao) % 10^digits
```

Giữ HMAC-SHA1 vì RFC quy định vậy; SHA-1 chỉ yếu với va chạm, không yếu trong
HMAC. Dùng SHA-256 sẽ ra mã không khớp với site.

Auto refresh là `setInterval` tính lại mỗi giây, cộng vòng đếm ngược
`period - (unix_time % period)`. Không có network.

**Lệch đồng hồ:** TOTP sai nếu đồng hồ máy lệch quá ~30 giây. Lúc unlock, extension
đọc header `Date` từ API của chính mình, tính offset, và cảnh báo nếu lệch lớn.

## 6. Password generator

`crypto.getRandomValues()`, không bao giờ `Math.random()`. Chống modulo bias bằng
rejection sampling. Ba chế độ: ngẫu nhiên (độ dài + bộ ký tự), passphrase từ
wordlist EFF, PIN số. Hiển thị entropy (bits). Lưu lịch sử mật khẩu đã sinh vào
vault (đã mã hoá) để không mất khi site báo lỗi lúc đổi.

## 7. Luồng share link

```
1. Chọn item -> đặt TTL (1h/24h/7d) + max_views
2. share_key = 32 bytes ngẫu nhiên (chỉ tồn tại ở client)
3. Mã hoá {username, password, totp_secret, note} bằng share_key
4. POST ciphertext -> Worker lưu vào `shares`, trả id
5. Link: https://vault.example.com/s/<id>#<base64url(share_key)>
                                          ^ fragment: browser KHÔNG gửi lên server
6. Người nhận mở -> JS đọc location.hash -> GET ciphertext -> giải mã trong browser
   -> nếu có totp_secret thì hiện mã 6 số + vòng đếm ngược, tự refresh
7. Worker tăng view_count; Cron Trigger mỗi giờ xoá bản ghi hết hạn
```

**Giới hạn phải chấp nhận:** gửi link qua Zalo/Messenger thì nền tảng đó đọc được
cả fragment, vì với họ link chỉ là text. Server của ta mù, nhưng kênh truyền thì
không. 1Password chịu đúng giới hạn này. Giảm thiểu: mặc định TTL ngắn +
`max_views = 1`, và tuỳ chọn mật khẩu phụ cho link (tham gia vào dẫn xuất khoá,
báo cho người nhận qua kênh khác).

## 8. Bẫy kỹ thuật đã biết

- **MV3 service worker bị kill sau ~30s idle** -> vault key trong biến thường sẽ
  mất, popup bắt nhập lại master password liên tục. Giữ vault key trong
  `chrome.storage.session` (bộ nhớ, không ghi đĩa, tự xoá khi đóng browser) kèm
  auto-lock timer mặc định 15 phút.
- **Không bao giờ ghi vault key hay plaintext vào `chrome.storage.local`** — nó
  nằm trên đĩa dạng rõ. Chỉ cache ciphertext ở đó.
- **Clipboard**: tự xoá sau 30 giây sau khi copy mật khẩu.

## 9. Thứ tự triển khai

1. `src/core/` — base32, TOTP, crypto (KDF/HKDF/AES-GCM), generator. Test đối
   chiếu vector chuẩn RFC 6238 và RFC 4648 trước khi viết UI.
2. Migration D1 + Worker API (`/api/auth`, `/api/items`).
3. Extension: unlock, danh sách item, copy, hiển thị TOTP.
4. Share: API + trang `/s/:id`.
5. Cron Trigger dọn share hết hạn.

## 10. Chi phí

Workers 100k request/ngày, D1 5GB + 5 triệu lượt đọc/ngày — dùng cá nhân nằm gọn
trong bậc miễn phí. Chỉ tốn tiền domain.
