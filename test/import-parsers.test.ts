import { describe, expect, it } from "vitest";
import { bitwardenFromCsv, bitwardenFromJson } from "../extension/lib/import/bitwarden.js";
import { genericCsv, isGenericCsv } from "../extension/lib/import/generic-csv.js";
import { onePasswordFromExport } from "../extension/lib/import/onepassword.js";
import { protonFromCsv, protonFromJson } from "../extension/lib/import/protonpass.js";
import { readExport } from "../extension/lib/import/read-export.js";
import { ImportError, type ImportSource } from "../extension/lib/import/source.js";

const SECRET = "JBSWY3DPEHPK3PXP";
const TOTP_URI = `otpauth://totp/Bank:ana?secret=${SECRET}&issuer=Bank`;
const TRICKY_PASSWORD = ' p"a,ss\nwörd🔑 ';

const read = (text: string, passphrase?: string) =>
  readExport({
    name: "export.csv",
    bytes: new TextEncoder().encode(text),
    passphrase,
    recoveryTitle: "Recovery",
  });

async function importCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ImportError) {
      return error.code;
    }
    throw error;
  }
  return "no error";
}

const HOSTILE_VALUES: unknown[] = [
  null,
  undefined,
  0,
  -1,
  1e308,
  "",
  "x".repeat(100_000),
  [],
  [null],
  {},
  { __proto__: { polluted: true } },
  true,
];

function expectNoPollution() {
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
}

