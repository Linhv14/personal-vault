import { describe, expect, it } from "vitest";
import { githubEnvBlock, githubIdToken, maskCommands } from "../cli/ci-client.js";
import { parseArgs } from "../cli/main.js";

describe("trust1 CLI", () => {
  it("reads the link and server from flags or the environment", () => {
    expect(parseArgs(["run", "--", "npm", "test"], { TRUST1_LINK: "o.l" })).toEqual({
      command: "run",
      link: "o.l",
      server: "https://1pw.online",
      rest: ["npm", "test"],
    });
    expect(
      parseArgs(["dotenv", "--link", "a.b", "--server", "http://127.0.0.1:8787"], {}),
    ).toMatchObject({ command: "dotenv", link: "a.b", server: "http://127.0.0.1:8787" });
    expect(() => parseArgs(["env", "extra"], {})).toThrow("Unexpected argument");
  });

  it("masks every line of every secret value, but not variables", () => {
    expect(
      maskCommands([
        { name: "KEY", value: "line one\nline two" },
        { name: "URL", value: "https://example.com", kind: "variable" },
        { name: "EMPTY", value: "" },
      ]),
    ).toEqual(["::add-mask::line one", "::add-mask::line two"]);
  });

  it("writes multi-line values to GITHUB_ENV with a delimiter the value cannot contain", () => {
    const block = githubEnvBlock([{ name: "CERT", value: "a\nb" }]);
    const [first, ...rest] = block.trimEnd().split("\n");
    const delimiter = first!.split("<<")[1]!;
    expect(first).toBe(`CERT<<${delimiter}`);
    expect(rest).toEqual(["a", "b", delimiter]);
    expect(delimiter).toMatch(/^TRUST1_[0-9a-f]{24}$/);
  });

  it("asks GitHub for an OIDC token for the server's audience", async () => {
    const seen: string[] = [];
    const token = await githubIdToken(
      "https://vault.trust1.io",
      {
        ACTIONS_ID_TOKEN_REQUEST_URL: "https://runner.example/token?api-version=2.0",
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: "runner",
      },
      async (input, init) => {
        seen.push(String(input), new Headers(init?.headers).get("Authorization") ?? "");
        return new Response(JSON.stringify({ value: "jwt" }));
      },
    );
    expect(token).toBe("jwt");
    expect(seen[0]).toBe(
      "https://runner.example/token?api-version=2.0&audience=https%3A%2F%2Fvault.trust1.io",
    );
    expect(seen[1]).toBe("Bearer runner");
    await expect(githubIdToken("https://vault.trust1.io", {})).rejects.toThrow("id-token: write");
  });
});
