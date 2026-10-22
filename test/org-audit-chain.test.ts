import { describe, expect, it } from "vitest";
import type { AuditEvent } from "../src/core/org-model.js";
import { chainHash, chainInput, GENESIS, verifyChain } from "../src/worker/orgs/audit-chain.js";

const recorded: AuditEvent[] = [
  {
    seq: 1,
    at: 1700000014,
    actor: "owner",
    action: "org.created",
    target: "owner",
    ip: "1.1.1.1",
    hash: "uvACLpk6dLAxyeUL+SbCYik79vyhbZf1ggOsFblqTBI=",
  },
  {
    seq: 2,
    at: 1700000021,
    actor: "owner",
    action: "member.added",
    target: "admin",
    ip: null,
    hash: "TApNKUbmETKOuqLVY/MzcJFo83v/dVCD8jYWb8ZEVNk=",
  },
];

describe("audit hash chain", () => {
  it("hashes the previous hash and the event fields in a fixed order", () => {
    expect(
      chainInput(GENESIS, {
        ip: "203.0.113.7",
        target: "t1",
        action: "team.created",
        actor: "owner",
        at: 1700000000,
      }),
    ).toBe(
      'genesis\n{"at":1700000000,"actor":"owner","action":"team.created","target":"t1","ip":"203.0.113.7"}',
    );
  });

  it("produces the stored SHA-256 base64 digests", async () => {
    const first = await chainHash(GENESIS, {
      at: 1700000000,
      actor: "owner",
      action: "team.created",
      target: "t1",
      ip: "203.0.113.7",
    });
    expect(first).toBe("YwCd6vCg9By/p9XtbMRI7YpBOSJMw+IuCja1iW2vRho=");
    const second = await chainHash(first, {
      at: 1700000060,
      actor: "github:o/r@refs/heads/main",
      action: "ci.read",
      target: null,
      ip: null,
    });
    expect(second).toBe("kW9MHx3vq7LBC84lUQYZGerR4+Lu1xqvGuWf1EupP+0=");
  });

  it("ignores the sequence number and stored hash of the event itself", async () => {
    const [event] = recorded;
    expect(await chainHash(GENESIS, event!)).toBe(event!.hash);
  });

  it("verifies a recorded chain from genesis in any order", async () => {
    expect(await verifyChain(GENESIS, recorded)).toBe(true);
    expect(await verifyChain(GENESIS, [...recorded].reverse())).toBe(true);
  });

  it("verifies a page that starts after the first event", async () => {
    expect(await verifyChain(recorded[0]!.hash, recorded.slice(1))).toBe(true);
  });

  it("accepts an empty page", async () => {
    expect(await verifyChain("anything", [])).toBe(true);
  });

  it("rejects a tampered field", async () => {
    const tampered = recorded.map((event) =>
      event.seq === 2 ? { ...event, target: "someone-else" } : event,
    );
    expect(await verifyChain(GENESIS, tampered)).toBe(false);
  });

  it("rejects a page anchored to the wrong previous hash", async () => {
    expect(await verifyChain(GENESIS, recorded.slice(1))).toBe(false);
  });

  it("rejects a removed event in the middle of the chain", async () => {
    const third: AuditEvent = {
      seq: 3,
      at: 1700000030,
      actor: "owner",
      action: "note",
      target: null,
      ip: null,
      hash: await chainHash(recorded[1]!.hash, {
        at: 1700000030,
        actor: "owner",
        action: "note",
        target: null,
        ip: null,
      }),
    };
    expect(await verifyChain(GENESIS, [...recorded, third])).toBe(true);
    expect(await verifyChain(GENESIS, [recorded[0]!, third])).toBe(false);
  });
});
