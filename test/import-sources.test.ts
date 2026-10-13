import { createCipheriv, createHmac, pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { planImport } from "../extension/lib/import/plan.js";
import { readExport } from "../extension/lib/import/read-export.js";
import { fromBase64Url, toBase64Url } from "../extension/lib/passkey/base64url.js";
import { makeZip } from "./zip-fixture.js";

const TOTP_URI = "otpauth://totp/GitHub:me?secret=JBSWY3DPEHPK3PXP&issuer=GitHub";
const encode = (content: string) => new TextEncoder().encode(content);

function read(bytes: Uint8Array, name = "export", passphrase?: string) {
  return readExport({ name, bytes, passphrase, recoveryTitle: "Recovery codes" });
}

function bitwardenProtected(password: string, plaintext: string, kdfType = 0): string {
  const salt = randomBytes(16).toString("base64");
  const iterations = 1000;
  const master = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const expand = (info: string) =>
    createHmac("sha256", master)
      .update(Buffer.concat([Buffer.from(info), Buffer.from([1])]))
      .digest();
  const [encryption, mac] = [expand("enc"), expand("mac")];
  const seal = (text: string) => {
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-cbc", encryption, iv);
    const data = Buffer.concat([cipher.update(text), cipher.final()]);
    const tag = createHmac("sha256", mac)
      .update(Buffer.concat([iv, data]))
      .digest();
    return `2.${iv.toString("base64")}|${data.toString("base64")}|${tag.toString("base64")}`;
  };
  return JSON.stringify({
    encrypted: true,
    passwordProtected: true,
    salt,
    kdfType,
    kdfIterations: iterations,
    encKeyValidation_DO_NOT_EDIT: seal(randomUUID()),
    data: seal(plaintext),
  });
}

async function passkeyKeys() {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keys.privateKey));
  return { publicKey: keys.publicKey, keyValue: toBase64Url(pkcs8) };
}

async function bitwardenExport() {
  const { publicKey, keyValue } = await passkeyKeys();
  const json = JSON.stringify({
    encrypted: false,
    folders: [],
    items: [
      {
        type: 1,
        name: "GitHub",
        notes: "work",
        creationDate: "2024-01-02T03:04:05.000Z",
        fields: [
          { name: "PIN", value: "1234", type: 1 },
          { name: "linked", value: null, type: 3, linkedId: 100 },
        ],
        login: {
          uris: [{ uri: "https://github.com/login" }, { uri: "https://gist.github.com" }],
          username: "octocat",
          password: "hunter2",
          totp: TOTP_URI,
          fido2Credentials: [
            {
              credentialId: "8c6ae6a4-3a53-4b6e-9f25-0f8a1d9bbc11",
              keyType: "public-key",
              keyAlgorithm: "ECDSA",
              keyCurve: "P-256",
              keyValue,
              rpId: "github.com",
              userHandle: "dXNlci1oYW5kbGU",
              userName: "octocat",
              counter: "0",
              discoverable: "true",
              creationDate: "2024-01-02T03:04:05.000Z",
            },
          ],
        },
      },
      { type: 2, name: "Recipe", notes: "flour", secureNote: { type: 0 } },
      {
        type: 3,
        name: "Visa",
        card: {
          cardholderName: "Jane Doe",
          brand: "Visa",
          number: "4111 1111 1111 1111",
          expMonth: "4",
          expYear: "2027",
          code: "123",
        },
      },
      {
        type: 4,
        name: "Home",
        identity: {
          firstName: "Jane",
          lastName: "Doe",
          address1: "1 Main St",
          address2: "Apt 2",
          city: "Hanoi",
          country: "VN",
          passportNumber: "B1234567",
        },
      },
      { type: 6, name: "Bank account" },
    ],
  });
  return { json, publicKey };
}

