#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import path from "node:path";
import {
  FILES_BUCKET,
  parseDeployFlags,
  renderConfig,
  requiredSecrets,
  resolveDeployOptions,
  type DeployOptions,
} from "./deploy-config.ts";

const root = path.resolve(import.meta.dirname, "..");
const TEMPLATE = path.join(root, "wrangler.toml");
const GENERATED = path.join(root, ".wrangler.local.toml");
const STATE = path.join(root, ".cf-state.json");
const SECRETS_NOTE = path.join(root, ".secrets.local.txt");

const WRANGLER = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");

const DB_NAME = "vault";
const CI_TEST_ISSUER = "https://ci-test.invalid";
const GENERATED_SECRETS = new Set(["REGISTRATION_TOKEN", "EMAIL_PROBE_SECRET", "AT_REST_SECRET"]);

interface Account {
  id: string;
  name: string;
}

interface Database {
  uuid: string;
  name: string;
}

interface DeployState extends Partial<DeployOptions> {
  accountId?: string;
  accountName?: string;
  databaseId?: string;
  workerUrl?: string;
}

const style = {
  step: (text: string) => console.log(`\n\x1b[1m▸ ${text}\x1b[0m`),
  ok: (text: string) => console.log(`  \x1b[32m✓\x1b[0m ${text}`),
  info: (text: string) => console.log(`  ${text}`),
  warn: (text: string) => console.log(`  \x1b[33m!\x1b[0m ${text}`),
  fail: (text: string) => console.error(`\n\x1b[31m✗ ${text}\x1b[0m`),
};

let accountEnv: Record<string, string> = {};

function wranglerEnv() {
  return { ...process.env, ...accountEnv };
}

function wranglerCapture(args: string[]) {
  const result = spawnSync(process.execPath, [WRANGLER, ...args], {
    cwd: root,
    encoding: "utf8",
    env: wranglerEnv(),
  });
  return { ok: result.status === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function wranglerTee(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WRANGLER, ...args], {
      cwd: root,
      env: wranglerEnv(),
      stdio: ["inherit", "pipe", "inherit"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      process.stdout.write(chunk);
    });
    child.on("close", (code) =>
      code === 0
        ? resolve(output)
        : reject(new Error(`wrangler ${args[0]} exited with code ${code}`)),
    );
  });
}

function wranglerInherit(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WRANGLER, ...args], {
      cwd: root,
      stdio: "inherit",
      env: wranglerEnv(),
    });
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`wrangler ${args[0]} exited with code ${code}`)),
    );
  });
}

function tryParseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function parseJsonFromOutput<T>(output: string): T | null {
  for (let i = 0; i < output.length; i++) {
    const char = output[i];
    if (char !== "{" && char !== "[") {
      continue;
    }
    const parsed = tryParseJson<T>(output.slice(i));
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

function readState(): DeployState {
  return existsSync(STATE) ? (JSON.parse(readFileSync(STATE, "utf8")) as DeployState) : {};
}

function writeState(patch: DeployState): DeployState {
  const next = { ...readState(), ...patch };
  writeFileSync(STATE, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

async function ask<T extends { label: string }>(question: string, choices: T[]): Promise<T> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    choices.forEach((choice, index) => console.log(`    ${index + 1}) ${choice.label}`));
    for (;;) {
      const answer = (await rl.question(`  ${question} [1-${choices.length}]: `)).trim();
      const index = Number.parseInt(answer, 10) - 1;
      const choice = choices[index];
      if (choice) {
        return choice;
      }
      console.log("  Not a valid choice.");
    }
  } finally {
    rl.close();
  }
}

async function ensureLogin() {
  style.step("Checking Cloudflare login");

  let who = wranglerCapture(["whoami", "--json"]);
  if (!who.ok) {
    if (process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN) {
      throw new Error(
        "CLOUDFLARE_API_TOKEN / CF_API_TOKEN is set but not usable.\n" +
          "  Unset it and run again, or replace it with a valid token for the target account.",
      );
    }
    style.info("Not signed in — opening a browser…");
    await wranglerInherit(["login"]);
    who = wranglerCapture(["whoami", "--json"]);
    if (!who.ok) {
      throw new Error("Sign-in failed");
    }
  }

  const accounts = parseJsonFromOutput<{ accounts?: Account[] }>(who.stdout)?.accounts ?? [];
  if (accounts.length === 0) {
    throw new Error("Could not read the account list from wrangler");
  }

  const state = readState();
  const fromEnv = process.env.CLOUDFLARE_ACCOUNT_ID;
  let account =
    accounts.find((a) => a.id === fromEnv) ??
    accounts.find((a) => a.id === state.accountId) ??
    (accounts.length === 1 ? accounts[0] : null);

  if (!account) {
    style.warn(`Your credentials reach ${accounts.length} accounts:`);
    account = await ask(
      "Deploy to which account?",
      accounts.map((a) => ({ label: `${a.name}  (${a.id})`, ...a })),
    );
  }

  accountEnv = { CLOUDFLARE_ACCOUNT_ID: account.id };
  writeState({ accountId: account.id, accountName: account.name });
  style.ok(`Account: ${account.name}`);
  return account;
}

async function ensureDatabase() {
  style.step("Checking the D1 database");

  const state = readState();
  const listed =
    parseJsonFromOutput<Database[]>(wranglerCapture(["d1", "list", "--json"]).stdout) ?? [];
  const existing = listed.find((db) => db.uuid === state.databaseId || db.name === DB_NAME);

  if (existing) {
    writeState({ databaseId: existing.uuid });
    style.ok(`Reusing database "${existing.name}" (${existing.uuid})`);
    return existing.uuid;
  }

  style.info(`Creating database "${DB_NAME}"…`);
  await wranglerInherit(["d1", "create", DB_NAME]);

  const after =
    parseJsonFromOutput<Database[]>(wranglerCapture(["d1", "list", "--json"]).stdout) ?? [];
  const created = after.find((db) => db.name === DB_NAME);
  if (!created) {
    throw new Error(`Created the database but could not find "${DB_NAME}"`);
  }

  writeState({ databaseId: created.uuid });
  style.ok(`Created database (${created.uuid})`);
  return created.uuid;
}

async function ensureFilesBucket(options: DeployOptions) {
  if (options.attachments === "off") {
    return;
  }
  style.step("Checking the R2 bucket for file attachments");
  const listed = wranglerCapture(["r2", "bucket", "list"]);
  if (!listed.ok) {
    throw new Error(
      "Could not list R2 buckets. Turn on R2 in the Cloudflare dashboard, or deploy with --attachments off",
    );
  }
  if (new RegExp(`name:\\s+${FILES_BUCKET}\\b`).test(listed.stdout)) {
    style.ok(`Reusing bucket "${FILES_BUCKET}"`);
    return;
  }
  await wranglerInherit(["r2", "bucket", "create", FILES_BUCKET]);
  style.ok(`Created bucket "${FILES_BUCKET}"`);
}

function writeGeneratedConfig(
  accountId: string,
  databaseId: string,
  options: DeployOptions,
): string {
  const template = readFileSync(TEMPLATE, "utf8");
  writeFileSync(GENERATED, renderConfig(template, { accountId, databaseId, options }));
  return GENERATED;
}

async function ensureSecrets(configPath: string, options: DeployOptions): Promise<void> {
  style.step("Checking secrets");

  const listed =
    parseJsonFromOutput<{ name: string }[]>(
      wranglerCapture(["secret", "list", "--format", "json", "-c", configPath]).stdout,
    ) ?? [];
  const present = new Set(listed.map((secret) => secret.name));

  const generated: Record<string, string> = {};
  for (const name of requiredSecrets(options)) {
    if (present.has(name)) {
      style.ok(`${name} already set`);
      continue;
    }
    if (!GENERATED_SECRETS.has(name)) {
      throw new Error(
        `${name} is required but not set. Run: npx wrangler secret put ${name} -c ${path.basename(configPath)}`,
      );
    }

    const value = randomBytes(name === "REGISTRATION_TOKEN" ? 24 : 32).toString("base64url");
    const result = spawnSync(
      process.execPath,
      [WRANGLER, "secret", "put", name, "-c", configPath],
      {
        cwd: root,
        input: value,
        encoding: "utf8",
      },
    );
    if (result.status !== 0) {
      throw new Error(`Could not set ${name}: ${result.stderr || result.stdout}`);
    }

    generated[name] = value;
    style.ok(`${name} generated`);
  }

  const lines: string[] = [];
  if (generated.REGISTRATION_TOKEN) {
    lines.push(
      `REGISTRATION_TOKEN=${generated.REGISTRATION_TOKEN}`,
      '  -> Enter this in the extension\'s "Registration token" field on first setup.',
      "  -> Anyone holding it can create an account on your Worker.",
      "  -> Lost it? Run: npx wrangler secret put REGISTRATION_TOKEN -c .wrangler.local.toml",
      "",
    );
  }
  if (generated.AT_REST_SECRET) {
    lines.push(
      `AT_REST_SECRET=${generated.AT_REST_SECRET}`,
      "  -> Protects password hashes and wrapped vault keys stored in D1.",
      "  -> BACK THIS UP OFFLINE, then delete it from this file. Cloudflare cannot show it again.",
      "  -> If it is lost or replaced, EVERY account on this Worker is locked out for good.",
      "",
    );
  }
  if (lines.length > 0) {
    if (!existsSync(SECRETS_NOTE)) {
      writeFileSync(
        SECRETS_NOTE,
        "Secrets for this 7key deployment (gitignored — do not commit or share).\n\n",
      );
    }
    appendFileSync(SECRETS_NOTE, lines.join("\n"));
    style.warn(`New secrets written to ${path.basename(SECRETS_NOTE)}`);
  }
}

function buildAssets() {
  style.step("Building the share page and the extension");
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "build.ts")], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error("Build failed");
  }
}

