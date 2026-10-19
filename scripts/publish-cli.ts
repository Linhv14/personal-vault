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
import { FORMULA, PACKAGE, TAP, formula, packageJson } from "./cli-package.ts";

const root = path.resolve(import.meta.dirname, "..");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
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

run(process.execPath, [path.join(root, "scripts", "build.ts")]);

const stage = mkdtempSync(path.join(tmpdir(), "7key-cli-"));
try {
  cpSync(path.join(root, "dist", "cli", "7key.mjs"), path.join(stage, "7key.mjs"));
  cpSync(path.join(root, "cli", "README.md"), path.join(stage, "README.md"));
  cpSync(path.join(root, "LICENSE"), path.join(stage, "LICENSE"));
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
  writeFileSync(path.join(tap, "Formula", `${FORMULA}.rb`), formula(version, sha256));
  rmSync(path.join(tap, "Aliases", PACKAGE), { force: true });
  symlinkSync(`../Formula/${FORMULA}.rb`, path.join(tap, "Aliases", PACKAGE));
  writeFileSync(
    path.join(tap, "README.md"),
    `# 7key Homebrew tap\n\n\`\`\`bash\nbrew tap linhv14/7key\nbrew trust linhv14/7key\nbrew install linhv14/7key/7key\n\`\`\`\n\nSee https://7key.online.\n`,
  );
  run("git", ["add", "-A"], tap);
  if (run("git", ["status", "--porcelain"], tap)) {
    run("git", ["commit", "-m", `7key ${version}`], tap);
    run("git", ["push", "origin", "HEAD:main"], tap);
  }
  console.log(`Updated ${TAP}: brew install linhv14/7key/7key`);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
