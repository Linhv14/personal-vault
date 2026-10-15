import { describe, expect, it } from "vitest";
import { randomKey } from "../src/core/identity.js";
import {
  formatDotenv,
  isSecretName,
  newProject,
  openProject,
  openSecret,
  parseDotenv,
  sealProject,
  sealSecret,
  type SecretAddress,
} from "../src/core/projects.js";

const PROJECT_ID = "6f1c2a7e-3d4b-4c5a-9e8f-0a1b2c3d4e5f";

describe("project and secret encryption", () => {
  it("opens a project only with its team key, id and generation", async () => {
    const teamKey = randomKey();
    const project = newProject("Payments API");
    const sealed = await sealProject(teamKey, PROJECT_ID, 2, project);
    expect(await openProject(teamKey, PROJECT_ID, 2, sealed)).toEqual(project);
    await expect(openProject(teamKey, PROJECT_ID, 1, sealed)).rejects.toThrow();
    await expect(openProject(randomKey(), PROJECT_ID, 2, sealed)).rejects.toThrow();
    expect(JSON.stringify(sealed)).not.toContain("Payments");
  });

  it("binds a secret to its environment so it cannot be moved to another", async () => {
    const project = newProject("Web");
    const [development, , production] = project.environments;
    const address: SecretAddress = {
      projectId: PROJECT_ID,
      generation: 0,
      environmentId: development!.id,
      secretId: crypto.randomUUID(),
    };
    const secret = { name: "DATABASE_URL", value: "postgres://dev" };
    const sealed = await sealSecret(project, address, secret);
    expect(await openSecret(project, address, sealed)).toEqual(secret);
    await expect(
      openSecret(project, { ...address, environmentId: production!.id }, sealed),
    ).rejects.toThrow();
    await expect(openSecret(project, { ...address, generation: 1 }, sealed)).rejects.toThrow();
  });

  it("starts with three environments that have distinct ids", () => {
    const { environments } = newProject("x");
    expect(environments.map((env) => env.name)).toEqual(["Development", "Staging", "Production"]);
    expect(new Set(environments.map((env) => env.id)).size).toBe(3);
  });
});

describe("dotenv", () => {
  it("reads names, quoted values, comments and export prefixes", () => {
    const parsed = parseDotenv(
      [
        "# comment",
        "API_KEY=abc123",
        'export GREETING="hello \\"world\\"\\nbye"',
        "SINGLE='a # not a comment'",
        "TRAILING=value # comment",
        "1INVALID=x",
        "API_KEY=last wins",
        "",
      ].join("\n"),
    );
    expect(parsed).toEqual([
      { name: "API_KEY", value: "last wins" },
      { name: "GREETING", value: 'hello "world"\nbye' },
      { name: "SINGLE", value: "a # not a comment" },
      { name: "TRAILING", value: "value" },
    ]);
  });

  it("round-trips through its own output", () => {
    const secrets = [
      { name: "URL", value: "https://example.com/a?b=c" },
      { name: "TEXT", value: 'line one\nsays "hi" \\ ok' },
      { name: "EMPTY", value: "" },
    ];
    expect(parseDotenv(formatDotenv(secrets))).toEqual(secrets);
  });

  it("accepts conventional variable names only", () => {
    expect(isSecretName("NEXT_PUBLIC_URL")).toBe(true);
    expect(isSecretName("app.key-1")).toBe(true);
    expect(isSecretName("9LIVES")).toBe(false);
    expect(isSecretName("HAS SPACE")).toBe(false);
  });
});
