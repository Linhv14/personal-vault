#!/usr/bin/env node

/**
 * `cf` — CLI triển khai Personal Vault lên Cloudflare account của CHÍNH NGƯỜI CHẠY.
 *
 * Đây là điều kiện để app này có nghĩa: một password manager mà dữ liệu nằm trên
 * hạ tầng của tác giả thì không ai nên dùng. Mỗi người tự deploy một bản, và tác
 * giả không có quyền truy cập gì vào dữ liệu đó.
 *
 *   cf deploy    tạo D1 + secret nếu chưa có, chạy migration, build, deploy
 *   cf dev       chạy Worker local kèm D1 local
 *   cf logs      xem log realtime
 *   cf status    xem đang deploy ở account nào, tài nguyên nào
 *
 * Script tự viết thay vì dựa vào provisioning của wrangler, vì wrangler 4.149
 * không có cờ nào tự tạo D1 khi thiếu `database_id`.
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
 * Gọi thẳng binary wrangler bằng chính Node đang chạy, không qua npx và không
 * qua shell.
 *
 * Trên Windows, spawn("npx", args, { shell: true }) vỡ khi đường dẫn Node có dấu
 * cách — mặc định là "C:\Program Files\nodejs" — vì shell cắt chuỗi ở dấu cách
 * rồi báo "Cannot find module C:\Program Files\nodejs". Gọi trực tiếp thì không
 * có bước parse nào của shell để mà hỏng.
 */
const WRANGLER = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");

const DB_NAME = "vault";
const DATABASE_ID_SENTINEL = "SET_BY_CF_DEPLOY";
const REQUIRED_SECRETS = ["REGISTRATION_TOKEN", "EMAIL_PROBE_SECRET"];

// ---------------------------------------------------------------------------
// Tiện ích
// ---------------------------------------------------------------------------

const style = {
  step: (text) => console.log(`\n\x1b[1m▸ ${text}\x1b[0m`),
  ok: (text) => console.log(`  \x1b[32m✓\x1b[0m ${text}`),
  info: (text) => console.log(`  ${text}`),
  warn: (text) => console.log(`  \x1b[33m!\x1b[0m ${text}`),
  fail: (text) => console.error(`\n\x1b[31m✗ ${text}\x1b[0m`),
};

/** Chạy wrangler và trả stdout. Không in ra — dùng cho lệnh cần đọc kết quả. */
function wranglerCapture(args) {
  const result = spawnSync(process.execPath, [WRANGLER, ...args], {
    cwd: root,
    encoding: "utf8",
  });
  return { ok: result.status === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** Chạy wrangler và cho nó chiếm terminal — dùng cho login, dev, deploy, logs. */
function wranglerInherit(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WRANGLER, ...args], {
      cwd: root,
      stdio: "inherit",
    });
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`wrangler ${args[0]} thoát với mã ${code}`)),
    );
  });
}

/**
 * Wrangler in cả log lẫn JSON ra stdout, nên không parse thẳng được.
 * Lấy khối JSON cuối cùng trong output.
 */
