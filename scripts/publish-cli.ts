import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BIN, FORMULA, PACKAGE, TAP, formula, packageJson, tarballUrl } from "./cli-package.ts";

const root = path.resolve(import.meta.dirname, "..");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const tapOnly = args.includes("--tap-only");
const version = args.find((arg) => !arg.startsWith("--"));
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Usage: npm run publish:cli -- <version> [--dry-run], for example 1.3.1");
  process.exit(1);
}

function run(command: string, list: string[], cwd = root, allowFailure = false): string {
  const result = spawnSync(command, list, { cwd, encoding: "utf8" });
  if (result.status !== 0 && !allowFailure) {
    console.error(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }
  return result.status === 0 ? result.stdout.trim() : "";
}

function updateTap(stage: string, release: string, sha256: string): void {
  const tap = path.join(stage, "tap");
  if (!run("gh", ["repo", "view", TAP, "--json", "name"], root, true)) {
    run("gh", [
      "repo",
      "create",
      TAP,
      "--public",
      "--description",
      "Homebrew tap for the 7key CLI",
    ]);
  }
  run("gh", ["repo", "clone", TAP, tap]);
  run("git", ["checkout", "-B", "main"], tap);
  mkdirSync(path.join(tap, "Formula"), { recursive: true });
  mkdirSync(path.join(tap, "Aliases"), { recursive: true });
  writeFileSync(path.join(tap, "Formula", `${FORMULA}.rb`), formula(release, sha256));
  rmSync(path.join(tap, "Aliases", BIN), { force: true });
  symlinkSync(`../Formula/${FORMULA}.rb`, path.join(tap, "Aliases", BIN));
  writeFileSync(
    path.join(tap, "README.md"),
    `# 7key Homebrew tap\n\nThe [7key](https://7key.online) CLI: give AI agents and CI your secrets without showing them the values.\n\n\`\`\`bash\nbrew install linhv14/7key/sevenkey\n\`\`\`\n\nThe formula is \`sevenkey\` because formula names cannot start with a digit; it installs the \`7key\` command. Also on npm: \`npm install -g @7key/cli\`.\n`,
  );
  run("git", ["add", "-A"], tap);
  if (run("git", ["status", "--porcelain"], tap)) {
    run("git", ["commit", "-m", `7key ${release}`], tap);
    run("git", ["push", "origin", "HEAD:main"], tap);
  }
  console.log(`Updated ${TAP}: brew install linhv14/7key/sevenkey`);
}

async function publishedSha(release: string): Promise<string | null> {
  const response = await fetch(tarballUrl(release));
  if (!response.ok) return null;
  return createHash("sha256")
    .update(new Uint8Array(await response.arrayBuffer()))
    .digest("hex");
}

async function updateTapFromNpm(release: string): Promise<boolean> {
  const sha256 = await publishedSha(release);
  if (!sha256) return false;
  const stage = mkdtempSync(path.join(tmpdir(), "7key-tap-"));
  try {
    updateTap(stage, release, sha256);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
  return true;
}

const LATER = `Approve it on npmjs.com if npm staged it, then run: npm run publish:cli -- ${version} --tap-only`;

if (tapOnly) {
  if (!(await updateTapFromNpm(version))) {
    console.error(`${PACKAGE}@${version} is not on npm yet. ${LATER}`);
    process.exit(1);
  }
  process.exit(0);
}

run(process.execPath, [path.join(root, "scripts", "build.ts")]);

const stage = mkdtempSync(path.join(tmpdir(), "7key-cli-"));
try {
  cpSync(path.join(root, "dist", "cli", "7key.mjs"), path.join(stage, "7key.mjs"));
  cpSync(path.join(root, "cli", "README.md"), path.join(stage, "README.md"));
  cpSync(path.join(root, "LICENSE"), path.join(stage, "LICENSE"));
  cpSync(path.join(root, "NOTICE"), path.join(stage, "NOTICE"));
  writeFileSync(path.join(stage, "package.json"), packageJson(version));

  const tarball = path.join(stage, run("npm", ["pack", "--silent"], stage).split("\n").at(-1)!);
  const sha256 = createHash("sha256").update(readFileSync(tarball)).digest("hex");
  console.log(`Packed ${path.basename(tarball)} (sha256 ${sha256})`);

  if (dryRun) {
    cpSync(tarball, path.join(root, "dist", "cli", path.basename(tarball)));
    console.log(run("tar", ["-tzf", tarball]));
    console.log(formula(version, sha256));
    process.exit(0);
  }

  if (!run("npm", ["whoami"], stage, true)) {
    console.error("Sign in to npm first: npm login");
    process.exit(1);
  }
  const published = spawnSync("npm", ["publish", tarball, "--access", "public"], {
    cwd: stage,
    stdio: "inherit",
  });
  if (published.status !== 0) process.exit(published.status ?? 1);
  console.log(`Published ${PACKAGE}@${version} to npm`);

  if (!(await updateTapFromNpm(version))) console.log(LATER);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
