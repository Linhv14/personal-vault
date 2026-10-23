import { describe, expect, it } from "vitest";
import { findSiteMerges, mergedItem } from "../extension/lib/vault/site-merge.js";
import {
  labelFromTitle,
  loginForCodes,
  loginForPasskey,
} from "../extension/lib/vault/site-match.js";
import type { VaultItem } from "../extension/lib/vault/types.js";

const passkey = {
  credentialId: "AQID",
  rpId: "github.com",
  userHandle: "dQ",
  userName: "olivia-nw",
  userDisplayName: "Olivia",
  privateKey: "AA",
  createdAt: 1,
};

const login = (id: string, fields: Partial<VaultItem>): VaultItem => ({
  id,
  type: "login",
  title: id,
  createdAt: 1,
  updatedAt: 1,
  ...fields,
});

const github = login("github", {
  url: "https://github.com/login",
  username: "Olivia@Northwind.dev ",
  password: "Copper-Lantern-48-Fjord",
});
const githubPasskey = login("github-passkey", {
  url: "https://github.com",
  username: "olivia-nw",
  passkey,
  note: "made on the laptop",
});
const githubCodes: VaultItem = {
  createdAt: 1,
  updatedAt: 1,
  id: "github-codes",
  type: "recovery",
  title: "github-recovery-codes",
  codes: ["a1b2c-3d4e5", "f6g7h-8i9j0"],
  usedCodes: ["a1b2c-3d4e5"],
};

describe("matching a site", () => {
  it("reads the site out of a recovery codes title", () => {
    expect(labelFromTitle("github-recovery-codes")).toBe("github");
    expect(labelFromTitle("Shopify recovery codes")).toBe("shopify");
    expect(labelFromTitle("Backup codes")).toBeNull();
  });

  it("puts a passkey on the login with the same user, ignoring case and spaces", () => {
    const work = login("work", { url: "https://github.com", username: "olivia@work.dev" });
    expect(loginForPasskey([github, work], "github.com", "olivia@northwind.dev")?.id).toBe(
      "github",
    );
  });

  it("puts a passkey on the only login of the site even when the site names the user differently", () => {
    expect(loginForPasskey([github], "github.com", "olivia-nw")?.id).toBe("github");
  });

  it("makes a new item when several logins could own the passkey", () => {
    const work = login("work", { url: "https://github.com", username: "olivia@work.dev" });
    expect(loginForPasskey([github, work], "github.com", "olivia-nw")).toBeUndefined();
  });

  it("never attaches to a login that already has a passkey, is in a team vault or in the trash", () => {
    for (const blocked of [
      { ...github, passkey },
      { ...github, vault: "team:org:team" },
      { ...github, trashedAt: 1 },
    ]) {
      expect(loginForPasskey([blocked], "github.com", "olivia-nw")).toBeUndefined();
    }
  });

  it("finds the login for a recovery codes file, but only one that has no codes yet", () => {
    expect(loginForCodes([github], "github-recovery-codes.txt")?.id).toBe("github");
    expect(loginForCodes([{ ...github, codes: ["x"] }], "github-recovery-codes")).toBeUndefined();
    expect(loginForCodes([github], "gitlab-recovery-codes")).toBeUndefined();
  });
});

describe("merging items of one site", () => {
  it("moves the passkey and the recovery codes into the login, keeping notes and used codes", () => {
    const [merge] = findSiteMerges([github, githubPasskey, githubCodes]);
    expect(merge).toMatchObject({
      domain: "github.com",
      target: { id: "github" },
      passkeyFrom: { id: "github-passkey" },
      codesFrom: { id: "github-codes" },
    });
    expect(mergedItem(merge!)).toMatchObject({
      id: "github",
      password: "Copper-Lantern-48-Fjord",
      passkey: { credentialId: "AQID" },
      codes: ["a1b2c-3d4e5", "f6g7h-8i9j0"],
      usedCodes: ["a1b2c-3d4e5"],
      note: "made on the laptop",
    });
  });

  it("does not merge two accounts of the same site", () => {
    const second = login("github-2", {
      url: "https://github.com",
      username: "olivia@work.dev",
      password: "Other-Password-91-Lake",
    });
    expect(findSiteMerges([github, second, githubPasskey, githubCodes])).toEqual([]);
  });

  it("leaves an item that holds more than a passkey where it is", () => {
    const busy = {
      ...githubPasskey,
      totp: { secret: "JBSWY3DP", algorithm: "SHA-1", digits: 6, period: 30 },
    } as VaultItem;
    expect(findSiteMerges([github, busy])).toEqual([]);
  });

  it("finds nothing to do when the login already has a passkey and codes", () => {
    const complete = { ...github, passkey, codes: ["x"] };
    expect(findSiteMerges([complete, githubPasskey, githubCodes])).toEqual([]);
  });
});
