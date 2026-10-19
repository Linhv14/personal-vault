import { describe, expect, it } from "vitest";
import { randomKey } from "../src/core/identity.js";
import { importVaultKey, sealJson } from "../src/core/crypto.js";
import { fromBase64, utf8Encode } from "../src/core/bytes.js";
import {
  environmentKey,
  formatDotenv,
  openSecretWithOrigin,
  openWithEnvironmentKey,
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

  it("gives each environment its own key, which opens nothing else", async () => {
    const project = newProject("Api");
    const [development, , production] = project.environments;
    const address: SecretAddress = {
      projectId: PROJECT_ID,
      generation: 0,
      environmentId: production!.id,
      secretId: crypto.randomUUID(),
    };
    const sealed = await sealSecret(project, address, { name: "TOKEN", value: "prod" });
    const productionKey = await environmentKey(project, PROJECT_ID, production!.id);
    const developmentKey = await environmentKey(project, PROJECT_ID, development!.id);
    expect(productionKey).not.toEqual(developmentKey);
    expect(productionKey).not.toEqual(fromBase64(project.key));
    expect(await openWithEnvironmentKey(productionKey, address, sealed)).toEqual({
      name: "TOKEN",
      value: "prod",
    });
    await expect(openWithEnvironmentKey(developmentKey, address, sealed)).rejects.toThrow();
  });

  it("still opens a secret sealed under the project key and marks it for upgrade", async () => {
    const project = newProject("Old");
    const address: SecretAddress = {
      projectId: PROJECT_ID,
      generation: 0,
      environmentId: project.environments[0]!.id,
      secretId: crypto.randomUUID(),
    };
    const context = utf8Encode(
      `personal-vault/secret/${PROJECT_ID}/0/${address.environmentId}/${address.secretId}`,
    );
    const sealed = await sealJson(
      await importVaultKey(fromBase64(project.key)),
      { name: "OLD", value: "v" },
      context,
    );
    expect(await openSecretWithOrigin(project, address, sealed)).toEqual({
      content: { name: "OLD", value: "v" },
      legacy: true,
    });
    const fresh = await sealSecret(project, address, { name: "NEW", value: "v" });
    expect((await openSecretWithOrigin(project, address, fresh)).legacy).toBe(false);
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

describe("project handles", () => {
  it("turn names into lowercase dashed handles, Vietnamese included", async () => {
    const { handleOf } = await import("../src/core/projects.js");
    expect(handleOf("Trust1 Portal")).toBe("trust1-portal");
    expect(handleOf("  Payments API (v2) ")).toBe("payments-api-v2");
    expect(handleOf("Đội Phát triển")).toBe("doi-phat-trien");
  });

  it("match an id, a handle or a name, nothing else", async () => {
    const { refersTo } = await import("../src/core/projects.js");
    const entry = { id: "8f0c2b1e-0000-4000-8000-000000000001", name: "Trust1 Portal" };
    expect(refersTo(entry.id, entry)).toBe(true);
    expect(refersTo("trust1-portal", entry)).toBe(true);
    expect(refersTo("Trust1 Portal", entry)).toBe(true);
    expect(refersTo("trust1", entry)).toBe(false);
    expect(refersTo("---", entry)).toBe(false);
  });
});
