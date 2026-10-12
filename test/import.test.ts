import { describe, expect, it } from "vitest";
import { csvRecords, parseCsv } from "../extension/lib/import/csv.js";
import { readZip } from "../extension/lib/import/zip.js";
import {
  ImportError,
  planImport,
  readProtonPassExport,
} from "../extension/lib/import/protonpass.js";
import type { VaultItem } from "../extension/lib/vault.js";

const TOTP_URI = "otpauth://totp/GitHub:me@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub";

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(data)])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function makeZip(files: Record<string, string>, method: 0 | 8): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const raw = encoder.encode(content);
    const data = method === 8 ? await deflateRaw(raw) : raw;
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, method, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const directorySize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, directorySize, true);
  ev.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, end];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let position = 0;
  for (const part of parts) {
    out.set(part, position);
    position += part.length;
  }
  return out;
}

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
            content: { number: "4111" },
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

  it("maps rows to the header", () => {
    expect(csvRecords("name,password\nGitHub,pw\n")).toEqual([{ name: "GitHub", password: "pw" }]);
  });
});

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
    const entries = await readProtonPassExport(
      await makeZip({ "Proton Pass/data.json": protonJson }, 0),
    );
    const plan = planImport(entries, []);

    expect(plan.items.map((item) => item.title)).toEqual([
      "GitHub",
      "Bank",
      "Recovery codes",
      "Home",
    ]);
    expect(plan.skipped).toEqual({ trashed: 1, alias: 1, card: 1 });

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
    expect(plan.items[3]).toMatchObject({ username: "home-5g", password: "wifi-pass" });
  });

  it("reads a plain JSON export", async () => {
    const entries = await readProtonPassExport(new TextEncoder().encode(protonJson));
    expect(planImport(entries, []).items).toHaveLength(4);
  });

  it("reads the CSV export", async () => {
    const csv = [
      "type,name,url,email,username,password,note,totp,createTime,modifyTime,vault",
      `login,GitHub,"https://github.com, https://gist.github.com",me@example.com,,hunter2,"multi\nline",${TOTP_URI},1700000000,1700000000,Personal`,
      "alias,Alias,,x@alias.example,,,,,1,1,Personal",
    ].join("\n");
    const plan = planImport(await readProtonPassExport(new TextEncoder().encode(csv)), []);
    expect(plan.items).toHaveLength(1);
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
    const entries = await readProtonPassExport(new TextEncoder().encode(protonJson));
    const plan = planImport([...entries, ...entries], existing);
    expect(plan.items.map((item) => item.title)).toEqual(["Bank", "Recovery codes", "Home"]);
    expect(plan.skipped.duplicate).toBe(5);
  });

  it("explains an encrypted export instead of failing on it", async () => {
    await expect(
      readProtonPassExport(await makeZip({ "Proton Pass/data.pgp": "x" }, 0)),
    ).rejects.toMatchObject({ code: "encrypted" });
    await expect(
      readProtonPassExport(new TextEncoder().encode("-----BEGIN PGP MESSAGE-----")),
    ).rejects.toBeInstanceOf(ImportError);
  });

  it("rejects files that are not a Proton Pass export", async () => {
    await expect(
      readProtonPassExport(new TextEncoder().encode("url,user,pass\na,b,c")),
    ).rejects.toMatchObject({ code: "unrecognized" });
  });
});
