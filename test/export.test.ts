import { describe, expect, it } from "vitest";
import { csvExport, encryptExport, isEncryptedExport } from "../extension/lib/export.js";
import { readExport } from "../extension/lib/import/read-export.js";
import { ImportError } from "../extension/lib/import/source.js";
import type { VaultItem } from "../extension/lib/vault.js";

const base = { createdAt: 1, updatedAt: 2 };
const items: VaultItem[] = [
  {
    ...base,
    id: "a",
    title: 'GitHub, "work"',
    url: "github.com",
    username: "me@example.com",
    password: 'p,a"ss\nword',
    note: "line one\nline two",
    totp: { secret: "JBSWY3DPEHPK3PXP", algorithm: "SHA-1", digits: 6, period: 30 },
    vault: "work",
    favorite: true,
    tags: ["dev"],
  },
  { ...base, id: "b", type: "note", title: "Wifi at home", note: "secret" },
  { ...base, id: "c", title: "Old", password: "gone", trashedAt: 5 },
  { ...base, id: "d", title: "", system: "vaults", vaults: [] },
];

const file = (text: string, passphrase?: string) => ({
  name: "export.json",
  bytes: new TextEncoder().encode(text),
  passphrase,
  recoveryTitle: "Recovery codes",
});

describe("encrypted 7key export", () => {
  it("round-trips live items through the importer and leaves out trash and vault records", async () => {
    const text = await encryptExport(items, "correct horse battery", 1_000);
    expect(text).not.toContain("GitHub");
    expect(text).not.toContain("JBSWY3DPEHPK3PXP");
    expect(isEncryptedExport(JSON.parse(text))).toBe(true);

    const source = await readExport(file(text, "correct horse battery"));
    expect(source.format).toBe("1pw");
    expect(source.drafts.map((draft) => draft.title)).toEqual(['GitHub, "work"', "Wifi at home"]);
    const [login] = source.drafts;
    expect(login).toMatchObject({ password: 'p,a"ss\nword', favorite: true, tags: ["dev"] });
    expect(login).not.toHaveProperty("vault");
    expect(login).not.toHaveProperty("id");
  });

  it("asks for the passphrase and rejects a wrong one", async () => {
    const text = await encryptExport(items, "correct horse battery", 1_000);
    await expect(readExport(file(text))).rejects.toEqual(new ImportError("needs_passphrase"));
    await expect(readExport(file(text, "wrong"))).rejects.toEqual(
      new ImportError("wrong_passphrase"),
    );
  });

  it("refuses files that would make key derivation hang", () => {
    expect(
      isEncryptedExport({
        format: "1pw-export",
        version: 1,
        kdf: { type: "pbkdf2-sha256", iterations: 1e12, salt: "AA==" },
        sealed: { ciphertext: "AA==", nonce: "AA==" },
      }),
    ).toBe(false);
  });
});

describe("CSV export", () => {
  it("writes logins only, escaped so the importer reads them back unchanged", async () => {
    const { csv, exported, left } = csvExport(items);
    expect(exported).toBe(1);
    expect(left).toBe(1);
    expect(csv.split("\r\n")[0]).toBe("name,url,username,password,note,totp");

    const source = await readExport({ ...file(csv), name: "export.csv" });
    expect(source.drafts).toHaveLength(1);
    expect(source.drafts[0]).toMatchObject({
      title: 'GitHub, "work"',
      username: "me@example.com",
      password: 'p,a"ss\nword',
      note: "line one\nline two",
    });
    expect(source.drafts[0]!.totp?.secret).toBe("JBSWY3DPEHPK3PXP");
  });
});
