import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isKdfParams, isSealedData } from "#core/crypto.js";
import { isString } from "#core/json.js";
import { pkceChallenge, pkceVerifier } from "#core/pkce.js";
import { AgentError, call, ServerRefusal, unlockAccount, type Session } from "../agent/session.js";

const WAIT_MS = 5 * 60_000;
const RESULT_PATH = "/sso/result";

const PAGE = `<!doctype html>
<meta charset="utf-8">
<title>7key</title>
<body style="font:16px system-ui;margin:3rem;color:#222">
<p id="m">Finishing the sign-in…</p>
<script>
fetch("${RESULT_PATH}", { method: "POST", body: location.hash.slice(1) })
  .then((r) => r.text())
  .then((t) => { document.getElementById("m").textContent = t; history.replaceState(null, "", "/sso"); });
</script>`;

export interface SsoDeps {
  request: typeof fetch;
  openUrl: (url: string) => void;
  log: (line: string) => void;
  askPassword: (question: string) => Promise<string>;
}

interface Listener {
  returnTo: string;
  fragment: Promise<string>;
  close: () => void;
}

function listen(waitMs: number): Promise<Listener> {
  return new Promise((resolve, reject) => {
    let settle: (fragment: string) => void = () => {};
    let fail: (error: Error) => void = () => {};
    const fragment = new Promise<string>((done, failed) => {
      settle = done;
      fail = failed;
    });
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const address = server.address();
      const origin =
        address && typeof address === "object" ? `http://127.0.0.1:${address.port}` : "";
      if (req.method === "GET" && req.url === "/sso") {
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        });
        res.end(PAGE);
        return;
      }
      if (req.method === "POST" && req.url === RESULT_PATH && req.headers.origin === origin) {
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Signed in. You can close this tab and go back to the terminal.");
          settle(Buffer.concat(chunks).toString("utf8").slice(0, 4096));
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    const timer = setTimeout(
      () => fail(new AgentError("The single sign-on took too long. Run 7key login --sso again")),
      waitMs,
    );
    timer.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address !== "object") {
        reject(new AgentError("Could not open a local port for single sign-on"));
        return;
      }
      resolve({
        returnTo: `http://127.0.0.1:${address.port}/sso`,
        fragment,
        close: () => {
          clearTimeout(timer);
          server.close();
          server.closeAllConnections();
        },
      });
    });
  });
}

function refusal(error: unknown): never {
  if (error instanceof ServerRefusal) {
    const messages: Record<string, string> = {
      "sso.not_found": "No single sign-on is set up for that email or organization",
      "sso.invalid_return":
        "This server does not accept sign-in from the CLI yet. Ask its operator to upgrade",
      "license.required": "Single sign-on is not available on this server's plan",
      "sso.email_not_allowed":
        "Your identity provider is not trusted for this email. Link your account in the 7key console first",
      "sso.expired": "The single sign-on expired. Run 7key login --sso again",
    };
    throw new AgentError(messages[error.code ?? ""] ?? error.message);
  }
  throw error;
}

export async function ssoSignIn(
  server: string,
  lookup: string,
  deps: SsoDeps,
  waitMs = WAIT_MS,
): Promise<{ email: string; session: Session }> {
  const origin = new URL(server).origin;
  const verifier = pkceVerifier();
  const challenge = await pkceChallenge(verifier);
  const listener = await listen(waitMs);
  try {
    const value = lookup.trim();
    const prepared = await call<{ authorizeUrl?: unknown }>(
      deps.request,
      origin,
      "/api/sso/prepare",
      {
        method: "POST",
        body: JSON.stringify({
          ...(value.includes("@") ? { email: value } : { identifier: value }),
          returnTo: listener.returnTo,
          clientChallenge: challenge,
        }),
      },
    ).catch(refusal);
    if (!isString(prepared.authorizeUrl) || new URL(prepared.authorizeUrl).protocol !== "https:") {
      throw new AgentError("The server answered with an unexpected sign-in address");
    }
    deps.log("Opening your identity provider in the browser. If nothing opens, visit:");
    deps.log(prepared.authorizeUrl);
    deps.openUrl(prepared.authorizeUrl);

    const params = new URLSearchParams(await listener.fragment);
    const grant = params.get("sso_grant");
    if (!grant) {
      refusal(
        new ServerRefusal(
          "Single sign-on failed",
          400,
          params.get("sso_error") ?? "sso.failed",
          {},
        ),
      );
    }
    const answer = await call<Record<string, unknown>>(deps.request, origin, "/api/sso/session", {
      method: "POST",
      body: JSON.stringify({ grant, clientVerifier: verifier, locale: "en" }),
    }).catch(refusal);
    if (answer.status === "register") {
      throw new AgentError(
        "You have no 7key account yet. Create it in the 7key extension or web app with single sign-on, then run 7key login --sso",
      );
    }
    if (
      answer.status !== "signed_in" ||
      !isString(answer.email) ||
      !isKdfParams(answer.kdf) ||
      !isString(answer.token) ||
      !isSealedData(answer.wrappedVaultKey)
    ) {
      throw new AgentError(
        "The server asked for a sign-in step this 7key does not know. Update 7key",
      );
    }
    const email = answer.email;
    const password = await deps.askPassword(`Master password for ${email}: `);
    const token = answer.token;
    const session = await unlockAccount(
      deps.request,
      origin,
      { email, kdf: answer.kdf },
      password,
      {
        token,
        expiresAt: typeof answer.expiresAt === "number" ? answer.expiresAt : undefined,
        wrappedVaultKey: answer.wrappedVaultKey,
      },
    ).catch(async (error: unknown) => {
      await call(deps.request, origin, "/api/auth/logout", { method: "POST", token }).catch(
        () => {},
      );
      throw error;
    });
    return { email, session };
  } finally {
    listener.close();
  }
}
