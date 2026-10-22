import { describe, expect, it } from "vitest";
import type { VaultItem } from "../extension/lib/vault/types.js";
import {
  DEFAULT_VAULT_ID,
  vaultList,
  vaultOf,
  withoutVault,
  withVault,
} from "../extension/lib/vault/defs.js";

const record = (updatedAt: number, vaults: VaultItem["vaults"]): VaultItem => ({
  id: `r${updatedAt}`,
  title: "",
  system: "vaults",
  vaults,
  createdAt: 0,
  updatedAt,
});

describe("vaults", () => {
  it("always offers the personal vault, named in the user's language when unnamed", () => {
    expect(vaultList([], "Cá nhân")).toEqual([
      { id: DEFAULT_VAULT_ID, name: "Cá nhân", color: "teal", icon: "person" },
    ]);
    expect(vaultOf({})).toBe(DEFAULT_VAULT_ID);
    expect(vaultOf({ vault: "work" })).toBe("work");
  });

  it("merges records from two devices, newest definition winning", () => {
    const work = { id: "work", name: "Work", color: "sky", icon: "briefcase" };
    const family = { id: "family", name: "Family", color: "rose", icon: "users" };
    const merged = vaultList(
      [record(2, [{ ...work, name: "Job" }]), record(1, [work, family])],
      "Personal",
    );
    expect(merged.map((vault) => vault.name)).toEqual(["Personal", "Job", "Family"]);
  });

  it("adds, renames and removes vaults but never the personal one", () => {
    const base = vaultList([], "Personal");
    const added = withVault(base, { id: "work", name: "Work", color: "sky", icon: "briefcase" });
    expect(added).toHaveLength(2);
    expect(withVault(added, { ...added[1]!, name: "Job" })[1]!.name).toBe("Job");
    expect(withoutVault(added, "work")).toHaveLength(1);
    expect(withoutVault(added, DEFAULT_VAULT_ID)).toHaveLength(2);
  });
});