function parseJsonFromOutput(output) {
  // Thử lần lượt từ dấu mở ngoặc đầu tiên trở đi. Không thể chỉ lấy dấu ngoặc
  // cuối cùng (sẽ trúng object lồng bên trong), cũng không thể chỉ lấy dấu đầu
  // tiên (log của wrangler đôi khi có chứa ngoặc).
  for (let i = 0; i < output.length; i++) {
    const char = output[i];
    if (char !== "{" && char !== "[") continue;
    try {
      return JSON.parse(output.slice(i));
    } catch {
      // Không phải điểm bắt đầu của JSON — thử dấu ngoặc tiếp theo.
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
    while (true) {
      const answer = (await rl.question(`  ${question} [1-${choices.length}]: `)).trim();
      const index = Number.parseInt(answer, 10) - 1;
      if (index >= 0 && index < choices.length) return choices[index];
      console.log("  Chọn không hợp lệ.");
    }
  } finally {
    rl.close();
  }
}

// ---------------------------------------------------------------------------
// Các bước
// ---------------------------------------------------------------------------

async function ensureLogin() {
  style.step("Kiểm tra đăng nhập Cloudflare");

  let who = wranglerCapture(["whoami", "--json"]);
  if (!who.ok) {
    if (process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN) {
      throw new Error(
        "Có biến môi trường CLOUDFLARE_API_TOKEN/CF_API_TOKEN nhưng nó không dùng được.\n" +
          "  Gỡ biến đó đi rồi chạy lại, hoặc thay bằng token hợp lệ của account bạn muốn deploy.",
      );
    }
    style.info("Chưa đăng nhập — mở browser để đăng nhập…");
    await wranglerInherit(["login"]);
    who = wranglerCapture(["whoami", "--json"]);
    if (!who.ok) throw new Error("Đăng nhập thất bại");
  }

  const info = parseJsonFromOutput(who.stdout);
  const accounts = info?.accounts ?? [];
  if (accounts.length === 0) throw new Error("Không đọc được danh sách account từ wrangler");

  const state = readState();
  const fromEnv = process.env.CLOUDFLARE_ACCOUNT_ID;
  let account =
    accounts.find((a) => a.id === fromEnv) ??
    accounts.find((a) => a.id === state.accountId) ??
    (accounts.length === 1 ? accounts[0] : null);

  if (!account) {
    // Nhiều account thì phải hỏi: deploy nhầm vào account công ty là chuyện
    // không nên để script tự đoán.
    style.warn(`Token của bạn truy cập được ${accounts.length} account:`);
    account = await ask(
      "Deploy vào account nào?",
      accounts.map((a) => ({ label: `${a.name}  (${a.id})`, ...a })),
    );
  }

  writeState({ accountId: account.id, accountName: account.name });
  style.ok(`Account: ${account.name}`);
  return account;
}

async function ensureDatabase() {
  style.step("Kiểm tra D1 database");

  const state = readState();
  const listed = parseJsonFromOutput(wranglerCapture(["d1", "list", "--json"]).stdout) ?? [];
  const existing = listed.find((db) => db.uuid === state.databaseId || db.name === DB_NAME);

  if (existing) {
    writeState({ databaseId: existing.uuid });
    style.ok(`Dùng lại database "${existing.name}" (${existing.uuid})`);
    return existing.uuid;
  }

  style.info(`Tạo database "${DB_NAME}"…`);
  await wranglerInherit(["d1", "create", DB_NAME]);

  // `d1 create` không có --json, nên đọc lại danh sách để lấy uuid.
  const after = parseJsonFromOutput(wranglerCapture(["d1", "list", "--json"]).stdout) ?? [];
  const created = after.find((db) => db.name === DB_NAME);
  if (!created) throw new Error(`Tạo xong nhưng không tìm thấy database "${DB_NAME}"`);

  writeState({ databaseId: created.uuid });
  style.ok(`Đã tạo database (${created.uuid})`);
  return created.uuid;
}

/**
 * Sinh config thật từ template.
 *
 * `wrangler.toml` trong repo cố tình KHÔNG chứa account_id hay database_id — đây
 * là repo public, và hai giá trị đó là của riêng từng người. File sinh ra nằm
 * trong .gitignore.
 */
function writeGeneratedConfig(accountId, databaseId) {
  const template = readFileSync(TEMPLATE, "utf8");
  if (!template.includes(DATABASE_ID_SENTINEL)) {
    throw new Error(`wrangler.toml thiếu placeholder ${DATABASE_ID_SENTINEL}`);
  }

  const generated = template
    .replace(DATABASE_ID_SENTINEL, databaseId)
    .replace(
      /^compatibility_date = .*$/m,
      (line) => `${line}\n\n# File này do \`cf\` sinh ra, không commit. Sửa wrangler.toml thay vì sửa đây.\naccount_id = "${accountId}"`,
    );

  writeFileSync(GENERATED, generated);
  return GENERATED;
}

async function ensureSecrets(configPath) {
  style.step("Kiểm tra secret");

  const listed =
    parseJsonFromOutput(
      wranglerCapture(["secret", "list", "--format", "json", "-c", configPath]).stdout,
    ) ?? [];
  const present = new Set(listed.map((secret) => secret.name));

  const created = {};
  for (const name of REQUIRED_SECRETS) {
    if (present.has(name)) {
      style.ok(`${name} đã có`);
      continue;
    }

    // Token đăng ký ngắn hơn cho dễ gõ tay vào extension; probe secret chỉ server
    // dùng nên để dài.
    const value = randomBytes(name === "REGISTRATION_TOKEN" ? 24 : 32).toString("base64url");
    const result = spawnSync(process.execPath, [WRANGLER, "secret", "put", name, "-c", configPath], {
      cwd: root,
      input: value,
      encoding: "utf8",
    });
    if (result.status !== 0) {
      throw new Error(`Không đặt được secret ${name}: ${result.stderr || result.stdout}`);
    }

    created[name] = value;
    style.ok(`${name} đã sinh mới`);
  }

  if (created.REGISTRATION_TOKEN) {
    // Ghi ra file thay vì in ra terminal: terminal thường được cuộn lại, chụp
    // màn hình, hoặc chia sẻ khi hỏi lỗi.
    writeFileSync(
      SECRETS_NOTE,
      [
        "Secret của bản Personal Vault này (file đã gitignore — đừng commit, đừng gửi ai).",
        "",
        `REGISTRATION_TOKEN=${created.REGISTRATION_TOKEN}`,
        '  -> Nhập vào ô "Token đăng ký" trong extension khi tạo vault lần đầu.',
        "  -> Ai có chuỗi này cũng tạo được account trên Worker của bạn.",
        "  -> Mất thì chạy: npx wrangler secret put REGISTRATION_TOKEN -c .wrangler.local.toml",
        "",
      ].join("\n"),
    );
    style.warn(`Token đăng ký đã ghi vào ${path.basename(SECRETS_NOTE)} — mở file đó để lấy.`);
  }
}

function buildAssets() {
  style.step("Build trang share và extension");
  const result = spawnSync("node", [path.join(root, "scripts", "build.mjs")], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error("Build thất bại");
}

// ---------------------------------------------------------------------------
// Lệnh
// ---------------------------------------------------------------------------

async function deploy() {
  const account = await ensureLogin();
  const databaseId = await ensureDatabase();
  const configPath = writeGeneratedConfig(account.id, databaseId);

  style.step("Chạy migration trên D1");
  await wranglerInherit(["d1", "migrations", "apply", DB_NAME, "--remote", "-c", configPath]);

  await ensureSecrets(configPath);
  buildAssets();

  style.step("Deploy Worker");
  await wranglerInherit(["deploy", "-c", configPath]);

  console.log("");
  style.ok("Xong. Hai bước còn lại:");
  style.info("1. Mở chrome://extensions → Developer mode → Load unpacked → chọn dist/extension");
  style.info(`2. Trong popup, nhập URL Worker ở trên và token trong ${path.basename(SECRETS_NOTE)}`);
}

async function dev() {
  buildAssets();
  style.step("Chuẩn bị D1 local");
  await wranglerInherit(["d1", "migrations", "apply", DB_NAME, "--local"]);

  if (!existsSync(path.join(root, ".dev.vars"))) {
    // Bản local cần secret riêng, không dùng secret production.
    writeFileSync(
      path.join(root, ".dev.vars"),
      [
        'REGISTRATION_TOKEN="token-dev-local"',
        `EMAIL_PROBE_SECRET="${randomBytes(32).toString("base64url")}"`,
        "",
      ].join("\n"),
    );
    style.ok("Đã tạo .dev.vars với token dev là: token-dev-local");
  }

  style.step("Worker local tại http://127.0.0.1:8787");
  await wranglerInherit(["dev", "--port", "8787"]);
}

async function status() {
  const state = readState();
  if (!state.accountId) {
    style.warn("Chưa deploy lần nào. Chạy: cf deploy");
    return;
  }
  console.log(`Account:  ${state.accountName} (${state.accountId})`);
  console.log(`Database: ${DB_NAME} (${state.databaseId ?? "chưa tạo"})`);

  const deployments = wranglerCapture(["deployments", "list", "-c", GENERATED]);
  console.log(deployments.ok ? deployments.stdout.trim() : "Chưa có deployment nào.");
}

async function logs() {
  if (!existsSync(GENERATED)) throw new Error("Chưa deploy lần nào. Chạy: cf deploy");
  await wranglerInherit(["tail", "-c", GENERATED]);
}

const COMMANDS = { deploy, dev, status, logs };

const command = process.argv[2];
if (!command || !(command in COMMANDS)) {
  console.log(`Dùng: cf <lệnh>

  deploy   Tạo D1 + secret nếu chưa có, migration, build, rồi deploy lên
           Cloudflare account của bạn. Chạy lại nhiều lần được.
  dev      Chạy Worker local kèm D1 local tại http://127.0.0.1:8787
  status   Đang deploy ở account nào, dùng tài nguyên nào
  logs     Xem log realtime của Worker
`);
  process.exit(command ? 1 : 0);
}

try {
  await COMMANDS[command]();
} catch (error) {
  style.fail(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