describe("Bitwarden", () => {
  it("reads every type from an unencrypted JSON export, passkey included", async () => {
    const { json, publicKey } = await bitwardenExport();
    const source = await read(encode(json));
    expect(source.format).toBe("bitwarden");
    expect(source.skipped).toEqual({ other: 1 });
    const [login, note, card, identity] = source.drafts;

    expect(login).toMatchObject({
      title: "GitHub",
      url: "https://github.com/login",
      username: "octocat",
      password: "hunter2",
      createdAt: 1704164645,
    });
    expect(login?.totp?.secret).toBe("JBSWY3DPEHPK3PXP");
    expect(login?.note).toBe("work\n\nWebsites:\nhttps://gist.github.com\n\nPIN: 1234");
    expect(login?.passkey).toMatchObject({
      credentialId: toBase64Url(
        Uint8Array.from(Buffer.from("8c6ae6a43a534b6e9f250f8a1d9bbc11", "hex")),
      ),
      rpId: "github.com",
      userHandle: "dXNlci1oYW5kbGU",
      userName: "octocat",
    });
    const signingKey = await crypto.subtle.importKey(
      "pkcs8",
      fromBase64Url(login?.passkey?.privateKey ?? ""),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
    const message = encode("challenge");
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      signingKey,
      message,
    );
    expect(
      await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, signature, message),
    ).toBe(true);

    expect(note).toMatchObject({ type: "note", title: "Recipe", note: "flour" });
    expect(card).toMatchObject({
      type: "card",
      cardholder: "Jane Doe",
      cardNumber: "4111111111111111",
      cardExpiry: "04/27",
      cardCvv: "123",
      note: "Brand: Visa",
    });
    expect(identity).toMatchObject({
      type: "identity",
      fullName: "Jane Doe",
      address: "1 Main St\nApt 2",
      city: "Hanoi",
      country: "VN",
      note: "Passport number: B1234567",
    });
  });

  it("opens a password-protected export and rejects a wrong password", async () => {
    const { json } = await bitwardenExport();
    const file = encode(bitwardenProtected("export password", json));
    await expect(read(file)).rejects.toMatchObject({ code: "needs_passphrase" });
    await expect(read(file, "export", "wrong")).rejects.toMatchObject({
      code: "wrong_passphrase",
    });
    const source = await read(file, "export", "export password");
    expect(source.drafts.map((draft) => draft.title)).toEqual(["GitHub", "Recipe", "Visa", "Home"]);
  });

  it("explains exports it cannot open", async () => {
    const argon = encode(bitwardenProtected("pw", "{}", 1));
    await expect(read(argon, "export", "pw")).rejects.toMatchObject({ code: "argon2" });
    const accountBound = encode(
      JSON.stringify({ encrypted: true, encKeyValidation_DO_NOT_EDIT: "2.a|b|c", items: [] }),
    );
    await expect(read(accountBound)).rejects.toMatchObject({ code: "account_encrypted" });
  });

  it("reads the CSV export", async () => {
    const csv = [
      "folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp",
      `,,login,GitHub,,"PIN: 1234",0,https://github.com,octocat,hunter2,${TOTP_URI}`,
      ",,note,Recipe,flour,,0,,,,",
    ].join("\n");
    const source = await read(encode(csv));
    expect(source.format).toBe("bitwarden");
    expect(source.drafts).toMatchObject([
      { title: "GitHub", url: "https://github.com", username: "octocat", note: "PIN: 1234" },
      { type: "note", title: "Recipe", note: "flour" },
    ]);
  });
});

