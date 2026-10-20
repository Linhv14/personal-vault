import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { PERSIST_DIR, REGISTRATION_TOKEN, WORKER_PORT } from "./env.ts";

const root = path.resolve(import.meta.dirname, "..");
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");

rmSync(PERSIST_DIR, { recursive: true, force: true });

const migrate = spawnSync(
  process.execPath,
  [wrangler, "d1", "migrations", "apply", "vault", "--local", "--persist-to", PERSIST_DIR],
  { cwd: root, stdio: "inherit", env: { ...process.env, CI: "1" } },
);
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

const testKey = JSON.parse(
  readFileSync(path.join(root, "test", "fixtures", "ci-test-key.json"), "utf8"),
) as { kid: string; kty: string; n: string; e: string };
const testJwks = Buffer.from(
  JSON.stringify([{ kid: testKey.kid, kty: testKey.kty, n: testKey.n, e: testKey.e }]),
).toString("base64url");

const vars = {
  REGISTRATION_TOKEN,
  EMAIL_PROBE_SECRET: randomBytes(32).toString("base64url"),
  AT_REST_SECRET: randomBytes(32).toString("base64url"),
  CI_TEST_JWKS: testJwks,
  CI_TEST_ISSUER: "https://ci-test.invalid",
  MIGRATION_TOKEN: "local-migration-token",
};

const child = spawn(
  process.execPath,
  [
    wrangler,
    "dev",
    "--local",
    "--port",
    String(WORKER_PORT),
    "--ip",
    "127.0.0.1",
    "--persist-to",
    PERSIST_DIR,
    "--show-interactive-dev-session=false",
    ...Object.entries(vars).flatMap(([name, value]) => ["--var", `${name}:${value}`]),
  ],
  { cwd: root, stdio: "inherit" },
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code) => process.exit(code ?? 0));
