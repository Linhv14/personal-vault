#!/usr/bin/env node

/**
 * Project task runner: deploys Personal Vault to the Cloudflare account of
 * whoever runs it. Reached through npm scripts:
 *
 *   npm run deploy    create D1 and secrets if absent, migrate, build, deploy
 *   npm run dev       run the Worker locally against a local D1
 *   npm run status    show which account and resources are in use
 *   npm run logs      tail the Worker
 *
 * Written by hand rather than relying on CLI provisioning: neither Wrangler
 * 4.149 nor the current `cf` beta creates a D1 database automatically when the
 * binding has no id.
 *
 * Deliberately not exposed as a `cf` command: Cloudflare ships an official CLI
 * by that name (open beta, September 2026), and shadowing it would be hostile.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const TEMPLATE = path.join(root, "wrangler.toml");
const GENERATED = path.join(root, ".wrangler.local.toml");
const STATE = path.join(root, ".cf-state.json");
const SECRETS_NOTE = path.join(root, ".secrets.local.txt");

/**
 * Invoke the Wrangler entrypoint directly with the current Node binary, without
 * npx and without a shell.
 *
 * On Windows, `spawn("npx", args, { shell: true })` breaks when the Node path
 * contains a space — the default is "C:\Program Files\nodejs" — because the
 * shell splits on it and reports "Cannot find module C:\Program Files\nodejs".
 */
const WRANGLER = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");

const DB_NAME = "vault";
const DATABASE_ID_SENTINEL = "SET_BY_DEPLOY";
const REQUIRED_SECRETS = ["REGISTRATION_TOKEN", "EMAIL_PROBE_SECRET"];

const style = {
  step: (text) => console.log(`\n\x1b[1m▸ ${text}\x1b[0m`),
  ok: (text) => console.log(`  \x1b[32m✓\x1b[0m ${text}`),
  info: (text) => console.log(`  ${text}`),
  warn: (text) => console.log(`  \x1b[33m!\x1b[0m ${text}`),
  fail: (text) => console.error(`\n\x1b[31m✗ ${text}\x1b[0m`),
};

/**
 * Set once the account is known and passed to every later wrangler call.
 *
 * `wrangler d1 list` and `d1 create` run before the generated config exists, and
 * with credentials that reach more than one account they abort rather than
 * guess. Without this the database lookup fails silently and the script tries to
 * create a database that is already there.
 */
let accountEnv = {};

function wranglerEnv() {
  return { ...process.env, ...accountEnv };
}

