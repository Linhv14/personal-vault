export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Bắt buộc khi đăng ký. Không có nó thì Worker của bạn là trang đăng ký công khai. */
  REGISTRATION_TOKEN: string;
  /** Khoá HMAC để sinh KDF params giả cho email không tồn tại. */
  EMAIL_PROBE_SECRET: string;
}

export interface SessionContext {
  accountId: string;
  tokenHash: string;
}

/** Biến context của Hono. Khai báo để `c.get("session")` có kiểu đúng. */
export type AppBindings = {
  Bindings: Env;
  Variables: { session: SessionContext };
};