describe("Bitwarden parser", () => {
  const exportJson = {
    encrypted: false,
    items: [
      {
        type: 1,
        name: "Ünïcødé 🔐 Bank",
        notes: "first line\nsecond line",
        creationDate: "2024-01-02T03:04:05.000Z",
        login: {
          username: "ana",
          password: TRICKY_PASSWORD,
          totp: TOTP_URI,
          uris: [{ uri: "https://bank.example/login" }, { uri: " https://m.bank.example " }],
        },
        fields: [
          { name: "PIN", value: "1234", type: 1 },
          { name: "Plain", value: "visible", type: 0 },
          { name: "Linked", value: "username", type: 3 },
        ],
      },
      {
        type: 3,
        name: "Visa",
        card: {
          cardholderName: "Ana",
          number: "4111 1111 1111 1111",
          code: "123",
          expMonth: "1",
          expYear: "2030",
        },
      },
      { type: 1, name: "Old", deletedDate: "2024-01-01T00:00:00Z", login: { password: "gone" } },
      { type: 99, name: "Future type" },
      "garbage",
      null,
      5,
    ],
  };

  it("puts each secret in its own field", async () => {
    const source = await bitwardenFromJson(exportJson, undefined);
    const [login, card] = source.drafts;
    expect(login).toMatchObject({
      title: "Ünïcødé 🔐 Bank",
      url: "https://bank.example/login",
      urls: ["https://m.bank.example"],
      username: "ana",
      password: TRICKY_PASSWORD,
      note: "first line\nsecond line",
      createdAt: Date.UTC(2024, 0, 2, 3, 4, 5) / 1000,
    });
    expect(login?.totp?.secret).toBe(SECRET);
    expect(login?.fields).toEqual([
      { label: "PIN", value: "1234", hidden: true },
      { label: "Plain", value: "visible" },
    ]);
    expect(card).toMatchObject({
      type: "card",
      cardNumber: "4111111111111111",
      cardCvv: "123",
      cardExpiry: "01/30",
      cardholder: "Ana",
    });
    expect(source.drafts).toHaveLength(2);
    expect(source.skipped).toEqual({ trashed: 1, other: 4 });
  });

  it("keeps an unreadable 2FA secret as a hidden field rather than dropping it", async () => {
    const source = await bitwardenFromJson(
      { encrypted: false, items: [{ type: 1, name: "X", login: { totp: "not a secret!" } }] },
      undefined,
    );
    expect(source.drafts[0]?.totp).toBeUndefined();
    expect(source.drafts[0]?.fields).toEqual([
      { label: "2FA", value: "not a secret!", hidden: true },
    ]);
  });

  it("survives hostile shapes in every position", async () => {
    for (const value of HOSTILE_VALUES) {
      const item = {
        type: 1,
        name: value,
        notes: value,
        login: { username: value, password: value, totp: value, uris: value },
        fields: value,
        passwordHistory: value,
        creationDate: value,
      };
      const nested = {
        type: 1,
        login: { uris: [value], fido2Credentials: [value] },
        fields: [value],
      };
      await expect(
        bitwardenFromJson({ encrypted: false, items: [item, nested, value] }, undefined),
      ).resolves.toBeDefined();
      await expect(
        bitwardenFromJson({ encrypted: false, items: value }, undefined),
      ).resolves.toBeDefined();
    }
    expectNoPollution();
  });

  it("counts passkeys it cannot read instead of failing the import", async () => {
    const source = await bitwardenFromJson(
      {
        encrypted: false,
        items: [
          {
            type: 1,
            name: "Site",
            login: {
              fido2Credentials: [
                { keyAlgorithm: "ECDSA", keyCurve: "P-256", rpId: "site.example", keyValue: "%%" },
                { keyAlgorithm: "RSA" },
              ],
            },
          },
        ],
      },
      undefined,
    );
    expect(source.drafts).toHaveLength(1);
    expect(source.drafts[0]?.passkey).toBeUndefined();
    expect(source.skipped.passkey).toBe(2);
  });

  it("refuses account-encrypted exports", async () => {
    expect(await importCode(bitwardenFromJson({ encrypted: true, items: [] }, undefined))).toBe(
      "account_encrypted",
    );
  });

  describe("password-protected exports", () => {
    const base = {
      encrypted: true,
      passwordProtected: true,
      salt: "salt",
      kdfType: 0,
      kdfIterations: 1,
      encKeyValidation_DO_NOT_EDIT: "2.AAAAAAAAAAAAAAAAAAAAAA==|AAAAAAAAAAAAAAAAAAAAAA==|AAAA",
      data: "2.AAAA|AAAA|AAAA",
    };

    it("asks for the passphrase", async () => {
      expect(await importCode(bitwardenFromJson(base, undefined))).toBe("needs_passphrase");
      expect(await importCode(bitwardenFromJson(base, ""))).toBe("needs_passphrase");
    });

    it("reports a wrong passphrase when the MAC does not match", async () => {
      expect(await importCode(bitwardenFromJson(base, "guess"))).toBe("wrong_passphrase");
    });

    it("rejects unsupported or damaged parameters with an import error", async () => {
      const cases: [Record<string, unknown>, string][] = [
        [{ kdfType: 1 }, "argon2"],
        [{ kdfType: 7 }, "unsupported_encryption"],
        [{ kdfIterations: 0 }, "unsupported_encryption"],
        [{ kdfIterations: "1000" }, "unsupported_encryption"],
        [{ kdfIterations: -5 }, "unsupported_encryption"],
        [{ encKeyValidation_DO_NOT_EDIT: "0.AAAA|AAAA" }, "unsupported_encryption"],
        [{ encKeyValidation_DO_NOT_EDIT: "2.AAAA" }, "damaged"],
        [{ encKeyValidation_DO_NOT_EDIT: "2.!!!|@@@|###" }, "damaged"],
        [{ encKeyValidation_DO_NOT_EDIT: 42 }, "unsupported_encryption"],
      ];
      for (const [patch, code] of cases) {
        expect(await importCode(bitwardenFromJson({ ...base, ...patch }, "pw")), code).toBe(code);
      }
    });

    it("still fails cleanly on a fractional iteration count", async () => {
      expect(await importCode(bitwardenFromJson({ ...base, kdfIterations: 1.5 }, "pw"))).toMatch(
        /^(unsupported_encryption|wrong_passphrase)$/,
      );
    });

    it("caps the iteration count so a hostile export cannot hang the extension", async () => {
      expect(await importCode(bitwardenFromJson({ ...base, kdfIterations: 1e9 }, "pw"))).toBe(
        "unsupported_encryption",
      );
    });
  });

  it("reads the CSV export and keeps quoted secrets intact", async () => {
    const source = await bitwardenFromCsv([
      {
        type: "login",
        name: "Ünïcødé",
        login_uri: "https://a.example, https://b.example",
        login_username: "ana",
        login_password: TRICKY_PASSWORD,
        login_totp: TOTP_URI,
        fields: "PIN: 1234\r\nbroken line\nAnswer: blue",
        notes: "",
      },
      { type: "note", name: "Wifi", notes: "the password is 12345" },
      {},
    ]);
    expect(source.drafts[0]).toMatchObject({
      url: "https://a.example",
      urls: ["https://b.example"],
      password: TRICKY_PASSWORD,
      fields: [
        { label: "PIN", value: "1234" },
        { label: "Answer", value: "blue" },
      ],
    });
    expect(source.drafts[0]?.totp?.secret).toBe(SECRET);
    expect(source.drafts[1]).toMatchObject({ type: "note", note: "the password is 12345" });
    expect(source.drafts[2]).toMatchObject({ title: "Login", password: undefined });
  });
});

