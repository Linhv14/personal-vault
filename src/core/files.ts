import { concat, randomBytes, utf8Encode, type Bytes } from "./bytes.js";
import { importVaultKey } from "./crypto.js";
import { VaultError } from "./errors.js";

export const FILE_CHUNK_BYTES = 1024 * 1024;
export const FILE_FORMAT_VERSION = 1;
const TAG_BYTES = 16;
const NONCE_BYTES = 12;

export function createFileKey(): Bytes {
  return randomBytes(32);
}

function chunkNonce(index: number): Bytes {
  const nonce = new Uint8Array(NONCE_BYTES);
  new DataView(nonce.buffer).setBigUint64(4, BigInt(index));
  return nonce;
}

function chunkContext(fileId: string, index: number, last: boolean): Bytes {
  return utf8Encode(`personal-vault/file/${fileId}/${index}/${last ? 1 : 0}`);
}

export function sealedFileSize(plaintextBytes: number): number {
  const chunks = Math.max(1, Math.ceil(plaintextBytes / FILE_CHUNK_BYTES));
  return 1 + plaintextBytes + chunks * TAG_BYTES;
}

export async function sealFile(key: Bytes, fileId: string, plaintext: Bytes): Promise<Bytes> {
  const aes = await importVaultKey(key);
  const chunks = Math.max(1, Math.ceil(plaintext.length / FILE_CHUNK_BYTES));
  const sealed: Bytes[] = [Uint8Array.of(FILE_FORMAT_VERSION)];
  for (let index = 0; index < chunks; index++) {
    const part = plaintext.subarray(index * FILE_CHUNK_BYTES, (index + 1) * FILE_CHUNK_BYTES);
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: chunkNonce(index),
        additionalData: chunkContext(fileId, index, index === chunks - 1),
      },
      aes,
      part,
    );
    sealed.push(new Uint8Array(ciphertext));
  }
  return concat(...sealed);
}

export async function openFile(key: Bytes, fileId: string, sealed: Bytes): Promise<Bytes> {
  if (sealed.length < 1 + TAG_BYTES || sealed[0] !== FILE_FORMAT_VERSION) {
    throw new VaultError("crypto.bad_file");
  }
  const aes = await importVaultKey(key);
  const body = sealed.subarray(1);
  const stride = FILE_CHUNK_BYTES + TAG_BYTES;
  const chunks = Math.ceil(body.length / stride);
  const parts: Bytes[] = [];
  for (let index = 0; index < chunks; index++) {
    const part = body.subarray(index * stride, (index + 1) * stride);
    if (part.length < TAG_BYTES) {
      throw new VaultError("crypto.bad_file");
    }
    try {
      const plain = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: chunkNonce(index),
          additionalData: chunkContext(fileId, index, index === chunks - 1),
        },
        aes,
        part,
      );
      parts.push(new Uint8Array(plain));
    } catch {
      throw new VaultError("crypto.bad_file");
    }
  }
  return concat(...parts);
}
