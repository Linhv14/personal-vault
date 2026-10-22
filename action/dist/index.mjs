// cli/ci-client.ts
import { randomBytes as randomBytes2 } from "node:crypto";
import { appendFile } from "node:fs/promises";

// src/core/bytes.ts
var textEncoder = new TextEncoder();
var textDecoder = new TextDecoder();
function utf8Encode(s) {
  return new Uint8Array(textEncoder.encode(s));
}
function utf8Decode(b) {
  return textDecoder.decode(b);
}
function toBase64(bytes) {
  let s = "";
  for (const byte of bytes) {
    s += String.fromCharCode(byte);
  }
  return btoa(s);
}
function fromBase64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    out[i] = s.charCodeAt(i);
  }
  return out;
}
function fromBase64Url(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - b64.length % 4) % 4);
  return fromBase64(padded);
}
function concat(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

// src/core/errors.ts
var VaultError = class extends Error {
  constructor(code, params = {}, developerMessage) {
    super(developerMessage ?? code);
    this.code = code;
    this.params = params;
    this.name = "VaultError";
  }
  code;
  params;
};

// src/core/json.ts
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/core/crypto.ts
var KEY_BYTES = 32;
function isSealedData(value) {
  return isPlainObject(value) && typeof value.ciphertext === "string" && typeof value.nonce === "string";
}
async function importAesKey(raw) {
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function open(key, sealed, associatedData) {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: fromBase64(sealed.nonce),
      ...associatedData && { additionalData: associatedData }
    },
    key,
    fromBase64(sealed.ciphertext)
  );
  return new Uint8Array(plaintext);
}
async function openJson(key, sealed, associatedData) {
  return JSON.parse(utf8Decode(await open(key, sealed, associatedData)));
}
async function importVaultKey(raw) {
  if (raw.length !== KEY_BYTES) {
    throw new VaultError("crypto.bad_key_length", {}, `Vault key must be ${KEY_BYTES} bytes`);
  }
  return importAesKey(raw);
}

// src/core/identity.ts
var CURVE = { name: "ECDH", namedCurve: "P-256" };
var WRAP_INFO = utf8Encode("personal-vault/key-wrap/v1");
function isWrappedForRecipient(value) {
  return isPlainObject(value) && typeof value.ephemeralPublicKey === "string" && isSealedData(value.sealed);
}
async function importPublic(spki) {
  return crypto.subtle.importKey("spki", fromBase64(spki), CURVE, false, []);
}
async function importPrivate(pkcs8) {
  return crypto.subtle.importKey("pkcs8", pkcs8, CURVE, false, ["deriveBits"]);
}
async function wrappingKey(privateKey, publicKey, ephemeral, recipient) {
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: publicKey },
      privateKey,
      256
    )
  );
  const material = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: concat(fromBase64(ephemeral), fromBase64(recipient)),
      info: WRAP_INFO
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}
async function unwrapForRecipient(identity, wrapped, context) {
  const key = await wrappingKey(
    await importPrivate(identity.privateKey),
    await importPublic(wrapped.ephemeralPublicKey),
    wrapped.ephemeralPublicKey,
    identity.publicKey
  );
  return open(key, wrapped.sealed, context);
}

// src/core/projects.ts
var MAX_SECRET_BYTES = 32 * 1024;
var MAX_PROJECT_BYTES = 8 * 1024;
function secretContext(address) {
  const { projectId, generation, environmentId, secretId } = address;
  return utf8Encode(
    `personal-vault/secret/${projectId}/${generation}/${environmentId}/${secretId}`
  );
}
async function openWithEnvironmentKey(key, address, sealed) {
  return openJson(await importVaultKey(key), sealed, secretContext(address));
}