describe("1Password parser", () => {
  const exportJson = {
    accounts: [
      {
        vaults: [
          {
            items: [
              {
                categoryUuid: "001",
                createdAt: 1_700_000_000,
                overview: {
                  title: "Банк",
                  url: "https://bank.example",
                  urls: [{ url: "https://bank.example" }, { url: "https://m.bank.example" }],
                },
                details: {
                  notesPlain: "note",
                  loginFields: [
                    { designation: "username", value: "ana" },
                    { designation: "password", value: TRICKY_PASSWORD },
                  ],
                  sections: [
                    {
                      fields: [
                        { id: "TOTP_abc", title: "one-time", value: { totp: TOTP_URI } },
                        { id: "q", title: "Security answer", value: { concealed: "blue" } },
                        { id: "e", title: "", value: { string: "   " } },
                      ],
                    },
                  ],
                  passwordHistory: [{ value: "old", time: 1_600_000_000 }, { value: "" }],
                },
              },
              { categoryUuid: "006", overview: { title: "A file" } },
              {
                categoryUuid: "002",
                overview: { title: "Visa" },
                details: {
                  sections: [
                    {
                      fields: [
                        { id: "ccnum", value: { creditCardNumber: "4111111111111111" } },
                        { id: "cvv", value: { concealed: "123" } },
                        { id: "expiry", value: { monthYear: 203001 } },
                        { id: "pin", value: { concealed: "0000" } },
                      ],
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  };

  it("puts each secret in its own field", () => {
    const source = onePasswordFromExport(exportJson);
    const [login, card] = source.drafts;
    expect(login).toMatchObject({
      title: "Банк",
      url: "https://bank.example",
      urls: ["https://m.bank.example"],
      username: "ana",
      password: TRICKY_PASSWORD,
      note: "note",
      createdAt: 1_700_000_000,
      passwordHistory: [{ password: "old", changedAt: 1_600_000_000 }],
      fields: [{ label: "Security answer", value: "blue", hidden: true }],
    });
    expect(login?.totp?.secret).toBe(SECRET);
    expect(card).toMatchObject({
      type: "card",
      cardNumber: "4111111111111111",
      cardCvv: "123",
      cardPin: "0000",
      cardExpiry: "01/30",
    });
    expect(source.skipped).toEqual({ other: 1 });
  });

  it("survives hostile shapes in every position", () => {
    for (const value of HOSTILE_VALUES) {
      const items = [
        value,
        { categoryUuid: value, overview: value, details: value },
        {
          categoryUuid: "001",
          overview: { title: value, url: value, urls: [value] },
          details: {
            loginFields: [value, { designation: "password", value }],
            sections: [value, { fields: [value, { id: value, value: { concealed: value } }] }],
            passwordHistory: [value],
            notesPlain: value,
          },
        },
      ];
      expect(() =>
        onePasswordFromExport({ accounts: [value, { vaults: [value, { items }] }] }),
      ).not.toThrow();
    }
    expectNoPollution();
  });

  it("does not throw on an out-of-range date field", () => {
    const parsed = {
      accounts: [
        {
          vaults: [
            {
              items: [
                {
                  categoryUuid: "001",
                  details: { sections: [{ fields: [{ id: "d", value: { date: 1e20 } }] }] },
                },
              ],
            },
          ],
        },
      ],
    };
    expect(() => onePasswordFromExport(parsed)).not.toThrow();
  });
});

describe("Proton Pass parser", () => {
  const exportJson = {
    encrypted: false,
    vaults: {
      personal: {
        items: [
          {
            createTime: 1_700_000_000,
            data: {
              type: "login",
              metadata: { name: "Mail 📧", note: "n" },
              content: {
                itemEmail: "ana@mail.example",
                itemUsername: "",
                password: TRICKY_PASSWORD,
                urls: ["https://mail.example", {}, ""],
                totpUri: TOTP_URI,
              },
              extraFields: [
                { fieldName: "Recovery", type: "hidden", data: { content: "r3c0very" } },
                { fieldName: "Backup 2FA", type: "totp", data: { totpUri: TOTP_URI } },
              ],
            },
          },
          { state: 2, data: { type: "login", metadata: { name: "Trashed" } } },
          { data: { type: "alias", metadata: { name: "alias" } } },
          {
            data: {
              type: "creditCard",
              metadata: { name: "Visa" },
              content: {
                cardholderName: "Ana",
                number: "4111-1111-1111-1111",
                verificationNumber: "999",
                expirationDate: "2030-01",
                pin: "0000",
              },
            },
          },
        ],
      },
    },
  };

  it("puts each secret in its own field", async () => {
    const source = await protonFromJson(exportJson);
    const [login, card] = source.drafts;
    expect(login).toMatchObject({
      title: "Mail 📧",
      url: "https://mail.example",
      username: "ana@mail.example",
      password: TRICKY_PASSWORD,
      note: "n",
      createdAt: 1_700_000_000,
      fields: [{ label: "Recovery", value: "r3c0very", hidden: true }],
    });
    expect(login?.urls).toBeUndefined();
    expect(login?.totp?.secret).toBe(SECRET);
    expect(card).toMatchObject({
      type: "card",
      cardNumber: "4111111111111111",
      cardCvv: "999",
      cardPin: "0000",
      cardExpiry: "01/30",
    });
    expect(source.skipped).toEqual({ trashed: 1, alias: 1 });
  });

  it("refuses an encrypted JSON export", async () => {
    expect(await importCode(protonFromJson({ encrypted: true, vaults: {} }))).toBe(
      "unsupported_encryption",
    );
  });

  it("survives hostile shapes in every position", async () => {
    for (const value of HOSTILE_VALUES) {
      const items = [
        value,
        { data: value, state: value, createTime: value },
        {
          data: {
            type: "login",
            metadata: value,
            content: { urls: value, passkeys: [value, { content: value }], sections: value },
            extraFields: [value, { fieldName: value, type: "totp", data: value }],
          },
        },
        {
          data: { type: "identity", content: { extraSections: [value], extraWorkDetails: value } },
        },
        { data: { type: "creditCard", content: { expirationDate: value } } },
      ];
      await expect(
        protonFromJson({ vaults: { a: value, b: { items }, c: { items: value } } }),
      ).resolves.toBeDefined();
    }
    expectNoPollution();
  });

  it("reads structured CSV notes and tolerates broken JSON in them", async () => {
    const source: ImportSource = await protonFromCsv([
      {
        type: "creditCard",
        name: "Visa",
        note: JSON.stringify({ number: "4111111111111111", verificationNumber: "321", note: "x" }),
      },
      { type: "identity", name: "Me", note: "{not json" },
      { type: "login", name: "", url: "", password: "", username: "", email: "" },
      { type: "login", name: "Site", url: "https://a.example, https://b.example", password: "pw" },
    ]);
    expect(source.drafts[0]).toMatchObject({
      type: "card",
      cardNumber: "4111111111111111",
      cardCvv: "321",
      note: "x",
    });
    expect(source.drafts[1]).toMatchObject({ type: "identity", title: "Me" });
    expect(source.drafts[2]).toMatchObject({ url: "https://a.example", password: "pw" });
    expect(source.skipped).toEqual({ other: 1 });
  });
});

describe("generic CSV parser", () => {
  it("detects only files with a password column and a title or URL", () => {
    expect(isGenericCsv(["name", "password"])).toBe(true);
    expect(isGenericCsv(["url", "pass"])).toBe(true);
    expect(isGenericCsv(["name", "username"])).toBe(false);
    expect(isGenericCsv(["password"])).toBe(false);
  });

  it("keeps quoting, unicode and whitespace in secrets intact", async () => {
    const csv = [
      "﻿Title,URL,Username,Password,TOTP,Notes",
      `"Acme, Inc. — ☃",https://acme.example,"  ana  ","${TRICKY_PASSWORD.replaceAll('"', '""')}",${TOTP_URI},"multi`,
      `line ""note"""`,
    ].join("\r\n");
    const source = await read(csv);
    expect(source.format).toBe("csv");
    expect(source.drafts).toHaveLength(1);
    expect(source.drafts[0]).toMatchObject({
      title: "Acme, Inc. — ☃",
      url: "https://acme.example",
      username: "ana",
      password: TRICKY_PASSWORD,
      note: 'multi\r\nline "note"',
    });
    expect(source.drafts[0]?.totp?.secret).toBe(SECRET);
  });

  it("names a login after its site, then its username, and skips empty rows", () => {
    const header = ["url", "username", "password"];
    const source = genericCsv(header, [
      { url: "https://www.example.co.uk/login https://other.example", username: "", password: "x" },
      { url: "", username: "ana", password: "y" },
      { url: "", username: "", password: "" },
      { url: "", username: "", password: "z" },
    ]);
    expect(source.drafts.map((draft) => [draft.title, draft.url, draft.password])).toEqual([
      ["example.co.uk", "https://www.example.co.uk/login", "x"],
      ["ana", undefined, "y"],
      ["Login", undefined, "z"],
    ]);
  });

  it("hides an unreadable 2FA value instead of putting it in plain text", () => {
    const source = genericCsv(
      ["title", "password", "totp"],
      [{ title: "A", password: "p", totp: "not a secret!" }],
    );
    expect(source.drafts[0]?.totp).toBeUndefined();
    expect(source.drafts[0]?.fields).toEqual([
      { label: "2FA", value: "not a secret!", hidden: true },
    ]);
  });

  it("copes with ragged rows and an unterminated quote", async () => {
    const ragged = await read("name,url,password\nOnly name\nA,https://a.example,p,extra,cells\n");
    expect(ragged.drafts.map((draft) => draft.title)).toEqual(["Only name", "A"]);
    const open = await read('name,password\n"unterminated,secret\nnext,row');
    expect(open.drafts).toHaveLength(1);
    expect(open.drafts[0]?.title).toBe("unterminated,secret\nnext,row");
  });

  it("does not let header names reach the object prototype", async () => {
    const source = await read("__proto__,constructor,name,password\nx,y,Site,pw\n");
    expect(source.drafts[0]).toMatchObject({ title: "Site", password: "pw" });
    expectNoPollution();
  });

  it("rejects files that are neither a known export nor recovery codes", async () => {
    for (const text of [
      "",
      "name,username\nA,b",
      "{",
      '{"hello": "world"}',
      "[1,2,3]",
      "\u0000\u0001\u0002",
    ]) {
      expect(await importCode(read(text)), JSON.stringify(text)).toMatch(
        /^(unrecognized|damaged)$/,
      );
    }
  });
});
