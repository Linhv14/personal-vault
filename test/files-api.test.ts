import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes, toBase64 } from "../src/core/bytes.js";
import { durableNamespace, memoryBucket } from "./durable-storage.js";
import { addOrg, signedInAccount } from "./sso-harness.js";
import { setTime, startWorker, T0, type TestWorker } from "./worker-harness.js";

let worker: TestWorker;
let bucket: ReturnType<typeof memoryBucket>;
interface FileStore {
  alarm(): Promise<void>;
}

const STORE = new URL("../src/worker/user-vault-object.ts", import.meta.url).href;
const { UserStore } = (await import(STORE)) as {
  UserStore: new (ctx: unknown, env: unknown) => FileStore;
};

let users: ReturnType<typeof durableNamespace<FileStore>>;

async function start(vars: Record<string, unknown> = {}, withBucket = true) {
  bucket = memoryBucket();
  users = durableNamespace((state) => new UserStore({ storage: state.storage }, worker.env));
  worker = await startWorker({
    vars: { USER_STORE: users.binding, ...(withBucket ? { FILES: bucket.binding } : {}), ...vars },
  });
}

const uuid = () => crypto.randomUUID();

function upload(token: string, id: string, item: string, bytes = randomBytes(64)) {
  return worker.fetch(`/api/files/${id}?item=${item}`, {
    method: "PUT",
    token,
    body: bytes,
    headers: { "Content-Length": String(bytes.length) },
  });
}

function saveItem(token: string, id: string) {
  return worker.fetch(`/api/items/${id}`, {
    method: "PUT",
    token,
    json: { ciphertext: toBase64(randomBytes(40)), nonce: toBase64(randomBytes(12)) },
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  setTime(T0);
});

afterEach(() => vi.useRealTimers());

describe("file attachments API", () => {
  it("reports the mode in /api/config", async () => {
    await start();
    expect(await (await worker.fetch("/api/config")).json()).toMatchObject({ attachments: "all" });
    await start({}, false);
    expect(await (await worker.fetch("/api/config")).json()).toMatchObject({ attachments: "off" });
    const ana = await signedInAccount(worker, "ana@acme.com");
    expect((await upload(ana.token, uuid(), uuid())).status).toBe(404);
  });

  it("stores a sealed file and gives it back only to its owner", async () => {
    await start();
    const ana = await signedInAccount(worker, "ana@acme.com");
    const bo = await signedInAccount(worker, "bo@acme.com");
    const id = uuid();
    const bytes = randomBytes(5000);
    const put = await upload(ana.token, id, uuid(), bytes);
    expect(put.status).toBe(201);
    expect(bucket.objects.has(`a/${ana.id}/${id}`)).toBe(true);
    const got = await worker.fetch(`/api/files/${id}`, { token: ana.token });
    expect(got.headers.get("Cache-Control")).toBe("private, no-store");
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes);
    expect((await worker.fetch(`/api/files/${id}`, { token: bo.token })).status).toBe(404);
    expect(
      (await worker.fetch(`/api/files/${id}`, { method: "DELETE", token: bo.token })).status,
    ).toBe(404);
    expect((await upload(ana.token, id, uuid())).status).toBe(409);
  });

  it("enforces the size, per-item and per-account limits", async () => {
    await start({ FILE_MAX_BYTES: "1000", ACCOUNT_FILES_BYTES: "3000" });
    const ana = await signedInAccount(worker, "ana@acme.com");
    expect((await upload(ana.token, uuid(), uuid(), randomBytes(2000))).status).toBe(413);
    const item = uuid();
    for (let i = 0; i < 3; i++) {
      expect((await upload(ana.token, uuid(), item, randomBytes(900))).status).toBe(201);
    }
    const full = await upload(ana.token, uuid(), uuid(), randomBytes(900));
    expect(full.status).toBe(403);
    expect(await full.json()).toMatchObject({ code: "files.quota_exceeded" });
    expect((await upload(ana.token, "not-a-uuid", item)).status).toBe(400);
  });

  it("refuses uploads on the paid mode until the account is in a paid organization", async () => {
    await start({ ATTACHMENTS: "paid" });
    const ana = await signedInAccount(worker, "ana@acme.com");
    const refused = await upload(ana.token, uuid(), uuid());
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "files.plan_required" });
    addOrg(worker, "11111111-1111-4111-8111-111111111111", "free", [[ana.id, "owner"]]);
    expect((await upload(ana.token, uuid(), uuid())).status).toBe(403);
    addOrg(worker, "22222222-2222-4222-8222-222222222222", "team", [[ana.id, "member"]]);
    expect((await upload(ana.token, uuid(), uuid())).status).toBe(201);
  });

  it("deletes a file on its own, and every file of an item deleted for good", async () => {
    await start();
    const ana = await signedInAccount(worker, "ana@acme.com");
    const item = uuid();
    expect((await saveItem(ana.token, item)).status).toBe(200);
    const [first, second, single] = [uuid(), uuid(), uuid()];
    await upload(ana.token, first, item);
    await upload(ana.token, second, item);
    await upload(ana.token, single, uuid());
    expect(
      (await worker.fetch(`/api/files/${single}`, { method: "DELETE", token: ana.token })).status,
    ).toBe(200);
    expect(bucket.objects.has(`a/${ana.id}/${single}`)).toBe(false);
    expect(
      (await worker.fetch(`/api/items/${item}`, { method: "DELETE", token: ana.token })).status,
    ).toBe(200);
    expect([...bucket.objects.keys()]).toEqual([]);
  });

  it("removes files left without a live item after a day, and keeps attached ones", async () => {
    await start();
    const ana = await signedInAccount(worker, "ana@acme.com");
    const item = uuid();
    await saveItem(ana.token, item);
    const kept = uuid();
    const orphan = uuid();
    await upload(ana.token, kept, item);
    await upload(ana.token, orphan, uuid());
    const store = users.binding.get(`user:${ana.id}`);
    const state = users.state(`user:${ana.id}`);
    expect(state.alarmAt()).toBe((T0 + 24 * 3600) * 1000);
    setTime(T0 + 24 * 3600 + 5);
    await store.alarm();
    expect(bucket.objects.has(`a/${ana.id}/${kept}`)).toBe(true);
    expect(bucket.objects.has(`a/${ana.id}/${orphan}`)).toBe(false);
  });

  it("deletes every file with the account", async () => {
    await start();
    const ana = await signedInAccount(worker, "ana@acme.com");
    await upload(ana.token, uuid(), uuid());
    await upload(ana.token, uuid(), uuid());
    expect(bucket.objects.size).toBe(2);
    const deleted = await worker.fetch("/api/auth/delete-account", {
      method: "POST",
      token: ana.token,
      json: { currentAuthKey: ana.record.authKey },
    });
    expect(deleted.status).toBe(200);
    expect(bucket.objects.size).toBe(0);
  });
});