async function deploy() {
  const options = resolveDeployOptions({ ...readState() }, parseDeployFlags(process.argv.slice(3)));
  const account = await ensureLogin();
  const databaseId = await ensureDatabase();
  writeState(options);
  const configPath = writeGeneratedConfig(account.id, databaseId, options);

  style.step("Applying migrations");
  await wranglerInherit(["d1", "migrations", "apply", DB_NAME, "--remote", "-c", configPath]);

  await ensureSecrets(configPath, options);
  await ensureFilesBucket(options);
  buildAssets();

  style.step("Deploying the Worker");
  const output = await wranglerTee(["deploy", "-c", configPath]);

  const url = options.customDomain
    ? `https://${options.customDomain}`
    : output.match(/https:\/\/\S+\.workers\.dev/)?.[0];
  if (url) {
    writeState({ workerUrl: url });
    buildAssets();
    style.ok(`Extension rebuilt with ${url} baked in`);
  }

  console.log("");
  const open = options.registrationMode === "open";
  style.ok(`Done. Registration is ${open ? "OPEN to anyone" : "gated by REGISTRATION_TOKEN"}.`);
  style.info("1. chrome://extensions → Developer mode → Load unpacked → dist/extension");
  style.info(
    open
      ? "2. In the popup, choose Create a new vault"
      : `2. In the popup, create a vault with the token in ${path.basename(SECRETS_NOTE)}`,
  );
  const server = readState().workerUrl;
  if (server) {
    style.info(`3. For the 7key CLI: 7key login --server ${server}`);
  }
}

async function dev() {
  buildAssets();

  style.step("Preparing the local D1 database");
  await wranglerInherit(["d1", "migrations", "apply", DB_NAME, "--local"]);

  if (!existsSync(path.join(root, ".dev.vars"))) {
    writeFileSync(
      path.join(root, ".dev.vars"),
      [
        'REGISTRATION_TOKEN="token-dev-local"',
        `EMAIL_PROBE_SECRET="${randomBytes(32).toString("base64url")}"`,
        `AT_REST_SECRET="${randomBytes(32).toString("base64url")}"`,
        "",
      ].join("\n"),
    );
    style.ok('Created .dev.vars with the registration token "token-dev-local"');
  } else if (!readFileSync(path.join(root, ".dev.vars"), "utf8").includes("AT_REST_SECRET=")) {
    appendFileSync(
      path.join(root, ".dev.vars"),
      `\nAT_REST_SECRET="${randomBytes(32).toString("base64url")}"\n`,
    );
    style.ok("Added AT_REST_SECRET to .dev.vars");
  }

  style.step("Worker running at http://127.0.0.1:8787");
  const testKey = JSON.parse(
    readFileSync(path.join(root, "test", "fixtures", "ci-test-key.json"), "utf8"),
  ) as { kid: string; kty: string; n: string; e: string };
  const testJwks = Buffer.from(
    JSON.stringify([{ kid: testKey.kid, kty: testKey.kty, n: testKey.n, e: testKey.e }]),
  ).toString("base64url");
  await wranglerInherit([
    "dev",
    "--port",
    "8787",
    "--var",
    `CI_TEST_JWKS:${testJwks}`,
    "--var",
    `CI_TEST_ISSUER:${CI_TEST_ISSUER}`,
    "--var",
    "MIGRATION_TOKEN:local-migration-token",
  ]);
}

async function status() {
  const state = readState();
  if (!state.accountId) {
    style.warn("Never deployed. Run: npm run deploy");
    return;
  }
  console.log(`Account:  ${state.accountName} (${state.accountId})`);
  console.log(`Database: ${DB_NAME} (${state.databaseId ?? "not created"})`);
  console.log(`Worker:   ${state.workerUrl ?? "not deployed"}`);
  const deployments = wranglerCapture(["deployments", "list", "-c", GENERATED]);
  console.log(deployments.ok ? deployments.stdout.trim() : "No deployments yet.");
}

async function logs() {
  if (!existsSync(GENERATED)) {
    throw new Error("Never deployed. Run: npm run deploy");
  }
  await wranglerInherit(["tail", "-c", GENERATED]);
}