// src/core/ci.ts
var REPO_KEY_PREFIX = "1pw1";
function decodeRepoKey(text) {
  const [prefix, publicKey, privateKey] = text.trim().split(".");
  if (prefix !== REPO_KEY_PREFIX || !publicKey || !privateKey) {
    throw new Error("Not a 7key repository key");
  }
  return { publicKey: toBase64(fromBase64Url(publicKey)), privateKey: fromBase64Url(privateKey) };
}
function parseLinkReference(text) {
  const [orgId, linkId, extra] = text.trim().split(".");
  return orgId && linkId && extra === void 0 ? { orgId, linkId } : null;
}
function linkKeyContext(linkId, generation) {
  return utf8Encode(`personal-vault/link-key/${linkId}/${generation}`);
}
function isCiResponse(value) {
  return isPlainObject(value) && typeof value.projectId === "string" && typeof value.environmentId === "string" && typeof value.generation === "number" && isWrappedForRecipient(value.wrappedKey) && Array.isArray(value.secrets) && value.secrets.every(
    (secret) => isPlainObject(secret) && typeof secret.id === "string" && isSealedData(secret.sealed)
  );
}
async function openCiResponse(repoKey, linkId, response) {
  const environmentKey = new Uint8Array(
    await unwrapForRecipient(
      decodeRepoKey(repoKey),
      response.wrappedKey,
      linkKeyContext(linkId, response.generation)
    )
  );
  const opened = await Promise.all(
    response.secrets.map(
      ({ id, sealed }) => openWithEnvironmentKey(
        environmentKey,
        {
          projectId: response.projectId,
          generation: response.generation,
          environmentId: response.environmentId,
          secretId: id
        },
        sealed
      )
    )
  );
  return opened.sort((a, b) => a.name.localeCompare(b.name));
}

// src/core/brand.ts
var DEFAULT_SERVER = "https://7key.online";

// cli/ci-client.ts
var CiError = class extends Error {
};
async function githubIdToken(audience, env = process.env, request = fetch) {
  const url = env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const bearer = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !bearer) {
    throw new CiError(
      "No GitHub OIDC token. Run inside GitHub Actions with `permissions: id-token: write`."
    );
  }
  const target = new URL(url);
  target.searchParams.set("audience", audience);
  const response = await request(target, { headers: { Authorization: `Bearer ${bearer}` } });
  if (!response.ok) {
    throw new CiError(`GitHub refused an OIDC token (${response.status})`);
  }
  const body = await response.json();
  const value = isPlainObject(body) ? body.value : void 0;
  if (typeof value !== "string" || !value) {
    throw new CiError("GitHub returned an empty OIDC token");
  }
  return value;
}
async function fetchSecrets(options) {
  const request = options.fetch ?? fetch;
  const reference = parseLinkReference(options.link);
  if (!reference) {
    throw new CiError("The link should look like <organization>.<link>");
  }
  const server = new URL(options.server).origin;
  const token = await githubIdToken(server, options.env, request);
  const response = await request(`${server}/api/ci/secrets`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ link: options.link })
  });
  if (!response.ok) {
    const { error } = await response.json().catch(() => ({}));
    throw new CiError(`7key refused the request (${response.status}): ${error ?? "unknown error"}`);
  }
  const body = await response.json();
  if (!isCiResponse(body)) {
    throw new CiError("7key sent a response this version cannot read; update the action");
  }
  return openCiResponse(options.repoKey, reference.linkId, body);
}
function maskCommands(secrets) {
  return secrets.filter((secret) => secret.kind !== "variable").flatMap((secret) => secret.value.split(/\r?\n/)).filter((line) => line.trim().length > 0).map((line) => `::add-mask::${line}`);
}
function githubEnvBlock(secrets) {
  return secrets.map(({ name, value }) => {
    const delimiter = `SEVENKEY_${randomBytes2(12).toString("hex")}`;
    return `${name}<<${delimiter}
${value}
${delimiter}
`;
  }).join("");
}
async function exportToGithubEnv(secrets, env = process.env, write = (line) => console.log(line)) {
  const file = env.GITHUB_ENV;
  if (!file) {
    throw new CiError("GITHUB_ENV is not set; this only works inside GitHub Actions");
  }
  for (const command of maskCommands(secrets)) {
    write(command);
  }
  await appendFile(file, githubEnvBlock(secrets));
}

// action/main.ts
function input(name) {
  return process.env[`INPUT_${name.toUpperCase()}`]?.trim() ?? "";
}
try {
  const secrets = await fetchSecrets({
    server: input("server") || DEFAULT_SERVER,
    link: input("link"),
    repoKey: input("key")
  });
  await exportToGithubEnv(secrets);
  process.stdout.write(`7key: loaded ${secrets.length} values into the job environment
`);
} catch (error) {
  process.stdout.write(
    `::error::7key: ${error instanceof Error ? error.message : String(error)}
`
  );
  process.exit(1);
}