function wranglerCapture(args) {
  const result = spawnSync(process.execPath, [WRANGLER, ...args], {
    cwd: root,
    encoding: "utf8",
    env: wranglerEnv(),
  });
  return { ok: result.status === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function wranglerInherit(args) {
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

/**
 * Wrangler prints logs and JSON to the same stream, so try parsing from each
 * opening brace in turn. Taking only the last one would land inside a nested
 * object; taking only the first fails when a log line contains a brace.
 */
function parseJsonFromOutput(output) {
  for (let i = 0; i < output.length; i++) {
    const char = output[i];
    if (char !== "{" && char !== "[") continue;
    try {
      return JSON.parse(output.slice(i));
    } catch {
      // Not the start of the JSON block; keep looking.
    }
  }
  return null;
}

function readState() {
  return existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
}

function writeState(patch) {
  const next = { ...readState(), ...patch };
  writeFileSync(STATE, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

async function ask(question, choices) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    choices.forEach((choice, index) => console.log(`    ${index + 1}) ${choice.label}`));
    for (;;) {
      const answer = (await rl.question(`  ${question} [1-${choices.length}]: `)).trim();
      const index = Number.parseInt(answer, 10) - 1;
      if (index >= 0 && index < choices.length) return choices[index];
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
    if (!who.ok) throw new Error("Sign-in failed");
  }

  const accounts = parseJsonFromOutput(who.stdout)?.accounts ?? [];
  if (accounts.length === 0) throw new Error("Could not read the account list from wrangler");

  const state = readState();
  const fromEnv = process.env.CLOUDFLARE_ACCOUNT_ID;
  let account =
    accounts.find((a) => a.id === fromEnv) ??
    accounts.find((a) => a.id === state.accountId) ??
    (accounts.length === 1 ? accounts[0] : null);

  if (!account) {
    // Deploying into the wrong account is not something a script should guess at.
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
  const listed = parseJsonFromOutput(wranglerCapture(["d1", "list", "--json"]).stdout) ?? [];
  const existing = listed.find((db) => db.uuid === state.databaseId || db.name === DB_NAME);

  if (existing) {
    writeState({ databaseId: existing.uuid });
    style.ok(`Reusing database "${existing.name}" (${existing.uuid})`);
    return existing.uuid;
  }

  style.info(`Creating database "${DB_NAME}"…`);
  await wranglerInherit(["d1", "create", DB_NAME]);

  // `d1 create` has no --json, so read the list back to learn the uuid.
  const after = parseJsonFromOutput(wranglerCapture(["d1", "list", "--json"]).stdout) ?? [];
  const created = after.find((db) => db.name === DB_NAME);
  if (!created) throw new Error(`Created the database but could not find "${DB_NAME}"`);

  writeState({ databaseId: created.uuid });
  style.ok(`Created database (${created.uuid})`);
  return created.uuid;
}

/**
 * `wrangler.toml` in the repository deliberately carries no account or database
 * id — this is a public template and those values belong to each operator. The
 * generated file is gitignored.
 */
function writeGeneratedConfig(accountId, databaseId) {
  const template = readFileSync(TEMPLATE, "utf8");
  if (!template.includes(DATABASE_ID_SENTINEL)) {
    throw new Error(`wrangler.toml is missing the ${DATABASE_ID_SENTINEL} placeholder`);
  }

  const generated = template
    .replace(DATABASE_ID_SENTINEL, databaseId)
    .replace(
      /^compatibility_date = .*$/m,
      (line) =>
        `${line}\n\n# Generated by \`cf\`; not committed. Edit wrangler.toml instead.\naccount_id = "${accountId}"`,
    );

  writeFileSync(GENERATED, generated);
  return GENERATED;
}

async function ensureSecrets(configPath) {
  style.step("Checking secrets");

  const listed =
    parseJsonFromOutput(
      wranglerCapture(["secret", "list", "--format", "json", "-c", configPath]).stdout,
    ) ?? [];
  const present = new Set(listed.map((secret) => secret.name));

  let registrationToken;
  for (const name of REQUIRED_SECRETS) {
    if (present.has(name)) {
      style.ok(`${name} already set`);
      continue;
    }

    // The registration token is shorter because it gets typed into the
    // extension by hand; the probe secret is server-only.
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

    if (name === "REGISTRATION_TOKEN") registrationToken = value;
    style.ok(`${name} generated`);
  }

  if (registrationToken) {
    // Written to a file rather than printed: terminals get scrolled back,
    // screenshotted, and pasted into bug reports.
    writeFileSync(
      SECRETS_NOTE,
      [
        "Secrets for this Personal Vault deployment (gitignored — do not commit or share).",
        "",
        `REGISTRATION_TOKEN=${registrationToken}`,
        '  -> Enter this in the extension\'s "Registration token" field on first setup.',
        "  -> Anyone holding it can create an account on your Worker.",
        "  -> Lost it? Run: npx wrangler secret put REGISTRATION_TOKEN -c .wrangler.local.toml",
        "",
      ].join("\n"),
    );
    style.warn(`Registration token written to ${path.basename(SECRETS_NOTE)}`);
  }
}

function buildAssets() {
  style.step("Building the share page and the extension");
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "build.mjs")], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error("Build failed");
}

async function deploy() {
  const account = await ensureLogin();
  const databaseId = await ensureDatabase();
  const configPath = writeGeneratedConfig(account.id, databaseId);

  style.step("Applying migrations");
  await wranglerInherit(["d1", "migrations", "apply", DB_NAME, "--remote", "-c", configPath]);

  await ensureSecrets(configPath);
  buildAssets();

  style.step("Deploying the Worker");
  await wranglerInherit(["deploy", "-c", configPath]);

  console.log("");
  style.ok("Done. Two steps left:");
  style.info("1. chrome://extensions → Developer mode → Load unpacked → dist/extension");
  style.info(
    `2. In the popup, enter the Worker URL above and the token in ${path.basename(SECRETS_NOTE)}`,
  );
}

async function dev() {
  buildAssets();

  style.step("Preparing the local D1 database");
  await wranglerInherit(["d1", "migrations", "apply", DB_NAME, "--local"]);

  if (!existsSync(path.join(root, ".dev.vars"))) {
    // Local runs get their own secrets; never the production ones.
    writeFileSync(
      path.join(root, ".dev.vars"),
      [
        'REGISTRATION_TOKEN="token-dev-local"',
        `EMAIL_PROBE_SECRET="${randomBytes(32).toString("base64url")}"`,
        "",
      ].join("\n"),
    );
    style.ok('Created .dev.vars with the registration token "token-dev-local"');
  }

  style.step("Worker running at http://127.0.0.1:8787");
  await wranglerInherit(["dev", "--port", "8787"]);
}

async function status() {
  const state = readState();
  if (!state.accountId) {
    style.warn("Never deployed. Run: npm run deploy");
    return;
  }
  console.log(`Account:  ${state.accountName} (${state.accountId})`);
  console.log(`Database: ${DB_NAME} (${state.databaseId ?? "not created"})`);

  const deployments = wranglerCapture(["deployments", "list", "-c", GENERATED]);
  console.log(deployments.ok ? deployments.stdout.trim() : "No deployments yet.");
}

async function logs() {
  if (!existsSync(GENERATED)) throw new Error("Never deployed. Run: npm run deploy");
  await wranglerInherit(["tail", "-c", GENERATED]);
}

const COMMANDS = { deploy, dev, status, logs };

const command = process.argv[2];
if (!command || !(command in COMMANDS)) {
  console.log(`Usage: node scripts/vault.mjs <command>

  deploy   Create D1 and secrets if needed, migrate, build and deploy to your
           own Cloudflare account. Safe to run repeatedly.
  dev      Run the Worker and a local D1 at http://127.0.0.1:8787
  status   Show the account and resources in use
  logs     Tail the Worker logs
`);
  process.exit(command ? 1 : 0);
}

try {
  await COMMANDS[command]();
} catch (error) {
  style.fail(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
