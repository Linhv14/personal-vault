import { describe, expect, it } from "vitest";
import { randomBytes, utf8Encode } from "../src/core/bytes.js";
import {
  createFileKey,
  FILE_CHUNK_BYTES,
  openFile,
  sealedFileSize,
  sealFile,
} from "../src/core/files.js";

const ID = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-2222-4333-8444-555555555555";

function sample(bytes: number): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(bytes);
  for (let offset = 0; offset < bytes; offset += 65536) {
    data.set(randomBytes(Math.min(65536, bytes - offset)), offset);
  }
  return data;
}

describe("file encryption", () => {
  it("round-trips empty, small, exact-chunk and multi-chunk files", async () => {
    const key = createFileKey();
    for (const size of [
      0,
      1,
      4096,
      FILE_CHUNK_BYTES,
      FILE_CHUNK_BYTES + 1,
      2 * FILE_CHUNK_BYTES + 7,
    ]) {
      const plain = sample(size);
      const sealed = await sealFile(key, ID, plain);
      expect(sealed.length, String(size)).toBe(sealedFileSize(size));
      expect(Buffer.from(await openFile(key, ID, sealed)).equals(Buffer.from(plain))).toBe(true);
    }
  });

  it("refuses a wrong key, another file's id and a flipped bit", async () => {
    const key = createFileKey();
    const sealed = await sealFile(key, ID, utf8Encode("passport scan"));
    await expect(openFile(createFileKey(), ID, sealed)).rejects.toMatchObject({
      code: "crypto.bad_file",
    });
    await expect(openFile(key, OTHER, sealed)).rejects.toMatchObject({ code: "crypto.bad_file" });
    const flipped = sealed.slice();
    flipped[5]! ^= 1;
    await expect(openFile(key, ID, flipped)).rejects.toMatchObject({ code: "crypto.bad_file" });
  });

  it("refuses a file cut short at a chunk boundary, or with chunks swapped", async () => {
    const key = createFileKey();
    const sealed = await sealFile(key, ID, sample(2 * FILE_CHUNK_BYTES + 100));
    const stride = FILE_CHUNK_BYTES + 16;
    const truncated = sealed.subarray(0, 1 + 2 * stride);
    await expect(openFile(key, ID, truncated)).rejects.toMatchObject({ code: "crypto.bad_file" });
    const swapped = sealed.slice();
    swapped.set(sealed.subarray(1 + stride, 1 + 2 * stride), 1);
    swapped.set(sealed.subarray(1, 1 + stride), 1 + stride);
    await expect(openFile(key, ID, swapped)).rejects.toMatchObject({ code: "crypto.bad_file" });
  });

  it("refuses an unknown format version and a body too short to hold a tag", async () => {
    const key = createFileKey();
    const sealed = await sealFile(key, ID, utf8Encode("x"));
    const versioned = sealed.slice();
    versioned[0] = 2;
    await expect(openFile(key, ID, versioned)).rejects.toMatchObject({ code: "crypto.bad_file" });
    await expect(openFile(key, ID, sealed.subarray(0, 10))).rejects.toMatchObject({
      code: "crypto.bad_file",
    });
  });
});
