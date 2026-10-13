import { describe, expect, it } from "vitest";
import * as openpgp from "openpgp";
import { parseCsv } from "../extension/lib/import/csv.js";
import { readZip } from "../extension/lib/import/zip.js";
import { planImport } from "../extension/lib/import/plan.js";
import { readExport } from "../extension/lib/import/read-export.js";
import type { VaultItem } from "../extension/lib/vault.js";
import { makeZip } from "./zip-fixture.js";

const TOTP_URI = "otpauth://totp/GitHub:me@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub";

const protonJson = JSON.stringify({
  version: "1.30.0",
  userId: "u",
  encrypted: false,
  vaults: {
    share1: {
      name: "Personal",
      items: [
        {
          state: 1,
          createTime: 1700000000,
          data: {
            type: "login",
            metadata: { name: "GitHub", note: "work account" },
            extraFields: [{ fieldName: "PIN", type: "hidden", data: { content: "4242" } }],
            content: {
              itemEmail: "me@example.com",
              itemUsername: "octocat",
              password: "hunter2",
              urls: ["https://github.com/login", "https://gist.github.com"],
              totpUri: TOTP_URI,
            },
          },
        },
        {
          state: 1,
          data: {
            type: "login",
            metadata: { name: "Bank", note: "" },
            extraFields: [],
            content: {
              itemEmail: "",
              itemUsername: "0123",
              password: "s3cret",
              autofillUrls: [{ url: "https://bank.example", mode: 0 }],
              totpUri: "",
            },
          },
        },
        {
          state: 2,
          data: {
            type: "login",
            metadata: { name: "Old", note: "" },
            extraFields: [],
            content: {},
          },
        },
        {
          state: 1,
          aliasEmail: "x@alias.example",
          data: {
            type: "alias",
            metadata: { name: "Alias", note: "" },
            extraFields: [],
            content: {},
          },
        },
        {
          state: 1,
          data: {
            type: "creditCard",
            metadata: { name: "Visa", note: "" },
            extraFields: [],
            content: {
              cardholderName: "Jane Doe",
              number: "4111 1111 1111 1111",
              verificationNumber: "123",
              expirationDate: "2027-04",
              pin: "0000",
            },
          },
        },
        {
          state: 1,
          data: {
            type: "identity",
            metadata: { name: "Home address", note: "" },
            extraFields: [],
            content: {
              firstName: "Jane",
              lastName: "Doe",
              streetAddress: "1 Main St",
              city: "Hanoi",
              countryOrRegion: "Vietnam",
              passportNumber: "B1234567",
              extraAddressDetails: [{ fieldName: "Gate", type: "text", data: { content: "4" } }],
            },
          },
        },
        {
          state: 1,
          data: {
            type: "note",
            metadata: { name: "Recovery codes", note: "abc def" },
            extraFields: [],
            content: {},
          },
        },
        {
          state: 1,
          data: {
            type: "wifi",
            metadata: { name: "Home", note: "" },
            extraFields: [],
            content: { ssid: "home-5g", password: "wifi-pass" },
          },
        },
      ],
    },
  },
});

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, newlines in fields, CRLF and a BOM", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","he said ""hi""\nbye"\r\n')).toEqual([
      ["a", "b"],
      ["x, y", 'he said "hi"\nbye'],
    ]);
  });
});

function read(bytes: Uint8Array, passphrase?: string, name = "export") {
  return readExport({ name, bytes, passphrase, recoveryTitle: "Recovery codes" });
}

const encode = (content: string) => new TextEncoder().encode(content);

describe("readZip", () => {
  it.each([0, 8] as const)("reads entries stored with method %i", async (method) => {
    const entries = readZip(
      await makeZip({ "Proton Pass/data.json": "{}", "a.txt": "hello" }, method),
    );
    expect(entries.map((entry) => entry.name)).toEqual(["Proton Pass/data.json", "a.txt"]);
    expect(new TextDecoder().decode(await entries[1]!.read())).toBe("hello");
  });
});

