export const PACKAGE = "7key";
export const TAP = "Linhv14/homebrew-7key";
export const FORMULA = "sevenkey";

export function packageJson(release: string): string {
  return `${JSON.stringify(
    {
      name: PACKAGE,
      version: release,
      description: "7key CLI: give AI agents and CI your secrets without letting them see them",
      homepage: "https://7key.online",
      repository: { type: "git", url: "git+https://github.com/Linhv14/7key-action.git" },
      bugs: { url: "https://github.com/Linhv14/7key-action/issues" },
      license: "MIT",
      keywords: ["secrets", "password-manager", "ai-agents", "claude", "github-actions", "cli"],
      bin: { "7key": "7key.mjs" },
      files: ["7key.mjs", "README.md", "LICENSE"],
      engines: { node: ">=20" },
    },
    null,
    2,
  )}\n`;
}

export function formula(release: string, sha256: string): string {
  return `class Sevenkey < Formula
  desc "Give AI agents and CI your secrets without letting them see them"
  homepage "https://7key.online"
  url "https://registry.npmjs.org/${PACKAGE}/-/${PACKAGE}-${release}.tgz"
  sha256 "${sha256}"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec.glob("bin/*")
  end

  test do
    assert_match "Usage: 7key", shell_output("#{bin}/7key help")
  end
end
`;
}
