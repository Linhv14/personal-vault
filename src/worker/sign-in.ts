import type { Context } from "hono";
import { revealWrappedKey } from "./at-rest.js";
import { deviceLabel } from "./device-label.js";
import { newSignInEmail } from "./emails.js";
import { inBackground } from "./http.js";
import { createMailer } from "./mailer.js";
import { createSession, noteDevice } from "./session.js";
import type { AppBindings } from "./types.js";
import { MIN_KDF_ITERATIONS } from "./validate.js";

export async function signedIn(
  c: Context<AppBindings>,
  accountId: string,
  email: string,
  locale: "en" | "vi",
  timestamp: number,
) {
  const row = await c.env.DB.prepare(
    "SELECT wrapped_vault_key, wrap_nonce, kdf_iterations FROM accounts WHERE id = ?",
  )
    .bind(accountId)
    .first<{ wrapped_vault_key: string; wrap_nonce: string; kdf_iterations: number }>();
  if (!row) {
    throw new Error("Account vanished during sign-in");
  }
  const wrapped = await revealWrappedKey(c.env, accountId, row.wrapped_vault_key);
  const label = deviceLabel(c.req.header("User-Agent"));
  const session = await createSession(c.env, accountId, timestamp, label);
  const mailer = createMailer(c.env);
  if ((await noteDevice(c.env, accountId, label, timestamp)) === "new" && mailer) {
    const message = newSignInEmail(
      { locale, siteUrl: new URL(c.req.url).origin },
      { device: label, at: timestamp },
    );
    inBackground(c, "new_sign_in_email_failed", () => mailer.send({ to: email, ...message }));
  }
  return {
    ...session,
    wrappedVaultKey: { ciphertext: wrapped.ciphertext, nonce: row.wrap_nonce },
    ...(row.kdf_iterations < MIN_KDF_ITERATIONS ? { upgradeKdf: true } : {}),
  };
}
