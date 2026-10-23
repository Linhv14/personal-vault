import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ACTION_MAJOR, ACTION_REPOSITORY } from "../src/core/brand.ts";

const root = path.resolve(import.meta.dirname, "..");
const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Usage: npm run publish:action -- <version>, for example 1.0.1");
  process.exit(1);
}
if (`v${version.split(".")[0]}` !== ACTION_MAJOR) {
  console.error(`Version ${version} is outside ${ACTION_MAJOR}; update ACTION_MAJOR first.`);
  process.exit(1);
}

function run(command: string, args: string[], cwd = root): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }
  return result.stdout.trim();
}

process.env.SEVENKEY_CLI_VERSION = version;
run(process.execPath, [path.join(root, "scripts", "build.ts")]);

const work = mkdtempSync(path.join(tmpdir(), "7key-action-"));
try {
  run("gh", ["repo", "clone", ACTION_REPOSITORY, work]);
  run("git", ["checkout", "-B", "main"], work);
  mkdirSync(path.join(work, "dist"), { recursive: true });
  cpSync(path.join(root, "action", "action.yml"), path.join(work, "action.yml"));
  cpSync(path.join(root, "action", "README.md"), path.join(work, "README.md"));
  cpSync(path.join(root, "action", "dist", "index.mjs"), path.join(work, "dist", "index.mjs"));
  for (const file of ["LICENSE", "NOTICE"]) {
    cpSync(path.join(root, file), path.join(work, file));
  }

  const tag = `v${version}`;
  run("git", ["add", "-A"], work);
  if (run("git", ["status", "--porcelain"], work)) {
    run("git", ["commit", "-m", `release ${tag}`], work);
  }
  run("git", ["tag", "-a", tag, "-m", tag], work);
  run("git", ["tag", "-f", "-a", ACTION_MAJOR, "-m", tag], work);
  run("git", ["push", "origin", "HEAD"], work);
  run("git", ["push", "origin", tag], work);
  run("git", ["push", "--force", "origin", ACTION_MAJOR], work);

  const cli = path.join(root, "dist", "cli", "7key.mjs");
  const sum = createHash("sha256").update(readFileSync(cli)).digest("hex");
  const sumFile = path.join(work, "7key.mjs.sha256");
  writeFileSync(sumFile, `${sum}  7key.mjs\n`);
  run("gh", [
    "release",
    "create",
    tag,
    cli,
    sumFile,
    "--repo",
    ACTION_REPOSITORY,
    "--title",
    tag,
    "--notes",
    `7key Action and CLI ${tag}. \`7key.mjs\` SHA-256: \`${sum}\``,
  ]);
  console.log(`Published ${ACTION_REPOSITORY}@${tag} and moved ${ACTION_MAJOR}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