describe("Proton Pass import", () => {
  it("reads the JSON inside an unencrypted export archive", async () => {
    const entries = await read(await makeZip({ "Proton Pass/data.json": protonJson }, 0));
    const plan = planImport(entries, []);

    expect(plan.items.map((item) => [item.type ?? "login", item.title])).toEqual([
      ["login", "GitHub"],
      ["login", "Bank"],
      ["card", "Visa"],
      ["identity", "Home address"],
      ["note", "Recovery codes"],
      ["wifi", "Home"],
    ]);
    expect(plan.skipped).toEqual({ trashed: 1, alias: 1 });

    const github = plan.items[0]!;
    expect(github).toMatchObject({
      url: "https://github.com/login",
      username: "octocat",
      password: "hunter2",
      createdAt: 1700000000,
    });
    expect(github.totp?.secret).toBe("JBSWY3DPEHPK3PXP");
    expect(github.note).toContain("work account");
    expect(github.note).toContain("Email: me@example.com");
    expect(github.note).toContain("https://gist.github.com");
    expect(github.note).toContain("PIN: 4242");
    expect(plan.items[1]).toMatchObject({ url: "https://bank.example", username: "0123" });
    expect(plan.items[2]).toMatchObject({
      cardholder: "Jane Doe",
      cardNumber: "4111111111111111",
      cardExpiry: "04/27",
      cardCvv: "123",
      cardPin: "0000",
    });
    expect(plan.items[3]).toMatchObject({
      fullName: "Jane Doe",
      address: "1 Main St",
      city: "Hanoi",
      country: "Vietnam",
    });
    expect(plan.items[3]!.note).toBe("Passport number: B1234567\n\nGate: 4");
    expect(plan.items[5]).toMatchObject({ ssid: "home-5g", password: "wifi-pass" });
  });

  it("reads a plain JSON export", async () => {
    const entries = await read(new TextEncoder().encode(protonJson));
    expect(planImport(entries, []).items).toHaveLength(6);
  });

  it("reads the CSV export", async () => {
    const csv = [
      "type,name,url,email,username,password,note,totp,createTime,modifyTime,vault",
      `login,GitHub,"https://github.com, https://gist.github.com",me@example.com,,hunter2,"multi\nline",${TOTP_URI},1700000000,1700000000,Personal`,
      "alias,Alias,,x@alias.example,,,,,1,1,Personal",
      `creditCard,Visa,,,,,"${JSON.stringify({ number: "4111111111111111", expirationDate: "2027-04", note: "travel" }).replaceAll('"', '""')}",,1,1,Personal`,
    ].join("\n");
    const plan = planImport(await read(new TextEncoder().encode(csv)), []);
    expect(plan.items).toHaveLength(2);
    expect(plan.items[1]).toMatchObject({
      type: "card",
      cardNumber: "4111111111111111",
      cardExpiry: "04/27",
      note: "travel",
    });
    expect(plan.items[0]).toMatchObject({
      title: "GitHub",
      url: "https://github.com",
      username: "me@example.com",
      password: "hunter2",
    });
    expect(plan.items[0]!.note).toContain("multi\nline");
    expect(plan.skipped).toEqual({ alias: 1 });
  });

  it("skips logins already in the vault and duplicates within the file", async () => {
    const existing = [
      {
        id: "1",
        title: "GitHub",
        url: "https://github.com",
        username: "octocat",
        password: "hunter2",
      },
    ] as VaultItem[];
    const source = await read(encode(protonJson));
    const plan = planImport({ ...source, drafts: [...source.drafts, ...source.drafts] }, existing);
    expect(plan.items.map((item) => item.title)).toEqual([
      "Bank",
      "Visa",
      "Home address",
      "Recovery codes",
      "Home",
    ]);
    expect(plan.skipped.duplicate).toBe(7);
  });

  it("opens the PGP-encrypted export with the export password", async () => {
    const armored = (await openpgp.encrypt({
      message: await openpgp.createMessage({ text: protonJson }),
      passwords: ["export password"],
      config: { aeadProtect: false, s2kIterationCountByte: 96 },
    })) as string;
    const archive = await makeZip({ "Proton Pass/data.pgp": armored }, 0);

    await expect(read(archive)).rejects.toMatchObject({ code: "needs_passphrase" });
    await expect(read(archive, "wrong")).rejects.toMatchObject({
      code: "wrong_passphrase",
    });
    const entries = await read(archive, "export password");
    expect(planImport(entries, []).items).toHaveLength(6);
  });

  it("rejects files it does not recognize", async () => {
    await expect(read(encode("Nothing to see here."))).rejects.toMatchObject({
      code: "unrecognized",
    });
  });
});