describe("1Password", () => {
  const field = (id: string, title: string, value: Record<string, unknown>) => ({
    id,
    title,
    value,
  });
  const exportData = {
    accounts: [
      {
        attrs: { name: "Me" },
        vaults: [
          {
            attrs: { name: "Private" },
            items: [
              {
                uuid: "1",
                createdAt: 1700000000,
                state: "active",
                categoryUuid: "001",
                overview: {
                  title: "GitHub",
                  url: "https://github.com",
                  urls: [{ url: "https://github.com" }, { url: "https://gist.github.com" }],
                },
                details: {
                  loginFields: [
                    { designation: "username", value: "octocat", fieldType: "T" },
                    { designation: "password", value: "hunter2", fieldType: "P" },
                  ],
                  notesPlain: "work",
                  sections: [
                    {
                      title: "",
                      fields: [
                        field("TOTP_abc", "one-time password", { totp: TOTP_URI }),
                        field("pin", "PIN", { concealed: "1234" }),
                      ],
                    },
                  ],
                },
              },
              {
                uuid: "2",
                state: "active",
                categoryUuid: "002",
                overview: { title: "Visa" },
                details: {
                  sections: [
                    {
                      title: "",
                      fields: [
                        field("cardholder", "cardholder name", { string: "Jane Doe" }),
                        field("ccnum", "number", { creditCardNumber: "4111111111111111" }),
                        field("cvv", "verification number", { concealed: "123" }),
                        field("expiry", "expiry date", { monthYear: 202704 }),
                        field("type", "type", { creditCardType: "visa" }),
                      ],
                    },
                  ],
                },
              },
              {
                uuid: "3",
                state: "active",
                categoryUuid: "004",
                overview: { title: "Home" },
                details: {
                  sections: [
                    {
                      title: "Identification",
                      fields: [
                        field("firstname", "first name", { string: "Jane" }),
                        field("lastname", "last name", { string: "Doe" }),
                        field("email", "email", {
                          email: { email_address: "jane@example.com", provider: null },
                        }),
                        field("address", "address", {
                          address: {
                            street: "1 Main St",
                            city: "Hanoi",
                            country: "vn",
                            zip: "100000",
                            state: "",
                          },
                        }),
                        field("birthdate", "birth date", { date: 631152000 }),
                      ],
                    },
                  ],
                },
              },
              {
                uuid: "4",
                state: "active",
                categoryUuid: "109",
                overview: { title: "Home Wi-Fi" },
                details: {
                  sections: [
                    {
                      title: "",
                      fields: [
                        field("network_name", "network name", { string: "HomeNet" }),
                        field("wireless_password", "wireless network password", {
                          concealed: "wifi-pass",
                        }),
                      ],
                    },
                  ],
                },
              },
              {
                uuid: "5",
                state: "archived",
                categoryUuid: "003",
                overview: { title: "Recipe" },
                details: { notesPlain: "flour" },
              },
              {
                uuid: "6",
                state: "active",
                categoryUuid: "006",
                overview: { title: "Scan.pdf" },
                details: {},
              },
            ],
          },
        ],
      },
    ],
  };

  it("reads a .1pux archive", async () => {
    const archive = await makeZip({ "export.data": JSON.stringify(exportData) }, 8);
    const source = await read(archive, "1PasswordExport.1pux");
    expect(source.format).toBe("1password");
    expect(source.skipped).toEqual({ other: 1 });
    const [login, card, identity, wifi, note] = source.drafts;
    expect(login).toMatchObject({
      title: "GitHub",
      url: "https://github.com",
      username: "octocat",
      password: "hunter2",
      createdAt: 1700000000,
      note: "work\n\nWebsites:\nhttps://gist.github.com\n\nPIN: 1234",
    });
    expect(login?.totp?.secret).toBe("JBSWY3DPEHPK3PXP");
    expect(card).toMatchObject({
      type: "card",
      cardholder: "Jane Doe",
      cardNumber: "4111111111111111",
      cardExpiry: "04/27",
      cardCvv: "123",
      note: "type: visa",
    });
    expect(identity).toMatchObject({
      type: "identity",
      fullName: "Jane Doe",
      email: "jane@example.com",
      address: "1 Main St",
      city: "Hanoi",
      postalCode: "100000",
      country: "vn",
      note: "birth date: 1990-01-01",
    });
    expect(wifi).toMatchObject({ type: "wifi", ssid: "HomeNet", password: "wifi-pass" });
    expect(note).toMatchObject({ type: "note", title: "Recipe", note: "flour" });
  });

  it("reads the CSV export", async () => {
    const csv = [
      "Title,Url,Username,Password,OTPAuth,Favorite,Archived,Tags,Notes",
      `GitHub,https://github.com,octocat,hunter2,${TOTP_URI},false,false,,work`,
    ].join("\n");
    const source = await read(encode(csv));
    expect(source.format).toBe("csv");
    expect(source.drafts).toMatchObject([
      { title: "GitHub", url: "https://github.com", username: "octocat", note: "work" },
    ]);
    expect(source.drafts[0]?.totp?.secret).toBe("JBSWY3DPEHPK3PXP");
  });
});

describe("other files", () => {
  it("reads a browser's password CSV", async () => {
    const csv = "name,url,username,password,note\n,https://github.com/login,octocat,hunter2,\n";
    const source = await read(encode(csv));
    expect(source.drafts).toMatchObject([
      { title: "github.com", url: "https://github.com/login", password: "hunter2" },
    ]);
  });

  it("turns a recovery codes file into one item named after it", async () => {
    const source = await read(encode("a1b2c-3d4e5\nf6a7b-8c9d0\n"), "github-recovery-codes.txt");
    expect(source).toEqual({
      format: "recovery",
      skipped: {},
      drafts: [{ type: "recovery", title: "Github", codes: ["a1b2c-3d4e5", "f6a7b-8c9d0"] }],
    });
    const again = planImport(source, [
      { id: "1", createdAt: 0, updatedAt: 0, ...source.drafts[0], title: "Github" },
    ]);
    expect(again.skipped).toEqual({ duplicate: 1 });
  });
});