async function backup() {
  if (!existsSync(GENERATED)) {
    throw new Error("Never deployed. Run: npm run deploy");
  }
  const directory = path.join(root, "backups");
  mkdirSync(directory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const output = path.join(directory, `vault-${stamp}.sql`);

  style.step("Exporting the remote D1 database");
  await wranglerInherit(["d1", "export", DB_NAME, "--remote", "--output", output, "-c", GENERATED]);
  chmodSync(output, 0o600);
  style.ok(`Saved ${path.relative(root, output)}`);
  style.info("It holds ciphertext only, but keep it with AT_REST_SECRET somewhere offline:");
  style.info(
    "restoring it is useless without that secret, and the pair is what an attacker wants.",
  );
}

function runStep(label: string, command: string, args: string[]): void {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${label} failed`);
  }
}

async function upgrade() {
  if (!existsSync(GENERATED)) {
    throw new Error("Never deployed. Run: npm run deploy");
  }
  const changes = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], {
    cwd: root,
    encoding: "utf8",
  });
  if (changes.status !== 0) {
    throw new Error("This folder is not a git clone; upgrade by hand (docs/how-to/upgrade.md)");
  }
  if (changes.stdout.trim()) {
    throw new Error("Commit or stash your local changes first");
  }
  await backup();

  style.step("Pulling the latest release");
  runStep("git pull", "git", ["pull", "--ff-only"]);

  style.step("Installing dependencies");
  const npm = process.env.npm_execpath;
  runStep("npm ci", npm ? process.execPath : "npm", npm ? [npm, "ci"] : ["ci"]);

  runStep("deploy", process.execPath, [path.join(root, "scripts", "vault.ts"), "deploy"]);
  style.info("Then reload 7key in chrome://extensions on every machine that uses this build.");
}

const PRODUCTION = path.join(root, "deploy", "production.json");

async function ci() {
  if (!existsSync(PRODUCTION)) {
    throw new Error("deploy/production.json is missing");
  }
  const state = JSON.parse(readFileSync(PRODUCTION, "utf8")) as DeployState & {
    accountId: string;
    databaseId: string;
  };
  writeState(state);
  accountEnv = { CLOUDFLARE_ACCOUNT_ID: state.accountId };
  const options = resolveDeployOptions({ ...state }, {});
  const configPath = writeGeneratedConfig(state.accountId, state.databaseId, options);

  style.step("Applying migrations");
  await wranglerInherit(["d1", "migrations", "apply", DB_NAME, "--remote", "-c", configPath]);

  await ensureFilesBucket(options);
  buildAssets();

  style.step("Deploying the Worker");
  await wranglerInherit(["deploy", "-c", configPath]);
}

const COMMANDS: Record<string, () => Promise<void>> = {
  deploy,
  upgrade,
  ci,
  dev,
  status,
  logs,
  backup,
};

const command = process.argv[2];
if (!command || !(command in COMMANDS)) {
  console.log(`Usage: node scripts/vault.ts <command>

  deploy   Create D1 and secrets if needed, migrate, build and deploy to your
           own Cloudflare account. Safe to run repeatedly.
           --open-registration   let anyone create an account (shared server)
           --token-registration  require REGISTRATION_TOKEN again (default)
           --domain <host>       serve on a custom domain in this account ("none" to drop)
           --email-from <addr>   send sign-up codes from this address ("none" to drop)
           --email-provider <p>  "resend" (default; needs the RESEND_API_KEY secret)
                                 or "cloudflare" (Email Sending; Workers Paid plan)
           --turnstile-site-key <key>  require a Turnstile check on sign-up, recovery and
                                 share codes; needs the TURNSTILE_SECRET secret ("none" to drop)
           --site-service <name>  bind the SITE Worker that serves /, /vi, /privacy and
                                 /media/* ("none" to drop; deploy that Worker first)
           --attachments <mode>  store encrypted file attachments in R2: all, paid
                                 (Team and Enterprise organizations only) or off
           --file-max-mb <n>     largest attachment, in MB (default 25; "none" to reset)
           --account-files-mb <n>  attachment storage per account, in MB (default 250)
           --privacy-url <url>   link this https privacy policy from the share page,
                                 /security, emails and the extension ("none" to drop)
  upgrade  Back up, pull the latest release, reinstall dependencies and deploy
           with the saved options.
  ci       Deploy from Workers Builds with deploy/production.json: migrate,
           build and deploy. Secrets must already be set on the Worker.
  dev      Run the Worker and a local D1 at http://127.0.0.1:8787
  status   Show the account and resources in use
  logs     Tail the Worker logs
  backup   Export the remote D1 database to backups/ (ciphertext only)
`);
  process.exit(command ? 1 : 0);
}

try {
  await COMMANDS[command]?.();
} catch (error) {
  style.fail(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
